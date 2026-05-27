const express = require("express");
const pool = require("../config/db");
const axios = require("axios");
const { verifyToken } = require("../middlewares/auth");
const router = express.Router();

// ==========================================
// ANNUAL REPORT MASTER DATA FETCH
// ==========================================
router.get("/api/annual-report/master-data", verifyToken, async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) throw new Error("Year is required");

    // 1. Fetch Master Vehicles & Site Logs (Running Status preferred)
    // Using distinct plates and their latest site logs
    const vehicleQuery = `
            SELECT 
                tv.plate_no, 
                tv.owner_name, 
                tv.vehicle_type, 
                tv.rate,
                vsl.site_name,
                TO_CHAR(vsl.work_start_date, 'YYYY-MM-DD') as work_start_date,
                TO_CHAR(vsl.work_end_date, 'YYYY-MM-DD') as last_working_day,
                vsl.status,
                vdl.driver_name
            FROM timesheet_vehicles tv
            LEFT JOIN vehicle_site_log vsl ON UPPER(tv.plate_no) = UPPER(vsl.plate_no) AND vsl.status = 'Running'
            LEFT JOIN vehicle_driver_log vdl ON UPPER(tv.plate_no) = UPPER(vdl.plate_no) AND vdl.status = 'Running'
            ORDER BY vsl.site_name ASC, tv.plate_no ASC
        `;
    const vehicles = await pool.query(vehicleQuery);

    // 2. Fetch Timesheet Daily Records for the entire year (To calculate NR & OT)
    const timesheetQuery = `
            SELECT plate_no, month, SUM(CAST(calc_time AS NUMERIC)) as total_time
            FROM timesheet_daily_records 
            WHERE year = $1
            GROUP BY plate_no, month
        `;
    const timesheets = await pool.query(timesheetQuery, [year]);

    // 3. Fetch Billing Records for the entire year
    const billingQuery = `
            SELECT plate_no, billing_month, nhr, nrate, othr, otrate, total 
            FROM billing_records 
            WHERE billing_month ILIKE '%' || $1
        `;
    const billings = await pool.query(billingQuery, [year]);

    // 4. Fetch Zoho Mapping Rules to attach Project Names to Sites
    const mappingQuery = `
            SELECT pm.erp_site_keyword, pm.zoho_project_name 
            FROM zoho_project_mappings pm
        `;
    const mappings = await pool.query(mappingQuery);

    res.json({
      success: true,
      year: year,
      vehicles: vehicles.rows,
      timesheets: timesheets.rows,
      billings: billings.rows,
      mappings: mappings.rows,
    });
  } catch (error) {
    console.error("Annual Report API Error:", error.message);
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;
