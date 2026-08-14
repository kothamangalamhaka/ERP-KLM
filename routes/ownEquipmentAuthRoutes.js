const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs"); // Added bcryptjs
const jwt = require("jsonwebtoken"); // Added jsonwebtoken to fix the error

// Corrected DB connection path based on your server.js setup
const pool = require("../config/db");

// User Signup (Status: Pending) - Password Hashed
router.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  try {
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO employloguser (username, password, status) VALUES ($1, $2, 'pending')`,
      [username, hashedPassword],
    );
    res.json({ success: true, message: "User registered successfully." });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      success: false,
      message: "Username already exists or database error.",
    });
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
      { expiresIn: "12h" }
    );

    res.json({ success: true, token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error during login." });
  }
});

module.exports = router;
