const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs"); // Added bcryptjs
const jwt = require("jsonwebtoken"); // Added jsonwebtoken to fix the error
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const eqWebauthnChallenges = new Map();

function getEqRpConfig(req) {
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "";
  const rpID = hostHeader.split(":")[0];
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  return { rpID, origin: `${proto}://${hostHeader}` };
}

async function ensureWebauthnColumn() {
  await pool.query(
    `ALTER TABLE employloguser ADD COLUMN IF NOT EXISTS webauthn_credentials JSONB DEFAULT '[]'::jsonb`,
  );
}

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

    const clientIp = (req.headers["x-forwarded-for"] || req.ip || "")
      .split(",")[0]
      .trim();
    fetch("http://127.0.0.1:8001/py/reset-face-lock", {
      method: "POST",
      headers: {
        "x-internal-secret": process.env.JWT_SECRET,
        ...(clientIp ? { "x-forwarded-for": clientIp } : {}),
      },
    }).catch(() => {});

    res.json({ success: true, token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error during login." });
  }
});

// 1. Start Windows Hello Registration (Username + Password നിർബന്ധം)
router.post("/webauthn/register-options", async (req, res) => {
  try {
    await ensureWebauthnColumn();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json({ success: false, message: "Username and password required." });
    }
    const userRes = await pool.query(
      "SELECT id, username, password, status, webauthn_credentials FROM employloguser WHERE username = $1",
      [username],
    );
    if (userRes.rows.length === 0) {
      return res.json({ success: false, message: "Invalid credentials." });
    }
    const user = userRes.rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.json({ success: false, message: "Invalid credentials." });
    }
    if (user.status !== "approved") {
      return res.json({ success: false, message: "Account not approved by Admin." });
    }

    const { rpID } = getEqRpConfig(req);
    const existingCreds = Array.isArray(user.webauthn_credentials) ? user.webauthn_credentials : [];

    const options = await generateRegistrationOptions({
      rpName: "Haka ERP Own Equipment",
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

    eqWebauthnChallenges.set(`reg_${user.id}`, options.challenge);
    res.json({ success: true, options, userId: user.id });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 2. Verify & Save Windows Hello Credential
router.post("/webauthn/register-verify", async (req, res) => {
  try {
    await ensureWebauthnColumn();
    const { userId, credential } = req.body;
    const expectedChallenge = eqWebauthnChallenges.get(`reg_${userId}`);
    if (!expectedChallenge) {
      return res.json({ success: false, message: "Registration session expired. Try again." });
    }

    const { rpID, origin } = getEqRpConfig(req);
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
      "SELECT webauthn_credentials FROM employloguser WHERE id = $1",
      [userId],
    );
    const existing = Array.isArray(userRes.rows[0]?.webauthn_credentials)
      ? userRes.rows[0].webauthn_credentials
      : [];
    existing.push(credRecord);

    await pool.query(
      "UPDATE employloguser SET webauthn_credentials = $1::jsonb WHERE id = $2",
      [JSON.stringify(existing), userId],
    );

    eqWebauthnChallenges.delete(`reg_${userId}`);
    res.json({ success: true, message: "Windows Hello / Biometric enabled on this device!" });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 3. Start Windows Hello Login
router.post("/webauthn/login-options", async (req, res) => {
  try {
    await ensureWebauthnColumn();
    const { rpID } = getEqRpConfig(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: [],
    });
    eqWebauthnChallenges.set(options.challenge, { ts: Date.now() });
    res.json({ success: true, options });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 4. Verify Windows Hello Login & Issue JWT
router.post("/webauthn/login-verify", async (req, res) => {
  try {
    await ensureWebauthnColumn();
    const { credential, challenge } = req.body;
    if (!eqWebauthnChallenges.get(challenge)) {
      return res.json({ success: false, message: "Challenge expired. Try again." });
    }

    const usersRes = await pool.query(
      "SELECT id, username, role, status, webauthn_credentials FROM employloguser WHERE webauthn_credentials IS NOT NULL AND jsonb_array_length(webauthn_credentials) > 0",
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
    if (matchedUser.status !== "approved") {
      return res.json({ success: false, message: "Account not approved by Admin." });
    }

    const { rpID, origin } = getEqRpConfig(req);
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
      "UPDATE employloguser SET webauthn_credentials = $1::jsonb WHERE id = $2",
      [JSON.stringify(matchedUser.webauthn_credentials), matchedUser.id],
    );
    eqWebauthnChallenges.delete(challenge);

    const token = jwt.sign(
      { id: matchedUser.id, username: matchedUser.username, role: matchedUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "12h" },
    );

    res.json({
      success: true,
      token,
      user: { id: matchedUser.id, username: matchedUser.username, role: matchedUser.role, status: matchedUser.status },
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
