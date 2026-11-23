const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const pool = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET;

// Sign Up (Default Role: User, Default Status: Pending)
router.post("/signup", async (req, res) => {
  try {
    const { displayName, username, email, password } = req.body;

    if (!displayName || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled.",
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanDisplayName = String(displayName).trim();
    const cleanEmail = email ? String(email).trim() : null;

    if (cleanUsername.length < 3 || password.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Username (min 3) and password (min 4) too short.",
      });
    }

    const existing = await pool.query(
      "SELECT id FROM spare_parts_users WHERE username = $1",
      [cleanUsername],
    );
    if (existing.rows.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "Username already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO spare_parts_users (display_name, username, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'User', 'Pending')`,
      [cleanDisplayName, cleanUsername, cleanEmail, passwordHash],
    );

    res.json({
      success: true,
      message: "Sign up submitted! Wait for Super Admin approval.",
    });
  } catch (err) {
    console.error("SpareParts Signup Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Server error during signup." });
  }
});

// Forgot Password - Request OTP via Email
router.post("/forgot-password/request", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res
        .status(400)
        .json({ success: false, message: "Username is required." });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const userRes = await pool.query(
      "SELECT id, display_name, email FROM spare_parts_users WHERE username = $1",
      [cleanUsername],
    );

    if (userRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Username not found." });
    }

    const user = userRes.rows[0];
    if (!user.email || !user.email.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "No valid email registered. Contact Super Admin.",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      "UPDATE spare_parts_users SET reset_otp = $1, otp_expiry = $2 WHERE id = $3",
      [otp, expiry, user.id],
    );

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Spare Parts Hub Security" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Password Reset OTP - Spare Parts Hub",
      html: `<div style="font-family:sans-serif; padding:20px;">
               <h2>Password Reset Request</h2>
               <p>Hello ${user.display_name},</p>
               <p>Your OTP for password recovery is: <b style="font-size:24px; color:#2563eb;">${otp}</b></p>
               <p>This OTP is valid for 10 minutes.</p>
             </div>`,
    });

    res.json({ success: true, message: "OTP sent to your registered email." });
  } catch (err) {
    console.error("SpareParts OTP Request Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to send OTP email." });
  }
});

// Forgot Password - Verify OTP & Reset Password
router.post("/forgot-password/reset", async (req, res) => {
  try {
    const { username, otp, newPassword } = req.body;
    if (!username || !otp || !newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }
    if (String(newPassword).length < 4) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 4 characters.",
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const userRes = await pool.query(
      "SELECT id, reset_otp, otp_expiry FROM spare_parts_users WHERE username = $1",
      [cleanUsername],
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].reset_otp) {
      return res
        .status(400)
        .json({ success: false, message: "No active OTP request found." });
    }

    const stored = userRes.rows[0];
    if (new Date() > new Date(stored.otp_expiry)) {
      await pool.query(
        "UPDATE spare_parts_users SET reset_otp = NULL, otp_expiry = NULL WHERE id = $1",
        [stored.id],
      );
      return res
        .status(400)
        .json({ success: false, message: "OTP expired. Request a new one." });
    }

    if (stored.reset_otp !== String(otp).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Incorrect OTP entered." });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE spare_parts_users SET password_hash = $1, reset_otp = NULL, otp_expiry = NULL WHERE id = $2",
      [hashedNew, stored.id],
    );

    res.json({
      success: true,
      message: "Password updated! You can now login.",
    });
  } catch (err) {
    console.error("SpareParts OTP Reset Error:", err.message);
    res.status(500).json({ success: false, message: "Password reset failed." });
  }
});

// Login (Only Active users allowed)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Username and password required." });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const result = await pool.query(
      "SELECT id, display_name, username, password_hash, role, status FROM spare_parts_users WHERE username = $1",
      [cleanUsername],
    );

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid username or password." });
    }

    const user = result.rows[0];
    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid username or password." });
    }

    if (user.status === "Pending") {
      return res.status(403).json({
        success: false,
        message: "Account pending Super Admin approval.",
      });
    }
    if (user.status !== "Active") {
      return res
        .status(403)
        .json({ success: false, message: "Account access denied / rejected." });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        module: "spare_parts",
      },
      JWT_SECRET,
      { expiresIn: "30d" },
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        displayName: user.display_name,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("SpareParts Login Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Server error during login." });
  }
});

module.exports = router;
