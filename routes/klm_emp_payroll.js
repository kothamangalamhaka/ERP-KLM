const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middlewares/auth");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_change_this";

router.post("/verify-pin", (req, res) => {
  const { pin } = req.body;
  const validPin = process.env.SAL_PIN;

  if (pin && pin === validPin) {
    const token = jwt.sign({ role: "salary_admin" }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: "Invalid Salary PIN" });
  }
});

router.use(verifyToken);

function getNonFridayDaysCount(year, monthIndex) {
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const d = new Date(year, monthIndex, day);
    if (d.getDay() !== 5) workingDays++;
  }
  return { totalDays, workingDays };
}

router.get("/data", async (req, res) => {
  try {
    const { month } = req.query; 
    if (!month) return res.status(400).json({ error: "Month is required" });

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const monthIndex = parseInt(monthStr) - 1;

    const { totalDays, workingDays } = getNonFridayDaysCount(year, monthIndex);
    const startDateStr = `${yearStr}-${monthStr.padStart(2, "0")}-01`;
    const endDateStr = `${yearStr}-${monthStr.padStart(2, "0")}-${String(totalDays).padStart(2, "0")}`;

    const empQuery = `SELECT id, name, mobile, base_salary, shift_hours, mobile_allowance, start_date, end_date FROM employee_data WHERE (start_date IS NULL OR start_date <= $1) AND (end_date IS NULL OR end_date >= $2) ORDER BY id ASC`;
    const empResult = await pool.query(empQuery, [endDateStr, startDateStr]);
    const employees = empResult.rows;

    const staffPayrollList = [];

    for (const emp of employees) {
      const shiftHrs = parseFloat(emp.shift_hours) || 10;
      const baseSalary = parseFloat(emp.base_salary) || 0;
      const expectedShiftHours = workingDays * shiftHrs;
      const divisorHours = Math.min(260, expectedShiftHours);
      const hourlyRate = divisorHours > 0 ? baseSalary / divisorHours : 0;

      const logsRes = await pool.query(
        `SELECT SUM(COALESCE(normal_hr, 0)) as total_normal, SUM(COALESCE(ot_hr, 0)) as total_ot FROM attendance_logs WHERE emp_id = $1 AND log_date >= $2 AND log_date <= $3`,
        [emp.id, startDateStr, endDateStr]
      );
      
      const totalNormalHr = parseFloat(logsRes.rows[0].total_normal) || 0;
      const totalOtHr = parseFloat(logsRes.rows[0].total_ot) || 0;

      staffPayrollList.push({
        id: emp.id,
        name: emp.name,
        base_salary: baseSalary,
        shift_hours: shiftHrs,
        mobile_allowance: parseFloat(emp.mobile_allowance) || 0,
        hourly_rate: hourlyRate,
        normal_hr: totalNormalHr,
        ot_hr: totalOtHr,
        basic_earned: totalNormalHr * hourlyRate,
        ot_earned: totalOtHr * hourlyRate
      });
    }

    const summaryRes = await pool.query(`SELECT * FROM monthly_payroll_summary WHERE month_year = $1`, [month]);
    let summary = summaryRes.rows[0];

    // If current month data doesn't exist, fetch previous month's closing & upcoming expenses
    if (!summary) {
      const prevDate = new Date(year, monthIndex - 1, 1);
      const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
      const prevSummaryRes = await pool.query(`SELECT closing_balance, upcoming_expenses FROM monthly_payroll_summary WHERE month_year = $1`, [prevMonthStr]);
      
      let carryForwardCash = 0;
      let prevUpcomingExp = [];
      
      if (prevSummaryRes.rows.length > 0) {
        carryForwardCash = parseFloat(prevSummaryRes.rows[0].closing_balance) || 0;
        prevUpcomingExp = prevSummaryRes.rows[0].upcoming_expenses || [];
      }

      // Filter out fixed items from previous upcoming so we don't duplicate them
      prevUpcomingExp = prevUpcomingExp.filter(ex => ex.desc !== "GST Filing & Professional Charges");

      summary = {
        cash_in_hand_cf: carryForwardCash,
        cash_from_ajil: 0,
        staff_adjustments: {},
        current_expenses: [
          { desc: "Office Rent", amt: 6000, fixed: true },
          ...prevUpcomingExp
        ],
        upcoming_expenses: [
          { desc: "GST Filing & Professional Charges", amt: 3100, fixed: true }
        ]
      };
    }

    res.json({
      month: month,
      working_days: workingDays,
      staff: staffPayrollList,
      summary: summary
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch payroll data" });
  }
});

router.post("/save-summary", async (req, res) => {
  try {
    const { month_year, cash_in_hand_cf, cash_from_ajil, staff_adjustments, current_expenses, upcoming_expenses, closing_balance } = req.body;
    
    const query = `
      INSERT INTO monthly_payroll_summary (month_year, cash_in_hand_cf, cash_from_ajil, staff_adjustments, current_expenses, upcoming_expenses, closing_balance, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (month_year)
      DO UPDATE SET
        cash_in_hand_cf = EXCLUDED.cash_in_hand_cf,
        cash_from_ajil = EXCLUDED.cash_from_ajil,
        staff_adjustments = EXCLUDED.staff_adjustments,
        current_expenses = EXCLUDED.current_expenses,
        upcoming_expenses = EXCLUDED.upcoming_expenses,
        closing_balance = EXCLUDED.closing_balance,
        updated_at = NOW()
      RETURNING *;
    `;
    
    const result = await pool.query(query, [
      month_year, cash_in_hand_cf || 0, cash_from_ajil || 0, 
      JSON.stringify(staff_adjustments || {}), JSON.stringify(current_expenses || []), 
      JSON.stringify(upcoming_expenses || []), closing_balance || 0
    ]);
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save summary" });
  }
});

module.exports = router;