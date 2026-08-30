const pool = require("../config/db");
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");

function formatDate(dateVal) {
  if (!dateVal) return "-";
  let d;
  if (dateVal instanceof Date) {
    d = dateVal;
  } else {
    const cleanStr = String(dateVal).split("T")[0].trim();
    d = new Date(cleanStr);
  }
  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = monthNames[d.getMonth()];
  return `${day}-${month}-${d.getFullYear()}`;
}

function getDaysRemaining(dateVal) {
  if (!dateVal || dateVal === "null" || dateVal === "undefined") return null;

  let target;
  if (dateVal instanceof Date) {
    target = new Date(dateVal.getTime());
  } else {
    const cleanStr = String(dateVal).split("T")[0].trim();
    target = new Date(cleanStr);
  }

  if (isNaN(target.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWN_EXPIRY_ID;

  if (!token || !chatId) {
    console.warn(
      "⚠️ Telegram configuration missing: TELEGRAM_BOT_TOKEN or TELEGRAM_OWN_EXPIRY_ID not set.",
    );
    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "HTML",
        }),
      },
    );
    const resData = await response.json();
    if (!resData.ok) {
      console.error("❌ Telegram API Error Response:", resData.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ Telegram Send Exception:", err.message);
    return false;
  }
}

async function sendExpiryEmail(htmlTable) {
  const toEmail = process.env.OWN_EQ_EXP_ALERT_MAIL;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!toEmail || !user || !pass) {
    console.warn(
      "⚠️ Email configuration missing: OWN_EQ_EXP_ALERT_MAIL, EMAIL_USER, or EMAIL_PASS not set.",
    );
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const mailOptions = {
    from: `"We1 Own Equipment Alert" <${user}>`,
    to: toEmail,
    subject: `⚠️ Own Equipment Expiry Alert - ${formatDate(new Date())}`,
    html: `
      <h3>Own Equipment Expiry Alert Report</h3>
      <p>Following equipment items are expired or expiring within 30 days:</p>
      ${htmlTable}
      <br>
      <p style="font-size:12px; color:#666;">This is an automated system generated alert.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(
      "📧 Expiry Alert Email Sent Successfully! Message ID:",
      info.messageId,
    );
    return true;
  } catch (err) {
    console.error("❌ Email Send Exception:", err.message);
    return false;
  }
}

async function checkAndSendOwnEqAlerts(isTest = false) {
  try {
    console.log("🔍 Fetching Running/Mobilizing Equipment from DB...");
    const query = `
      SELECT 
        m.plate_no,
        m.vehicle_type,
        m.site_name,
        m.driver_name,
        m.chassis_no,
        m.serial_no,
        m.eq_insurance_exp,
        m.fahs_mvpi_exp,
        m.op_card_exp,
        m.isthimaara_exp,
        d.iqama_no,
        d.iqama_expiry,
        d.licence_expiry
      FROM we1_own_eq_master m
      LEFT JOIN LATERAL (
        SELECT iqama_no, iqama_expiry, licence_expiry
        FROM we1_driver_log
        WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM(m.plate_no))
        ORDER BY COALESCE(join_date, '1970-01-01'::date) DESC, id DESC
        LIMIT 1
      ) d ON true
      WHERE m.status = 'Running' OR m.status = 'Mobilizing'
      ORDER BY m.id ASC
    `;

    const result = await pool.query(query);
    const rows = result.rows;
    console.log(`📊 Found ${rows.length} active equipment records.`);

    const alertItems = [];
    let shouldTriggerEmail = false;
    const emailMilestoneDays = [5, 10, 15, 20, 25, 30];

    for (const row of rows) {
      const iqamaDays = getDaysRemaining(row.iqama_expiry);
      const licenceDays = getDaysRemaining(row.licence_expiry);
      const insuranceDays = getDaysRemaining(row.eq_insurance_exp);
      const fahsDays = getDaysRemaining(row.fahs_mvpi_exp);
      const opCardDays = getDaysRemaining(row.op_card_exp);
      const isthimaaraDays = getDaysRemaining(row.isthimaara_exp);

      // Condition: Expired (< 0) or Expiring in next 30 days (<= 30)
      const hasAlert = 
        (iqamaDays !== null && iqamaDays <= 30) ||
        (licenceDays !== null && licenceDays <= 30) ||
        (insuranceDays !== null && insuranceDays <= 30) ||
        (fahsDays !== null && fahsDays <= 30) ||
        (opCardDays !== null && opCardDays <= 30) ||
        (isthimaaraDays !== null && isthimaaraDays <= 30);

      if (!hasAlert) continue;

      alertItems.push({
        ...row,
        iqamaDays,
        licenceDays,
        insuranceDays,
        fahsDays,
        opCardDays,
        isthimaaraDays
      });

      // Email Rule: Trigger ONLY if at least one item hits 5, 10, 15, 20, 25, or 30 days
      [iqamaDays, licenceDays, insuranceDays, fahsDays, opCardDays, isthimaaraDays].forEach((d) => {
        if (d !== null && (emailMilestoneDays.includes(d) || (isTest && d <= 30))) {
          shouldTriggerEmail = true;
        }
      });
    }

    console.log(`⚠️ Total Expiry Alert Items found: ${alertItems.length}`);

    if (alertItems.length === 0) {
      console.log(
        "✅ All equipment and driver documents are valid (> 30 days). No alerts needed.",
      );
      return;
    }

    // 1. Send Individual Telegram Message per Plate
    console.log("📲 Sending Telegram Alerts...");
    for (const item of alertItems) {
      let msg = `<b>Plate NO ::</b> ${item.plate_no || "-"}\n`;
      msg += `<b>Vehicle Type ::</b> ${item.vehicle_type || "-"}\n`;
      msg += `<b>Site Name ::</b> ${item.site_name || "-"}\n\n`;
      msg += `<b>Driver Name ::</b> ${item.driver_name || "-"}\n`;

      if (item.iqamaDays !== null && item.iqamaDays <= 30) {
        const tag =
          item.iqamaDays < 0
            ? `(EXPIRED ${Math.abs(item.iqamaDays)} days ago)`
            : `(${item.iqamaDays} days count)`;
        msg += `IQAMA Exp :: ${formatDate(item.iqama_expiry)} ${tag}\n`;
        msg += `IQAMA No :: ${item.iqama_no || "-"}\n`;
      }

      if (item.licenceDays !== null && item.licenceDays <= 30) {
        const tag =
          item.licenceDays < 0
            ? `(EXPIRED ${Math.abs(item.licenceDays)} days ago)`
            : `(${item.licenceDays} days count)`;
        msg += `Licence Exp :: ${formatDate(item.licence_expiry)} ${tag}\n`;
      }

      let eqSection = "";
      let hasEq = false;

      if (item.insuranceDays !== null && item.insuranceDays <= 30) {
        const tag =
          item.insuranceDays < 0
            ? `(EXPIRED ${Math.abs(item.insuranceDays)} days ago)`
            : `(${item.insuranceDays} days count)`;
        eqSection += `EQ Insurance :: ${formatDate(item.eq_insurance_exp)} ${tag}\n`;
        hasEq = true;
      }

      if (item.fahsDays !== null && item.fahsDays <= 30) {
        const tag = item.fahsDays < 0 ? `(EXPIRED ${Math.abs(item.fahsDays)} days ago)` : `(${item.fahsDays} days count)`;
        eqSection += `FAHS :: ${formatDate(item.fahs_mvpi_exp)} ${tag}\n`;
        eqSection += `Chassis No :: ${item.chassis_no || "-"}\n`;
        eqSection += `Serial No :: ${item.serial_no || "-"}\n`;
        hasEq = true;
      }

      if (item.opCardDays !== null && item.opCardDays <= 30) {
        const tag = item.opCardDays < 0 ? `(EXPIRED ${Math.abs(item.opCardDays)} days ago)` : `(${item.opCardDays} days count)`;
        eqSection += `Operation Card Exp :: ${formatDate(item.op_card_exp)} ${tag}\n`;
        hasEq = true;
      }

      if (item.isthimaaraDays !== null && item.isthimaaraDays <= 30) {
        const tag = item.isthimaaraDays < 0 ? `(EXPIRED ${Math.abs(item.isthimaaraDays)} days ago)` : `(${item.isthimaaraDays} days count)`;
        eqSection += `Isthimaara Exp :: ${formatDate(item.isthimaara_exp)} ${tag}\n`;
        hasEq = true;
      }

      if (hasEq) {
        msg += `\n${eqSection}`;
      }

      const sent = await sendTelegramMessage(msg);
      if (sent) console.log(`   ✔️ Telegram sent for Plate: ${item.plate_no}`);
      await new Promise((r) => setTimeout(r, 500));
    }

    // 2. Send Consolidated Email Table
    if (shouldTriggerEmail && alertItems.length > 0) {
      console.log("📨 Generating and Sending Expiry Email Table...");
      const getExpiryCellStyle = (days) => {
        if (days === null || days === undefined) return '';
        if (days < 0) {
          return 'background-color: #dc3545; color: #ffffff; font-weight: bold; text-align: center;';
        } else if (days <= 30) {
          return 'background-color: #fff3cd; color: #d97706; font-weight: bold; text-align: center;';
        }
        return '';
      };

      let tableHtml = `
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:Arial, sans-serif; font-size:12px; width:100%;">
          <tr style="background:#f2f2f2; text-align:left;">
            <th>SN</th>
            <th>Vehicle Type</th>
            <th>Plate No</th>
            <th>Driver Name</th>
            <th>Site Name</th>
            <th>IQAMA No</th>
            <th>IQAMA Exp</th>
            <th>License Expiry</th>
            <th>Chassis No</th>
            <th>Serial No</th>
            <th>EQ Insurance Exp</th>
            <th>FAHS/MVPI</th>
            <th>Operation Card Exp</th>
            <th>Isthimaara Exp</th>
          </tr>
      `;

      alertItems.forEach((r, idx) => {
        tableHtml += `
          <tr>
            <td style="text-align: center;">${idx + 1}</td>
            <td>${r.vehicle_type || "-"}</td>
            <td><strong>${r.plate_no || "-"}</strong></td>
            <td>${r.driver_name || "-"}</td>
            <td>${r.site_name || "-"}</td>
            <td>${r.iqama_no || "-"}</td>
            <td style="${getExpiryCellStyle(r.iqamaDays)}">${formatDate(r.iqama_expiry)}</td>
            <td style="${getExpiryCellStyle(r.licenceDays)}">${formatDate(r.licence_expiry)}</td>
            <td>${r.chassis_no || "-"}</td>
            <td>${r.serial_no || "-"}</td>
            <td style="${getExpiryCellStyle(r.insuranceDays)}">${formatDate(r.eq_insurance_exp)}</td>
            <td style="${getExpiryCellStyle(r.fahsDays)}">${formatDate(r.fahs_mvpi_exp)}</td>
            <td style="${getExpiryCellStyle(r.opCardDays)}">${formatDate(r.op_card_exp)}</td>
            <td style="${getExpiryCellStyle(r.isthimaaraDays)}">${formatDate(r.isthimaara_exp)}</td>
          </tr>
        `;
      });

      tableHtml += `</table>`;
      await sendExpiryEmail(tableHtml);
    } else {
      console.log(
        "ℹ️ Email not triggered (No milestone 5, 10, 15, 20, 25, 30 days met today).",
      );
    }
  } catch (error) {
    console.error("❌ Error in checkAndSendOwnEqAlerts:", error.message);
  }
}

module.exports = { checkAndSendOwnEqAlerts };
