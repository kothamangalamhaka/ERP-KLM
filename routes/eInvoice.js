const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const uploadDir = path.join(__dirname, "../public/uploads/einvoice");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `${file.fieldname}_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage: storage });

// ZATCA Phase 1 TLV Base64 Encoder Function
function getZatcaTLV(tag, value) {
  const str = String(value || "");
  const valBuf = Buffer.from(str, "utf8");
  const tagBuf = Buffer.from([tag]);
  const lenBuf = Buffer.from([valBuf.length]);
  return Buffer.concat([tagBuf, lenBuf, valBuf]);
}

function generateZatcaQrBase64(sellerName, vatNumber, invoiceTimestamp, invoiceTotal, vatTotal) {
  const tlv1 = getZatcaTLV(1, sellerName);
  const tlv2 = getZatcaTLV(2, vatNumber);
  const tlv3 = getZatcaTLV(3, invoiceTimestamp);
  const tlv4 = getZatcaTLV(4, invoiceTotal);
  const tlv5 = getZatcaTLV(5, vatTotal);

  const qrBuffer = Buffer.concat([tlv1, tlv2, tlv3, tlv4, tlv5]);
  return qrBuffer.toString("base64");
}

// 1. Fetch all companies for dropdown
router.get("/api/companies", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM e_invoice_companies ORDER BY id ASC");
    res.json({ success: true, companies: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 2. Add or Update company
router.post(
  "/api/save-company",
  upload.fields([{ name: "logo_file", maxCount: 1 }, { name: "seal_file", maxCount: 1 }, { name: "sign_file", maxCount: 1 }]),
  async (req, res) => {
    try {
      const {
        id, company_name_en, company_name_ar, short_code, cr_number, vat_number,
        address_line_en, address_line_ar, phone, email, existing_logo, existing_seal, existing_sign,
      } = req.body;

      const cleanCode = (short_code || "").trim().toUpperCase();
      let logo_url = existing_logo || null;
      let seal_url = existing_seal || null;
      let signature_url = existing_sign || null;

      if (req.files && req.files["logo_file"] && req.files["logo_file"][0]) logo_url = `/uploads/einvoice/${req.files["logo_file"][0].filename}`;
      if (req.files && req.files["seal_file"] && req.files["seal_file"][0]) seal_url = `/uploads/einvoice/${req.files["seal_file"][0].filename}`;
      if (req.files && req.files["sign_file"] && req.files["sign_file"][0]) signature_url = `/uploads/einvoice/${req.files["sign_file"][0].filename}`;

      if (id) {
        await pool.query(
          `UPDATE e_invoice_companies SET 
            company_name_en = $1, company_name_ar = $2, short_code = $3, cr_number = $4, vat_number = $5,
            address_line_en = $6, address_line_ar = $7, phone = $8, email = $9,
            logo_url = $10, seal_url = $11, signature_url = $12, updated_at = CURRENT_TIMESTAMP
           WHERE id = $13`,
          [company_name_en, company_name_ar, cleanCode, cr_number, vat_number, address_line_en, address_line_ar, phone, email, logo_url, seal_url, signature_url, id]
        );
      } else {
        await pool.query(
          `INSERT INTO e_invoice_companies 
            (company_name_en, company_name_ar, short_code, cr_number, vat_number, address_line_en, address_line_ar, phone, email, logo_url, seal_url, signature_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [company_name_en, company_name_ar, cleanCode, cr_number, vat_number, address_line_en, address_line_ar, phone, email, logo_url, seal_url, signature_url]
        );
      }
      res.json({ success: true });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  }
);

// 3. Delete company
router.post("/api/delete-company", async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("DELETE FROM e_invoice_companies WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 4. Generate ZATCA Base64
router.post("/api/generate-zatca-qr", (req, res) => {
  try {
    const { seller_name, vat_number, timestamp, total_with_vat, vat_total } = req.body;
    const base64Str = generateZatcaQrBase64(seller_name, vat_number, timestamp, total_with_vat, vat_total);
    res.json({ success: true, base64: base64Str });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 5. Unique Auto-Increment Invoice Number Generator
router.get("/api/next-invoice-no", async (req, res) => {
  try {
    const { company_id } = req.query;
    let shortCode = "NV";

    if (company_id) {
      const compRes = await pool.query("SELECT short_code, company_name_en FROM e_invoice_companies WHERE id = $1", [company_id]);
      if (compRes.rows.length > 0) {
        shortCode = compRes.rows[0].short_code || compRes.rows[0].company_name_en.substring(0, 3).toUpperCase();
      }
    }
    const now = new Date();
    const yStr = now.getFullYear();
    const mStr = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `${shortCode}-${yStr}-${mStr}`;

    const countRes = await pool.query(
      "SELECT COUNT(*) as total FROM generated_e_invoices WHERE invoice_no LIKE $1",
      [`${prefix}-%`]
    );
    const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
    const invNo = `${prefix}-${String(nextSeq).padStart(5, "0")}`;

    res.json({ success: true, invoice_no: invNo });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 6. Save Final E-Invoice Record to DB
router.post("/api/save-invoice-record", async (req, res) => {
  try {
    const {
      invoice_no, company_id, company_name, vendor_name, billing_month, invoice_date,
      invoice_time, subtotal, vat_amount, grand_total, has_seal, raw_payload,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO generated_e_invoices 
        (invoice_no, company_id, company_name, vendor_name, billing_month, invoice_date, invoice_time, subtotal, vat_amount, grand_total, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (invoice_no) DO UPDATE SET
        vendor_name = EXCLUDED.vendor_name, subtotal = EXCLUDED.subtotal, vat_amount = EXCLUDED.vat_amount, grand_total = EXCLUDED.grand_total, raw_payload = EXCLUDED.raw_payload
       RETURNING id`,
      [
        invoice_no, company_id || null, company_name, vendor_name, billing_month, invoice_date || new Date(),
        invoice_time, subtotal || 0, vat_amount || 0, grand_total || 0, { ...(raw_payload || {}), has_seal: !!has_seal },
      ]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 7. Customers / Suppliers Management Endpoints
router.get("/api/suppliers", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS e_invoice_suppliers (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        vat_number VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await pool.query("SELECT * FROM e_invoice_suppliers ORDER BY customer_name ASC");
    res.json({ success: true, suppliers: result.rows });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post("/api/save-supplier", async (req, res) => {
  try {
    const { customer_name, vat_number } = req.body;
    if (!customer_name) return res.json({ success: false, message: "Customer name required" });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS e_invoice_suppliers (
        id SERIAL PRIMARY KEY, customer_name VARCHAR(255) NOT NULL, vat_number VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query("INSERT INTO e_invoice_suppliers (customer_name, vat_number) VALUES ($1, $2)", [customer_name.trim(), (vat_number || "").trim()]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 8. Items / Vehicles Management Endpoints
router.get("/api/items", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS e_invoice_items (
        id SERIAL PRIMARY KEY,
        item_name VARCHAR(255) NOT NULL,
        rate DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const result = await pool.query("SELECT * FROM e_invoice_items ORDER BY item_name ASC");
    res.json({ success: true, items: result.rows });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post("/api/save-item", async (req, res) => {
  try {
    const { item_name, rate } = req.body;
    if (!item_name) return res.json({ success: false, message: "Item name required" });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS e_invoice_items (
        id SERIAL PRIMARY KEY, item_name VARCHAR(255) NOT NULL, rate DECIMAL(10,2) DEFAULT 0.00, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query("INSERT INTO e_invoice_items (item_name, rate) VALUES ($1, $2)", [item_name.trim(), parseFloat(rate) || 0]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 9. Dashboard API
router.get("/api/dashboard-invoices", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, invoice_no, company_name, vendor_name, billing_month, 
              TO_CHAR(invoice_date, 'YYYY-MM-DD') as invoice_date, invoice_time, 
              subtotal, vat_amount, grand_total, created_at
       FROM generated_e_invoices 
       ORDER BY id DESC`
    );
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 10. Fetch Single Invoice
router.get("/api/invoice/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM generated_e_invoices WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.json({ success: false, message: "Invoice not found" });
    res.json({ success: true, invoice: result.rows[0] });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 11. Security Check
router.post("/api/verify-security", (req, res) => {
  try {
    const { code } = req.body;
    const validCode = process.env.EINV; // Using EINV from .env
    if (!validCode) return res.status(500).json({ success: false, message: "Security code not configured in .env" });
    if (code && String(code).trim() === String(validCode).trim()) {
      return res.json({ success: true, message: "Access Granted" });
    } else {
      return res.json({ success: false, message: "Invalid Security Code" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;