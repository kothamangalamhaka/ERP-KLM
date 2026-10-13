const express = require("express");
const router = express.Router();
const pool = require("../config/db");

// 1. Fetch Companies for Dropdown
router.get("/api/companies", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM e_invoice_companies ORDER BY id ASC");
    res.json({ success: true, companies: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Fetch Owner Data from Timesheet DB for a vehicle & period
router.get("/api/vehicle-owners", async (req, res) => {
  try {
    const { plate_no, month, year, site_name } = req.query;
    if (!plate_no || !month || !year) {
      return res.status(400).json({ success: false, message: "Plate, Month and Year are required." });
    }

    const cleanPlate = plate_no.trim().toUpperCase();
    const rawParts = cleanPlate.split(/➔|→|->/).map(p => p.trim().toUpperCase()).filter(Boolean);
    const relatedPlates = [...new Set([cleanPlate, ...rawParts])];

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const mIdx = monthNames.indexOf(month.trim());
    const yNum = parseInt(year, 10);
    if (mIdx === -1 || isNaN(yNum)) {
      return res.status(400).json({ success: false, message: "Invalid month or year." });
    }

    const monthStart = new Date(yNum, mIdx, 1);
    const monthEnd = new Date(yNum, mIdx + 1, 0, 23, 59, 59, 999);

    // Fetch related plate variations from logs
    const pCheck = await pool.query(
      `SELECT old_plate_no, new_plate_no FROM vehicle_plate_log 
       WHERE UPPER(TRIM(old_plate_no)) = ANY($1::text[]) OR UPPER(TRIM(new_plate_no)) = ANY($1::text[])`,
      [relatedPlates]
    );
    pCheck.rows.forEach(pl => {
      let op = (pl.old_plate_no || "").trim().toUpperCase();
      let np = (pl.new_plate_no || "").trim().toUpperCase();
      if (op && !relatedPlates.includes(op)) relatedPlates.push(op);
      if (np && !relatedPlates.includes(np)) relatedPlates.push(np);
    });

    // 1. Fetch Owner logs overlapping this month
    const ownerLogsRes = await pool.query(
      `SELECT * FROM vehicle_owner_log 
       WHERE UPPER(TRIM(plate_no)) = ANY($1::text[])
       ORDER BY id DESC`,
      [relatedPlates]
    );

    const validOwnerLogs = ownerLogsRes.rows.filter(o => {
      let st = o.work_start_date ? new Date(o.work_start_date) : new Date("2000-01-01");
      let ed = o.work_end_date ? new Date(o.work_end_date) : new Date("2099-01-01");
      return st <= monthEnd && ed >= monthStart;
    });

    // 2. Fetch Site logs to cross-reference multiple owners across sites
    const siteLogsRes = await pool.query(
      `SELECT * FROM vehicle_site_log 
       WHERE UPPER(TRIM(plate_no)) = ANY($1::text[])
       ORDER BY id DESC`,
      [relatedPlates]
    );

    const validSiteLogs = siteLogsRes.rows.filter(s => {
      let st = s.work_start_date ? new Date(s.work_start_date) : new Date("2000-01-01");
      let ed = s.work_end_date ? new Date(s.work_end_date) : new Date("2099-01-01");
      return st <= monthEnd && ed >= monthStart;
    });

    // Master vehicle fallback
    const tsVehRes = await pool.query(
      `SELECT * FROM timesheet_vehicles WHERE UPPER(TRIM(plate_no)) = ANY($1::text[]) LIMIT 1`,
      [relatedPlates]
    );
    const masterVeh = tsVehRes.rows[0] || {};

    res.json({
      success: true,
      plate_no: cleanPlate,
      owners: validOwnerLogs,
      sites: validSiteLogs,
      master_vehicle: masterVeh
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Vendor Directory Endpoints (Separated from regular invoice suppliers)
router.get("/api/suppliers", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM vendor_bill_suppliers WHERE is_deleted = FALSE ORDER BY id DESC"
    );
    res.json({ success: true, suppliers: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/api/save-supplier", async (req, res) => {
  try {
    const { id, customer_name, nickname, vat_number } = req.body;
    if (!customer_name || !customer_name.trim()) {
      return res.status(400).json({ success: false, message: "Customer / Vendor name is required." });
    }

    if (id) {
      // Ensure only manual entries can be modified
      const checkManual = await pool.query("SELECT is_manual FROM vendor_bill_suppliers WHERE id = $1", [id]);
      if (checkManual.rows.length > 0 && !checkManual.rows[0].is_manual) {
        return res.status(403).json({ success: false, message: "Timesheet DB vendors cannot be edited." });
      }

      await pool.query(
        `UPDATE vendor_bill_suppliers 
         SET customer_name = $1, nickname = $2, vat_number = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $4 AND is_manual = TRUE`,
        [customer_name.trim(), (nickname || "").trim(), (vat_number || "").trim(), id]
      );
    } else {
      const countRes = await pool.query("SELECT COUNT(*) as total FROM vendor_bill_suppliers");
      const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
      const customerCode = `VEND-${String(nextSeq).padStart(5, "0")}`;

      await pool.query(
        `INSERT INTO vendor_bill_suppliers (customer_code, customer_name, nickname, vat_number, is_manual, is_deleted)
         VALUES ($1, $2, $3, $4, TRUE, FALSE)`,
        [customerCode, customer_name.trim(), (nickname || "").trim(), (vat_number || "").trim()]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/api/delete-supplier", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: "ID is required." });

    const checkManual = await pool.query("SELECT is_manual FROM vendor_bill_suppliers WHERE id = $1", [id]);
    if (checkManual.rows.length > 0 && !checkManual.rows[0].is_manual) {
      return res.status(403).json({ success: false, message: "Timesheet DB synced vendors cannot be deleted." });
    }

    await pool.query(
      "UPDATE vendor_bill_suppliers SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_manual = TRUE",
      [id]
    );
    res.json({ success: true, message: "Vendor archived successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Atomic Next Invoice Number Generator (Shared sequence across Regular Invoices & Vendor Bills)
async function generateNextInvoiceNoInternal(client, company_id, invoice_date) {
  let shortCode = "NV";

  if (company_id) {
    const compRes = await client.query(
      "SELECT short_code, company_name_en FROM e_invoice_companies WHERE id = $1",
      [company_id]
    );
    if (compRes.rows.length > 0) {
      shortCode =
        compRes.rows[0].short_code ||
        compRes.rows[0].company_name_en.substring(0, 3).toUpperCase();
    }
  }

  const cleanCode = (shortCode || "").trim().toUpperCase();

  let startBase = 5645;
  if (cleanCode.includes("HAK")) {
    startBase = 4238;
  } else if (cleanCode.includes("WE")) {
    startBase = 2598;
  } else if (cleanCode.includes("MW")) {
    startBase = 3111;
  } else if (cleanCode.includes("AL")) {
    startBase = 5645;
  }

  let targetYear = 2026;
  let targetMonth = 10;
  if (invoice_date && typeof invoice_date === "string" && invoice_date.includes("-")) {
    const parts = invoice_date.split("T")[0].split("-");
    if (parts.length >= 2) {
      targetYear = parseInt(parts[0], 10) || 2026;
      targetMonth = parseInt(parts[1], 10) || 10;
    }
  } else {
    const now = new Date();
    targetYear = now.getFullYear();
    targetMonth = now.getMonth() + 1;
  }

  const yyStr = String(targetYear).slice(-2);
  const mStr = String(targetMonth);
  const prefix = `${shortCode}-${yyStr}-${mStr}`;

  const monthDiff = (targetYear - 2026) * 12 + (targetMonth - 10);
  const calculatedBaseSeq = startBase + monthDiff;

  // Lock the matching rows in transaction to avoid collision
  const maxRes = await client.query(
    "SELECT invoice_no FROM generated_e_invoices WHERE invoice_no LIKE $1 FOR UPDATE",
    [`${prefix}-%`]
  );

  let nextSeq = calculatedBaseSeq;
  let maxNum = calculatedBaseSeq - 1;

  maxRes.rows.forEach(r => {
    const parts = (r.invoice_no || "").split("-");
    const lastPart = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastPart) && lastPart > maxNum) {
      maxNum = lastPart;
    }
  });

  if (maxNum >= calculatedBaseSeq) {
    nextSeq = maxNum + 1;
  }

  const seqStr = String(nextSeq).padStart(5, "0");
  return `${prefix}-${seqStr}`;
}

// Preview next invoice number (non-locking)
router.get("/api/next-invoice-no", async (req, res) => {
  const client = await pool.connect();
  try {
    const { company_id, invoice_date } = req.query;
    const invNo = await generateNextInvoiceNoInternal(client, company_id, invoice_date);
    res.json({ success: true, invoice_no: invNo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// 5. Save Final Vendor Bill Record to DB (Atomic concurrency check included)
router.post("/api/save-invoice-record", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let {
      invoice_no, company_id, company_name, vendor_name, billing_month, invoice_date,
      invoice_time, subtotal, vat_amount, grand_total, has_seal, mode, manual_items, raw_payload,
      is_final_save
    } = req.body;

    if (!company_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Company selection is mandatory." });
    }

    // PDF generation/Final save-ൽ അതേ നമ്പർ വേറെ ആരെങ്കിലും സേവ് ചെയ്തിട്ടുണ്ടെങ്കിൽ ഓട്ടോമാറ്റിക്കായി അടുത്ത നമ്പർ അസൈൻ ചെയ്യുന്നു
    if (is_final_save) {
      const existsCheck = await client.query(
        "SELECT id FROM generated_e_invoices WHERE invoice_no = $1 FOR UPDATE",
        [invoice_no]
      );
      if (existsCheck.rows.length > 0 && mode === "newbill") {
        invoice_no = await generateNextInvoiceNoInternal(client, company_id, invoice_date);
      }
    }

    const extractedRemarks = (raw_payload && raw_payload.remarks) ? raw_payload.remarks : "";

    const finalPayload = {
      ...(raw_payload || {}),
      remarks: extractedRemarks,
      manual_items: manual_items || (raw_payload ? raw_payload.manual_items : []),
      mode: mode || "newbill",
      has_seal: !!has_seal,
      bill_source: "VB"
    };

    const result = await client.query(
      `INSERT INTO generated_e_invoices 
        (invoice_no, company_id, company_name, vendor_name, billing_month, invoice_date, invoice_time, subtotal, vat_amount, grand_total, remarks, raw_payload, bill_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'VB')
       ON CONFLICT (invoice_no) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        company_name = EXCLUDED.company_name,
        vendor_name = EXCLUDED.vendor_name,
        billing_month = EXCLUDED.billing_month,
        invoice_date = EXCLUDED.invoice_date,
        invoice_time = EXCLUDED.invoice_time,
        subtotal = EXCLUDED.subtotal,
        vat_amount = EXCLUDED.vat_amount,
        grand_total = EXCLUDED.grand_total,
        remarks = EXCLUDED.remarks,
        raw_payload = EXCLUDED.raw_payload,
        bill_source = 'VB'
       RETURNING id, invoice_no`,
      [
        invoice_no, company_id || null, company_name, vendor_name, billing_month, invoice_date || new Date(),
        invoice_time, subtotal || 0, vat_amount || 0, grand_total || 0, extractedRemarks, finalPayload
      ]
    );

    // 🟢 വെണ്ടർ ബിൽ ഡയറക്ടറിയിലേക്ക് Nick Name ആയി ഒറിജിനൽ Owner Name ഉറപ്പുവരുത്തുന്നു
    if (vendor_name && vendor_name.trim()) {
      const vName = vendor_name.trim();
      const vatNum = (raw_payload && raw_payload.buyer_vat) ? raw_payload.buyer_vat.trim() : "";
      // raw_payload-ൽ നിന്ന് owner_nick എടുക്കുന്നു, ഇല്ലെങ്കിൽ vendor_name
      const nickName = (raw_payload && raw_payload.owner_nick && raw_payload.owner_nick.trim()) 
        ? raw_payload.owner_nick.trim() 
        : "";

      const vExist = await client.query(
        "SELECT id, nickname FROM vendor_bill_suppliers WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM($1))",
        [vName]
      );
      
      if (vExist.rows.length === 0) {
        const countRes = await client.query("SELECT COUNT(*) as total FROM vendor_bill_suppliers");
        const nextSeq = parseInt(countRes.rows[0].total || 0, 10) + 1;
        const customerCode = `VEND-${String(nextSeq).padStart(5, "0")}`;

        await client.query(
          `INSERT INTO vendor_bill_suppliers (customer_code, customer_name, nickname, vat_number, is_manual, is_deleted)
           VALUES ($1, $2, $3, $4, FALSE, FALSE)`,
          [customerCode, vName, nickName, vatNum]
        );
      } else if (nickName && vExist.rows[0].nickname !== nickName) {
        // നിലവിലുള്ള ലോഗ് ആണെങ്കിൽ കൃത്യമായ owner nick അപ്ഡേറ്റ് ചെയ്യുന്നു
        await client.query(
          `UPDATE vendor_bill_suppliers SET nickname = $1 WHERE id = $2`,
          [nickName, vExist.rows[0].id]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, id: result.rows[0].id, invoice_no: result.rows[0].invoice_no });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// 6. Security verification (Using VBILL_CODE from .env)
router.post("/api/verify-security", (req, res) => {
  try {
    const { code } = req.body;
    const validCode = process.env.VBILL_CODE;
    if (!validCode) return res.status(500).json({ success: false, message: "VBILL_CODE not configured in .env" });
    if (code && String(code).trim() === String(validCode).trim()) {
      return res.json({ success: true, message: "Access Granted" });
    } else {
      return res.json({ success: false, message: "Invalid Security Code" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// 🟢 Vendor Bill Dashboard API (Only fetches bills created via Vendor Bill)
router.get("/api/dashboard-invoices", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.invoice_no, g.company_name, g.vendor_name, g.billing_month, 
              TO_CHAR(g.invoice_date, 'YYYY-MM-DD') as invoice_date, g.invoice_time, 
              g.subtotal, g.vat_amount, g.grand_total, g.created_at, g.raw_payload,
              s.nickname
       FROM generated_e_invoices g
       LEFT JOIN vendor_bill_suppliers s 
         ON LOWER(TRIM(g.vendor_name)) = LOWER(TRIM(s.customer_name)) 
         AND s.is_deleted = FALSE
       WHERE g.bill_source = 'VB'
       ORDER BY g.id DESC`
    );
    res.json({ success: true, invoices: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Single invoice fetch for Vendor Bill View/Download
router.get("/api/invoice/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM generated_e_invoices WHERE id = $1 AND bill_source = 'VB'", [id]);
    if (result.rows.length === 0) return res.json({ success: false, message: "Invoice not found" });
    res.json({ success: true, invoice: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🟢 Delete Single Vendor Bill with PIN Verification from .env (VBDL)
router.post("/api/delete-invoice", async (req, res) => {
  try {
    const { id, pin } = req.body;
    const validPin = process.env.VBDL;

    if (!validPin) {
      return res.status(500).json({ success: false, message: "Delete PIN (VBDL) not configured in .env" });
    }

    if (!pin || String(pin).trim() !== String(validPin).trim()) {
      return res.status(403).json({ success: false, message: "Invalid Delete PIN! Action cancelled." });
    }

    if (!id) {
      return res.status(400).json({ success: false, message: "Invoice ID is required." });
    }

    // 🟢 Bill source 'VB' aayathum ee specific id ullathum maathram delete cheyyunnu
    const result = await pool.query(
      "DELETE FROM generated_e_invoices WHERE id = $1 AND bill_source = 'VB' RETURNING invoice_no",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Record not found or already deleted." });
    }

    res.json({ success: true, message: `Invoice ${result.rows[0].invoice_no} deleted successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;