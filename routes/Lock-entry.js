const express = require("express");
const router = express.Router();
const pool = require("../config/db"); // Adjust path if needed
const nodemailer = require("nodemailer");
const { verifySuperAdmin, verifyToken } = require("../middlewares/auth");

// Get current lock status
router.get("/status", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT lock_month, lock_year FROM timesheet_lock_period WHERE id = 1",
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Set a new Lock Period
router.post("/set", verifySuperAdmin, async (req, res) => {
  try {
    const { month, year } = req.body;
    await pool.query(
      "UPDATE timesheet_lock_period SET lock_month = $1, lock_year = $2 WHERE id = 1",
      [month, year],
    );
    res.json({
      success: true,
      message: `System locked up to ${month} ${year}`,
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Request Unlock OTP
router.post("/request-unlock", verifyToken, async (req, res) => {
  try {
    if (
      !process.env.EMAIL_USER ||
      !process.env.EMAIL_PASS ||
      !process.env.ENTRY_LOCK_MAIL
    ) {
      return res.status(500).json({
        success: false,
        message: "Email configuration missing in server environment (.env).",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins validity

    await pool.query(
      "UPDATE timesheet_lock_period SET otp = $1, otp_expiry = $2 WHERE id = 1",
      [otp, expiry],
    );

    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Timesheet ERP" <${process.env.EMAIL_USER}>`,
      to: process.env.ENTRY_LOCK_MAIL,
      subject: `System Unlock OTP`,
      html: `<div style="padding:20px; font-family: sans-serif;">
                     <h2>Timesheet Unlock Request</h2>
                     <p>Requested by: <b>${req.user?.username || "User"}</b></p>
                     <p>OTP to unlock the system is: <b style="font-size:24px; color:#ef4444; letter-spacing: 2px;">${otp}</b></p>
                     <p>Valid for 10 minutes.</p>
                   </div>`,
    });

    res.json({ success: true, message: `OTP sent to configured admin email.` });
  } catch (error) {
    console.error("Lock Unlock Request Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP: " + error.message,
    });
  }
});

// Verify OTP or Master Code and Unlock
router.post("/verify-unlock", verifyToken, async (req, res) => {
  try {
    const rawCode = req.body.code;
    const code = rawCode ? String(rawCode).trim() : "";
    const masterCode = process.env.MASTER_UNLOCK_CODE
      ? String(process.env.MASTER_UNLOCK_CODE).trim()
      : null;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Please enter the unlock code or OTP.",
      });
    }

    // Check if Master Code (Strict null/empty check)
    if (masterCode && code === masterCode) {
      await pool.query(
        "UPDATE timesheet_lock_period SET lock_month = NULL, lock_year = NULL, otp = NULL, otp_expiry = NULL WHERE id = 1",
      );
      return res.json({
        success: true,
        message: "System Unlocked via Master Code!",
      });
    }

    // Check OTP
    const dbRes = await pool.query(
      "SELECT otp, otp_expiry FROM timesheet_lock_period WHERE id = 1",
    );
    if (dbRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Lock record not found." });
    }

    const storedData = dbRes.rows[0];

    if (!storedData.otp) {
      return res.status(400).json({
        success: false,
        message: "No OTP requested. Please request an OTP first.",
      });
    }

    if (new Date() > new Date(storedData.otp_expiry)) {
      await pool.query(
        "UPDATE timesheet_lock_period SET otp = NULL, otp_expiry = NULL WHERE id = 1",
      );
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one.",
      });
    }

    if (String(storedData.otp).trim() !== code) {
      return res
        .status(400)
        .json({ success: false, message: "Incorrect OTP." });
    }

    // Unlock successful
    await pool.query(
      "UPDATE timesheet_lock_period SET lock_month = NULL, lock_year = NULL, otp = NULL, otp_expiry = NULL WHERE id = 1",
    );
    res.json({ success: true, message: "System Unlocked via OTP!" });
  } catch (error) {
    console.error("Lock Verify Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
