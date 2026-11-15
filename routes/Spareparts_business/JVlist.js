const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET;

function verifySpUser(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "Login required." });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || decoded.module !== "spare_parts") {
      return res
        .status(403)
        .json({ success: false, message: "Invalid session." });
    }
    req.spUser = decoded;
    next();
  });
}

// Unified Ledger & Stock Transactions List
router.get("/transactions", verifySpUser, async (req, res) => {
  try {
    // 1. Journal Vouchers (Sales Revenue & Cost Ledgers)
    const jvRes = await pool.query(`
      SELECT
        j.id,
        TO_CHAR(j.voucher_date, 'YYYY-MM-DD') AS voucher_date,
        TO_CHAR(j.effective_date, 'YYYY-MM-DD') AS effective_date,
        j.voucher_type,
        v.in_no,
        v.chassis_no,
        CASE
          WHEN j.voucher_type = 'SALES' THEN 'Customer / Cash (Dr)'
          ELSE COALESCE(h.head_name, 'Cost Expense') || ' (Dr)'
        END AS debit_account,
        CASE
          WHEN j.voucher_type = 'SALES' THEN 'Sales Revenue (Cr)'
          ELSE 'Cash / Payable (Cr)'
        END AS credit_account,
        CASE
          WHEN j.voucher_type = 'SALES' THEN TRIM(BOTH ' - ' FROM CONCAT(j.item_code, ' - ', j.item_name))
          ELSE COALESCE(h.head_name, '-')
        END AS item_desc,
        COALESCE(j.qty, 0) AS qty,
        COALESCE(j.total_amount, 0) AS amount,
        COALESCE(j.narration, '') AS narration,
        COALESCE(NULLIF(TRIM(u.display_name), ''), j.created_by, '-') AS recorded_by,
        j.created_at
      FROM spare_parts_jv j
      JOIN spare_parts_vehicles v ON v.id = j.vehicle_id
      LEFT JOIN spare_parts_cost_heads h ON h.id = j.cost_head_id
      LEFT JOIN spare_parts_users u ON u.username = j.created_by
    `);

    // 2. New EQ Registrations (Initial Purchase Cost)
    const eqRes = await pool.query(`
      SELECT
        v.id,
        TO_CHAR(v.created_at, 'YYYY-MM-DD') AS voucher_date,
        COALESCE(TO_CHAR(v.purchase_date, 'YYYY-MM-DD'), TO_CHAR(v.created_at, 'YYYY-MM-DD')) AS effective_date,
        'NEW EQ' AS voucher_type,
        v.in_no,
        v.chassis_no,
        'Purchase Cost (Dr)' AS debit_account,
        'Cash / Supplier (Cr)' AS credit_account,
        COALESCE(NULLIF(TRIM(v.vehicle_type), ''), 'Vehicle Purchase') AS item_desc,
        1 AS qty,
        COALESCE(c.amount, 0) AS amount,
        'Initial EQ Registration' AS narration,
        COALESCE(NULLIF(TRIM(u.display_name), ''), v.created_by, '-') AS recorded_by,
        v.created_at
      FROM spare_parts_vehicles v
      LEFT JOIN spare_parts_cost_heads h ON LOWER(TRIM(h.head_name)) = 'purchase cost'
      LEFT JOIN spare_parts_costs c ON c.vehicle_id = v.id AND c.cost_head_id = h.id
      LEFT JOIN spare_parts_users u ON u.username = v.created_by
    `);

    // 3. Stock Additions
    const stockRes = await pool.query(`
      SELECT
        l.id,
        TO_CHAR(l.added_date, 'YYYY-MM-DD') AS voucher_date,
        '-' AS effective_date,
        'ADD STOCK' AS voucher_type,
        v.in_no,
        v.chassis_no,
        'Stock Inventory (Dr)' AS debit_account,
        'Dismantled Parts (Cr)' AS credit_account,
        l.item_name AS item_desc,
        COALESCE(l.added_qty, 0) AS qty,
        0 AS amount,
        'Stock Quantity Added' AS narration,
        COALESCE(NULLIF(TRIM(u.display_name), ''), l.created_by, '-') AS recorded_by,
        l.created_at
      FROM spare_parts_stock_logs l
      JOIN spare_parts_vehicles v ON v.id = l.vehicle_id
      LEFT JOIN spare_parts_users u ON u.username = l.created_by
    `);

    const allTx = [...jvRes.rows, ...eqRes.rows, ...stockRes.rows].sort(
      (a, b) =>
        b.voucher_date.localeCompare(a.voucher_date) ||
        new Date(b.created_at) - new Date(a.created_at),
    );

    res.json({ success: true, transactions: allTx });
  } catch (err) {
    console.error("SpareParts JVList Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load transactions." });
  }
});

module.exports = router;
