// routes/We1_EQ_Driver_Payroll.js

const express = require("express");
const pool = require("../config/db"); 
const { verifyToken, verifyEditor } = require("../middlewares/auth"); 
const router = express.Router();

// 1. Fetch Payroll Data for a specific Month/Year
router.get("/data", verifyToken, async (req, res) => {
    try {
        const { month_year } = req.query; 
        
        if (!month_year) {
            return res.json({ success: false, message: "Month and Year required" });
        }

        // UNION query to get all saved payrolls for the month + any active drivers in master not yet in payroll
        const query = `
            SELECT 
                p.plate_no, 
                p.driver_name, 
                p.basic_salary, 
                p.over_time, 
                p.deduction, 
                p.status, 
                p.remark
            FROM we1_payroll p 
            WHERE p.month_year = $1
            
            UNION
            
            SELECT 
                m.plate_no, 
                m.driver_name, 
                0 as basic_salary, 
                0 as over_time, 
                0 as deduction, 
                'Un Paid' as status, 
                '' as remark
            FROM we1_own_eq_master m
            WHERE NOT EXISTS (
                SELECT 1 FROM we1_payroll p2 
                WHERE p2.month_year = $1 
                  AND p2.plate_no = m.plate_no 
                  AND p2.driver_name = m.driver_name
            )
            ORDER BY plate_no ASC, driver_name ASC
        `;
        
        const result = await pool.query(query, [month_year]);
        res.json({ success: true, data: result.rows });

    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 2. Save or Update Payroll Entry
router.post("/save", verifyEditor, async (req, res) => {
    try {
        const { 
            month_year, plate_no, driver_name, basic_salary, 
            over_time, deduction, status, remark 
        } = req.body;

        if (!month_year || !plate_no || !driver_name) {
            return res.json({ success: false, message: "Month/Year, Plate No and Driver Name required" });
        }

        // Upsert based on month_year + plate_no + driver_name
        const query = `
            INSERT INTO we1_payroll 
            (month_year, plate_no, driver_name, basic_salary, over_time, deduction, status, remark)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (month_year, plate_no, driver_name) 
            DO UPDATE SET 
                basic_salary = EXCLUDED.basic_salary,
                over_time = EXCLUDED.over_time,
                deduction = EXCLUDED.deduction,
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