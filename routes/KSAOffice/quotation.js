const express = require("express");
const router = express.Router();
const pool = require("../../config/db");

// ================= 1. IMPORTANT NOTES =================
router.get("/api/notes", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM qt_global_notes WHERE id = 1",
    );
    if (result.rows.length > 0) {
      res.json({ success: true, notes: result.rows[0] });
    } else {
      res.json({ success: true, notes: { notes_ar: "", notes_en: "" } });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-notes", async (req, res) => {
  try {
    const { notes_ar, notes_en } = req.body;
    await pool.query(
      `INSERT INTO qt_global_notes (id, notes_ar, notes_en, updated_at)
       VALUES (1, $1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE
       SET notes_ar = EXCLUDED.notes_ar, notes_en = EXCLUDED.notes_en, updated_at = CURRENT_TIMESTAMP`,
      [notes_ar || "", notes_en || ""],
    );
    res.json({
      success: true,
      message: "Important notes updated successfully",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 2. CUSTOMERS DIRECTORY API =================
router.get("/api/customers", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM qt_customers WHERE is_deleted = FALSE ORDER BY id DESC",
    );
    res.json({ success: true, customers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-customer", async (req, res) => {
  try {
    const {
      id,
      customer_name_en,
      customer_name_ar,
      nickname,
      cr_number,
      vat_number,
      contact_person,
      phone,
    } = req.body;

    if (!customer_name_en || !customer_name_en.trim()) {
      return res.json({
        success: false,
        message: "Customer English Name required",
      });
    }

    if (id) {
      await pool.query(
        `UPDATE qt_customers
         SET customer_name_en=$1, customer_name_ar=$2, nickname=$3, cr_number=$4, vat_number=$5,
             contact_person=$6, phone=$7, updated_at=CURRENT_TIMESTAMP
         WHERE id=$8`,
        [
          customer_name_en.trim(),
          (customer_name_ar || "").trim(),
          (nickname || "").trim(),
          (cr_number || "").trim(),
          (vat_number || "").trim(),
          (contact_person || "").trim(),
          (phone || "").trim(),
          id,
        ],
      );
    } else {
      const countRes = await pool.query(
        "SELECT COUNT(*) as total FROM qt_customers",
      );
      const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
      const cCode = `CUS-${String(nextSeq).padStart(4, "0")}`;
      await pool.query(
        `INSERT INTO qt_customers
         (customer_code, customer_name_en, customer_name_ar, nickname, cr_number, vat_number, contact_person, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          cCode,
          customer_name_en.trim(),
          (customer_name_ar || "").trim(),
          (nickname || "").trim(),
          (cr_number || "").trim(),
          (vat_number || "").trim(),
          (contact_person || "").trim(),
          (phone || "").trim(),
        ],
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/delete-customer", async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("UPDATE qt_customers SET is_deleted=TRUE WHERE id=$1", [
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 3. SHARED EQUIPMENTS DIRECTORY (LINKED TO PO) =================
router.get("/api/equipments", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM po_equipments WHERE is_deleted = FALSE ORDER BY id DESC",
    );
    res.json({ success: true, equipments: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-equipment", async (req, res) => {
  try {
    const { id, equipment_name_en, equipment_name_ar, default_rent } = req.body;
    if (!equipment_name_en || !equipment_name_en.trim()) {
      return res.json({
        success: false,
        message: "Equipment English Name required",
      });
    }

    if (id) {
      await pool.query(
        `UPDATE po_equipments SET equipment_name_en=$1, equipment_name_ar=$2, default_rent=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [
          equipment_name_en.trim(),
          (equipment_name_ar || "").trim(),
          parseFloat(default_rent) || 0,
          id,
        ],
      );
    } else {
      const countRes = await pool.query(
        "SELECT COUNT(*) as total FROM po_equipments",
      );
      const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
      const eqCode = `EQP-${String(nextSeq).padStart(4, "0")}`;
      await pool.query(
        `INSERT INTO po_equipments (equipment_code, equipment_name_en, equipment_name_ar, default_rent) VALUES ($1, $2, $3, $4)`,
        [
          eqCode,
          equipment_name_en.trim(),
          (equipment_name_ar || "").trim(),
          parseFloat(default_rent) || 0,
        ],
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
    await pool.query("UPDATE po_equipments SET is_deleted=TRUE WHERE id=$1", [
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 4. QUOTATION CORE =================
router.get("/api/next-qt-no", async (req, res) => {
  try {
    const { company_id } = req.query;
    let shortCode = "QT";
    if (company_id) {
      const compRes = await pool.query(
        "SELECT short_code FROM e_invoice_companies WHERE id = $1",
        [company_id],
      );
      if (compRes.rows.length > 0 && compRes.rows[0].short_code) {
        shortCode = compRes.rows[0].short_code;
      }
    }
    const currentYear = new Date().getFullYear().toString().slice(-2);
    const prefix = `${shortCode}-QT-${currentYear}`;

    const maxRes = await pool.query(
      `SELECT qt_no FROM generated_quotations
       WHERE qt_no LIKE $1
       ORDER BY id DESC LIMIT 1`,
      [`${prefix}-%`],
    );

    let nextSeq;
    if (maxRes.rows.length > 0) {
      const lastQtNo = maxRes.rows[0].qt_no;
      const parts = lastQtNo.split("-");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      nextSeq = !isNaN(lastNum) ? lastNum + 1 : 1001;
    } else {
      nextSeq = Math.floor(Math.random() * (2500 - 1100 + 1)) + 1100;
    }

    const qtNo = `${prefix}-${String(nextSeq).padStart(4, "0")}`;
    res.json({ success: true, qt_no: qtNo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-qt-record", async (req, res) => {
  try {
    const {
      qt_no,
      company_id,
      company_name,
      customer_name,
      customer_details,
      qt_date,
      valid_until,
      attention_to,
      project_location,
      subject,
      subtotal,
      vat_amount,
      grand_total,
      has_seal,
      line_items,
      notes_ar,
      notes_en,
    } = req.body;

    if (!qt_no) {
      return res
        .status(400)
        .json({ success: false, message: "Quotation No required" });
    }

    const result = await pool.query(
      `INSERT INTO generated_quotations (
         qt_no, company_id, company_name, customer_name, customer_details, qt_date,
         valid_until, attention_to, project_location, subject, subtotal, vat_amount,
         grand_total, has_seal, line_items, notes_ar, notes_en, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,CURRENT_TIMESTAMP)
       ON CONFLICT (qt_no) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         company_name = EXCLUDED.company_name,
         customer_name = EXCLUDED.customer_name,
         customer_details = EXCLUDED.customer_details,
         qt_date = EXCLUDED.qt_date,
         valid_until = EXCLUDED.valid_until,
         attention_to = EXCLUDED.attention_to,
         project_location = EXCLUDED.project_location,
         subject = EXCLUDED.subject,
         subtotal = EXCLUDED.subtotal,
         vat_amount = EXCLUDED.vat_amount,
         grand_total = EXCLUDED.grand_total,
         has_seal = EXCLUDED.has_seal,
         line_items = EXCLUDED.line_items,
         notes_ar = EXCLUDED.notes_ar,
         notes_en = EXCLUDED.notes_en,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        qt_no,
        company_id || null,
        company_name || "",
        customer_name || "",
        JSON.stringify(customer_details || {}),
        qt_date || new Date(),
        valid_until || "",
        attention_to || "",
        project_location || "",
        subject || "",
        subtotal || 0,
        vat_amount || 0,
        grand_total || 0,
        !!has_seal,
        JSON.stringify(line_items || []),
        notes_ar || "",
        notes_en || "",
      ],
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/dashboard-qts", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, qt_no, company_name, customer_name, TO_CHAR(qt_date, 'YYYY-MM-DD') as qt_date,
              project_location, grand_total, created_at
       FROM generated_quotations
       ORDER BY id DESC`,
    );
    res.json({ success: true, quotations: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/qt/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM generated_quotations WHERE id = $1",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Quotation not found" });
    }
    const qt = result.rows[0];
    let annexureHtml = "";
    if (qt.company_id) {
      const annRes = await pool.query(
        "SELECT content_html FROM qt_company_annexures WHERE company_id = $1",
        [qt.company_id],
      );
      if (annRes.rows.length > 0) {
        annexureHtml = annRes.rows[0].content_html;
      }
    }
    res.json({ success: true, qt: { ...qt, annexure_html: annexureHtml } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/api/annexure/:company_id", async (req, res) => {
  try {
    const { company_id } = req.params;
    const result = await pool.query(
      "SELECT * FROM qt_company_annexures WHERE company_id = $1",
      [company_id],
    );
    res.json({
      success: true,
      annexure: result.rows[0] || { content_html: "" },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= 5. COMPANY TEMPLATES =================
router.get("/api/template/:company_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT template FROM qt_company_templates WHERE company_id = $1",
      [req.params.company_id],
    );
    res.json({
      success: true,
      template: result.rows.length ? result.rows[0].template : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/api/save-template", async (req, res) => {
  try {
    const { company_id, template } = req.body;
    if (!company_id || !template) {
      return res.json({
        success: false,
        message: "company_id and template required",
      });
    }
    await pool.query(
      `INSERT INTO qt_company_templates (company_id, template, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (company_id) DO UPDATE
       SET template = EXCLUDED.template, updated_at = CURRENT_TIMESTAMP`,
      [company_id, JSON.stringify(template)],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
