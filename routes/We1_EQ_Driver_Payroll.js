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
            SELECT 
                p.plate_no, 
                p.driver_name, 
                p.basic_salary, 
                p.over_time, 
                p.deduction, 
                COALESCE(p.advance_paid, 0) as advance_paid,
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
                0 as advance_paid,
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