const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middlewares/auth");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_change_this";

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
async function initializeAccountingSystem() {
  try {
    // 1. Users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oeledger (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'User',
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Chart of Accounts — extended with account_type for proper reporting
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_accounts (
        id SERIAL PRIMARY KEY,
        ledger_name VARCHAR(255) NOT NULL,
        main_group VARCHAR(100) NOT NULL,
        sub_group VARCHAR(100),
        account_type VARCHAR(50),
        is_system BOOLEAN DEFAULT FALSE,
        is_employee BOOLEAN DEFAULT FALSE,
        opening_balance DECIMAL(15,2) DEFAULT 0,
        opening_balance_type VARCHAR(10) DEFAULT 'Dr',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Voucher Master — one record per voucher
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_vouchers (
        id SERIAL PRIMARY KEY,
        voucher_no VARCHAR(50),
        voucher_date DATE NOT NULL,
        voucher_type VARCHAR(50) NOT NULL,
        narration TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Voucher Lines — multiple Dr/Cr per voucher (Tally-style)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_voucher_lines (
        id SERIAL PRIMARY KEY,
        voucher_id INT REFERENCES oe_vouchers(id) ON DELETE CASCADE,
        account_id INT REFERENCES oe_accounts(id),
        entry_type VARCHAR(5) NOT NULL CHECK (entry_type IN ('Dr','Cr')),
        amount DECIMAL(15,2) NOT NULL,
        line_narration TEXT
      );
    `);

    // 5. Audit Log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_audit_log (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100),
        action VARCHAR(255),
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed system accounts (only if oe_accounts is empty)
    const countRes = await pool.query("SELECT COUNT(*) FROM oe_accounts");
    if (parseInt(countRes.rows[0].count) === 0) {
      await seedSystemAccounts();
    }

    console.log("✅ ERP Accounting System Initialized");
  } catch (err) {
    console.error("Accounting Init Error:", err.message);
  }
}

// ============================================================
// SEED SYSTEM/DEFAULT ACCOUNTS
// ============================================================
async function seedSystemAccounts() {
  const systemAccounts = [
    // ── ASSETS ──────────────────────────────────────────────
    // Cash & Bank
    {
      ledger_name: "Cash in Hand",
      main_group: "Assets",
      sub_group: "Cash & Bank",
      account_type: "cash",
      is_system: true,
    },
    {
      ledger_name: "Cash at Bank",
      main_group: "Assets",
      sub_group: "Cash & Bank",
      account_type: "bank",
      is_system: true,
    },

    // GST Receivables (Input Tax Credit)
    {
      ledger_name: "Input CGST",
      main_group: "Assets",
      sub_group: "GST / Tax Receivables",
      account_type: "gst",
      is_system: true,
    },
    {
      ledger_name: "Input SGST",
      main_group: "Assets",
      sub_group: "GST / Tax Receivables",
      account_type: "gst",
      is_system: true,
    },
    {
      ledger_name: "Input IGST",
      main_group: "Assets",
      sub_group: "GST / Tax Receivables",
      account_type: "gst",
      is_system: true,
    },
    {
      ledger_name: "TDS Receivable",
      main_group: "Assets",
      sub_group: "GST / Tax Receivables",
      account_type: "tax",
      is_system: true,
    },
    {
      ledger_name: "Advance Tax Paid",
      main_group: "Assets",
      sub_group: "GST / Tax Receivables",
      account_type: "tax",
      is_system: true,
    },
    {
      ledger_name: "GST Refund Receivable",
      main_group: "Assets",
      sub_group: "GST / Tax Receivables",
      account_type: "gst",
      is_system: true,
    },

    // Inventory
    {
      ledger_name: "Stock / Inventory",
      main_group: "Assets",
      sub_group: "Current Assets",
      account_type: "inventory",
      is_system: true,
    },

    // ── LIABILITIES ──────────────────────────────────────────
    // GST Payables (Output Tax)
    {
      ledger_name: "Output CGST",
      main_group: "Liabilities",
      sub_group: "Duties & Taxes",
      account_type: "gst",
      is_system: true,
    },
    {
      ledger_name: "Output SGST",
      main_group: "Liabilities",
      sub_group: "Duties & Taxes",
      account_type: "gst",
      is_system: true,
    },
    {
      ledger_name: "Output IGST",
      main_group: "Liabilities",
      sub_group: "Duties & Taxes",
      account_type: "gst",
      is_system: true,
    },
    {
      ledger_name: "TDS Payable",
      main_group: "Liabilities",
      sub_group: "Duties & Taxes",
      account_type: "tax",
      is_system: true,
    },

    // ── CAPITAL ──────────────────────────────────────────────
    {
      ledger_name: "Ajils KS Capital A/c",
      main_group: "Capital & Reserves",
      sub_group: "Capital Accounts",
      account_type: "capital",
      is_system: true,
    },
    {
      ledger_name: "Ajmal Khan O A Capital A/c",
      main_group: "Capital & Reserves",
      sub_group: "Capital Accounts",
      account_type: "capital",
      is_system: true,
    },
    {
      ledger_name: "Muhammedkutty Ummer Capital A/c",
      main_group: "Capital & Reserves",
      sub_group: "Capital Accounts",
      account_type: "capital",
      is_system: true,
    },
    {
      ledger_name: "Shelmy Capital A/c",
      main_group: "Capital & Reserves",
      sub_group: "Capital Accounts",
      account_type: "capital",
      is_system: true,
    },
    {
      ledger_name: "Reserves & Surplus",
      main_group: "Capital & Reserves",
      sub_group: "Reserves",
      account_type: "reserve",
      is_system: true,
    },

    // ── REVENUE ──────────────────────────────────────────────
    {
      ledger_name: "Sales",
      main_group: "Revenue",
      sub_group: "Direct Income",
      account_type: "sales",
      is_system: true,
    },
    {
      ledger_name: "Sales Return",
      main_group: "Revenue",
      sub_group: "Direct Income",
      account_type: "sales",
      is_system: true,
    },
    {
      ledger_name: "Commission Received",
      main_group: "Revenue",
      sub_group: "Indirect Income",
      account_type: "income",
      is_system: true,
    },

    // ── EXPENSES ─────────────────────────────────────────────
    {
      ledger_name: "Purchase",
      main_group: "Expenses",
      sub_group: "Direct Expenses",
      account_type: "purchase",
      is_system: true,
    },
    {
      ledger_name: "Purchase Return",
      main_group: "Expenses",
      sub_group: "Direct Expenses",
      account_type: "purchase",
      is_system: true,
    },
    {
      ledger_name: "Opening Stock",
      main_group: "Expenses",
      sub_group: "Direct Expenses",
      account_type: "stock",
      is_system: true,
    },
    {
      ledger_name: "Closing Stock",
      main_group: "Revenue",
      sub_group: "Direct Income",
      account_type: "stock",
      is_system: true,
    },

    // Office Expenses
    {
      ledger_name: "Office Stationery",
      main_group: "Expenses",
      sub_group: "Office Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Room Rent",
      main_group: "Expenses",
      sub_group: "Office Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Electricity Charges",
      main_group: "Expenses",
      sub_group: "Office Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Office Maintenance",
      main_group: "Expenses",
      sub_group: "Office Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Kitchen Supplies",
      main_group: "Expenses",
      sub_group: "Office Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Computer Accessories Purchase",
      main_group: "Expenses",
      sub_group: "Office Expenses",
      account_type: "expense",
      is_system: true,
    },

    // Employee / Salary
    {
      ledger_name: "Salary & Wages",
      main_group: "Expenses",
      sub_group: "Employee Expenses",
      account_type: "salary",
      is_system: true,
    },
    {
      ledger_name: "Salary Outstanding",
      main_group: "Liabilities",
      sub_group: "Current Liabilities",
      account_type: "payable",
      is_system: true,
    },
    {
      ledger_name: "Employee Bonus",
      main_group: "Expenses",
      sub_group: "Employee Expenses",
      account_type: "salary",
      is_system: true,
    },
    {
      ledger_name: "Mobile Allowance",
      main_group: "Expenses",
      sub_group: "Employee Expenses",
      account_type: "salary",
      is_system: true,
    },
    {
      ledger_name: "Other Allowances",
      main_group: "Expenses",
      sub_group: "Employee Expenses",
      account_type: "salary",
      is_system: true,
    },
    {
      ledger_name: "Staff Reimbursement",
      main_group: "Expenses",
      sub_group: "Employee Expenses",
      account_type: "expense",
      is_system: true,
    },

    // Other Expenses
    {
      ledger_name: "Equipment Maintenance",
      main_group: "Expenses",
      sub_group: "Indirect Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Depreciation",
      main_group: "Expenses",
      sub_group: "Indirect Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Bad Debt Provision",
      main_group: "Expenses",
      sub_group: "Indirect Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Legal Charges",
      main_group: "Expenses",
      sub_group: "Indirect Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Commission Paid",
      main_group: "Expenses",
      sub_group: "Indirect Expenses",
      account_type: "expense",
      is_system: true,
    },
    {
      ledger_name: "Drawings",
      main_group: "Assets",
      sub_group: "Current Assets",
      account_type: "drawings",
      is_system: true,
    },
  ];

  for (const acc of systemAccounts) {
    await pool.query(
      `INSERT INTO oe_accounts (ledger_name, main_group, sub_group, account_type, is_system)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [
        acc.ledger_name,
        acc.main_group,
        acc.sub_group,
        acc.account_type,
        acc.is_system,
      ],
    );
  }
  console.log("✅ System accounts seeded");
}

initializeAccountingSystem();

// ============================================================
// HELPER: Generate Voucher Number
// ============================================================
async function generateVoucherNo(type) {
  const prefix =
    {
      Payment: "PMT",
      Receipt: "RCT",
      Journal: "JNL",
      Contra: "CTR",
      Sales: "SLS",
      Purchase: "PUR",
    }[type] || "VCH";
  const res = await pool.query(
    "SELECT COUNT(*) FROM oe_vouchers WHERE voucher_type = $1",
    [type],
  );
  const seq = parseInt(res.rows[0].count) + 1;
  return `${prefix}-${String(seq).padStart(5, "0")}`;
}

// ============================================================
// AUTH
// ============================================================
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      "SELECT * FROM oeledger WHERE username = $1",
      [username],
    );
    if (result.rows.length === 0)
      return res.json({ success: false, message: "User not found." });
    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid)
      return res.json({ success: false, message: "Invalid password." });
    if (user.status !== "Active")
      return res.json({ success: false, message: "Account is inactive." });

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        module: "accounting",
      },
      JWT_SECRET,
      { expiresIn: "12h" },
    );
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'LOGIN', '{}')",
      [user.username],
    );
    res.json({
      success: true,
      token,
      user: { username: user.username, role: user.role },
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post("/users/add", verifyToken, async (req, res) => {
  if (req.user.role !== "Admin" && req.user.role !== "Super Admin") {
    return res.json({ success: false, message: "Access Denied: Admin only." });
  }
  try {
    const { username, password, role } = req.body;
    const check = await pool.query(
      "SELECT id FROM oeledger WHERE username = $1",
      [username],
    );
    if (check.rows.length > 0)
      return res.json({ success: false, message: "Username already exists." });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO oeledger (username, password_hash, role) VALUES ($1, $2, $3)",
      [username, hash, role || "User"],
    );
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'CREATE_USER', $2)",
      [req.user.username, JSON.stringify({ target_user: username, role })],
    );
    res.json({ success: true, message: "User created." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all users (Admin only)
router.get("/users", verifyToken, async (req, res) => {
  if (req.user.role !== "Admin" && req.user.role !== "Super Admin") {
    return res.json({ success: false, message: "Access Denied." });
  }
  try {
    const result = await pool.query(
      "SELECT id, username, role, status, created_at FROM oeledger ORDER BY id ASC",
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete user (Admin only)
router.delete("/users/delete/:id", verifyToken, async (req, res) => {
  if (req.user.role !== "Admin" && req.user.role !== "Super Admin") {
    return res.json({ success: false, message: "Access Denied." });
  }
  try {
    const id = req.params.id;
    const userRes = await pool.query(
      "SELECT username FROM oeledger WHERE id = $1",
      [id],
    );

    if (userRes.rows.length === 0) {
      return res.json({ success: false, message: "User not found." });
    }

    // സ്വന്തം അക്കൗണ്ട് ഡിലീറ്റ് ചെയ്യുന്നത് തടയാൻ
    if (userRes.rows[0].username === req.user.username) {
      return res.json({
        success: false,
        message: "You cannot delete your own logged-in account.",
      });
    }

    await pool.query("DELETE FROM oeledger WHERE id = $1", [id]);

    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'DELETE_USER', $2)",
      [
        req.user.username,
        JSON.stringify({ deleted_user: userRes.rows[0].username }),
      ],
    );

    res.json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// CHART OF ACCOUNTS
// ============================================================

// Get all ledgers (grouped)
router.get("/ledgers", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM oe_accounts ORDER BY main_group, sub_group, ledger_name ASC",
    );
    res.json({ success: true, ledgers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add new ledger
router.post("/ledgers/add", verifyToken, async (req, res) => {
  try {
    const {
      ledger_name,
      main_group,
      sub_group,
      account_type,
      is_employee,
      opening_balance,
      opening_balance_type,
    } = req.body;
    const result = await pool.query(
      `INSERT INTO oe_accounts (ledger_name, main_group, sub_group, account_type, is_employee, opening_balance, opening_balance_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        ledger_name,
        main_group,
        sub_group,
        account_type || "general",
        is_employee || false,
        opening_balance || 0,
        opening_balance_type || "Dr",
      ],
    );
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'CREATE_LEDGER', $2)",
      [
        req.user.username,
        JSON.stringify({ ledger: ledger_name, group: main_group, sub_group }),
      ],
    );
    res.json({ success: true, ledger: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete ledger (only if no transactions)
router.delete("/ledgers/delete/:id", verifyToken, async (req, res) => {
  if (req.user.role !== "Admin" && req.user.role !== "Super Admin") {
    return res.json({ success: false, message: "Access Denied: Admin only." });
  }
  try {
    const id = req.params.id;
    // Check if used in voucher lines
    const used = await pool.query(
      "SELECT COUNT(*) FROM oe_voucher_lines WHERE account_id = $1",
      [id],
    );
    if (parseInt(used.rows[0].count) > 0)
      return res.json({
        success: false,
        message: "Cannot delete — this account has transactions.",
      });
    const acc = await pool.query("SELECT * FROM oe_accounts WHERE id = $1", [
      id,
    ]);
    await pool.query("DELETE FROM oe_accounts WHERE id = $1", [id]);
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'DELETE_LEDGER', $2)",
      [
        req.user.username,
        JSON.stringify({ ledger_name: acc.rows[0]?.ledger_name }),
      ],
    );
    res.json({ success: true, message: "Ledger deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// VOUCHERS — MULTI-LINE (Tally-style)
// ============================================================

// Add voucher with multiple lines
router.post("/vouchers/add", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { voucher_date, voucher_type, narration, lines } = req.body;
    // lines = [{ account_id, entry_type: 'Dr'|'Cr', amount, line_narration }]

    if (!lines || lines.length < 2)
      return res.json({
        success: false,
        message: "Minimum 2 lines required (at least one Dr and one Cr).",
      });

    const drLines = lines.filter((l) => l.entry_type === "Dr");
    const crLines = lines.filter((l) => l.entry_type === "Cr");

    if (drLines.length === 0 || crLines.length === 0)
      return res.json({
        success: false,
        message: "Must have at least one Debit and one Credit line.",
      });

    const totalDr = drLines.reduce((s, l) => s + parseFloat(l.amount), 0);
    const totalCr = crLines.reduce((s, l) => s + parseFloat(l.amount), 0);

    if (Math.abs(totalDr - totalCr) > 0.01)
      return res.json({
        success: false,
        message: `Voucher is not balanced. Dr: ${totalDr.toFixed(2)}, Cr: ${totalCr.toFixed(2)}`,
      });

    const voucherNo = await generateVoucherNo(voucher_type);

    // Insert voucher master
    const vRes = await client.query(
      "INSERT INTO oe_vouchers (voucher_no, voucher_date, voucher_type, narration, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [voucherNo, voucher_date, voucher_type, narration, req.user.username],
    );
    const voucherId = vRes.rows[0].id;

    // Insert lines
    for (const line of lines) {
      await client.query(
        "INSERT INTO oe_voucher_lines (voucher_id, account_id, entry_type, amount, line_narration) VALUES ($1, $2, $3, $4, $5)",
        [
          voucherId,
          line.account_id,
          line.entry_type,
          parseFloat(line.amount),
          line.line_narration || null,
        ],
      );
    }

    // Audit
    const accountIds = lines.map((l) => l.account_id);
    const accRes = await client.query(
      "SELECT id, ledger_name FROM oe_accounts WHERE id = ANY($1)",
      [accountIds],
    );
    const accMap = {};
    accRes.rows.forEach((r) => (accMap[r.id] = r.ledger_name));

    await client.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'VOUCHER_ENTRY', $2)",
      [
        req.user.username,
        JSON.stringify({
          voucher_no: voucherNo,
          type: voucher_type,
          amount: totalDr,
          date: voucher_date,
          lines: lines.map((l) => ({
            account: accMap[l.account_id],
            type: l.entry_type,
            amount: l.amount,
          })),
        }),
      ],
    );

    await client.query("COMMIT");
    res.json({
      success: true,
      message: `Voucher ${voucherNo} saved successfully!`,
      voucher_id: voucherId,
      voucher_no: voucherNo,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Get vouchers list (daybook) — summarized view
router.get("/vouchers", verifyToken, async (req, res) => {
  try {
    const { fromDate, toDate, type } = req.query;
    let params = [];
    let where = [];
    let paramIdx = 1;

    if (fromDate && toDate) {
      where.push(
        `v.voucher_date >= $${paramIdx++} AND v.voucher_date <= $${paramIdx++}`,
      );
      params.push(fromDate, toDate);
    }
    if (type) {
      where.push(`v.voucher_type = $${paramIdx++}`);
      params.push(type);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    // Get vouchers with full line details as JSON for Tally style display
    const query = `
      SELECT 
        v.id, v.voucher_no, v.voucher_date, v.voucher_type, v.narration, v.created_by,
        (
          SELECT json_agg(json_build_object(
            'entry_type', vl.entry_type, 
            'ledger_name', a.ledger_name, 
            'amount', vl.amount, 
            'line_narration', vl.line_narration
          ) ORDER BY vl.entry_type DESC, vl.id ASC)
          FROM oe_voucher_lines vl 
          JOIN oe_accounts a ON vl.account_id = a.id 
          WHERE vl.voucher_id = v.id
        ) as lines,
        (SELECT COALESCE(SUM(amount), 0) FROM oe_voucher_lines WHERE voucher_id = v.id AND entry_type = 'Dr') AS amount
      FROM oe_vouchers v
      ${whereClause}
      ORDER BY v.voucher_date DESC, v.id DESC
    `;
    const result = await pool.query(query, params);
    res.json({ success: true, vouchers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single voucher with all lines (for editing)
router.get("/vouchers/:id", verifyToken, async (req, res) => {
  try {
    const vRes = await pool.query("SELECT * FROM oe_vouchers WHERE id = $1", [
      req.params.id,
    ]);
    if (vRes.rows.length === 0)
      return res.json({ success: false, message: "Voucher not found." });
    const lRes = await pool.query(
      `SELECT vl.*, a.ledger_name, a.main_group FROM oe_voucher_lines vl
       JOIN oe_accounts a ON vl.account_id = a.id WHERE vl.voucher_id = $1 ORDER BY vl.entry_type DESC, vl.id ASC`,
      [req.params.id],
    );
    res.json({ success: true, voucher: vRes.rows[0], lines: lRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Edit voucher (delete lines, re-insert)
router.put("/vouchers/edit/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = req.params.id;
    const { voucher_date, voucher_type, narration, lines } = req.body;

    if (!lines || lines.length < 2)
      return res.json({ success: false, message: "Minimum 2 lines required." });
    const totalDr = lines
      .filter((l) => l.entry_type === "Dr")
      .reduce((s, l) => s + parseFloat(l.amount), 0);
    const totalCr = lines
      .filter((l) => l.entry_type === "Cr")
      .reduce((s, l) => s + parseFloat(l.amount), 0);
    if (Math.abs(totalDr - totalCr) > 0.01)
      return res.json({
        success: false,
        message: `Not balanced. Dr: ${totalDr.toFixed(2)}, Cr: ${totalCr.toFixed(2)}`,
      });

    const old = await client.query("SELECT * FROM oe_vouchers WHERE id = $1", [
      id,
    ]);
    await client.query(
      "UPDATE oe_vouchers SET voucher_date=$1, voucher_type=$2, narration=$3 WHERE id=$4",
      [voucher_date, voucher_type, narration, id],
    );
    await client.query("DELETE FROM oe_voucher_lines WHERE voucher_id = $1", [
      id,
    ]);

    for (const line of lines) {
      await client.query(
        "INSERT INTO oe_voucher_lines (voucher_id, account_id, entry_type, amount, line_narration) VALUES ($1,$2,$3,$4,$5)",
        [
          id,
          line.account_id,
          line.entry_type,
          parseFloat(line.amount),
          line.line_narration || null,
        ],
      );
    }

    await client.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1,'UPDATE_VOUCHER',$2)",
      [
        req.user.username,
        JSON.stringify({
          voucher_id: id,
          voucher_no: old.rows[0]?.voucher_no,
          old_date: old.rows[0]?.voucher_date,
          new_date: voucher_date,
          status: "Voucher Modified",
        }),
      ],
    );

    await client.query("COMMIT");
    res.json({ success: true, message: "Voucher updated successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Delete voucher
router.delete("/vouchers/delete/:id", verifyToken, async (req, res) => {
  try {
    const old = await pool.query("SELECT * FROM oe_vouchers WHERE id = $1", [
      req.params.id,
    ]);
    if (old.rows.length === 0)
      return res.json({ success: false, message: "Voucher not found." });
    await pool.query("DELETE FROM oe_vouchers WHERE id = $1", [req.params.id]); // lines cascade
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1,'DELETE_VOUCHER',$2)",
      [
        req.user.username,
        JSON.stringify({
          voucher_id: req.params.id,
          voucher_no: old.rows[0].voucher_no,
          deleted_date: old.rows[0].voucher_date,
          warning: "Permanently Deleted",
        }),
      ],
    );
    res.json({ success: true, message: "Voucher deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// FINANCIAL REPORTS
// ============================================================

// Trial Balance / P&L / Balance Sheet data
router.get("/reports/financials", verifyToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    const query = `
      WITH LedgerTotals AS (
        SELECT
          a.id, a.ledger_name, a.main_group, a.sub_group, a.account_type,
          a.opening_balance, a.opening_balance_type,
          COALESCE(SUM(CASE WHEN vl.entry_type = 'Dr' THEN vl.amount ELSE 0 END), 0) AS txn_dr,
          COALESCE(SUM(CASE WHEN vl.entry_type = 'Cr' THEN vl.amount ELSE 0 END), 0) AS txn_cr
        FROM oe_accounts a
        LEFT JOIN oe_voucher_lines vl ON a.id = vl.account_id
          AND vl.voucher_id IN (
            SELECT id FROM oe_vouchers WHERE voucher_date >= $1 AND voucher_date <= $2
          )
        GROUP BY a.id, a.ledger_name, a.main_group, a.sub_group, a.account_type, a.opening_balance, a.opening_balance_type
      )
      SELECT *,
        txn_dr + CASE WHEN opening_balance_type = 'Dr' THEN opening_balance ELSE 0 END AS total_dr,
        txn_cr + CASE WHEN opening_balance_type = 'Cr' THEN opening_balance ELSE 0 END AS total_cr
      FROM LedgerTotals
      WHERE txn_dr > 0 OR txn_cr > 0 OR opening_balance > 0
      ORDER BY main_group, sub_group, ledger_name
    `;

    const result = await pool.query(query, [fromDate, toDate]);
    const ledgers = result.rows;

    // Net Dr/Cr per ledger
    ledgers.forEach((l) => {
      const dr = parseFloat(l.total_dr);
      const cr = parseFloat(l.total_cr);
      l.net_dr = dr > cr ? dr - cr : 0;
      l.net_cr = cr > dr ? cr - dr : 0;
    });

    // P&L
    let revenue = 0,
      expenses = 0;
    ledgers.forEach((l) => {
      if (l.main_group === "Revenue")
        revenue += parseFloat(l.net_cr) - parseFloat(l.net_dr);
      if (l.main_group === "Expenses")
        expenses += parseFloat(l.net_dr) - parseFloat(l.net_cr);
    });
    const netProfit = revenue - expenses;

    // Balance Sheet
    let assets = 0,
      liabilities = 0,
      capital = 0;
    ledgers.forEach((l) => {
      if (l.main_group === "Assets")
        assets += parseFloat(l.net_dr) - parseFloat(l.net_cr);
      if (l.main_group === "Liabilities")
        liabilities += parseFloat(l.net_cr) - parseFloat(l.net_dr);
      if (l.main_group === "Capital & Reserves")
        capital += parseFloat(l.net_cr) - parseFloat(l.net_dr);
    });

    res.json({
      success: true,
      trial_balance: ledgers,
      profit_loss: { revenue, expenses, net_profit: netProfit },
      balance_sheet: { assets, liabilities, capital, net_profit: netProfit },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Individual Ledger Statement
router.get("/reports/ledger-statement/:id", verifyToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const accountId = req.params.id;

    // Opening balance before fromDate
    const obRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN vl.entry_type='Dr' THEN vl.amount ELSE 0 END),0) AS ob_dr,
        COALESCE(SUM(CASE WHEN vl.entry_type='Cr' THEN vl.amount ELSE 0 END),0) AS ob_cr
      FROM oe_voucher_lines vl
      JOIN oe_vouchers v ON vl.voucher_id = v.id
      WHERE vl.account_id = $1 AND v.voucher_date < $2`,
      [accountId, fromDate],
    );

    const accInfo = await pool.query(
      "SELECT * FROM oe_accounts WHERE id = $1",
      [accountId],
    );
    const acc = accInfo.rows[0];
    const obDr =
      parseFloat(obRes.rows[0].ob_dr) +
      (acc.opening_balance_type === "Dr" ? parseFloat(acc.opening_balance) : 0);
    const obCr =
      parseFloat(obRes.rows[0].ob_cr) +
      (acc.opening_balance_type === "Cr" ? parseFloat(acc.opening_balance) : 0);

    const query = `
      SELECT
        v.voucher_no, v.voucher_date, v.voucher_type, v.narration,
        CASE WHEN vl.entry_type='Dr' THEN vl.amount ELSE 0 END AS debit,
        CASE WHEN vl.entry_type='Cr' THEN vl.amount ELSE 0 END AS credit,
        -- Opposite account name(s)
        (SELECT STRING_AGG(a2.ledger_name, ' / ')
         FROM oe_voucher_lines vl2
         JOIN oe_accounts a2 ON vl2.account_id = a2.id
         WHERE vl2.voucher_id = v.id AND vl2.account_id != $1
         AND vl2.entry_type != vl.entry_type) AS particulars
      FROM oe_voucher_lines vl
      JOIN oe_vouchers v ON vl.voucher_id = v.id
      WHERE vl.account_id = $1
        AND v.voucher_date >= $2 AND v.voucher_date <= $3
      ORDER BY v.voucher_date ASC, v.id ASC
    `;
    const result = await pool.query(query, [accountId, fromDate, toDate]);

    res.json({
      success: true,
      account: acc,
      opening: { dr: obDr, cr: obCr },
      statement: result.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Debtors / Creditors Outstanding
router.get("/reports/outstanding/:type", verifyToken, async (req, res) => {
  try {
    // type = 'debtors' or 'creditors'
    const subGroup = req.params.type === "debtors" ? "Debtors" : "Creditors";
    const query = `
      SELECT
        a.id, a.ledger_name,
        COALESCE(SUM(CASE WHEN vl.entry_type='Dr' THEN vl.amount ELSE 0 END),0) AS total_dr,
        COALESCE(SUM(CASE WHEN vl.entry_type='Cr' THEN vl.amount ELSE 0 END),0) AS total_cr,
        COALESCE(SUM(CASE WHEN vl.entry_type='Dr' THEN vl.amount ELSE -vl.amount END),0) AS balance
      FROM oe_accounts a
      LEFT JOIN oe_voucher_lines vl ON a.id = vl.account_id
      WHERE a.sub_group = $1
      GROUP BY a.id, a.ledger_name
      ORDER BY ABS(COALESCE(SUM(CASE WHEN vl.entry_type='Dr' THEN vl.amount ELSE -vl.amount END),0)) DESC
    `;
    const result = await pool.query(query, [subGroup]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GST Report
router.get("/reports/gst", verifyToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const query = `
      SELECT
        a.ledger_name, a.account_type,
        COALESCE(SUM(CASE WHEN vl.entry_type='Dr' THEN vl.amount ELSE 0 END),0) AS total_dr,
        COALESCE(SUM(CASE WHEN vl.entry_type='Cr' THEN vl.amount ELSE 0 END),0) AS total_cr
      FROM oe_accounts a
      JOIN oe_voucher_lines vl ON a.id = vl.account_id
      JOIN oe_vouchers v ON vl.voucher_id = v.id
      WHERE a.account_type = 'gst'
        AND v.voucher_date >= $1 AND v.voucher_date <= $2
      GROUP BY a.id, a.ledger_name, a.account_type
      ORDER BY a.main_group, a.ledger_name
    `;
    const result = await pool.query(query, [fromDate, toDate]);
    res.json({ success: true, gst: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Audit Logs
router.get("/logs", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM oe_audit_log ORDER BY created_at DESC LIMIT 500",
    );
    res.json({ success: true, logs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
