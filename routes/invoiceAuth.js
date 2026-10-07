const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// 1. Token Verification Middleware
const verifyInvoiceToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: "No token provided." });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }
};

// 2. Super Admin Verification Middleware
const verifyInvoiceAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== "Super Admin") {
        return res.status(403).json({ success: false, message: "Access Denied: Super Admin only." });
    }
    next();
};

// --- AUTHENTICATION ROUTES ---

// Signup
router.post("/signup", async (req, res) => {
    try {
        const { displayName, username, email, password } = req.body;
        
        const userCheck = await pool.query(
            "SELECT id FROM invoicedatauser WHERE username = $1 OR email = $2", 
            [username, email]
        );
        
        if (userCheck.rows.length > 0) {
            return res.json({ success: false, message: "Username or Email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            "INSERT INTO invoicedatauser (display_name, username, email, password_hash, role, status) VALUES ($1, $2, $3, $4, 'User', 'Pending')",
            [displayName, username, email, hashedPassword]
        );

        res.json({ success: true, message: "Registration successful! Awaiting Admin Approval." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Login
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query("SELECT * FROM invoicedatauser WHERE username = $1", [username]);

        if (result.rows.length === 0) {
            return res.json({ success: false, message: "User not found." });
        }

        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isValid) {
            return res.json({ success: false, message: "Invalid password." });
        }

        if (user.status !== "Approved") {
            return res.json({ success: false, message: "Your account is pending admin approval." });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: "24h" }
        );

        res.json({
            success: true,
            token,
            user: { username: user.username, role: user.role, displayName: user.display_name }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Forgot Password - Request OTP
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        const userRes = await pool.query("SELECT username FROM invoicedatauser WHERE email = $1", [email]);
        
        if (userRes.rows.length === 0) {
            return res.json({ success: false, message: "Email not found." });
        }

        const username = userRes.rows[0].username;
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        await pool.query("UPDATE invoicedatauser SET reset_otp = $1, otp_expiry = $2 WHERE email = $3", [otp, expiry, email]);

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });

        await transporter.sendMail({
            from: `"Billing & Report System" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Password Reset OTP`,
            html: `<div style="padding:20px;"><h2>Password Reset Request</h2><p>Hello ${username},</p><p>Your OTP for password recovery is: <b style="font-size:24px; color:#0ea5e9;">${otp}</b></p><p>Valid for 10 minutes.</p></div>`,
        });

        res.json({ success: true, message: "OTP sent successfully to your email." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reset Password
router.post("/reset-password", async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const userRes = await pool.query("SELECT reset_otp, otp_expiry FROM invoicedatauser WHERE email = $1", [email]);

        if (userRes.rows.length === 0 || !userRes.rows[0].reset_otp) {
            return res.json({ success: false, message: "No active OTP request found." });
        }

        if (new Date() > new Date(userRes.rows[0].otp_expiry)) {
            await pool.query("UPDATE invoicedatauser SET reset_otp = NULL, otp_expiry = NULL WHERE email = $1", [email]);
            return res.json({ success: false, message: "OTP has expired. Please request a new one." });
        }

        if (userRes.rows[0].reset_otp !== otp) {
            return res.json({ success: false, message: "Incorrect OTP." });
        }

        const hashedNew = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE invoicedatauser SET password_hash = $1, reset_otp = NULL, otp_expiry = NULL WHERE email = $2", [hashedNew, email]);

        res.json({ success: true, message: "Password reset successful! You can now login." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- ADMIN ROUTES ---

// Get all users
router.get("/admin/users", verifyInvoiceToken, verifyInvoiceAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, display_name, username, email, role, status, created_at FROM invoicedatauser ORDER BY id DESC");
        res.json({ success: true, users: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update User Status/Role
router.post("/admin/update-user", verifyInvoiceToken, verifyInvoiceAdmin, async (req, res) => {
    try {
        const { userId, role, status } = req.body;
        
        if (req.user.id === userId) {
            return res.json({ success: false, message: "Cannot edit your own active admin account." });
        }

        await pool.query("UPDATE invoicedatauser SET role = $1, status = $2 WHERE id = $3", [role, status, userId]);
        res.json({ success: true, message: "User updated successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete User
router.delete("/admin/delete-user/:id", verifyInvoiceToken, verifyInvoiceAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.id == id) {
            return res.json({ success: false, message: "Cannot delete your own account." });
        }
        await pool.query("DELETE FROM invoicedatauser WHERE id = $1", [id]);
        res.json({ success: true, message: "User deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;