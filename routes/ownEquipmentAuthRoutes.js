const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs"); // Added bcryptjs
const jwt = require("jsonwebtoken"); // Added jsonwebtoken to fix the error

// Corrected DB connection path based on your server.js setup
const pool = require("../config/db");

async function ensureFaceDescriptorColumn() {
  await pool.query(
    `ALTER TABLE employloguser ADD COLUMN IF NOT EXISTS face_descriptor TEXT`,
  );
}

// User Signup (Status: Pending) - Password Hashed + Optional Face Descriptor
router.post("/signup", async (req, res) => {
  const { username, password, faceDescriptor } = req.body;
  try {
    await ensureFaceDescriptorColumn();
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO employloguser (username, password, status, face_descriptor) VALUES ($1, $2, 'pending', $3)`,
      [
        username,
        hashedPassword,
        faceDescriptor ? JSON.stringify(faceDescriptor) : null,
      ],
    );

    if (faceDescriptor) {
      try {
        await fetch("http://127.0.0.1:8001/py/own-equipment-invalidate-cache", {
          method: "POST",
        });
      } catch (e) {
        console.warn("Own Equipment face cache invalidate failed:", e.message);
      }
    }

    res.json({ success: true, message: "User registered successfully." });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      success: false,
      message: "Username already exists or database error.",
    });
  }
});

// Verify credentials before resetting Face ID
router.post("/verify-credentials", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Missing credentials." });
  }
  try {
    const result = await pool.query(
      `SELECT id, password FROM employloguser WHERE username = $1`,
      [username],
    );
    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials!" });
    }
    const isMatch = await bcrypt.compare(password, result.rows[0].password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials!" });
    }
    res.json({ success: true, message: "Credentials verified." });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Server error verifying credentials." });
  }
});

// Reset / Update Face Descriptor
router.post("/reset-face-data", async (req, res) => {
  const { username, password, faceDescriptor } = req.body;
  if (!username || !password || !faceDescriptor) {
    return res.status(400).json({
      success: false,
      message: "All fields and face scan required.",
    });
  }
  try {
    await ensureFaceDescriptorColumn();
    const result = await pool.query(
      `SELECT id, password FROM employloguser WHERE username = $1`,
      [username],
    );
    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials!" });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials!" });
    }

    await pool.query(
      `UPDATE employloguser SET face_descriptor = $1 WHERE id = $2`,
      [JSON.stringify(faceDescriptor), user.id],
    );

    try {
      await fetch("http://127.0.0.1:8001/py/own-equipment-invalidate-cache", {
        method: "POST",
      });
    } catch (e) {
      console.warn("Own Equipment face cache invalidate failed:", e.message);
    }

    res.json({ success: true, message: "Face data updated successfully!" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Server error updating face data." });
  }
});

// User Login Check - With Bcrypt
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    // Fetch user by username only
    const result = await pool.query(
      `SELECT id, username, password, role, status FROM employloguser WHERE username = $1`,
      [username],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials!" });
    }

    const user = result.rows[0];

    // Compare the plain text password with the hashed password in DB
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials!" });
    }

    if (user.status !== "approved") {
      return res.status(403).json({
        message: "Your account status is pending or rejected by Admin.",
      });
    }

    // Remove password from user object for security before sending to frontend
    delete user.password;

    // JWT Token ജനറേറ്റ് ചെയ്യുന്നു
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "12h" },
    );

    res.json({ success: true, token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error during login." });
  }
});

module.exports = router;
