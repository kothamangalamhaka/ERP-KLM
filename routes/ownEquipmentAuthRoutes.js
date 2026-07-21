const express = require('express');
const router = express.Router();

// Corrected DB connection path based on your server.js setup
const pool = require('../config/db'); 

// User Signup (Status: Pending)
router.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query(
            `INSERT INTO equipment_users (username, password, status) VALUES ($1, $2, 'pending')`,
            [username, password]
        );
        res.json({ success: true, message: "User registered successfully." });
    } catch (err) {
        console.error(err);
        res.status(400).json({ success: false, message: "Username already exists or database error." });
    }
});

// User Login Check
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT id, username, role, status FROM equipment_users WHERE username = $1 AND password = $2`,
            [username, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid credentials!" });
        }

        const user = result.rows[0];
        if (user.status !== 'approved') {
            return res.status(403).json({ message: "Your account status is pending or rejected by Admin." });
        }

        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error during login." });
    }
});

module.exports = router;