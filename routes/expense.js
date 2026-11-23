const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { verifyToken } = require("../middlewares/auth");

const JWT_SECRET = process.env.JWT_SECRET;

// Isolated constant-time string comparison (anti-timing attack)
function _safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Isolated in-memory rate limiter for /login and /delete (anti-brute-force)
const _attemptStore = new Map();
function _checkRateLimit(key, maxAttempts = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = _attemptStore.get(key);
  if (!entry || now > entry.resetAt) {
    _attemptStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  entry.count += 1;
  return true;
}

function _validateEntryPayload(body) {
  const { date, particulars, ledger, type, amount } = body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return "Invalid date format";
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return "Amount must be a positive number";
  }
  const cleanPart = String(particulars || "").trim();
  if (!cleanPart || cleanPart.length > 255) {
    return "Particulars must be between 1 and 255 characters";
  }
  if (!type || !ledger) {
    return "Category and Source are required";
  }
  return null;
}

// 🟢 Secure Admin Login Route
router.post("/login", (req, res) => {
  const clientIp = req.ip || "unknown";
  if (!_checkRateLimit(`login:${clientIp}`)) {
    return res.status(429).json({
      success: false,
      message: "Too many login attempts. Try again later.",
    });
  }

  const { passcode } = req.body || {};
  const validPasscode = process.env.KLM_EXPENSE_CODE;

  if (!validPasscode || !JWT_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Server security configuration missing.",
    });
  }

  if (_safeEqual(passcode, validPasscode)) {
    _attemptStore.delete(`login:${clientIp}`);
    const token = jwt.sign({ role: "expense_admin" }, JWT_SECRET, {
      expiresIn: "30m",
    });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: "Invalid Passcode" });
  }
});

router.use(verifyToken);

// Isolated role check: only tokens issued by /expenses/login can access /expenses/*
router.use((req, res, next) => {
  if (!req.user || req.user.role !== "expense_admin") {
    return res.status(403).json({ success: false, message: "Access Denied" });
  }
  next();
});

// 1. Get all entries
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM journal_entries ORDER BY entry_date ASC, id ASC",
    );
    res.json(result.rows);
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server Error Fetching Data" });
  }
});

// 2. Add New Entry
router.post("/add", async (req, res) => {
  const validationError = _validateEntryPayload(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }
  try {
    const { date, particulars, ledger, type, amount } = req.body;
    await pool.query(
      "INSERT INTO journal_entries (entry_date, particulars, ledger_head, entry_type, amount) VALUES ($1, $2, $3, $4, $5)",
      [date, String(particulars).trim(), ledger, type, Number(amount)],
    );
    res.json({ success: true, message: "Entry Added Successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add entry" });
  }
});

// 3. Update Existing Entry
router.put("/update/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Invalid Entry ID" });
  }
  const validationError = _validateEntryPayload(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }
  try {
    const { date, particulars, ledger, type, amount } = req.body;
    const result = await pool.query(
      "UPDATE journal_entries SET entry_date=$1, particulars=$2, ledger_head=$3, entry_type=$4, amount=$5 WHERE id=$6",
      [date, String(particulars).trim(), ledger, type, Number(amount), id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    res.json({ success: true, message: "Entry Updated Successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update entry" });
  }
});

// 4. Secure Delete Entry with Environment Key validation
router.delete("/delete/:id", async (req, res) => {
  const clientIp = req.ip || "unknown";
  if (!_checkRateLimit(`delete:${clientIp}`)) {
    return res.status(429).json({
      success: false,
      message: "Too many delete attempts. Try again later.",
    });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Invalid Entry ID" });
  }
  try {
    const { key } = req.body || {};
    const validKey = process.env.DELETE_KEY;
    if (!validKey) {
      return res.status(500).json({
        success: false,
        message: "Delete key not configured on server",
      });
    }

    if (!_safeEqual(key, validKey)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Delete Security Key" });
    }

    _attemptStore.delete(`delete:${clientIp}`);
    const result = await pool.query("DELETE FROM journal_entries WHERE id=$1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }
    res.json({ success: true, message: "Entry Deleted Successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete entry" });
  }
});

// 5. Excel Export Route 🟢
router.get("/export-excel", async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if ((from && !dateRe.test(from)) || (to && !dateRe.test(to))) {
      return res.status(400).send("Invalid date filter");
    }

    let query = "SELECT * FROM journal_entries";
    let params = [];

    if (from && to) {
      query += " WHERE entry_date >= $1 AND entry_date <= $2";
      params = [from, to];
    } else if (from) {
      query += " WHERE entry_date >= $1";
      params = [from];
    } else if (to) {
      query += " WHERE entry_date <= $1";
      params = [to];
    }

    query += " ORDER BY entry_date ASC, id ASC";

    const result = await pool.query(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Expense Report");

    // 🟢 പ്രധാന മാറ്റം: Date കോളത്തിന് എക്സൽ ഫോർമാറ്റ് (numFmt) നൽകുന്നു
    worksheet.columns = [
      {
        header: "Date",
        key: "date",
        width: 15,
        style: { numFmt: "dd/mm/yyyy" },
      },
      { header: "Particulars", key: "particulars", width: 40 },
      { header: "Category", key: "category", width: 25 },
      { header: "Source", key: "source", width: 25 },
      { header: "Amount", key: "amount", width: 15 },
    ];

    result.rows.forEach((row) => {
      let excelDate = null;
      if (row.entry_date) {
        let d = new Date(row.entry_date);
        // 🟢 ടൈംസോൺ പ്രശ്നം ഒഴിവാക്കാൻ കൃത്യമായ Year, Month, Date എടുത്ത് പുതിയ Date Object ഉണ്ടാക്കുന്നു
        excelDate = new Date(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
        );
      }

      worksheet.addRow({
        date: excelDate, // 🟢 സ്ട്രിംഗിന് പകരം ഒറിജിനൽ Date Object തന്നെ നൽകുന്നു
        particulars: row.particulars,
        category: row.entry_type,
        source: row.ledger_head,
        amount: parseFloat(row.amount),
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=KLM_Expense_Report.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Export Error:", error);
    res.status(500).send("Error generating Excel");
  }
});

module.exports = router;
