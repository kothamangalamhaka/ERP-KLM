const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { verifyToken } = require("../middlewares/auth");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_change_this";

// In-memory OTP storage
let activeOtpStore = { otp: null, expiresAt: 0 };

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

// Send OTP to unlock
router.post("/send-unlock-otp", async (req, res) => {
  try {
    const targetEmail = process.env.KLM_STAFF_PAY_ROLL;
    if (!targetEmail) {
      return res.status(400).json({ success: false, message: "KLM_STAFF_PAY_ROLL email is not configured in .env" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    activeOtpStore = {
      otp: otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes validity
    };

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER || targetEmail,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Payroll Security" <${process.env.EMAIL_USER || targetEmail}>`,
      to: targetEmail,
      subject: "Security OTP to Unlock Payroll Sheet",
      text: `Your 6-digit OTP to unlock the payroll sheet is: ${otp}. It will expire in 5 minutes.`
    });

    res.json({ success: true, message: `OTP sent to ${targetEmail}` });
  } catch (err) {
    console.error("OTP Send Error:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP email" });
  }
});

// Verify OTP to unlock
router.post("/verify-unlock-otp", async (req, res) => {
  try {
    const { otp, month_year } = req.body;
    if (!otp || String(otp) !== activeOtpStore.otp || Date.now() > activeOtpStore.expiresAt) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    activeOtpStore = { otp: null, expiresAt: 0 };
    if (month_year) {
      await pool.query(
        `UPDATE monthly_payroll_summary SET is_locked = false, updated_at = NOW() WHERE month_year = $1`,
        [month_year]
      );
    }

    res.json({ success: true, message: "Unlocked successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Unlock operation failed" });
  }
});

// Toggle Direct Lock
router.post("/toggle-lock", async (req, res) => {
  try {
    const { month_year, lock } = req.body;
    await pool.query(
      `INSERT INTO monthly_payroll_summary (month_year, is_locked, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (month_year) 
       DO UPDATE SET is_locked = EXCLUDED.is_locked, updated_at = NOW()`,
      [month_year, lock]
    );
    res.json({ success: true, is_locked: lock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update lock status" });
  }
});

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
    const isJuneOrLater = (year > 2026) || (year === 2026 && monthIndex >= 5);

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
      
      const totalNormalHr = parseFloat(logsRes.rows[0]?.total_normal) || 0;
      const totalOtHr = parseFloat(logsRes.rows[0]?.total_ot) || 0;

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

    // Always fetch the latest previous month's closing balance dynamically
    const prevDate = new Date(year, monthIndex - 1, 1);
    const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const prevSummaryRes = await pool.query(`SELECT closing_balance, upcoming_expenses FROM monthly_payroll_summary WHERE month_year = $1`, [prevMonthStr]);
    
    let dynamicPrevClosing = 0;
    let prevUpcomingExp = [];
    
    if (prevSummaryRes.rows.length > 0) {
      dynamicPrevClosing = parseFloat(prevSummaryRes.rows[0].closing_balance) || 0;
      prevUpcomingExp = prevSummaryRes.rows[0].upcoming_expenses || [];
    }

    // Filter out GST Filing from previous upcoming as GST is handled separately per month
    const customPrevUpcomingExp = prevUpcomingExp.filter(ex => !ex.desc.includes("GST Filing"));

    if (!summary) {
      const dObj = new Date(year, monthIndex, 1);
      const curMonthName = dObj.toLocaleString("en-US", { month: "long" });

      let curExpenses = [{ desc: "Office Rent", amt: 6000, fixed: true }];

      if (isJuneOrLater) {
        curExpenses.push({ desc: `GST Filing & Professional Charges :: ${curMonthName}`, amt: 3100, fixed: true });
        curExpenses.push({ desc: "Wifi Recharge", amt: 1061, fixed: true });
      }

      // Add previous upcoming custom expenses into current period
      customPrevUpcomingExp.forEach(pExp => {
        if (!curExpenses.some(c => c.desc.trim().toLowerCase() === pExp.desc.trim().toLowerCase())) {
          curExpenses.push({ desc: pExp.desc, amt: pExp.amt, fixed: false });
        }
      });

      summary = {
        is_locked: false,
        cash_in_hand_cf: dynamicPrevClosing,
        cash_from_ajil: 0,
        staff_adjustments: {},
        current_expenses: curExpenses,
        other_expenses: [],
        upcoming_expenses: [
          { desc: "GST Filing & Professional Charges", amt: 3100, fixed: true }
        ]
      };
    } else {
      // If month is not May 2026 (starting month), keep Opening Balance strictly synced
      if (!(year === 2026 && monthIndex === 4)) {
        summary.cash_in_hand_cf = dynamicPrevClosing;
      }

      // Dynamically sync previous upcoming expenses into existing current_expenses if not locked
      if (!summary.is_locked) {
        let curExpenses = summary.current_expenses || [];
        let updated = false;

        customPrevUpcomingExp.forEach(pExp => {
          const existingIdx = curExpenses.findIndex(c => c.desc.trim().toLowerCase() === pExp.desc.trim().toLowerCase());
          if (existingIdx === -1) {
            // If item does not exist, append it
            curExpenses.push({ desc: pExp.desc, amt: pExp.amt, fixed: false });
            updated = true;
          } else if (curExpenses[existingIdx].amt !== pExp.amt) {
            // Update amount if previous month upcoming amount was modified
            curExpenses[existingIdx].amt = pExp.amt;
            updated = true;
          }
        });

        summary.current_expenses = curExpenses;
      }
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
    const { month_year, cash_in_hand_cf, cash_from_ajil, staff_adjustments, current_expenses, other_expenses, upcoming_expenses, closing_balance } = req.body;
    
    // Check if sheet is locked
    const checkLock = await pool.query(`SELECT is_locked FROM monthly_payroll_summary WHERE month_year = $1`, [month_year]);
    if (checkLock.rows.length > 0 && checkLock.rows[0].is_locked) {
      return res.status(403).json({ error: "This month is locked and cannot be edited." });
    }

    const query = `
      INSERT INTO monthly_payroll_summary (month_year, cash_in_hand_cf, cash_from_ajil, staff_adjustments, current_expenses, other_expenses, upcoming_expenses, closing_balance, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (month_year)
      DO UPDATE SET
        cash_in_hand_cf = EXCLUDED.cash_in_hand_cf,
        cash_from_ajil = EXCLUDED.cash_from_ajil,
        staff_adjustments = EXCLUDED.staff_adjustments,
        current_expenses = EXCLUDED.current_expenses,
        other_expenses = EXCLUDED.other_expenses,
        upcoming_expenses = EXCLUDED.upcoming_expenses,
        closing_balance = EXCLUDED.closing_balance,
        updated_at = NOW()
      RETURNING *;
    `;
    
    const result = await pool.query(query, [
      month_year, cash_in_hand_cf || 0, cash_from_ajil || 0, 
      JSON.stringify(staff_adjustments || {}), JSON.stringify(current_expenses || []), 
      JSON.stringify(other_expenses || []), JSON.stringify(upcoming_expenses || []), closing_balance || 0
    ]);
    
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save summary" });
  }
});

module.exports = router;