const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const invoiceWebauthnChallenges = new Map();

function getInvoiceRpConfig(req) {
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "";
  const rpID = hostHeader.split(":")[0];
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  return { rpID, origin: `${proto}://${hostHeader}` };
}

async function ensureInvoiceWebauthnColumn() {
  await pool.query(
    `ALTER TABLE invoicedatauser ADD COLUMN IF NOT EXISTS webauthn_credentials JSONB DEFAULT '[]'::jsonb`
  );
}

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// 1. Token Verification Middleware
const verifyInvoiceToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: "No token provided." });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        const u = await pool.query("SELECT status FROM invoicedatauser WHERE id = $1", [req.user.id]);
        if (u.rows.length === 0 || u.rows[0].status !== "Approved") {
            return res.status(401).json({ success: false, message: "Account not active." });
        }
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

// Signup (Updated to support Face Login Data)
router.post("/signup", async (req, res) => {
    try {
        const { displayName, username, email, password, faceDescriptor } = req.body;
        
        const userCheck = await pool.query(
            "SELECT id FROM invoicedatauser WHERE username = $1 OR email = $2", 
            [username, email]
        );
        
        if (userCheck.rows.length > 0) {
            return res.json({ success: false, message: "Username or Email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            "INSERT INTO invoicedatauser (display_name, username, email, password_hash, role, status, face_descriptor) VALUES ($1, $2, $3, $4, 'User', 'Pending', $5)",
            [displayName, username, email, hashedPassword, faceDescriptor ? JSON.stringify(faceDescriptor) : null]
        );

        res.json({ success: true, message: "Registration successful with Face ID! Awaiting Admin Approval." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post("/verify-credentials", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: "Missing credentials." });
        const result = await pool.query("SELECT * FROM invoicedatauser WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.json({ success: false, message: "User not found." });
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.json({ success: false, message: "Invalid credentials." });
        res.json({ success: true, message: "Credentials verified." });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

router.post("/reset-face-data", async (req, res) => {
    try {
        const { username, password, faceDescriptor } = req.body;
        if (!username || !password || !faceDescriptor) return res.json({ success: false, message: "All fields required." });
        const result = await pool.query("SELECT * FROM invoicedatauser WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.json({ success: false, message: "User not found." });
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.json({ success: false, message: "Invalid credentials." });
        await pool.query("UPDATE invoicedatauser SET face_descriptor = $1 WHERE id = $2", [JSON.stringify(faceDescriptor), user.id]);
        try {
            await fetch("http://127.0.0.1:8001/py/billing-invalidate-cache", { method: "POST" });
        } catch (e) {
            console.warn("Billing cache invalidate failed:", e.message);
        }
        const faceTrustToken =
            user.status === "Approved"
                ? jwt.sign(
                      { username: user.username, purpose: "invoice_face_device_trust" },
                      JWT_SECRET,
                      { expiresIn: "30d" }
                  )
                : null;
        res.json({ success: true, message: "Face data updated successfully!", faceTrustToken });
    } catch (error) {
        res.json({ success: false, message: error.message });
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

router.post("/webauthn/register-options", async (req, res) => {
  try {
    await ensureInvoiceWebauthnColumn();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json({ success: false, message: "Username and password required." });
    }
    const userRes = await pool.query(
      "SELECT id, username, password_hash, status, webauthn_credentials FROM invoicedatauser WHERE username = $1",
      [username]
    );
    if (userRes.rows.length === 0) {
      return res.json({ success: false, message: "Invalid credentials." });
    }
    const user = userRes.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.json({ success: false, message: "Invalid credentials." });
    }
    if (user.status !== "Approved") {
      return res.json({ success: false, message: "Account not approved by Admin." });
    }

    const { rpID } = getInvoiceRpConfig(req);
    const existingCreds = Array.isArray(user.webauthn_credentials) ? user.webauthn_credentials : [];

    const options = await generateRegistrationOptions({
      rpName: "Haka ERP Billing",
      rpID,
      userName: user.username,
      userDisplayName: user.username,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      excludeCredentials: existingCreds.map((c) => ({
        id: c.id,
        transports: c.transports || ["internal"],
      })),
    });

    invoiceWebauthnChallenges.set(`reg_${user.id}`, options.challenge);
    res.json({ success: true, options, userId: user.id });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post("/webauthn/register-verify", async (req, res) => {
  try {
    await ensureInvoiceWebauthnColumn();
    const { userId, credential } = req.body;
    const expectedChallenge = invoiceWebauthnChallenges.get(`reg_${userId}`);
    if (!expectedChallenge) {
      return res.json({ success: false, message: "Registration session expired. Try again." });
    }

    const { rpID, origin } = getInvoiceRpConfig(req);
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.json({ success: false, message: "Biometric verification failed." });
    }

    const { credential: newCred } = verification.registrationInfo;
    const credRecord = {
      id: newCred.id,
      publicKey: Buffer.from(newCred.publicKey).toString("base64url"),
      counter: newCred.counter,
      transports: credential.response?.transports || ["internal"],
    };

    const userRes = await pool.query(
      "SELECT webauthn_credentials FROM invoicedatauser WHERE id = $1",
      [userId]
    );
    const existing = Array.isArray(userRes.rows[0]?.webauthn_credentials)
      ? userRes.rows[0].webauthn_credentials
      : [];
    existing.push(credRecord);

    await pool.query(
      "UPDATE invoicedatauser SET webauthn_credentials = $1::jsonb WHERE id = $2",
      [JSON.stringify(existing), userId]
    );

    invoiceWebauthnChallenges.delete(`reg_${userId}`);
    res.json({ success: true, message: "Windows Hello / Biometric enabled on this device!" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post("/webauthn/login-options", async (req, res) => {
  try {
    await ensureInvoiceWebauthnColumn();
    const { rpID } = getInvoiceRpConfig(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: [],
    });
    invoiceWebauthnChallenges.set(options.challenge, { ts: Date.now() });
    res.json({ success: true, options });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post("/webauthn/login-verify", async (req, res) => {
  try {
    await ensureInvoiceWebauthnColumn();
    const { credential, challenge } = req.body;
    if (!invoiceWebauthnChallenges.get(challenge)) {
      return res.json({ success: false, message: "Challenge expired. Try again." });
    }

    const usersRes = await pool.query(
      "SELECT id, username, role, email, display_name, status, webauthn_credentials FROM invoicedatauser WHERE webauthn_credentials IS NOT NULL AND jsonb_array_length(webauthn_credentials) > 0"
    );

    let matchedUser = null;
    let matchedCred = null;
    for (const u of usersRes.rows) {
      const creds = Array.isArray(u.webauthn_credentials) ? u.webauthn_credentials : [];
      const found = creds.find((c) => c.id === credential.id);
      if (found) {
        matchedUser = u;
        matchedCred = found;
        break;
      }
    }

    if (!matchedUser || !matchedCred) {
      return res.json({ success: false, message: "Device biometric not registered." });
    }
    if (matchedUser.status !== "Approved") {
      return res.json({ success: false, message: "Account not approved by Admin." });
    }

    const { rpID, origin } = getInvoiceRpConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: matchedCred.id,
        publicKey: new Uint8Array(Buffer.from(matchedCred.publicKey, "base64url")),
        counter: matchedCred.counter || 0,
        transports: matchedCred.transports || ["internal"],
      },
    });

    if (!verification.verified) {
      return res.json({ success: false, message: "Biometric verification failed." });
    }

    matchedCred.counter = verification.authenticationInfo.newCounter;
    await pool.query(
      "UPDATE invoicedatauser SET webauthn_credentials = $1::jsonb WHERE id = $2",
      [JSON.stringify(matchedUser.webauthn_credentials), matchedUser.id]
    );
    invoiceWebauthnChallenges.delete(challenge);

    const token = jwt.sign(
      { id: matchedUser.id, username: matchedUser.username, role: matchedUser.role, email: matchedUser.email },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        role: matchedUser.role,
        email: matchedUser.email,
        displayName: matchedUser.display_name,
      },
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;