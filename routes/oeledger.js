const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { verifyToken, verifySuperAdmin } = require("../middlewares/auth");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_change_this";

// oeledger.js - Database Initialization Update
async function initializeAccountingSystem() {
  try {
    // 1. User Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oeledger (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE,
        password_hash VARCHAR(255),
        role VARCHAR(50) DEFAULT 'User', 
        status VARCHAR(20) DEFAULT 'Active'
      );
    `);

    // 2. Chart of Accounts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_accounts (
        id SERIAL PRIMARY KEY,
        ledger_name VARCHAR(255) NOT NULL,
        main_group VARCHAR(100) NOT NULL,
        sub_group VARCHAR(100),
        is_employee BOOLEAN DEFAULT FALSE,
        emp_id INT UNIQUE
      );
    `);

    // 3. Vouchers Table (CRITICAL: Added this table with DECIMAL for precision)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_vouchers (
        id SERIAL PRIMARY KEY,
        voucher_date DATE NOT NULL,
        voucher_type VARCHAR(50) NOT NULL,
        dr_account_id INT REFERENCES oe_accounts(id),
        cr_account_id INT REFERENCES oe_accounts(id),
        amount DECIMAL(15,2) NOT NULL,
        narration TEXT,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Audit Log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS oe_audit_log (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100),
        action VARCHAR(255),
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ Accounting System & Vouchers Table Initialized");
  } catch (err) {
    console.error("Accounting Init Error:", err.message);
  }
}
initializeAccountingSystem();

// ==========================================
// 🔐 AUTHENTICATION (Login & User Mgmt)
// ==========================================

// Login for Accounting Module
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      "SELECT * FROM oeledger WHERE username = $1",
      [username],
    );

    if (result.rows.length === 0)
      return res.json({
        success: false,
        message: "User not found in Accounting System.",
      });

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

    // Audit Log
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'LOGIN', '{}')",
      [user.username],
    );

    res.json({
      success: true,
      token,
      user: { username: user.username, role: user.role },
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Admin: Add New User to oeledger
router.post("/users/add", verifyToken, verifySuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    const userCheck = await pool.query(
      "SELECT * FROM oeledger WHERE username = $1",
      [username],
    );
    if (userCheck.rows.length > 0)
      return res.json({ success: false, message: "Username already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO oeledger (username, password_hash, role) VALUES ($1, $2, $3)",
      [username, hashedPassword, role || "User"],
    );

    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'CREATE_USER', $2)",
      [req.user.username, JSON.stringify({ target_user: username, role })],
    );

    res.json({
      success: true,
      message: "Accounting user created successfully.",
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ==========================================
// 📊 CHART OF ACCOUNTS (Ledger API)
// ==========================================

// Get All Ledgers
router.get("/ledgers", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM oe_accounts ORDER BY main_group, ledger_name ASC",
    );
    res.json({ success: true, ledgers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add New Custom Ledger (Add New +)
router.post("/ledgers/add", verifyToken, async (req, res) => {
  try {
    const { ledger_name, main_group, sub_group } = req.body;
    const newLedger = await pool.query(
      "INSERT INTO oe_accounts (ledger_name, main_group, sub_group) VALUES ($1, $2, $3) RETURNING *",
      [ledger_name, main_group, sub_group],
    );

    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'CREATE_LEDGER', $2)",
      [
        req.user.username,
        JSON.stringify({ ledger: ledger_name, group: main_group }),
      ],
    );

    res.json({ success: true, ledger: newLedger.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Edit Existing Ledger
router.put("/ledgers/edit/:id", verifyToken, async (req, res) => {
  try {
    const { ledger_name, main_group, sub_group } = req.body;
    const ledgerId = req.params.id;
    
    await pool.query(
      "UPDATE oe_accounts SET ledger_name = $1, main_group = $2, sub_group = $3 WHERE id = $4",
      [ledger_name, main_group, sub_group, ledgerId]
    );

    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'EDIT_LEDGER', $2)",
      [req.user.username, JSON.stringify({ ledger_id: ledgerId, updated_name: ledger_name, group: main_group })]
    );

    res.json({ success: true, message: "Ledger updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Audit Logs
router.get("/logs", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM oe_audit_log ORDER BY created_at DESC LIMIT 1000",
    );
    res.json({ success: true, logs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add New Voucher Entry
router.post("/vouchers/add", verifyToken, async (req, res) => {
  try {
    const {
      voucher_date,
      voucher_type,
      dr_account_id,
      cr_account_id,
      amount,
      narration,
    } = req.body;

    if (dr_account_id === cr_account_id) {
      return res.json({
        success: false,
        message: "Debit and Credit accounts cannot be the same.",
      });
    }

    const newVoucher = await pool.query(
      "INSERT INTO oe_vouchers (voucher_date, voucher_type, dr_account_id, cr_account_id, amount, narration, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [
        voucher_date,
        voucher_type,
        dr_account_id,
        cr_account_id,
        amount,
        narration,
        req.user.username,
      ],
    );

    // Get Ledger Names for the Log
    const ledgers = await pool.query(
      "SELECT id, ledger_name FROM oe_accounts WHERE id IN ($1, $2)",
      [dr_account_id, cr_account_id],
    );
    const drName = ledgers.rows.find((l) => l.id == dr_account_id)?.ledger_name;
    const crName = ledgers.rows.find((l) => l.id == cr_account_id)?.ledger_name;

    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'VOUCHER_ENTRY', $2)",
      [
        req.user.username,
        JSON.stringify({
          type: voucher_type,
          amount: amount,
          dr_account: drName,
          cr_account: crName,
          date: voucher_date,
        }),
      ],
    );

    res.json({
      success: true,
      message: "Voucher saved successfully!",
      voucher: newVoucher.rows[0],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get All Vouchers (Daybook / Voucher Log)
router.get("/vouchers", verifyToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    let query = `
      SELECT 
        v.id, v.voucher_date, v.voucher_type, v.amount, v.narration, v.created_by,
        dr.ledger_name AS dr_account_name,
        cr.ledger_name AS cr_account_name
      FROM oe_vouchers v
      LEFT JOIN oe_accounts dr ON v.dr_account_id = dr.id
      LEFT JOIN oe_accounts cr ON v.cr_account_id = cr.id
    `;

    let params = [];
    if (fromDate && toDate) {
      query += ` WHERE v.voucher_date >= $1 AND v.voucher_date <= $2 `;
      params.push(fromDate, toDate);
    }

    query += ` ORDER BY v.voucher_date DESC, v.id DESC`;

    const result = await pool.query(query, params);
    res.json({ success: true, vouchers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// ✏️ EDIT & DELETE VOUCHERS (WITH AUDIT TRAIL)
// ==========================================

// Edit/Update Voucher
router.put("/vouchers/edit/:id", verifyToken, async (req, res) => {
  try {
    const voucherId = req.params.id;
    const {
      voucher_date,
      voucher_type,
      dr_account_id,
      cr_account_id,
      amount,
      narration,
    } = req.body;

    // 1. പഴയ ഡാറ്റ എടുക്കുക (For Audit Log)
    const oldDataRes = await pool.query(
      "SELECT * FROM oe_vouchers WHERE id = $1",
      [voucherId],
    );
    if (oldDataRes.rows.length === 0)
      return res.json({ success: false, message: "Voucher not found." });
    const oldData = oldDataRes.rows[0];

    // 2. പുതിയ ഡാറ്റ അപ്ഡേറ്റ് ചെയ്യുക
    const updatedVoucher = await pool.query(
      `UPDATE oe_vouchers 
       SET voucher_date = $1, voucher_type = $2, dr_account_id = $3, cr_account_id = $4, amount = $5, narration = $6 
       WHERE id = $7 RETURNING *`,
      [
        voucher_date,
        voucher_type,
        dr_account_id,
        cr_account_id,
        amount,
        narration,
        voucherId,
      ],
    );

    // 3. Audit Log-ൽ മാറ്റങ്ങൾ കൃത്യമായി സേവ് ചെയ്യുക
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'UPDATE_VOUCHER', $2)",
      [
        req.user.username,
        JSON.stringify({
          voucher_id: voucherId,
          old_amount: oldData.amount,
          new_amount: amount,
          old_narration: oldData.narration,
          new_narration: narration,
          status: "Voucher Modified",
        }),
      ],
    );

    res.json({ success: true, message: "Voucher updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Voucher
router.delete("/vouchers/delete/:id", verifyToken, async (req, res) => {
  try {
    const voucherId = req.params.id;

    // 1. ഡിലീറ്റ് ചെയ്യുന്നതിന് മുൻപ് പഴയ ഡാറ്റ എടുക്കുക
    const oldDataRes = await pool.query(
      "SELECT * FROM oe_vouchers WHERE id = $1",
      [voucherId],
    );
    if (oldDataRes.rows.length === 0)
      return res.json({ success: false, message: "Voucher not found." });
    const oldData = oldDataRes.rows[0];

    // 2. വൗച്ചർ ഡിലീറ്റ് ചെയ്യുക
    await pool.query("DELETE FROM oe_vouchers WHERE id = $1", [voucherId]);

    // 3. Audit Log-ൽ ഡിലീറ്റ് ചെയ്ത വിവരം സേവ് ചെയ്യുക
    await pool.query(
      "INSERT INTO oe_audit_log (username, action, details) VALUES ($1, 'DELETE_VOUCHER', $2)",
      [
        req.user.username,
        JSON.stringify({
          voucher_id: voucherId,
          deleted_amount: oldData.amount,
          deleted_date: oldData.voucher_date,
          narration: oldData.narration,
          warning: "Voucher Permanently Deleted",
        }),
      ],
    );

    res.json({ success: true, message: "Voucher deleted and logged!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 📈 FINANCIAL REPORTS API (TB, P&L, BS, LEDGER)
// ==========================================

// 1. Trial Balance & Profit/Loss Base Data
router.get('/reports/financials', verifyToken, async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        
        // Advanced SQL to calculate Net Balances for all active ledgers
        const query = `
            WITH LedgerTotals AS (
                SELECT 
                    a.id, a.ledger_name, a.main_group, a.sub_group,
                    COALESCE(SUM(CASE WHEN v.dr_account_id = a.id THEN v.amount ELSE 0 END), 0) AS total_dr,
                    COALESCE(SUM(CASE WHEN v.cr_account_id = a.id THEN v.amount ELSE 0 END), 0) AS total_cr
                FROM oe_accounts a
                LEFT JOIN oe_vouchers v ON (a.id = v.dr_account_id OR a.id = v.cr_account_id) 
                     AND v.voucher_date >= $1 AND v.voucher_date <= $2
                GROUP BY a.id, a.ledger_name, a.main_group, a.sub_group
            )
            SELECT *, 
                CASE WHEN total_dr > total_cr THEN total_dr - total_cr ELSE 0 END as net_dr,
                CASE WHEN total_cr > total_dr THEN total_cr - total_dr ELSE 0 END as net_cr
            FROM LedgerTotals
            WHERE total_dr > 0 OR total_cr > 0
            ORDER BY main_group, ledger_name;
        `;
        
        const result = await pool.query(query, [fromDate, toDate]);
        const ledgers = result.rows;

        // --- Core Accounting Logic ---
        let totalSales = 0, totalExpenses = 0;
        let totalAssets = 0, totalLiabilities = 0;

        ledgers.forEach(l => {
            // P&L Logic
            if (l.main_group === 'Revenue') totalSales += parseFloat(l.net_cr) - parseFloat(l.net_dr);
            if (l.main_group === 'Expenses') totalExpenses += parseFloat(l.net_dr) - parseFloat(l.net_cr);
            
            // Balance Sheet Logic
            if (l.main_group === 'Assets') totalAssets += parseFloat(l.net_dr) - parseFloat(l.net_cr);
            if (l.main_group === 'Liabilities' || l.main_group === 'Equity') {
                totalLiabilities += parseFloat(l.net_cr) - parseFloat(l.net_dr);
            }
        });

        const netProfit = totalSales - totalExpenses;

        res.json({ 
            success: true, 
            trial_balance: ledgers,
            profit_loss: { revenue: totalSales, expenses: totalExpenses, net_profit: netProfit },
            balance_sheet: { assets: totalAssets, liabilities: totalLiabilities, net_profit: netProfit }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. Individual Ledger Statement (Account Book)
router.get('/reports/ledger-statement/:id', verifyToken, async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const accountId = req.params.id;

        const query = `
            SELECT 
                v.voucher_date, v.voucher_type, v.narration,
                CASE WHEN v.dr_account_id = $1 THEN v.amount ELSE 0 END AS debit,
                CASE WHEN v.cr_account_id = $1 THEN v.amount ELSE 0 END AS credit
            FROM oe_vouchers v
            WHERE (v.dr_account_id = $1 OR v.cr_account_id = $1)
              AND v.voucher_date >= $2 AND v.voucher_date <= $3
            ORDER BY v.voucher_date ASC, v.id ASC
        `;
        
        const result = await pool.query(query, [accountId, fromDate, toDate]);
        res.json({ success: true, statement: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
