const express = require("express");
const pool = require("../config/db"); 
const { verifyToken, verifyEditor } = require("../middlewares/auth"); 
const jwt = require("jsonwebtoken"); 
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET; 

const logTableMapping = {
    'SiteLog': 'we1_site_log',
    'DriverLog': 'we1_driver_log',
    'VehicleTypeLog': 'we1_vtype_log',
    'OwnerLog': 'we1_owner_log',
    'SanthookLog': 'we1_santhook_log'
};

// 1. Fetch all EQ Master Data
router.get("/data", verifyToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM we1_own_eq_master ORDER BY id ASC");
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 2. Fetch Log History by Type & Plate (Changed to POST to avoid URL space/character issues)
router.post("/log/history", verifyToken, async (req, res) => {
  try {
    const { type, plate } = req.body;
    const tableName = logTableMapping[type];
    if(!tableName) throw new Error("Invalid Log Type");

    // Using UPPER and TRIM for perfect matching
    const result = await pool.query(`SELECT * FROM ${tableName} WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM($1)) ORDER BY id DESC`, [plate]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 3. Add or Update Log Entry
router.post("/log/save", verifyEditor, async (req, res) => {
    const client = await pool.connect();
    try {
        const { type, plate_no, id, data } = req.body;
        const tableName = logTableMapping[type];
        if(!tableName) throw new Error("Invalid Log Type");

        await client.query('BEGIN');

        if(id) {
            // Update Existing Log
            const columns = Object.keys(data);
            const values = Object.values(data);
            const setString = columns.map((col, index) => `${col} = $${index + 1}`).join(", ");
            values.push(id);
            await client.query(`UPDATE ${tableName} SET ${setString} WHERE id = $${values.length}`, values);
        } else {
            // Insert New Log
            const columns = Object.keys(data);
            const values = Object.values(data);
            columns.push('plate_no');
            values.push(plate_no);
            
            const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
            await client.query(`INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`, values);
        }

        // 🟢 Auto-Sync Main Master Table from Latest Logs
        let syncQuery = "";
        let syncVals = [plate_no];

        if(type === 'SiteLog') {
            const latest = await client.query(`SELECT site_name, mob_date, work_end_date, replaced_date FROM we1_site_log WHERE plate_no = $1 ORDER BY id DESC LIMIT 1`, [plate_no]);
            if(latest.rows.length > 0) {
                const r = latest.rows[0];
                let status = 'Running';
                if(r.replaced_date) status = 'Replaced';
                else if(r.work_end_date) status = 'Released';
                
                syncQuery = `UPDATE we1_own_eq_master SET site_name=$2, mob_date=$3, status=$4 WHERE plate_no=$1`;
                syncVals.push(r.site_name, r.mob_date, status);
            }
        } else if(type === 'DriverLog') {
            const latest = await client.query(`SELECT driver_name, join_date, salary FROM we1_driver_log WHERE plate_no = $1 ORDER BY id DESC LIMIT 1`, [plate_no]);
            if(latest.rows.length > 0) {
                const r = latest.rows[0];
                syncQuery = `UPDATE we1_own_eq_master SET driver_name=$2, joining_date=$3, salary=$4 WHERE plate_no=$1`;
                syncVals.push(r.driver_name, r.join_date, r.salary);
            }
        }

        if(syncQuery) await client.query(syncQuery, syncVals);

        await client.query('COMMIT');
        res.json({ success: true, message: "Log saved successfully" });
    } catch (error) {
        await client.query('ROLLBACK');
        res.json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// 4. Add New Vehicle (With Auto-Log Generation)
router.post("/add", verifyEditor, async (req, res) => {
    const client = await pool.connect();
    try {
        const { 
            plate_no, mob_date, vehicle_type, driver_name, driver_mobile,
            joining_date, site_name, vehicle_owner, 
            santhook, salary, status 
        } = req.body;

        if (!plate_no) throw new Error("Plate number is required.");

        const cleanPlate = plate_no.trim().toUpperCase();
        const val = (v) => (v && String(v).trim() !== "") ? v : null;

        await client.query('BEGIN');

        // 1. Insert to Master Table
        const query = `
        INSERT INTO we1_own_eq_master 
        (plate_no, mob_date, vehicle_type, driver_name, driver_mobile, joining_date, site_name, vehicle_owner, santhook, salary, status) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
        ON CONFLICT (plate_no) DO NOTHING
        `;
        const values = [
            cleanPlate, val(mob_date), val(vehicle_type), val(driver_name), val(driver_mobile), 
            val(joining_date), val(site_name), val(vehicle_owner), val(santhook), val(salary), val(status) || 'Running'
        ];
        await client.query(query, values);

        // 2. Insert into Specific Logs Automatically (Always creates an initial row)
        await client.query(`INSERT INTO we1_site_log (plate_no, site_name, mob_date) VALUES ($1, $2, $3)`, [cleanPlate, val(site_name), val(mob_date)]);
        
        await client.query(`INSERT INTO we1_driver_log (plate_no, driver_name, join_date, salary) VALUES ($1, $2, $3, $4)`, [cleanPlate, val(driver_name), val(joining_date), val(salary)]);
        
        await client.query(`INSERT INTO we1_vtype_log (plate_no, vehicle_type, start_date) VALUES ($1, $2, $3)`, [cleanPlate, val(vehicle_type), val(mob_date)]);
        
        await client.query(`INSERT INTO we1_owner_log (plate_no, owner_name, start_date) VALUES ($1, $2, $3)`, [cleanPlate, val(vehicle_owner), val(mob_date)]);
        
        await client.query(`INSERT INTO we1_santhook_log (plate_no, santhook_name, start_date) VALUES ($1, $2, $3)`, [cleanPlate, val(santhook), val(mob_date)]);

        await client.query('COMMIT');
        res.json({ success: true, message: "Vehicle and initial logs successfully added." });
    } catch (error) {
        await client.query('ROLLBACK');
        res.json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// 5. Update Note (Double-click inline edit)
router.post("/update-note", verifyEditor, async (req, res) => {
    try {
        const { plate_no, note } = req.body;
        if (!plate_no) throw new Error("Plate number is missing.");

        await pool.query(
            "UPDATE we1_own_eq_master SET note = $1 WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM($2))",
            [note, plate_no]
        );
        res.json({ success: true, message: "Note updated successfully." });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 6. Verify Access Code for External Users
router.post("/verify-code", async (req, res) => {
    try {
        const { code } = req.body;
        const validCode = process.env.We1_own_EQ_DB;

        if (!validCode) {
            return res.json({ success: false, message: "Security code not configured in server." });
        }

        if (code === validCode) {
            // 🟢 കോഡ് ശരിയാണെങ്കിൽ 12 മണിക്കൂർ വാലിഡിറ്റി ഉള്ള ഒരു Guest Token നൽകുന്നു
            const token = jwt.sign(
                { id: 9999, username: "External User", role: "Editor", site_access: "All" },
                JWT_SECRET,
                { expiresIn: "12h" }
            );
            res.json({ success: true, token: token });
        } else {
            res.json({ success: false, message: "Invalid Access Code." });
        }
    } catch (error) {
        res.json({ success: false, message: "Server Error: " + error.message });
    }
});

module.exports = router;