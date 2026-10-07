const express = require("express");
const router = express.Router();
const pool = require("../config/db");

router.get("/data", async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  try {
    const equipments = await pool.query(
      `SELECT id, plate_no FROM equipments ORDER BY id ASC`,
    );
    const logs = await pool.query(
      `SELECT * FROM equipment_monthly_logs WHERE year = $1`,
      [year],
    );

    res.json({ equipments: equipments.rows, logs: logs.rows });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Database Error fetching monthly summary" });
  }
});

module.exports = router;
