const express = require("express");
const router = express.Router();
const pool = require("../config/db");

// ================= 1. TERMS & CONDITIONS =================
router.get("/api/terms", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM po_global_terms WHERE id = 1");
    if (result.rows.length > 0) {
      res.json({ success: true, terms: result.rows[0] });
    } else {
      res.json({ success: true, terms: { terms_ar: "", terms_en: "" } });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-terms", async (req, res) => {
  try {
    const { terms_ar, terms_en } = req.body;
    await pool.query(
      `INSERT INTO po_global_terms (id, terms_ar, terms_en, updated_at)
       VALUES (1, $1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE 
       SET terms_ar = EXCLUDED.terms_ar, terms_en = EXCLUDED.terms_en, updated_at = CURRENT_TIMESTAMP`,
      [terms_ar, terms_en]
    );
    res.json({ success: true, message: "Terms updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 2. VENDORS DIRECTORY API =================
router.get("/api/vendors", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM po_vendors WHERE is_deleted = FALSE ORDER BY id DESC");
    res.json({ success: true, vendors: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-vendor", async (req, res) => {
  try {
    const { id, vendor_name_en, vendor_name_ar, nickname, cr_number, vat_number } = req.body;
    if (!vendor_name_en || !vendor_name_en.trim()) {
      return res.json({ success: false, message: "Vendor English Name required" });
    }

    if (id) {
      await pool.query(
        `UPDATE po_vendors SET vendor_name_en=$1, vendor_name_ar=$2, nickname=$3, cr_number=$4, vat_number=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6`,
        [vendor_name_en.trim(), (vendor_name_ar||"").trim(), (nickname||"").trim(), (cr_number||"").trim(), (vat_number||"").trim(), id]
      );
    } else {
      const countRes = await pool.query("SELECT COUNT(*) as total FROM po_vendors");
      const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
      const vCode = `VEN-${String(nextSeq).padStart(4, "0")}`;
      await pool.query(
        `INSERT INTO po_vendors (vendor_code, vendor_name_en, vendor_name_ar, nickname, cr_number, vat_number) VALUES ($1, $2, $3, $4, $5, $6)`,
        [vCode, vendor_name_en.trim(), (vendor_name_ar||"").trim(), (nickname||"").trim(), (cr_number||"").trim(), (vat_number||"").trim()]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/delete-vendor", async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("UPDATE po_vendors SET is_deleted=TRUE WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 3. EQUIPMENTS DIRECTORY API =================
router.get("/api/equipments", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM po_equipments WHERE is_deleted = FALSE ORDER BY id DESC");
    res.json({ success: true, equipments: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-equipment", async (req, res) => {
  try {
    const { id, equipment_name_en, equipment_name_ar, default_rent } = req.body;
    if (!equipment_name_en || !equipment_name_en.trim()) {
      return res.json({ success: false, message: "Equipment English Name required" });
    }

    if (id) {
      await pool.query(
        `UPDATE po_equipments SET equipment_name_en=$1, equipment_name_ar=$2, default_rent=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [equipment_name_en.trim(), (equipment_name_ar||"").trim(), parseFloat(default_rent)||0, id]
      );
    } else {
      const countRes = await pool.query("SELECT COUNT(*) as total FROM po_equipments");
      const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
      const eqCode = `EQP-${String(nextSeq).padStart(4, "0")}`;
      await pool.query(
        `INSERT INTO po_equipments (equipment_code, equipment_name_en, equipment_name_ar, default_rent) VALUES ($1, $2, $3, $4)`,
        [eqCode, equipment_name_en.trim(), (equipment_name_ar||"").trim(), parseFloat(default_rent)||0]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/delete-equipment", async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("UPDATE po_equipments SET is_deleted=TRUE WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 4. PURCHASE ORDER CORE =================
router.get("/api/next-po-no", async (req, res) => {
  try {
    const { company_id } = req.query;
    let shortCode = "PO";
    if (company_id) {
      const compRes = await pool.query("SELECT short_code FROM e_invoice_companies WHERE id = $1", [company_id]);
      if (compRes.rows.length > 0 && compRes.rows[0].short_code) {
        shortCode = compRes.rows[0].short_code;
      }
    }
    const currentYear = new Date().getFullYear().toString().slice(-2);
    const prefix = `${shortCode}-PO-${currentYear}`;

    // 🟢 Ee company-kk ee prefix-ilulla ettavum valiya PO number check cheyyunnu
    const maxRes = await pool.query(
      `SELECT po_no FROM generated_purchase_orders 
       WHERE po_no LIKE $1 
       ORDER BY id DESC LIMIT 1`,
      [`${prefix}-%`]
    );

    let nextSeq;
    if (maxRes.rows.length > 0) {
      // Nilavil PO undengil athinte avasanathe number eduthu 1 kootunnu
      const lastPoNo = maxRes.rows[0].po_no;
      const parts = lastPoNo.split("-");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      nextSeq = !isNaN(lastNum) ? lastNum + 1 : 1001;
    } else {
      // 🟢 Puthya company-k 1000-nu mukalilulla random 4-digit number nalkunnu (e.g. 1100 to 2900)
      const randomBase = Math.floor(Math.random() * (2500 - 1100 + 1)) + 1100;
      nextSeq = randomBase;
    }

    const poNo = `${prefix}-${String(nextSeq).padStart(4, "0")}`;

    res.json({ success: true, po_no: poNo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-po-record", async (req, res) => {
  try {
    const {
      po_no, company_id, company_name, vendor_name, vendor_details, po_date,
      plate_no, payment_terms, location, subtotal, vat_amount, grand_total,
      has_seal, line_items, terms_ar, terms_en, raw_payload,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO generated_purchase_orders (
         po_no, company_id, company_name, vendor_name, vendor_details, po_date,
         plate_no, payment_terms, location, subtotal, vat_amount, grand_total,
         has_seal, line_items, terms_ar, terms_en, raw_payload, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
       ON CONFLICT (po_no) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         company_name = EXCLUDED.company_name,
         vendor_name = EXCLUDED.vendor_name,
         vendor_details = EXCLUDED.vendor_details,
         po_date = EXCLUDED.po_date,
         plate_no = EXCLUDED.plate_no,
         payment_terms = EXCLUDED.payment_terms,
         location = EXCLUDED.location,
         subtotal = EXCLUDED.subtotal,
         vat_amount = EXCLUDED.vat_amount,
         grand_total = EXCLUDED.grand_total,
         has_seal = EXCLUDED.has_seal,
         line_items = EXCLUDED.line_items,
         terms_ar = EXCLUDED.terms_ar,
         terms_en = EXCLUDED.terms_en,
         raw_payload = EXCLUDED.raw_payload,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        po_no, company_id || null, company_name, vendor_name, JSON.stringify(vendor_details || {}),
        po_date || new Date(), plate_no, payment_terms, location, subtotal || 0, vat_amount || 0,
        grand_total || 0, !!has_seal, JSON.stringify(line_items || []), terms_ar, terms_en, JSON.stringify(raw_payload || {}),
      ]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/dashboard-pos", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, po_no, company_name, vendor_name, TO_CHAR(po_date, 'YYYY-MM-DD') as po_date,
              plate_no, location, grand_total, created_at
       FROM generated_purchase_orders
       ORDER BY id DESC`
    );
    res.json({ success: true, orders: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/po/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM generated_purchase_orders WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "PO not found" });
    res.json({ success: true, po: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;