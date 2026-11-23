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

// Get Stock Summary Ordered by Item Code + IN-wise Breakdown
router.get("/summary", verifySpUser, async (req, res) => {
  try {
    // 1. Current Available Stock per Vehicle & Item
    const stocksRes = await pool.query(`
      SELECT 
        s.vehicle_id,
        v.in_no,
        v.chassis_no,
        COALESCE(NULLIF(TRIM(s.item_code), ''), m.item_code, '-') AS item_code,
        s.item_name,
        COALESCE(s.available_qty, 0) AS available_qty
      FROM spare_parts_stocks s
      JOIN spare_parts_vehicles v ON v.id = s.vehicle_id
      LEFT JOIN spare_parts_items m ON m.item_name = s.item_name
      ORDER BY item_code ASC, s.item_name ASC, v.id ASC
    `);

    // 2. Sold Quantity per Vehicle & Item from Sales JV
    const soldRes = await pool.query(`
      SELECT 
        vehicle_id,
        item_name,
        COALESCE(SUM(qty), 0) AS sold_qty
      FROM spare_parts_jv
      WHERE voucher_type = 'SALES'
      GROUP BY vehicle_id, item_name
    `);

    const soldMap = {};
    soldRes.rows.forEach((r) => {
      soldMap[`${r.vehicle_id}|${r.item_name}`] = Number(r.sold_qty || 0);
    });

    // 3. Group by Item Code + Item Name
    const grouped = {};
    stocksRes.rows.forEach((row) => {
      const code = row.item_code;
      const name = row.item_name;
      const key = `${code}|${name}`;
      const avail = Number(row.available_qty || 0);
      const sold = soldMap[`${row.vehicle_id}|${name}`] || 0;
      const total = avail + sold;

      if (!grouped[key]) {
        grouped[key] = {
          item_code: code,
          item_name: name,
          total_qty: 0,
          sold_qty: 0,
          available_qty: 0,
          available_ins: [],
          breakdown: [],
        };
      }

      grouped[key].total_qty += total;
      grouped[key].sold_qty += sold;
      grouped[key].available_qty += avail;

      if (avail > 0) {
        grouped[key].available_ins.push(`${row.in_no} (${avail})`);
      }

      grouped[key].breakdown.push({
        in_no: row.in_no,
        chassis_no: row.chassis_no,
        total_qty: total,
        sold_qty: sold,
        available_qty: avail,
      });
    });

    const items = Object.values(grouped).sort(
      (a, b) =>
        a.item_code.localeCompare(b.item_code, undefined, { numeric: true }) ||
        a.item_name.localeCompare(b.item_name),
    );

    res.json({ success: true, items });
  } catch (err) {
    console.error("SpareParts Stock Summary Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load stock summary." });
  }
});

// Get Date-wise Add & Sold History for Specific IN No & Item
router.get("/history", verifySpUser, async (req, res) => {
  try {
    const inNo = String(req.query.inNo || "")
      .trim()
      .toUpperCase();
    const itemName = String(req.query.itemName || "")
      .trim()
      .toUpperCase();
    const itemCode = String(req.query.itemCode || "")
      .trim()
      .toUpperCase();

    if (!inNo || !itemName) {
      return res
        .status(400)
        .json({ success: false, message: "IN No and Item Name required." });
    }

    const vRes = await pool.query(
      "SELECT id FROM spare_parts_vehicles WHERE in_no = $1",
      [inNo],
    );
    if (vRes.rows.length === 0) {
      return res.json({ success: true, entries: [] });
    }
    const vehicleId = vRes.rows[0].id;

    // 1. Added Stock Logs (Matches "CODE - ITEM" or "ITEM")
    const fullLabel =
      itemCode && itemCode !== "-" ? `${itemCode} - ${itemName}` : itemName;
    const addLogsRes = await pool.query(
      `SELECT 
         TO_CHAR(added_date, 'YYYY-MM-DD') AS tx_date,
         'ADDED' AS tx_type,
         added_qty AS qty,
         created_at
       FROM spare_parts_stock_logs
       WHERE vehicle_id = $1 AND (item_name = $2 OR item_name = $3)`,
      [vehicleId, itemName, fullLabel],
    );

    // 2. Sold JV Logs
    const soldLogsRes = await pool.query(
      `SELECT 
         TO_CHAR(effective_date, 'YYYY-MM-DD') AS tx_date,
         'SOLD' AS tx_type,
         qty,
         created_at
       FROM spare_parts_jv
       WHERE vehicle_id = $1 AND voucher_type = 'SALES' AND item_name = $2`,
      [vehicleId, itemName],
    );

    const entries = [...addLogsRes.rows, ...soldLogsRes.rows].sort(
      (a, b) =>
        a.tx_date.localeCompare(b.tx_date) ||
        new Date(a.created_at) - new Date(b.created_at),
    );

    res.json({ success: true, entries });
  } catch (err) {
    console.error("SpareParts Stock History Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load history." });
  }
});

module.exports = router;
