const express = require('express');
const router = express.Router();
const pool = require('../config/db'); 

const verifyAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    next();
};

// 1. Fetch Salary Data
router.get("/data", verifyAuth, async (req, res) => {
    try {
        const { month_year } = req.query; 
        if (!month_year) return res.json({ success: false, message: "Month/Year required" });

        const startDate = `${month_year}-01`;
        const [year, month] = month_year.split('-');
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        const empQuery = `
            SELECT id, name, designation as current_desig, category, joining_date, released_date
            FROM employees 
            WHERE joining_date <= $2 
            AND (category != 'Released' OR released_date >= $1)
            ORDER BY name ASC
        `;
        const activeEmps = await pool.query(empQuery, [startDate, endDate]);

        const histQuery = `
            SELECT employee_id, previous_designation, previous_category, start_date, end_date
            FROM employee_history
            WHERE start_date <= $2 AND end_date >= $1
        `;
        const historyData = await pool.query(histQuery, [startDate, endDate]);

        const payQuery = `SELECT * FROM staff_payroll WHERE month_year = $1`;
        const payData = await pool.query(payQuery, [month_year]);

        const finalData = activeEmps.rows.map(emp => {
            let designations = new Set();
            
            const myHistory = historyData.rows.filter(h => h.employee_id === emp.id);
            myHistory.forEach(h => {
                if(h.previous_designation) designations.add(h.previous_designation);
                else designations.add(h.previous_category);
            });

            if (emp.category !== 'Released' || emp.released_date >= endDate) {
                if(emp.current_desig) designations.add(emp.current_desig);
                else designations.add(emp.category);
            }

            const desigString = Array.from(designations).join(" & ");
            const payRec = payData.rows.find(p => p.emp_id === emp.id) || {};

            return {
                emp_id: emp.id,
                name: emp.name,
                designations: desigString || 'Unknown',
                basic_salary: payRec.basic_salary || 0,
                over_time: payRec.over_time || 0,
                food_allowance: payRec.food_allowance || 0,
                mobile_allowance: payRec.mobile_allowance || 0,
                present_days: payRec.present_days || 0,
                commission: payRec.commission || 0,
                staff_remittance: payRec.staff_remittance || 0,
                deduction: payRec.deduction || 0,
                currency: payRec.currency || 'SAR',
                status: payRec.status || 'Unpaid',
                remark: payRec.remark || ''
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Save or Update Payroll Entry
router.post("/save", verifyAuth, async (req, res) => {
    try {
        const { 
            month_year, emp_id, basic_salary, over_time, food_allowance, mobile_allowance, 
            present_days, commission, staff_remittance, deduction, currency, status, remark 
        } = req.body;

        const query = `
            INSERT INTO staff_payroll 
            (month_year, emp_id, basic_salary, over_time, food_allowance, mobile_allowance, present_days, commission, staff_remittance, deduction, currency, status, remark)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (month_year, emp_id) 
            DO UPDATE SET 
                basic_salary = EXCLUDED.basic_salary,
                over_time = EXCLUDED.over_time,
                food_allowance = EXCLUDED.food_allowance,
                mobile_allowance = EXCLUDED.mobile_allowance,
                present_days = EXCLUDED.present_days,
                commission = EXCLUDED.commission,
                staff_remittance = EXCLUDED.staff_remittance,
                deduction = EXCLUDED.deduction,
                currency = EXCLUDED.currency,
                status = EXCLUDED.status,
                remark = EXCLUDED.remark
        `;

        const values = [
            month_year, emp_id, basic_salary || 0, over_time || 0, food_allowance || 0, mobile_allowance || 0,
            present_days || 0, commission || 0, staff_remittance || 0, deduction || 0, currency, status, remark
        ];

        await pool.query(query, values);
        res.json({ success: true, message: "Salary saved successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;