const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

const verifyBillingEditor = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "No token provided. Access Denied." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const allowedRoles = ["Super Admin", "Admin", "User"];

    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Viewers cannot edit driver billing.",
      });
    }
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid or expired session" });
  }
};

router.use(verifyBillingEditor);

// 🟢 1. Fetch Drivers & Vehicle Logs for Driver OT Billing
router.get("/vehicles", async (req, res) => {
  try {
    const { month } = req.query;

    const [tsVehicles, driverLogs, siteLogs, plateLogs] = await Promise.all([
      pool.query("SELECT * FROM timesheet_vehicles"),
      pool.query("SELECT plate_no, driver_name, work_start_date, work_end_date FROM vehicle_driver_log"),
      pool.query("SELECT plate_no, site_name, rate, work_start_date, work_end_date FROM vehicle_site_log"),
      pool.query("SELECT old_plate_no, new_plate_no, TO_CHAR(change_date, 'YYYY-MM-DD') as change_date FROM vehicle_plate_log ORDER BY change_date ASC"),
    ]);

    let savedBills = [];
    let timesheetRows = [];
    let invoiceRows = [];

    if (month && month !== "All") {
      const savedQuery = `SELECT * FROM billing_records WHERE billing_month = $1`;
      const savedRes = await pool.query(savedQuery, [month]);
      savedBills = savedRes.rows;

      const [mName, yStr] = month.trim().split(" ");
      if (mName && yStr) {
        const [timesheetsResult, invoicesResult] = await Promise.all([
          pool.query(
            "SELECT plate_no, record_date, calc_time, bd FROM timesheet_daily_records WHERE month = $1 AND year = $2",
            [mName, yStr]
          ),
          pool.query(
            "SELECT plate_no, site_name, bill_nr, bill_ot FROM invoice_records WHERE month = $1",
            [month]
          ),
        ]);
        timesheetRows = timesheetsResult.rows;
        invoiceRows = invoicesResult.rows;
      }
    }

    res.json({
      success: true,
      vehicles: tsVehicles.rows,
      driver_logs: driverLogs.rows,
      site_logs: siteLogs.rows,
      plate_logs: plateLogs.rows,
      timesheets: timesheetRows,
      invoices: invoiceRows,
      saved_bills: savedBills,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🟢 2. Save Driver OT & Driver Amount to billing_records (Conflict-free multi-month save)
router.post("/save", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "No driver items to save" });
    }

    for (let row of items) {
      const plate = (row.plate || "").trim();
      const billingMonth = (row.billing_month || "").trim();
      const site = (row.site_name || "").trim();
      const driverName = (row.driver || "").trim();
      const driverOt = parseFloat(row.driver_ot) || 0;
      const driverAmount = parseFloat(row.driver_amount) || 0;

      if (!plate || !billingMonth) continue;

      // Check if billing record already exists for this exact plate, site, and month
      const checkRes = await client.query(
        `SELECT id FROM billing_records 
         WHERE billing_month = $1 
           AND UPPER(TRIM(plate_no)) = UPPER(TRIM($2)) 
           AND LOWER(TRIM(COALESCE(site_name, ''))) = LOWER(TRIM($3))`,
        [billingMonth, plate, site]
      );

      if (checkRes.rows.length > 0) {
        // Update existing record
        await client.query(
          `UPDATE billing_records 
           SET driver_ot = $1, driver_amount = $2, driver = COALESCE(NULLIF($3, ''), driver)
           WHERE id = $4`,
          [driverOt, driverAmount, driverName, checkRes.rows[0].id]
        );
      } else {
        // Insert new record if not present
        await client.query(
          `INSERT INTO billing_records 
           (billing_month, plate_no, site_name, driver, driver_ot, driver_amount, nhr, nrate, othr, otrate, rent, total, after_adjustment)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0, 0, 0, 0)`,
          [billingMonth, plate, site, driverName, driverOt, driverAmount]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Driver OT billing saved successfully!" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Driver save error:", err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;