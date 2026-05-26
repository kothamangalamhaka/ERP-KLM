const express = require("express");
const router = express.Router();
const pool = require("../config/db"); // Adjust path if needed
const { verifyToken } = require("../middlewares/auth");

// 🟢 GET: Fetch all entry logs
router.get("/", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, plate_number, to_char(entry_date, 'YYYY-MM-DD') as entry_date, action, created_at FROM timesheet_entry_logs ORDER BY created_at DESC LIMIT 2000",
    );
    res.json({ success: true, logs: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 🟢 POST: Add a new log (Called from your live entry page)
router.post("/add", verifyToken, async (req, res) => {
  try {
    const { username, plate_number, entry_date, action } = req.body;

    await pool.query(
      "INSERT INTO timesheet_entry_logs (username, plate_number, entry_date, action) VALUES ($1, $2, $3, $4)",
      [username, plate_number, entry_date, action || "ENTRY"],
    );

    res.json({ success: true, message: "Log saved successfully" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;
