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
      pool.query("SELECT plate_no, owner_name, site_name, vehicle_type, vat, driver_name, driver_mobile, field_co, site_co FROM timesheet_vehicles"),
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

      let nhr = saved ? parseFloat(saved.nhr) || 0 : 0;
      let othr = saved ? parseFloat(saved.othr) || 0 : 0;
      let rent = saved ? parseFloat(saved.rent) || 0 : 0;
      let vatAmt = saved ? parseFloat(saved.vat_amount) || 0 : 0;
      let total = saved ? parseFloat(saved.total) || (rent + vatAmt) : 0;

      resultRows.push({
        date: monthStr.substring(0, 3) + " " + yearStr.substring(2, 4),
        vtype: v.vehicle_type || "N/A",
        driver: v.driver_name || "N/A",
        site: v.site_name || "N/A",
        plate_no: displayPlate,
        owner: v.owner_name || "COMPANY VEHICLE",
        nhr,
        othr,
        nrate: saved ? parseFloat(saved.nrate) || 0 : 0,
        otrate: saved ? parseFloat(saved.otrate) || 0 : 0,
        rent,
        vat_amount: vatAmt,
        vat_percent: saved ? parseFloat(saved.vat_percent) || 0 : 0,
        total,
        invoice_no: invData.invoice_no || "",
        bill_no: invData.bill_no || "",
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

      // report.html സ്ക്രീനിൽ diff_clear ചെയ്തിട്ടില്ലെങ്കിൽ മാത്രം Difference പരിശോധിക്കുക
      if (!isDiffCleared) {
        // പോസിറ്റീവ് വാല്യൂസ് (ts_nr > inv_nr) മാത്രം എടുക്കുക, നെഗറ്റീവ് വാല്യൂസ് പൂർണ്ണമായി ഒഴിവാക്കുക
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
        rate: v.rate || saved?.nrate || "-",
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

module.exports = router;