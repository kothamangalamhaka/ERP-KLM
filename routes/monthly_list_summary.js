const express = require("express");
const router = express.Router();
const pool = require("../config/db");

router.get("/data", async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  try {
    const [equipments, logs, compHelper] = await Promise.all([
      pool.query(`SELECT id, plate_no FROM equipments ORDER BY id ASC`),
      pool.query(`SELECT * FROM equipment_monthly_logs WHERE year = $1`, [year]),
      pool.query(
        `SELECT DISTINCT ON (UPPER(TRIM(plate_no)), EXTRACT(MONTH FROM date)::int)
           UPPER(TRIM(plate_no)) as plate_no,
           EXTRACT(MONTH FROM date)::int as month,
           company, site_name
         FROM billing_records
         WHERE EXTRACT(YEAR FROM date)::int = $1
         ORDER BY UPPER(TRIM(plate_no)), EXTRACT(MONTH FROM date)::int, id DESC`,
        [year]
      ).catch(() => ({ rows: [] }))
    ]);

    const companies = {};
    compHelper.rows.forEach(r => {
      if (!companies[r.plate_no]) companies[r.plate_no] = {};
      companies[r.plate_no][r.month] = {
        company: r.company || "Not Work",
        site: r.site_name || ""
      };
    });

    res.json({ equipments: equipments.rows, logs: logs.rows, companies });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Database Error fetching monthly summary" });
  }
});

module.exports = router;
