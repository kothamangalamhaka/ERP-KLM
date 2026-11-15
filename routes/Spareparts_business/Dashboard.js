const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware: Verify Spare Parts Active User
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

// Get Dashboard Ledger Matrix (Columns + Rows + Totals)
router.get("/summary", verifySpUser, async (req, res) => {
  try {
    const headsRes = await pool.query(
      `SELECT id, head_name, sort_order
       FROM spare_parts_cost_heads
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, id ASC`,
    );

    const vehiclesRes = await pool.query(
      `SELECT id, in_no, chassis_no, purchase_date, vehicle_type, sales_revenue, created_at
       FROM spare_parts_vehicles
       ORDER BY purchase_date ASC NULLS LAST, id ASC
       LIMIT 500`,
    );

    const vehicleIds = vehiclesRes.rows.map((v) => v.id);
    let costMap = {};

    if (vehicleIds.length > 0) {
      const costsRes = await pool.query(
        `SELECT vehicle_id, cost_head_id, amount
         FROM spare_parts_costs
         WHERE vehicle_id = ANY($1::int[])`,
        [vehicleIds],
      );
      costsRes.rows.forEach((c) => {
        if (!costMap[c.vehicle_id]) costMap[c.vehicle_id] = {};
        costMap[c.vehicle_id][c.cost_head_id] = Number(c.amount || 0);
      });
    }

    const rows = vehiclesRes.rows.map((v) => {
      const vCosts = costMap[v.id] || {};
      let totalCost = 0;
      headsRes.rows.forEach((h) => {
        totalCost += Number(vCosts[h.id] || 0);
      });
      const revenue = Number(v.sales_revenue || 0);
      const netCf = revenue - totalCost;

      return {
        id: v.id,
        in_no: v.in_no,
        chassis_no: v.chassis_no,
        purchase_date: v.purchase_date
          ? v.purchase_date.toISOString().split("T")[0]
          : "",
        vehicle_type: v.vehicle_type || "",
        costs: vCosts,
        total_cost: totalCost,
        sales_revenue: revenue,
        net_cf: netCf,
      };
    });

    res.json({
      success: true,
      costHeads: headsRes.rows,
      rows,
    });
  } catch (err) {
    console.error("SpareParts Dashboard Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load dashboard data." });
  }
});

// Add New Cost Ledger Column
router.post("/cost-head", verifySpUser, async (req, res) => {
  try {
    const cleanName = String(req.body.headName || "").trim();
    if (!cleanName || cleanName.length > 80) {
      return res
        .status(400)
        .json({ success: false, message: "Valid ledger name required." });
    }

    const orderRes = await pool.query(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM spare_parts_cost_heads",
    );
    const nextOrder = orderRes.rows[0].next_order;

    const insertRes = await pool.query(
      `INSERT INTO spare_parts_cost_heads (head_name, sort_order)
       VALUES ($1, $2)
       ON CONFLICT (head_name) DO UPDATE SET is_active = TRUE
       RETURNING id, head_name, sort_order`,
      [cleanName, nextOrder],
    );

    res.json({
      success: true,
      costHead: insertRes.rows[0],
      message: "Cost ledger added.",
    });
  } catch (err) {
    console.error("Add Cost Head Error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Could not add cost column." });
  }
});

// Add / Update Vehicle Row (New EQ & Edit)
router.post("/vehicle", verifySpUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const { inNo, chassisNo, purchaseDate, vehicleType, salesRevenue, costs } =
      req.body;
    const cleanIn = String(inNo || "")
      .trim()
      .toUpperCase();
    const cleanChassis = String(chassisNo || "")
      .trim()
      .toUpperCase();
    const cleanDate = purchaseDate ? String(purchaseDate).trim() : null;
    const cleanType = vehicleType ? String(vehicleType).trim() : null;
    const rev = Number(salesRevenue || 0);

    if (!cleanIn || !cleanChassis) {
      return res.status(400).json({
        success: false,
        message: "IN No and Chassis No are required.",
      });
    }

    await client.query("BEGIN");

    const vRes = await client.query(
      `INSERT INTO spare_parts_vehicles (in_no, chassis_no, purchase_date, vehicle_type, sales_revenue, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (in_no) DO UPDATE
         SET chassis_no = EXCLUDED.chassis_no,
             purchase_date = COALESCE(EXCLUDED.purchase_date, spare_parts_vehicles.purchase_date),
             vehicle_type = COALESCE(EXCLUDED.vehicle_type, spare_parts_vehicles.vehicle_type),
             sales_revenue = EXCLUDED.sales_revenue,
             updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [cleanIn, cleanChassis, cleanDate, cleanType, rev, req.spUser.username],
    );

    const vehicleId = vRes.rows[0].id;

    if (costs && typeof costs === "object") {
      for (const [headIdStr, val] of Object.entries(costs)) {
        const headId = Number(headIdStr);
        const amt = Number(val || 0);
        if (headId > 0) {
          await client.query(
            `INSERT INTO spare_parts_costs (vehicle_id, cost_head_id, amount)
             VALUES ($1, $2, $3)
             ON CONFLICT (vehicle_id, cost_head_id) DO UPDATE
               SET amount = EXCLUDED.amount,
                   updated_at = CURRENT_TIMESTAMP`,
            [vehicleId, headId, amt],
          );
        }
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Record saved successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Save Vehicle Error:", err.message);
    res.status(500).json({ success: false, message: "Failed to save record." });
  } finally {
    client.release();
  }
});

// Get All Master Items (Code + Name)
router.get("/items", verifySpUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, item_code, item_name
       FROM spare_parts_items
       ORDER BY item_code ASC, item_name ASC`,
    );
    res.json({ success: true, items: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load items." });
  }
});

// Create New Master Item (Code + Name)
router.post("/items", verifySpUser, async (req, res) => {
  try {
    const cleanCode = String(req.body.itemCode || "")
      .trim()
      .toUpperCase();
    const cleanName = String(req.body.itemName || "")
      .trim()
      .toUpperCase();

    if (!cleanCode || !cleanName) {
      return res.status(400).json({
        success: false,
        message: "Item Code and Item Name are required.",
      });
    }

    const insertRes = await pool.query(
      `INSERT INTO spare_parts_items (item_code, item_name, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (item_code, item_name) DO UPDATE SET item_name = EXCLUDED.item_name
       RETURNING id, item_code, item_name`,
      [cleanCode, cleanName, req.spUser.username],
    );

    res.json({
      success: true,
      item: insertRes.rows[0],
      message: `${cleanCode} - ${cleanName} saved!`,
    });
  } catch (err) {
    console.error("Create Item Error:", err.message);
    res.status(500).json({ success: false, message: "Failed to save item." });
  }
});

// Get Stocks for a Vehicle (IN No)
router.get("/stocks/:vehicleId", verifySpUser, async (req, res) => {
  try {
    const vehicleId = Number(req.params.vehicleId);
    const result = await pool.query(
      `SELECT id, item_code, item_name, available_qty
       FROM spare_parts_stocks
       WHERE vehicle_id = $1
       ORDER BY item_code ASC, item_name ASC`,
      [vehicleId],
    );
    res.json({ success: true, stocks: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load stocks." });
  }
});

// Add Stock (Cumulative on Current Date)
router.post("/stocks/add", verifySpUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const vehicleId = Number(req.body.vehicleId);
    const cleanCode = String(req.body.itemCode || "")
      .trim()
      .toUpperCase();
    const cleanItem = String(req.body.itemName || "")
      .trim()
      .toUpperCase();
    const addQty = Number(req.body.qty || 0);

    if (!vehicleId || !cleanItem || addQty <= 0) {
      return res.status(400).json({
        success: false,
        message: "Select IN No, item and valid quantity (> 0).",
      });
    }

    await client.query("BEGIN");

    await client.query(
      `INSERT INTO spare_parts_stocks (vehicle_id, item_code, item_name, available_qty, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (vehicle_id, item_name) DO UPDATE
         SET item_code = COALESCE(NULLIF(EXCLUDED.item_code, ''), spare_parts_stocks.item_code),
             available_qty = spare_parts_stocks.available_qty + EXCLUDED.available_qty,
             updated_at = CURRENT_TIMESTAMP`,
      [vehicleId, cleanCode, cleanItem, addQty],
    );

    await client.query(
      `INSERT INTO spare_parts_stock_logs (vehicle_id, item_name, added_qty, added_date, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
      [
        vehicleId,
        cleanCode ? `${cleanCode} - ${cleanItem}` : cleanItem,
        addQty,
        req.spUser.username,
      ],
    );

    await client.query("COMMIT");
    res.json({
      success: true,
      message: `${cleanCode ? cleanCode + " - " : ""}${cleanItem} (+${addQty}) added to stock.`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Add Stock Error:", err.message);
    res.status(500).json({ success: false, message: "Failed to add stock." });
  } finally {
    client.release();
  }
});

// Post Journal Voucher (JV) - Sales or Cost Ledger (Cumulative Addition + Stock Check)
router.post("/jv", verifySpUser, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      voucherDate,
      effectiveDate,
      voucherType,
      costHeadId,
      vehicleId,
      itemName,
      qty,
      rate,
      vatPercent,
      amount,
      narration,
    } = req.body;

    const vId = Number(vehicleId);
    if (
      !voucherDate ||
      !effectiveDate ||
      !vId ||
      !["SALES", "COST"].includes(voucherType)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required JV fields." });
    }

    await client.query("BEGIN");

    if (voucherType === "SALES") {
      const cleanItem = String(itemName || "")
        .trim()
        .toUpperCase();
      const saleQty = Number(qty || 0);
      const saleRate = Number(rate || 0);
      const vatPct = Number(vatPercent || 0);

      if (!cleanItem || saleQty <= 0 || saleRate < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Select item, valid quantity (> 0) and rate.",
        });
      }

      // Lock stock row and check available quantity
      const stockRes = await client.query(
        `SELECT id, available_qty FROM spare_parts_stocks
         WHERE vehicle_id = $1 AND item_name = $2
         FOR UPDATE`,
        [vId, cleanItem],
      );

      const avail =
        stockRes.rows.length > 0 ? Number(stockRes.rows[0].available_qty) : 0;
      if (avail <= 0 || saleQty > avail) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${cleanItem}. Available: ${avail}`,
        });
      }

      const subTotal = Number((saleQty * saleRate).toFixed(2));
      const vatAmt = Number(((subTotal * vatPct) / 100).toFixed(2));
      const totalAmt = Number((subTotal + vatAmt).toFixed(2));

      // Deduct stock
      await client.query(
        `UPDATE spare_parts_stocks
         SET available_qty = available_qty - $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [saleQty, stockRes.rows[0].id],
      );

      // Cumulative add to Sales Revenue
      await client.query(
        `UPDATE spare_parts_vehicles
         SET sales_revenue = COALESCE(sales_revenue, 0) + $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [totalAmt, vId],
      );

      const cleanCode = String(req.body.itemCode || "")
        .trim()
        .toUpperCase();
      await client.query(
        `INSERT INTO spare_parts_jv
         (voucher_date, effective_date, voucher_type, vehicle_id, item_code, item_name, qty, rate, sub_total, vat_percent, vat_amount, total_amount, narration, created_by)
         VALUES ($1, $2, 'SALES', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          voucherDate,
          effectiveDate,
          vId,
          cleanCode,
          cleanItem,
          saleQty,
          saleRate,
          subTotal,
          vatPct,
          vatAmt,
          totalAmt,
          narration || null,
          req.spUser.username,
        ],
      );
    } else {
      // COST LEDGER JV
      const headId = Number(costHeadId);
      const costAmt = Number(amount || 0);
      if (!headId || costAmt <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Select cost ledger and enter amount (> 0).",
        });
      }

      // Cumulative add to Cost Ledger cell
      await client.query(
        `INSERT INTO spare_parts_costs (vehicle_id, cost_head_id, amount, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (vehicle_id, cost_head_id) DO UPDATE
           SET amount = spare_parts_costs.amount + EXCLUDED.amount,
               updated_at = CURRENT_TIMESTAMP`,
        [vId, headId, costAmt],
      );

      await client.query(
        `INSERT INTO spare_parts_jv
         (voucher_date, effective_date, voucher_type, cost_head_id, vehicle_id, total_amount, narration, created_by)
         VALUES ($1, $2, 'COST', $3, $4, $5, $6, $7)`,
        [
          voucherDate,
          effectiveDate,
          headId,
          vId,
          costAmt,
          narration || null,
          req.spUser.username,
        ],
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "JV posted & ledger updated!" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Post JV Error:", err.message);
    res.status(500).json({ success: false, message: "Failed to post JV." });
  } finally {
    client.release();
  }
});

module.exports = router;
