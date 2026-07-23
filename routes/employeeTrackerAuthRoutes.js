const express = require('express');
const router = express.Router();
const pool = require('../config/db'); 
const bcrypt = require('bcryptjs');

// User Signup (Status: Pending) - Password Hashed
router.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO employloguser (username, password, status, role) VALUES ($1, $2, 'pending', 'user')`,
            [username, hashedPassword]
        );
        res.json({ success: true, message: "User registered successfully. Waiting for admin approval." });
    } catch (err) {
        console.error(err);
        res.status(400).json({ success: false, message: "Username already exists or database error." });
    }
});

// User Login Check - With Bcrypt
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT id, username, password, role, status FROM employloguser WHERE username = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid credentials!" });
        }

        const user = result.rows[0];
        
        // Compare hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials!" });
        }

        if (user.status !== 'approved') {
            return res.status(403).json({ message: "Your account status is pending or rejected by Admin." });
        }

        // Remove password from user object before sending to frontend
        delete user.password;

        res.json({ success: true, user, token: "dummy_emp_token_123" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error during login." });
    }
});

module.exports = router;