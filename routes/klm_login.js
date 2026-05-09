const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'klm_super_secure_secret_key_2026';

// Environment variable or default fallback for KLM Admin Password
const KLM_ADMIN_PASS = process.env.KLM_ADMIN_PASS;
if (!KLM_ADMIN_PASS) {
    console.error('KLM_ADMIN_PASS is missing in .env file!');
}

router.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Basic check: You can expand this to check a database table later if needed
    if ((username === 'admin' || username === 'klmadmin') && password === KLM_ADMIN_PASS) {

        // Generate a token valid for 24 hours
        const token = jwt.sign(
            { role: 'klm_admin', user: username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ success: true, token: token, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid Username or Password' });
    }
});

// Middleware to protect KLM routes (Can be exported and used in other files)
router.verifyKlmToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Access Denied. No token provided.' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.status(403).json({ success: false, message: 'Invalid or expired session. Please login again.' });
    }
};

module.exports = router;