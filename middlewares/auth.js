// middlewares/auth.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token provided' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.json({ success: false, message: 'Invalid session' });
    }
};

const verifySuperAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'Super Admin') return res.json({ success: false, message: 'Access Denied: Super Admin only.' });
        req.user = decoded;
        next();
    } catch (e) {
        res.json({ success: false, message: 'Invalid token' });
    }
};

const pool = require('../config/db');

const verifyEditor = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const userRes = await pool.query("SELECT role, status FROM timesheet_users WHERE id = $1", [decoded.id]);
        if (userRes.rows.length === 0 || userRes.rows[0].status !== 'Active') {
            return res.json({ success: false, message: 'User inactive or not found.' });
        }

        const currentRole = userRes.rows[0].role;
        const allowedRoles = ['Super Admin', 'Admin', 'Site Coordinator', 'Editor'];
        
        if (!allowedRoles.includes(currentRole)) {
            return res.json({ success: false, message: 'Access Denied.' });
        }

        req.user = { ...decoded, role: currentRole };
        next();
    } catch (e) {
        res.json({ success: false, message: 'Invalid token' });
    }
};

module.exports = {
    verifyToken,
    verifySuperAdmin,
    verifyEditor
};