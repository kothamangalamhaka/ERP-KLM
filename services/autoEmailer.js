const cron = require("node-cron");
const nodemailer = require("nodemailer");
const pool = require("../config/db"); // Adjust path according to your structure

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_ALL = process.env.PENDING_REPORT_EMAIL_ALL;
const EMAIL_WE1 = process.env.PENDING_REPORT_EMAIL_WE1;

const monthNames = [
  "January", "February", "March", "April", "May", "June", 
  "July", "August", "September", "October", "November", "December"
];

// Helper: Get Day Name
function getDayName(dayNum, monthIdx, year) {
  const d = new Date(year, monthIdx, dayNum);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

// Helper: Parse Log Date
function parseLogDate(dVal, defaultDate) {
  if (!dVal) return defaultDate;
  let d = new Date(dVal);
  if (isNaN(d.getTime())) return defaultDate;
  return d;
}

// Helper: Check if vehicle is active on a specific date
function isVehicleActiveOnDate(d, sLogs, dLogs) {
  let sActive = false;
  if (!sLogs || sLogs.length === 0) {
    sActive = true;
  } else {
    for (let i = 0; i < sLogs.length; i++) {
      let st = parseLogDate(sLogs[i].work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(sLogs[i].work_end_date, new Date("2099-01-01"));
      if (d >= st && d <= ed) {
        sActive = true;
        break;
      }
    }
  }

  let dActive = false;
  if (!dLogs || dLogs.length === 0) {
    dActive = true;
  } else {
    for (let i = 0; i < dLogs.length; i++) {
      let st = parseLogDate(dLogs[i].work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(dLogs[i].work_end_date, new Date("2099-01-01"));
      if (d >= st && d <= ed) {
        dActive = true;
        break;
      }
    }
  }
  return sActive && dActive;
}

async function generatePendingData() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = now.getFullYear();
  const mIdx = now.getMonth();
  const m = monthNames[mIdx];
  
  // Checking pending data up to yesterday to give drivers time to fill today's data
  const upToDay = now.getDate() === 1 ? 1 : now.getDate() - 1; 
  const monthStart = new Date(y, mIdx, 1);
  const monthEnd = new Date(y, mIdx + 1, 0);

  const vehiclesRes = await pool.query("SELECT * FROM timesheet_vehicles ORDER BY plate_no ASC");
  const recordsRes = await pool.query("SELECT * FROM timesheet_daily_records WHERE month=$1 AND year=$2", [m, y]);
  const driverLogsRes = await pool.query("SELECT * FROM vehicle_driver_log");
  const siteLogsRes = await pool.query("SELECT * FROM vehicle_site_log");

  const vehicles = vehiclesRes.rows;
  const records = recordsRes.rows;
  const allDriverLogs = driverLogsRes.rows;
  const allSiteLogs = siteLogsRes.rows;

  let pendingList = [];

  vehicles.forEach((v) => {
    const plate = v.plate_no;
    const vRecords = records.filter((r) => r.plate_no === plate);
    const dLogs = allDriverLogs.filter((l) => l.plate_no === plate);
    const sLogs = allSiteLogs.filter((l) => l.plate_no === plate);

    let activeDrivers = dLogs.filter((d) => {
      let st = parseLogDate(d.work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(d.work_end_date, new Date("2099-01-01"));
      return st <= monthEnd && ed >= monthStart;
    });

    let activeSites = sLogs.filter((s) => {
      let st = parseLogDate(s.work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(s.work_end_date, new Date("2099-01-01"));
      return st <= monthEnd && ed >= monthStart;
    });

    let currSite = activeSites.map((s) => s.site_name).join(" & ") || v.site_name || "N/A";
    
    // 🔴 മാറ്റിയിരിക്കുന്ന ഭാഗം: 'Z' ൽ തുടങ്ങുന്ന സൈറ്റുകൾ ഒഴിവാക്കുന്നു (case-insensitive)
    if (currSite.trim().toUpperCase().startsWith("Z")) {
      return; // ഇത് ഈ വണ്ടിയെ ഒഴിവാക്കി അടുത്തതിലേക്ക് പോകും
    }

    let ownerName = v.owner_name || "N/A";
    let currDriver = activeDrivers.map((d) => d.driver_name).join(" & ") || v.driver_name || "N/A";
    
    let blankDays = [];

    for (let i = 1; i <= upToDay; i++) {
      let dayName = getDayName(i, mIdx, y);
      if (dayName === "Fri") continue; // Skip Fridays

      let checkDate = new Date(y, mIdx, i);

      if (isVehicleActiveOnDate(checkDate, sLogs, dLogs)) {
        const rec = vRecords.find((r) => parseInt(r.record_date) === i) || {};
        let timeRaw = parseFloat(rec.calc_time) || 0;
        let bdStr = String(rec.bd || "").trim();
        let wsStr = String(rec.wrk_start || "").trim();
        let hsStr = String(rec.hmr_start || "").trim();
        let remStr = String(rec.remark || "").trim();

        if (timeRaw === 0 && bdStr === "" && wsStr === "" && hsStr === "" && remStr === "") {
          blankDays.push(i);
        }
      }
    }

    if (blankDays.length > 0) {
      pendingList.push({
        site: currSite,
        owner: ownerName,
        driver: currDriver,
        plate: plate,
        pendingDates: blankDays.join(", "),
      });
    }
  });

  return pendingList;
}

// Function to send the emails
async function sendDailyPendingEmails() {
  try {
    const pendingList = await generatePendingData();
    
    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });

    const nowStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    // ==========================================
    // EMAIL 1: All Vehicles -> Kothamangalamhaka (Everyday)
    // ==========================================
    if (pendingList.length > 0 && EMAIL_ALL) {
      let siteCounts = {};
      pendingList.forEach(item => {
        siteCounts[item.site] = (siteCounts[item.site] || 0) + 1;
      });

      // 🔴 മാറ്റിയിരിക്കുന്ന ഭാഗം: സൈറ്റ് കൗണ്ട് അക്ഷരമാലാക്രമത്തിൽ (Alphabetical sorting)
      let siteHtml = Object.keys(siteCounts)
        .sort()
        .map(site => `<li><b>${site}:</b> ${siteCounts[site]}</li>`)
        .join("");

      let tableHtml = pendingList.map(row => `
        <tr>
          <td style="padding:8px; border:1px solid #ddd;">${row.site}</td>
          <td style="padding:8px; border:1px solid #ddd;">${row.owner}</td>
          <td style="padding:8px; border:1px solid #ddd; font-weight:bold;">${row.plate}</td>
          <td style="padding:8px; border:1px solid #ddd; color:#d9534f;">${row.pendingDates}</td>
        </tr>
      `).join("");

      let mail1Html = `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #2c3e50;">Daily Pending Log Sheets</h2>
          <p>Generated on: ${nowStr} (IST)</p>
          <hr>
          <h3>Total Pending Vehicles: <span style="color: #d9534f;">${pendingList.length}</span></h3>
          <h4>Site-wise Count:</h4>
          <ul>${siteHtml}</ul>
          <br>
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="background-color: #f4f4f4;">
                <th style="padding:10px; border:1px solid #ddd;">Site Name</th>
                <th style="padding:10px; border:1px solid #ddd;">Owner Name</th>
                <th style="padding:10px; border:1px solid #ddd;">Plate No</th>
                <th style="padding:10px; border:1px solid #ddd;">Pending Dates</th>
              </tr>
            </thead>
            <tbody>${tableHtml}</tbody>
          </table>
        </div>
      `;

      await transporter.sendMail({
        from: `"Haka ERP" <${EMAIL_USER}>`,
        to: EMAIL_ALL,
        subject: `Daily Pending Logs Report - ${new Date().toLocaleDateString('en-IN')}`,
        html: mail1Html,
      });
      console.log("Email 1 (All) sent successfully.");
    }

    // ==========================================
    // EMAIL 2: 'We1' Owners Only -> 3 ദിവസത്തിൽ ഒരിക്കൽ മാത്രം
    // ==========================================
    
    // 🔴 മാറ്റിയിരിക്കുന്ന ഭാഗം: 3 ദിവസത്തെ ഇടവേള കണ്ടെത്താനുള്ള ലോജിക്ക്
    // നാളത്തെ തീയതി (June 29, 2026) ഒരു റെഫറൻസ് ആയി വെക്കുന്നു.
    const refDate = new Date("2026-06-29T00:00:00+05:30"); 
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    today.setHours(0, 0, 0, 0);
    refDate.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - refDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // ജൂൺ 29, ജൂലൈ 2, ജൂലൈ 5 എന്നീ ദിവസങ്ങളിൽ വ്യത്യാസം 3-ന്റെ ഗുണിതമായിരിക്കും (0, 3, 6...)
    const isWe1Day = Math.abs(diffDays) % 3 === 0;

    if (isWe1Day) {
      const we1List = pendingList.filter(row => row.owner.toLowerCase().includes("we1"));
      
      if (we1List.length > 0 && EMAIL_WE1) {
        let we1SiteCounts = {};
        we1List.forEach(item => {
          we1SiteCounts[item.site] = (we1SiteCounts[item.site] || 0) + 1;
        });

        // 🔴 മാറ്റിയിരിക്കുന്ന ഭാഗം: We1 സൈറ്റ് കൗണ്ട് അക്ഷരമാലാക്രമത്തിൽ
        let we1SiteHtml = Object.keys(we1SiteCounts)
          .sort()
          .map(site => `<li><b>${site}:</b> ${we1SiteCounts[site]}</li>`)
          .join("");

        let we1TableHtml = we1List.map(row => `
          <tr>
            <td style="padding:8px; border:1px solid #ddd;">${row.site}</td>
            <td style="padding:8px; border:1px solid #ddd;">${row.driver}</td>
            <td style="padding:8px; border:1px solid #ddd; font-weight:bold;">${row.plate}</td>
            <td style="padding:8px; border:1px solid #ddd; color:#d9534f;">${row.pendingDates}</td>
          </tr>
        `).join("");

        let mail2Html = `
          <div style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #2c3e50;">We1 - Pending Log Sheets</h2>
            <p>Generated on: ${nowStr} (IST)</p>
            <hr>
            <h3>Total We1 Pending Vehicles: <span style="color: #d9534f;">${we1List.length}</span></h3>
            <h4>Site-wise Count:</h4>
            <ul>${we1SiteHtml}</ul>
            <br>
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
              <thead>
                <tr style="background-color: #f4f4f4;">
                  <th style="padding:10px; border:1px solid #ddd;">Site Name</th>
                  <th style="padding:10px; border:1px solid #ddd;">Driver Name</th>
                  <th style="padding:10px; border:1px solid #ddd;">Plate No</th>
                  <th style="padding:10px; border:1px solid #ddd;">Pending Dates</th>
                </tr>
              </thead>
              <tbody>${we1TableHtml}</tbody>
            </table>
          </div>
        `;

        await transporter.sendMail({
          from: `"Own Equipment Logsheet Pending" <${EMAIL_USER}>`,
          to: EMAIL_WE1,
          subject: `We1 Pending Logs Report - ${new Date().toLocaleDateString('en-IN')}`,
          html: mail2Html,
        });
        console.log("Email 2 (We1) sent successfully.");
      }
    } else {
      console.log("Skipped We1 email today. It is scheduled to run every 3 days.");
    }

  } catch (error) {
    console.error("Error sending daily pending emails:", error);
  }
}

// 🟢 Schedule Cron Job at 10:00 AM IST Every Day
function startEmailCron() {
  cron.schedule("0 10 * * *", () => {
    console.log("Running Daily Pending Email Job...");
    sendDailyPendingEmails();
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata" // Strictly follow IST
  });
  console.log("Pending Email Cron Job scheduled for 10:00 AM IST.");
}



module.exports = { startEmailCron };