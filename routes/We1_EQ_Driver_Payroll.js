// routes/We1_EQ_Driver_Payroll.js

const express = require("express");
const pool = require("../config/db"); 

// Custom middleware to check emp_token
const verifyAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });
    next();
};

const router = express.Router();

// 1. Fetch Payroll Data for a specific Month/Year
router.get("/data", verifyAuth, async (req, res) => {
    try {
        const { month_year } = req.query; 
        
        if (!month_year) {
            return res.json({ success: false, message: "Month and Year required" });
        }

        const query = `
            WITH VehicleEndDates AS (
                -- Finding the exact stop/replace date of each vehicle from site log & master
                SELECT 
                    s.plate_no,
                    CASE 
                        WHEN m.status = 'Running' THEN NULL
                        ELSE MAX(COALESCE(s.replaced_date, s.work_end_date))::date
                    END as final_end_date
                FROM we1_site_log s
                JOIN we1_own_eq_master m ON s.plate_no = m.plate_no
                GROUP BY s.plate_no, m.status
            ),
            DriverHistory AS (
                SELECT
                    d.plate_no,
                    d.driver_name,
                    d.join_date::date AS start_date,
                    CASE 
                        -- If a next driver exists, use their join date as the end date
                        WHEN LEAD(d.join_date::date) OVER (PARTITION BY d.plate_no ORDER BY d.join_date) IS NOT NULL 
                        THEN LEAD(d.join_date::date) OVER (PARTITION BY d.plate_no ORDER BY d.join_date)
                        
                        -- If no next driver, but the vehicle was replaced/stopped, use the vehicle's end date
                        WHEN v.final_end_date IS NOT NULL 
                        THEN v.final_end_date
                        
                        -- Otherwise, still running
                        ELSE NULL
                    END AS end_date
                FROM we1_driver_log d
                LEFT JOIN VehicleEndDates v ON d.plate_no = v.plate_no
                WHERE d.driver_name IS NOT NULL AND TRIM(d.driver_name) != ''
            ),
            ActiveDrivers AS (
                SELECT
                    driver_name,
                    STRING_AGG(DISTINCT plate_no, ' & ') AS plate_no
                FROM DriverHistory
                WHERE 
                    (start_date IS NULL OR start_date <= (TO_DATE($1 || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date)
                    AND 
                    (end_date IS NULL OR end_date >= TO_DATE($1 || '-01', 'YYYY-MM-DD'))
                GROUP BY driver_name
            ),
            PayrollData AS (
                SELECT
                    driver_name,
                    MAX(plate_no) as plate_no,
                    SUM(basic_salary) as basic_salary,
                    SUM(over_time) as over_time,
                    SUM(deduction) as deduction,
                    SUM(COALESCE(advance_paid, 0)) as advance_paid,
                    MAX(status) as status,
                    MAX(remark) as remark
                FROM we1_payroll
                WHERE month_year = $1
                GROUP BY driver_name
            )
            SELECT
                a.plate_no AS plate_no,
                a.driver_name AS driver_name,
                COALESCE(p.basic_salary, 0) AS basic_salary,
                COALESCE(p.over_time, 0) AS over_time,
                COALESCE(p.deduction, 0) AS deduction,
                COALESCE(p.advance_paid, 0) AS advance_paid,
                COALESCE(p.status, 'Un Paid') AS status,
                COALESCE(p.remark, '') AS remark
            FROM ActiveDrivers a
            LEFT JOIN PayrollData p ON a.driver_name = p.driver_name
            ORDER BY a.driver_name ASC
        `;
        
        const result = await pool.query(query, [month_year]);
        res.json({ success: true, data: result.rows });

    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 2. Save or Update Payroll Entry
router.post("/save", verifyAuth, async (req, res) => {
    try {
        const { 
            month_year, plate_no, driver_name, basic_salary, 
            over_time, deduction, advance_paid, status, remark 
        } = req.body;

        if (!month_year || !plate_no || !driver_name) {
            return res.json({ success: false, message: "Month/Year, Plate No and Driver Name required" });
        }

        const query = `
            INSERT INTO we1_payroll 
            (month_year, plate_no, driver_name, basic_salary, over_time, deduction, advance_paid, status, remark)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (month_year, plate_no, driver_name) 
            DO UPDATE SET 
                basic_salary = EXCLUDED.basic_salary,
                over_time = EXCLUDED.over_time,
                deduction = EXCLUDED.deduction,
                advance_paid = EXCLUDED.advance_paid,
                status = EXCLUDED.status,
                remark = EXCLUDED.remark
        `;

        const values = [
            month_year, 
            plate_no, 
            driver_name, 
            basic_salary || 0, 
            over_time || 0, 
            deduction || 0, 
            advance_paid || 0,
            status || 'Un Paid', 
            remark
        ];

        await pool.query(query, values);
        res.json({ success: true, message: "Payroll updated successfully" });

    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;