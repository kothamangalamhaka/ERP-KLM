const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Fetch Equipment Master and Monthly Logs for Year
router.get('/data', async (req, res) => {
    const year = req.query.year || new Date().getFullYear();
    try {
        const equipments = await pool.query(`SELECT * FROM equipments ORDER BY id ASC`);
        const logs = await pool.query(`SELECT * FROM equipment_monthly_logs WHERE year = $1`, [year]);

        res.json({
            equipments: equipments.rows,
            logs: logs.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching tracker data." });
    }
});

// Add Equipment
router.post('/add-equipment', async (req, res) => {
    const { plate_no, purchase_date, purchase_cost } = req.body;
    try {
        await pool.query(
            `INSERT INTO equipments (plate_no, purchase_date, purchase_cost) VALUES ($1, $2, $3)`,
            [plate_no, purchase_date || null, purchase_cost || 0]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ message: "Equipment already exists or invalid data." });
    }
});

// Save Monthly Data (UPSERT Query)
router.post('/save-log', async (req, res) => {
    const {
        equipment_id, year, month, maintenance_cost, basic_salary,
        overtime, santook_rent, kafil_comm, owner_comm, investor_comm, op_revenue
    } = req.body;

    try {
        const query = `
            INSERT INTO equipment_monthly_logs 
            (equipment_id, year, month, maintenance_cost, basic_salary, overtime, santook_rent, kafil_comm, owner_comm, investor_comm, op_revenue)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (equipment_id, year, month)
            DO UPDATE SET 
                maintenance_cost = EXCLUDED.maintenance_cost,
                basic_salary = EXCLUDED.basic_salary,
                overtime = EXCLUDED.overtime,
                santook_rent = EXCLUDED.santook_rent,
                kafil_comm = EXCLUDED.kafil_comm,
                owner_comm = EXCLUDED.owner_comm,
                investor_comm = EXCLUDED.investor_comm,
                op_revenue = EXCLUDED.op_revenue;
        `;

        await pool.query(query, [
            equipment_id, year, month, maintenance_cost || 0, basic_salary || 0,
            overtime || 0, santook_rent || 0, kafil_comm || 0, owner_comm || 0,
            investor_comm || 0, op_revenue || 0
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to save monthly log." });
    }
});

module.exports = router;