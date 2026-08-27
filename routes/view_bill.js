const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const JWT_SECRET = process.env.JWT_SECRET;

// Helper function
function cleanPlate(p) {
  return String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// 🟢 Middlewares (Fixed Token Splitting .split(" ")[1])
const verifyViewBillUser = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "No token provided. Access Denied." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const dbRes = await pool.query(
      "SELECT id, username, display_name, role, status, assigned_sites FROM view_bill_users WHERE id = $1",
      [decoded.id]
    );

    if (dbRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: "User not found." });
    }

    const user = dbRes.rows[0];
    if (user.status !== "approved" && user.status !== "Active") {
      return res.status(403).json({ success: false, message: "Account pending admin approval." });
    }

    let sites = user.assigned_sites || [];
    if (typeof sites === "string") {
      try { sites = JSON.parse(sites); } catch (e) { sites = []; }
    }

    req.viewUser = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      assigned_sites: sites,
    };
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid or expired session." });
  }
};

const verifyViewBillSuperAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "No token provided. Access Denied." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const dbRes = await pool.query(
      "SELECT id, username, display_name, role, status FROM view_bill_users WHERE id = $1",
      [decoded.id]
    );

    if (dbRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: "User not found." });
    }

    const user = dbRes.rows[0];
    if (user.role !== "Super Admin") {
      return res.status(403).json({ success: false, message: "Access Denied: Super Admin only." });
    }

    req.viewUser = user;
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid or expired session." });
  }
};

// 1. User Signup
router.post("/signup", async (req, res) => {
  try {
    const { displayName, username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required." });
    }

    const cleanUsername = username.trim();
    const userCheck = await pool.query(
      "SELECT id FROM view_bill_users WHERE username = $1",
      [cleanUsername]
    );
    if (userCheck.rows.length > 0) {
      return res.json({ success: false, message: "Username already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = cleanUsername.toLowerCase() === "fefei" ? "Super Admin" : "Site Co";
    const userStatus = cleanUsername.toLowerCase() === "fefei" ? "approved" : "pending";

    await pool.query(
      "INSERT INTO view_bill_users (display_name, username, password_hash, role, status, assigned_sites) VALUES ($1, $2, $3, $4, $5, '[]'::jsonb)",
      [displayName || cleanUsername, cleanUsername, hashedPassword, userRole, userStatus]
    );

    const msg = userStatus === "approved" 
      ? "Registration successful! You can login now." 
      : "Registration successful! Awaiting Admin Approval.";

    res.json({ success: true, message: msg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. User Login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required." });
    }

    const result = await pool.query(
      "SELECT * FROM view_bill_users WHERE username = $1",
      [username.trim()]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, message: "User not found." });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.json({ success: false, message: "Invalid password." });
    }

    if (user.status !== "approved" && user.status !== "Active") {
      return res.json({ success: false, message: "Account pending admin approval." });
    }

    let sites = user.assigned_sites || [];
    if (typeof sites === "string") {
      try { sites = JSON.parse(sites); } catch (e) { sites = []; }
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        assigned_sites: sites,
        type: "view_bill",
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        assigned_sites: sites,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Verify Session
router.get("/verify-session", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "No token provided." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const dbUser = await pool.query(
      "SELECT id, username, display_name, role, status, assigned_sites FROM view_bill_users WHERE id = $1",
      [decoded.id]
    );

    if (dbUser.rows.length === 0) {
      return res.status(401).json({ success: false, message: "User not found." });
    }

    const user = dbUser.rows[0];
    if (user.status !== "approved" && user.status !== "Active") {
      return res.status(403).json({ success: false, message: "Account is not active." });
    }

    let sites = user.assigned_sites || [];
    if (typeof sites === "string") {
      try { sites = JSON.parse(sites); } catch (e) { sites = []; }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        assigned_sites: sites,
      },
    });
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid or expired session." });
  }
});

// 4. Admin Users List
router.get("/admin/users", verifyViewBillSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, display_name, username, role, status, assigned_sites, created_at FROM view_bill_users ORDER BY id ASC"
    );
    res.json({ success: true, users: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Admin Update User
router.post("/admin/update-user", verifyViewBillSuperAdmin, async (req, res) => {
  try {
    const { userId, role, status, assigned_sites } = req.body;
    await pool.query(
      "UPDATE view_bill_users SET role = $1, status = $2, assigned_sites = $3::jsonb WHERE id = $4",
      [role, status, JSON.stringify(assigned_sites || []), userId]
    );
    res.json({ success: true, message: "User updated successfully!" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. Admin Delete User
router.delete("/admin/delete-user/:id", verifyViewBillSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM view_bill_users WHERE id = $1", [id]);
    res.json({ success: true, message: "User deleted successfully!" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 7. Admin Sites List
router.get("/admin/sites-list", verifyViewBillSuperAdmin, async (req, res) => {
  try {
    const vSites = await pool.query("SELECT DISTINCT site_name FROM timesheet_vehicles WHERE site_name IS NOT NULL AND TRIM(site_name) != ''");
    const lSites = await pool.query("SELECT DISTINCT site_name FROM vehicle_site_log WHERE site_name IS NOT NULL AND TRIM(site_name) != ''");

    let allSites = new Set();
    vSites.rows.forEach((r) => allSites.add(r.site_name.trim()));
    lSites.rows.forEach((r) => allSites.add(r.site_name.trim()));

    res.json({ success: true, sites: Array.from(allSites).sort() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 8. Suggestions API
router.get("/suggestions", verifyViewBillUser, async (req, res) => {
  try {
    const user = req.viewUser;
    let siteFilterCondition = "TRUE";
    let params = [];

    if (user.role === "Site Co") {
      const assigned = user.assigned_sites || [];
      if (assigned.length === 0) {
        return res.json({ success: true, plates: [], owners: [], sites: [] });
      }
      siteFilterCondition = "TRIM(LOWER(site_name)) = ANY($1::text[])";
      params = [assigned.map((s) => String(s).trim().toLowerCase())];
    }

    const vehiclesRes = await pool.query(
      `SELECT DISTINCT plate_no, owner_name, site_name FROM timesheet_vehicles WHERE ${siteFilterCondition} ORDER BY plate_no ASC`,
      params
    );

    const siteLogRes = await pool.query(
      `SELECT DISTINCT plate_no, site_name FROM vehicle_site_log WHERE ${siteFilterCondition}`,
      params
    );

    let allowedPlates = new Set();
    let allowedOwners = new Set();
    let allowedSites = new Set();

    vehiclesRes.rows.forEach((r) => {
      if (r.plate_no) allowedPlates.add(r.plate_no.trim().toUpperCase());
      if (r.owner_name) allowedOwners.add(r.owner_name.trim().toUpperCase());
      if (r.site_name) allowedSites.add(r.site_name.trim());
    });

    siteLogRes.rows.forEach((r) => {
      if (r.plate_no) allowedPlates.add(r.plate_no.trim().toUpperCase());
      if (r.site_name) allowedSites.add(r.site_name.trim());
    });

    res.json({
      success: true,
      plates: Array.from(allowedPlates).sort(),
      owners: Array.from(allowedOwners).sort(),
      sites: Array.from(allowedSites).sort(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 9. View Bill Data API (Exact match with report.html: Active vehicles only + Accurate Calculations)
router.get("/data", verifyViewBillUser, async (req, res) => {
  try {
    const { month, year, search_type, search_value } = req.query;
    const user = req.viewUser;

    if (!month || !year) {
      return res.status(400).json({ success: false, message: "Month and Year are required." });
    }

    const monthStr = month.trim();
    const yearStr = year.trim();
    const fullMonth = `${monthStr} ${yearStr}`;

    const [vehiclesRes, sitesRes, driversRes, timesheetsRes, invoicesRes, billingRes, specialRulesRes] = await Promise.all([
      pool.query("SELECT plate_no, owner_name, site_name, vehicle_type, vat, driver_name, driver_mobile, field_co, site_co, rate FROM timesheet_vehicles"),
      pool.query("SELECT plate_no, site_name, work_start_date, work_end_date, rate, field_co, site_co, status FROM vehicle_site_log"),
      pool.query("SELECT plate_no, driver_name, driver_mobile, work_start_date, work_end_date, status FROM vehicle_driver_log"),
      pool.query("SELECT plate_no, record_date, calc_time, calc_distance, bd, remark, wrk_start, hmr_start FROM timesheet_daily_records WHERE month=$1 AND year=$2", [monthStr, yearStr]),
      pool.query("SELECT * FROM invoice_records WHERE month=$1", [fullMonth]),
      pool.query("SELECT * FROM billing_records WHERE billing_month=$1", [fullMonth]),
      pool.query("SELECT * FROM special_days_rules WHERE is_active = true")
    ]);

    let vehicles = vehiclesRes.rows;
    let siteLogs = sitesRes.rows;
    let timesheets = timesheetsRes.rows;
    let invoices = invoicesRes.rows;
    let billing = billingRes.rows;

    // 🟢 1. EXACT MONTH DATE RANGE CALCULATION FOR ACTIVE VEHICLES
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const mIdx = monthNames.indexOf(monthStr);
    const monthStart = new Date(parseInt(yearStr), mIdx, 1);
    const monthEnd = new Date(parseInt(yearStr), mIdx + 1, 0, 23, 59, 59, 999);
    const daysInMonth = monthEnd.getDate();

    // 🟢 2. FILTER VEHICLES: ONLY ACTIVE IN THIS MONTH (MATCHING REPORT.HTML LOGIC)
    vehicles = vehicles.filter((v) => {
      let normPlate = cleanPlate(v.plate_no);
      if (!normPlate) return false;

      let vSiteLogs = siteLogs.filter((s) => cleanPlate(s.plate_no) === normPlate);
      if (vSiteLogs.length === 0) return false;

      return vSiteLogs.some((s) => {
        let st = s.work_start_date ? new Date(s.work_start_date) : new Date(2000, 0, 1);
        let ed = s.work_end_date ? new Date(s.work_end_date) : new Date(2100, 11, 31);
        if (s.status === "Running" && !s.work_end_date) ed = new Date(2100, 11, 31);

        return st <= monthEnd && ed >= monthStart;
      });
    });

    // 🟢 3. SITE CO PERMISSION FILTERING
    if (user.role === "Site Co") {
      const assigned = (user.assigned_sites || []).map((s) => String(s).trim().toLowerCase());
      if (assigned.length === 0) {
        return res.json({ success: true, rows: [], reportData: [] });
      }

      siteLogs = siteLogs.filter((s) => s.site_name && assigned.includes(s.site_name.trim().toLowerCase()));
      vehicles = vehicles.filter((v) =>
        (v.site_name && assigned.includes(v.site_name.trim().toLowerCase())) ||
        siteLogs.some((s) => cleanPlate(s.plate_no) === cleanPlate(v.plate_no))
      );
    }

    // 🟢 4. SEARCH QUERY FILTERING
    if (search_value && search_value.trim() !== "") {
      const cleanVal = search_value.trim().toUpperCase();
      if (search_type === "plate") {
        vehicles = vehicles.filter((v) => (v.plate_no || "").trim().toUpperCase().includes(cleanVal));
      } else if (search_type === "owner") {
        vehicles = vehicles.filter((v) => (v.owner_name || "").trim().toUpperCase().includes(cleanVal));
      } else {
        vehicles = vehicles.filter((v) =>
          (v.plate_no || "").trim().toUpperCase().includes(cleanVal) ||
          (v.owner_name || "").trim().toUpperCase().includes(cleanVal)
        );
      }
    }

    let resultRows = [];
    let reportData = [];

    vehicles.forEach((v) => {
      let displayPlate = (v.plate_no || "").trim().toUpperCase();
      let normPlate = cleanPlate(v.plate_no);
      if (!normPlate) return;

      let saved = billing.find((b) => cleanPlate(b.plate_no) === normPlate);
      let vInvs = invoices.filter((i) => cleanPlate(i.plate_no) === normPlate);
      let invData = vInvs[0] || {};

      // Fetch dynamic rate from site logs or vehicle master
      let activeSiteLog = siteLogs.find(s => 
          cleanPlate(s.plate_no) === normPlate && 
          (s.site_name || "").trim().toLowerCase() === (v.site_name || "").trim().toLowerCase()
      );
      
      let baseRate = activeSiteLog && activeSiteLog.rate ? parseFloat(activeSiteLog.rate) : (parseFloat(v.rate) || 0);
      let calculatedNRate = baseRate ? (baseRate / 260) : 0;
      let calculatedOTRate = baseRate ? ((baseRate / 260) * 0.7) : 0;

      let nhr = saved ? parseFloat(saved.nhr) || 0 : 0;
      let othr = saved ? parseFloat(saved.othr) || 0 : 0;
      
      // Override 0 rates with database calculated rates
      let nrate = (saved && parseFloat(saved.nrate) > 0) ? parseFloat(saved.nrate) : calculatedNRate;
      let otrate = (saved && parseFloat(saved.otrate) > 0) ? parseFloat(saved.otrate) : calculatedOTRate;

      // Calculate dynamic rent and total if not saved
      let rent = (saved && parseFloat(saved.rent) > 0) ? parseFloat(saved.rent) : ((nhr * nrate) + (othr * otrate));
      let vatAmt = saved ? parseFloat(saved.vat_amount) || 0 : 0;
      let total = (saved && parseFloat(saved.total) > 0) ? parseFloat(saved.total) : (rent + vatAmt);

      resultRows.push({
        date: monthStr.substring(0, 3) + " " + yearStr.substring(2, 4),
        vtype: v.vehicle_type || "N/A",
        driver: v.driver_name || "N/A",
        site: v.site_name || "N/A",
        plate_no: displayPlate,
        owner: v.owner_name || "COMPANY VEHICLE",
        nhr,
        othr,
        nrate: nrate,
        otrate: otrate,
        rent,
        vat_amount: vatAmt,
        vat_percent: saved ? parseFloat(saved.vat_percent) || 0 : 0,
        total,
        invoice_no: invData.invoice_no || "",
        bill_no: invData.bill_no || "",
        remark: saved ? (saved.remark || "") : ""  // 🟢 ഈ വരി നിർബന്ധമായും ചേർക്കണം!
      });

      // 🟢 5. REPORT.HTML ACCURATE LOGSHEET CALCULATION (FRIDAYS, 31ST, SPECIAL RULES)
      let ts_nr = 0, ts_ot = 0;
      let vTs = timesheets.filter((t) => cleanPlate(t.plate_no) === normPlate);

      for (let i = 1; i <= daysInMonth; i++) {
        let checkDate = new Date(parseInt(yearStr), mIdx, i);
        let formattedDate = checkDate.toLocaleDateString("en-GB", {
          day: "2-digit", month: "short", year: "numeric"
        }).replace(/ /g, " ");

        let dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][checkDate.getDay()];
        let siteForRule = (v.site_name || "").split("&")[0].trim().toUpperCase();
        
        let specialRule = specialRulesRes.rows.find(
          (r) => r.is_active && (r.sites.includes("ALL") || r.sites.includes(siteForRule)) && r.dates.includes(formattedDate)
        );

        let ts = vTs.find((r) => parseInt(r.record_date) === i);
        let tm = ts ? parseFloat(ts.calc_time) || 0 : 0;
        let bd = ts ? String(ts.bd || "").trim().toUpperCase() : "";
        let hasData = tm > 0 || bd !== "" || (ts && (ts.wrk_start || ts.hmr_start));

        if (!hasData && specialRule && specialRule.rule_type !== "FULL_OT") {
          bd = specialRule.rule_type;
          hasData = true;
        }

        if (!hasData) continue;

        let isFullOT = (dayName === "Fri" || i === 31);
        if (specialRule && specialRule.rule_type === "FULL_OT") isFullOT = true;

        let nHr = 0, otHr = 0;
        if (bd === "ID" || bd === "NP" || bd === "W" || bd === "P") {
          if (isFullOT) otHr = 10;
          else nHr = 10;
        } else if (bd === "B" || bd === "H" || bd === "A" || bd === "L" || bd === "S") {
          nHr = 0; otHr = 0;
        } else if (tm > 0) {
          if (isFullOT) otHr = tm;
          else {
            if (tm > 10) { nHr = 10; otHr = tm - 10; }
            else { nHr = tm; otHr = 0; }
          }
        }

        ts_nr += nHr;
        ts_ot += otHr;
      }

      let inv_nr = parseFloat(invData.bill_nr) || 0;
      let inv_ot = parseFloat(invData.bill_ot) || 0;
      let bill_sup_nr = parseFloat(saved?.nhr) || 0;
      let bill_sup_ot = parseFloat(saved?.othr) || 0;

      // 🟢 6. ACCURATE DIFFERENCE CALCULATION (Positive Only + Respects 'diff_clear' from report screen)
      let isDiffCleared = invData.diff_clear && !["no", "false", "0", "", "null", "undefined"].includes(String(invData.diff_clear).trim().toLowerCase());

      let diff_nr = "";
      let diff_ot = "";
      let diff_st = "";

      if (!isDiffCleared) {
        if (ts_nr > inv_nr) {
          diff_nr = parseFloat((ts_nr - inv_nr).toFixed(2));
        }
        if (ts_ot > inv_ot) {
          diff_ot = parseFloat((ts_ot - inv_ot).toFixed(2));
        }

        if (diff_nr !== "" && diff_ot !== "") diff_st = "NR & OT";
        else if (diff_nr !== "") diff_st = "NR";
        else if (diff_ot !== "") diff_st = "OT";
      }

      reportData.push({
        report_date: monthStr.substring(0, 3) + " " + yearStr.substring(2, 4),
        rate: baseRate || saved?.nrate || "-",
        vat: (v.vat || "No").toLowerCase().includes("yes") ? "Yes" : "No",
        site: v.site_name || "N/A",
        owner: v.owner_name || "COMPANY VEHICLE",
        driver_name: v.driver_name || "N/A",
        plate: displayPlate,
        ts_nr: ts_nr > 0 ? ts_nr : "",
        ts_ot: ts_ot > 0 ? ts_ot : "",
        inv_nr: inv_nr > 0 ? inv_nr : "",
        inv_ot: inv_ot > 0 ? inv_ot : "",
        bill_db_nr: bill_sup_nr > 0 ? bill_sup_nr : "",
        bill_db_ot: bill_sup_ot > 0 ? bill_sup_ot : "",
        diff_nr,
        diff_ot,
        diff_st,
      });
    });

    res.json({
      success: true,
      rows: resultRows,
      reportData,
      role: user.role,
      assigned_sites: user.assigned_sites || [],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/combined-bill", verifyViewBillUser, async (req, res) => {
  try {
    const { plate_no, from_month, from_year, to_month, to_year } = req.query;
    const user = req.viewUser;

    if (!plate_no || !from_month || !from_year || !to_month || !to_year) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: plate_no, from_month, from_year, to_month, to_year",
      });
    }

    const cleanPlate = plate_no.trim().toUpperCase();

    // Site Co പെർമിഷൻ ചെക്ക്
    if (user.role === "Site Co") {
      const assigned = (user.assigned_sites || []).map((s) => String(s).trim().toLowerCase());
      
      const vehicleCheck = await pool.query(
        `SELECT site_name FROM timesheet_vehicles WHERE UPPER(TRIM(plate_no)) = $1`,
        [cleanPlate]
      );
      const siteLogCheck = await pool.query(
        `SELECT site_name FROM vehicle_site_log WHERE UPPER(TRIM(plate_no)) = $1`,
        [cleanPlate]
      );

      let vSites = new Set();
      if (vehicleCheck.rows[0]?.site_name) vSites.add(vehicleCheck.rows[0].site_name.trim().toLowerCase());
      siteLogCheck.rows.forEach(r => { if (r.site_name) vSites.add(r.site_name.trim().toLowerCase()); });

      let hasAccess = Array.from(vSites).some(site => assigned.includes(site));
      if (!hasAccess && assigned.length > 0) {
        // Status 403 മാറ്റി 200/400 നൽകുന്നു (ലോഗൗട്ട് ആകാതിരിക്കാൻ)
        return res.json({ 
          success: false, 
          message: "Plate no not exist or no permission! Contact Administrator." 
        });
      }
    }

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    const fromMIdx = monthNames.indexOf(from_month.trim());
    const toMIdx = monthNames.indexOf(to_month.trim());
    const startYr = parseInt(from_year, 10);
    const endYr = parseInt(to_year, 10);

    if (fromMIdx === -1 || toMIdx === -1 || isNaN(startYr) || isNaN(endYr)) {
      return res.status(400).json({ success: false, message: "Invalid month or year selection." });
    }

    let targetMonths = [];
    let curDate = new Date(startYr, fromMIdx, 1);
    let endDate = new Date(endYr, toMIdx, 1);

    while (curDate <= endDate) {
      let mName = monthNames[curDate.getMonth()];
      let yNum = curDate.getFullYear();
      targetMonths.push(`${mName} ${yNum}`);
      curDate.setMonth(curDate.getMonth() + 1);
    }

    const savedResult = await pool.query(
      `SELECT * FROM billing_records 
       WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM($1)) 
         AND billing_month = ANY($2::text[])
       ORDER BY TO_DATE(billing_month, 'Month YYYY') ASC, id ASC`,
      [cleanPlate, targetMonths]
    );

    const tsVehicleRes = await pool.query(
      `SELECT * FROM timesheet_vehicles WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM($1)) LIMIT 1`,
      [cleanPlate]
    );

    const vehicleInfo = tsVehicleRes.rows[0] || {};

    let combinedRows = [];
    let totals = { nhr: 0, othr: 0, rent: 0, vat_amount: 0, total: 0, adjusted_amount: 0, after_adjustment: 0 };

    targetMonths.forEach((mStr) => {
      let savedRow = savedResult.rows.find((r) => r.billing_month === mStr);

      const [mName, yStr] = mStr.split(" ");
      const shortDate = mName.substring(0, 3) + " " + (yStr ? yStr.substring(2, 4) : "");

      if (savedRow) {
        let nhr = parseFloat(savedRow.nhr) || 0;
        let othr = parseFloat(savedRow.othr) || 0;
        let rent = parseFloat(savedRow.rent) || 0;
        let vatAmt = parseFloat(savedRow.vat_amount) || 0;
        let total = parseFloat(savedRow.total) || (rent + vatAmt);
        let adjAmt = parseFloat(savedRow.adjusted_amount) || 0;
        let afterAdj = parseFloat(savedRow.after_adjustment) || (total + adjAmt);

        totals.nhr += nhr;
        totals.othr += othr;
        totals.rent += rent;
        totals.vat_amount += vatAmt;
        totals.total += total;
        totals.adjusted_amount += adjAmt;
        totals.after_adjustment += afterAdj;

        // 🟢 Site Name ൽ നിന്നും ശരിയായ കമ്പനി കണ്ടുപിടിക്കുന്നു (report.html ലെ അതേ ലോജിക്)
        let rowSite = savedRow.site_name || vehicleInfo.site_name || "N/A";
        let autoCompany = "Haka";
        let sUpper = rowSite.toUpperCase();
        if (sUpper.includes("ALJODA") || sUpper.includes("AL JODA")) autoCompany = "Aljoda";
        else if (sUpper.includes("MASAR")) autoCompany = "Masar Wheels";
        else if (sUpper.includes("WE1") || sUpper.includes("WE 1")) autoCompany = "We1 Track";

        combinedRows.push({
          billing_month: mStr,
          date: savedRow.date || shortDate,
          company: autoCompany, // 🟢 Always use autoCompany calculated from Site
          owner: savedRow.owner || vehicleInfo.owner_name || "COMPANY VEHICLE",
          site_name: rowSite,
          vtype: savedRow.vtype || vehicleInfo.vehicle_type || "N/A",
          driver: savedRow.driver || vehicleInfo.driver_name || "N/A",
          plate_no: cleanPlate,
          nhr: nhr,
          nrate: parseFloat(savedRow.nrate) || 0,
          othr: othr,
          otrate: parseFloat(savedRow.otrate) || 0,
          rent: rent,
          vat_percent: parseFloat(savedRow.vat_percent) || 0,
          vat_amount: vatAmt,
          total: total,
          adjustment_desc: savedRow.adjustment_desc || "",
          adjusted_amount: adjAmt,
          after_adjustment: afterAdj,
          remark: savedRow.remark || ""
        });
      } else {
        let activeSite = vehicleInfo.site_name || "N/A";
        let autoCompany = "Haka";
        let sUpper = activeSite.toUpperCase();
        if (sUpper.includes("ALJODA") || sUpper.includes("AL JODA")) autoCompany = "Aljoda";
        else if (sUpper.includes("MASAR")) autoCompany = "Masar Wheels";
        else if (sUpper.includes("WE1") || sUpper.includes("WE 1")) autoCompany = "We1 Track";

        combinedRows.push({
          billing_month: mStr,
          date: shortDate,
          company: autoCompany,
          owner: vehicleInfo.owner_name || "COMPANY VEHICLE",
          site_name: activeSite,
          vtype: vehicleInfo.vehicle_type || "N/A",
          driver: vehicleInfo.driver_name || "N/A",
          plate_no: cleanPlate,
          nhr: 0,
          nrate: parseFloat(vehicleInfo.rate) || 0,
          otrate: (parseFloat(vehicleInfo.rate) || 0) * 0.7,
          rent: 0,
          vat_percent: 0,
          vat_amount: 0,
          total: 0,
          adjustment_desc: "",
          adjusted_amount: 0,
          after_adjustment: 0,
          remark: ""
        });
      }
    });

    res.status(200).json({
      success: true,
      plate_no: cleanPlate,
      vehicle_info: vehicleInfo,
      rows: combinedRows,
      totals: totals
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// 🟢 Security Code Verification for Combined Bill Generator Images in View Bill
router.post("/verify-combined-security", verifyViewBillUser, (req, res) => {
  try {
    const { code } = req.body;
    const validCode = process.env.COMBINED_GENERATOR_CODE || "12345";

    if (code === validCode) {
      res.json({ success: true, message: "Security Code Verified!" });
    } else {
      res.json({ success: false, message: "Invalid Security Code!" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 🟢 1. Single Remark Auto-Save Endpoint
router.post("/save-remark", verifyViewBillUser, async (req, res) => {
  try {
    const { plate_no, month, site_name, remark } = req.body;
    const cleanPlate = (plate_no || "").trim().toUpperCase();

    // 🟢 500 Error Fix: Removed site_name from the condition to avoid matching issues
    const check = await pool.query(
      `SELECT id FROM billing_records WHERE UPPER(TRIM(plate_no)) = $1 AND billing_month = $2`,
      [cleanPlate, month]
    );

    if (check.rows.length > 0) {
      await pool.query(
        `UPDATE billing_records SET remark = $1 WHERE id = $2`,
        [remark || "", check.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO billing_records (plate_no, billing_month, site_name, remark, nhr, othr, rent, total) 
         VALUES ($1, $2, $3, $4, 0, 0, 0, 0)`,
        [cleanPlate, month, site_name || "N/A", remark || ""]
      );
    }

    res.json({ success: true, message: "Remark saved successfully!" });
  } catch (error) {
    console.error("Save Remark Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 🟢 2. Save Active Calculated Screen Data (Triggered on Copy/Download)
router.post("/save-active-bill", verifyViewBillUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const { month, items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: "No items provided." });
    }

    await client.query("BEGIN");

    for (let row of items) {
      const cleanPlate = (row.plate_no || "").trim().toUpperCase();
      const nhr = parseFloat(row.nhr) || 0;
      const othr = parseFloat(row.othr) || 0;
      const nrate = parseFloat(row.nrate) || 0;
      const otrate = parseFloat(row.otrate) || 0;
      const rent = parseFloat(row.rent) || 0;
      const vatAmt = parseFloat(row.vat_amount) || 0;
      const total = parseFloat(row.total) || (rent + vatAmt);
      const remark = (row.remark || "").trim();

      const check = await client.query(
        `SELECT id FROM billing_records WHERE UPPER(TRIM(plate_no)) = $1 AND billing_month = $2 AND site_name = $3`,
        [cleanPlate, month, row.site]
      );

      if (check.rows.length > 0) {
        await client.query(
          `UPDATE billing_records SET 
            nrate = COALESCE(NULLIF($1, 0), nrate),
            otrate = COALESCE(NULLIF($2, 0), otrate),
            rent = COALESCE(NULLIF($3, 0), rent),
            vat_amount = $4,
            total = COALESCE(NULLIF($5, 0), total),
            remark = $6
           WHERE id = $7`,
          [nrate, otrate, rent, vatAmt, total, remark, check.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO billing_records 
            (billing_month, date, owner, site_name, vtype, driver, plate_no, nhr, nrate, othr, otrate, rent, vat_amount, total, remark) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            month, row.date, row.owner, row.site, row.vtype, row.driver,
            cleanPlate, nhr, nrate, othr, otrate, rent, vatAmt, total, remark
          ]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Active bill data auto-saved!" });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// 🟢 Save Edited Bill from View Bill Screen (For Site Co & View Bill Users)
router.post("/save-bill", verifyViewBillUser, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { billing_period, items } = req.body;

    for (let row of items) {
      const cleanPlate = (row.plate || row.plate_no || "").trim().toUpperCase();
      const nhr = parseFloat(row.nhr) || 0;
      const othr = parseFloat(row.othr) || 0;
      const rent = parseFloat(row.rent) || 0;
      const adjAmt = parseFloat(row.adjusted_amount) || 0;
      const remark = (row.remark || "").trim();

      if (nhr === 0 && othr === 0 && rent === 0 && adjAmt === 0 && remark === "") {
        continue;
      }

      await client.query(
        `DELETE FROM billing_records WHERE billing_month = $1 AND UPPER(TRIM(plate_no)) = $2 AND site_name = $3`,
        [billing_period, cleanPlate, row.site_name]
      );

      const query = `INSERT INTO billing_records 
                (billing_month, date, company, owner, site_name, vtype, driver, plate_no, nhr, nrate, othr, otrate, rent, vat_percent, vat_amount, total, adjustment_desc, adjusted_amount, after_adjustment, remark) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`;

      await client.query(query, [
        billing_period, row.date, row.company, row.owner, row.site_name, row.vtype, row.driver, cleanPlate,
        nhr, row.nrate, othr, row.otrate, rent, row.vat_percent, row.vat_amount, row.total,
        row.adjustment_desc || "", adjAmt, row.after_adjustment, remark
      ]);
    }
    await client.query("COMMIT");
    res.json({ success: true, message: "Saved successfully to ERP!" });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});


module.exports = router;