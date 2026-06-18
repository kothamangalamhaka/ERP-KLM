const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { verifyToken, verifySuperAdmin } = require("../middlewares/auth");

// 1. Fetch all break rules
router.get("/api/break-rules", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM site_break_rules ORDER BY created_at DESC"
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 2. Add a new break rule
router.post("/api/add-break-rule", verifySuperAdmin, async (req, res) => {
  try {
    const { sites, start_date, end_date, break_start, break_end, is_active } = req.body;
    
    await pool.query(
      `INSERT INTO site_break_rules (sites, start_date, end_date, break_start, break_end, is_active) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        JSON.stringify(sites),
        start_date,
        end_date,
        break_start,
        break_end,
        is_active !== undefined ? is_active : true,
      ]
    );

    // Logging the action
    await pool.query(
      "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_BREAK_RULE', $2)",
      [req.user.username, JSON.stringify({ sites, start_date, end_date })]
    );

    res.json({ success: true, message: "Break rule added successfully!" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 3. Update an existing break rule
router.post("/api/update-break-rule", verifySuperAdmin, async (req, res) => {
  try {
    const { id, sites, start_date, end_date, break_start, break_end, is_active } = req.body;
    
    await pool.query(
      `UPDATE site_break_rules 
       SET sites=$1, start_date=$2, end_date=$3, break_start=$4, break_end=$5, is_active=$6 
       WHERE id=$7`,
      [
        JSON.stringify(sites),
        start_date,
        end_date,
        break_start,
        break_end,
        is_active,
        id,
      ]
    );

    await pool.query(
      "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'UPDATE_BREAK_RULE', $2)",
      [req.user.username, JSON.stringify({ rule_id: id })]
    );

    res.json({ success: true, message: "Break rule updated successfully!" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 4. Delete a break rule
router.post("/api/delete-break-rule", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("DELETE FROM site_break_rules WHERE id=$1", [id]);
    
    await pool.query(
      "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'DELETE_BREAK_RULE', $2)",
      [req.user.username, JSON.stringify({ rule_id: id })]
    );

    res.json({ success: true, message: "Break rule deleted successfully!" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;