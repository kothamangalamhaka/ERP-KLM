const express = require("express");
const router = express.Router();
const pool = require("../config/db"); // Adjust path if needed
const { verifyToken } = require("../middlewares/auth");

// 🟢 GET: Fetch entry logs from the last 6 months
router.get("/", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, plate_number, to_char(entry_date, 'YYYY-MM-DD') as entry_date, action, created_at FROM timesheet_entry_logs WHERE created_at >= NOW() - INTERVAL '6 months' ORDER BY created_at DESC"
    );
    res.json({ success: true, logs: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 🟢 POST: Add a new log and auto-delete logs older than 6 months
router.post("/add", verifyToken, async (req, res) => {
  try {
    const { username, plate_number, entry_date, action } = req.body;

    // 1. Insert the new log
    await pool.query(
      "INSERT INTO timesheet_entry_logs (username, plate_number, entry_date, action) VALUES ($1, $2, $3, $4)",
      [username, plate_number, entry_date, action || "ENTRY"]
    );

    // 2. Auto-cleanup: Delete logs older than 6 months
    // We run this asynchronously so it doesn't block the immediate response to the user
    pool.query("DELETE FROM timesheet_entry_logs WHERE created_at < NOW() - INTERVAL '6 months'")
      .catch(err => console.error("Background log cleanup failed:", err.message));

    res.json({ success: true, message: "Log saved successfully" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;