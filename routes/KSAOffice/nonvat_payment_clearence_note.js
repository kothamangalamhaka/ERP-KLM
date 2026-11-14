const express = require("express");
const router = express.Router();
const pool = require("../../config/db");

// 1. Fetch dashboard records
router.get("/api/records", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, arabic_name, id_no, plate_no, clearance_date, amount, custom_note, TO_CHAR(created_at, 'DD-Mon-YYYY HH12:MI AM') as created_at_formatted FROM nonvat_payment_clearance_records ORDER BY created_at DESC",
    );
    res.json({ success: true, records: result.rows });
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// 2. Save new clearance record
router.post("/api/save", async (req, res) => {
  try {
    const { name, arabic_name, id_no, plate_no, date, amount, custom_note } =
      req.body;
    if (!name || !arabic_name || !plate_no || !date || !amount) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    const cleanAmount =
      parseFloat(String(amount).replace(/[^0-9.-]+/g, "")) || 0;
    const noteVal = custom_note
      ? custom_note.trim()
      : "This is the last payment/ هذا هو الدفعة الأخيرة";
    const idNoVal = id_no ? id_no.trim() : "";

    const result = await pool.query(
      `INSERT INTO nonvat_payment_clearance_records (name, arabic_name, id_no, plate_no, clearance_date, amount, custom_note) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, TO_CHAR(created_at, 'DD-Mon-YYYY HH12:MI AM') as created_at_formatted`,
      [
        name.trim(),
        arabic_name.trim(),
        idNoVal,
        plate_no.trim(),
        date.trim(),
        cleanAmount,
        noteVal,
      ],
    );

    res.json({
      success: true,
      record: result.rows[0],
      message: "Saved to dashboard successfully!",
    });
  } catch (err) {
    console.error("Save Error:", err);
    res.status(500).json({ success: false, message: "Failed to save record" });
  }
});

// 3. Update existing clearance record (Replace/Modify)
router.put("/api/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, arabic_name, id_no, plate_no, date, amount, custom_note } =
      req.body;
    if (!name || !arabic_name || !plate_no || !date || !amount) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    const cleanAmount =
      parseFloat(String(amount).replace(/[^0-9.-]+/g, "")) || 0;
    const noteVal = custom_note
      ? custom_note.trim()
      : "This is the last payment/ هذا هو الدفعة الأخيرة";
    const idNoVal = id_no ? id_no.trim() : "";

    const result = await pool.query(
      `UPDATE nonvat_payment_clearance_records 
       SET name = $1, arabic_name = $2, id_no = $3, plate_no = $4, clearance_date = $5, amount = $6, custom_note = $7 
       WHERE id = $8 RETURNING id`,
      [
        name.trim(),
        arabic_name.trim(),
        idNoVal,
        plate_no.trim(),
        date.trim(),
        cleanAmount,
        noteVal,
        id,
      ],
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Record not found" });
    }

    res.json({ success: true, message: "Record updated successfully!" });
  } catch (err) {
    console.error("Update Error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update record" });
  }
});

module.exports = router;
