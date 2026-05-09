const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const router = express.Router();

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
});

const JWT_SECRET = process.env.JWT_SECRET;
const otpStore = new Map();

// ==========================================
// MIDDLEWARES
// ==========================================
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token provided' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { res.json({ success: false, message: 'Invalid session' }); }
};

const verifySuperAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'Super Admin') return res.json({ success: false, message: 'Access Denied.' });
        req.user = decoded; next();
    } catch (e) { res.json({ success: false, message: 'Invalid token' }); }
};

const verifyEditor = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!['Super Admin', 'Editor'].includes(decoded.role)) return res.json({ success: false, message: 'Access Denied.' });
        req.user = decoded; next();
    } catch (e) { res.json({ success: false, message: 'Invalid token' }); }
};

// ==========================================
// AUTH & ADMIN
// ==========================================
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const userCheck = await pool.query('SELECT * FROM timesheet_users WHERE username = $1 OR email = $2', [username, email]);
        if (userCheck.rows.length > 0) return res.json({ success: false, message: 'Username or Email exists.' });
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO timesheet_users (username, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5)', [username, email, hashedPassword, 'Viewer', 'Pending']);
        res.json({ success: true, message: 'Registration successful!' });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM timesheet_users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.json({ success: false, message: 'User not found.' });
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.json({ success: false, message: 'Invalid password.' });
        if (user.status !== 'Active') return res.json({ success: false, message: 'Account Pending.' });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '365d' });
        res.json({ success: true, token, user: { username: user.username, role: user.role, email: user.email } });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/forgot-password/request', async (req, res) => {
    try {
        const { email } = req.body;
        const userRes = await pool.query('SELECT username FROM timesheet_users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.json({ success: false, message: 'Email not found.' });
        const username = userRes.rows[0].username;
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(email, { otp: otp, expiry: Date.now() + 10 * 60 * 1000 });
        let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
        await transporter.sendMail({
            from: `"Timesheet System" <${process.env.EMAIL_USER}>`, to: email, subject: `Password Reset OTP`,
            html: `<div style="padding:20px;"><h2>Password Reset Request</h2><p>Hello ${username},</p><p>Your OTP is: <b style="font-size:24px; color:#0d6efd;">${otp}</b></p></div>`
        });
        res.json({ success: true, message: `OTP sent successfully.` });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/forgot-password/reset', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const storedData = otpStore.get(email);
        if (!storedData) return res.json({ success: false, message: 'No active OTP request found.' });
        if (Date.now() > storedData.expiry) { otpStore.delete(email); return res.json({ success: false, message: 'OTP expired.' }); }
        if (storedData.otp !== otp) return res.json({ success: false, message: 'Incorrect OTP.' });
        const hashedNew = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE timesheet_users SET password_hash = $1 WHERE email = $2", [hashedNew, email]);
        otpStore.delete(email);
        res.json({ success: true, message: 'Password reset successful!' });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.get('/admin/users', verifySuperAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, username, email, role, status, created_at FROM timesheet_users ORDER BY created_at DESC");
        res.json({ success: true, users: result.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/admin/update-user', verifySuperAdmin, async (req, res) => {
    try {
        const { userId, role, status } = req.body;
        await pool.query("UPDATE timesheet_users SET role = $1, status = $2 WHERE id = $3", [role, status, userId]);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.get('/read-erp-data', verifyToken, async (req, res) => {
    try {
        const headerResult = await pool.query('SELECT header_name FROM erp_headers ORDER BY col_order ASC');
        let headers = headerResult.rows.map(h => h.header_name);
        const dataResult = await pool.query('SELECT sn, plate_number, site, record_data FROM erp_records ORDER BY sn ASC');
        res.json({ success: true, headers: headers, records: dataResult.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

// ==========================================
// RULES
// ==========================================
router.get('/api/rules', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM timesheet_rules ORDER BY id ASC');
        res.json({ success: true, data: result.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/update-rule', verifySuperAdmin, async (req, res) => {
    try {
        const { id, site_keyword, deduct_under_11, deduct_over_12, default_deduct } = req.body;
        await pool.query('UPDATE timesheet_rules SET site_keyword=$1, deduct_under_11=$2, deduct_over_12=$3, default_deduct=$4 WHERE id=$5', [site_keyword, deduct_under_11, deduct_over_12, default_deduct, id]);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/add-rule', verifySuperAdmin, async (req, res) => {
    try {
        const { site_keyword, deduct_under_11, deduct_over_12, default_deduct } = req.body;
        await pool.query('INSERT INTO timesheet_rules (site_keyword, deduct_under_11, deduct_over_12, default_deduct) VALUES ($1, $2, $3, $4)', [site_keyword, deduct_under_11, deduct_over_12, default_deduct]);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

// ==========================================
// VEHICLE DRIVER & SITE LOGS
// ==========================================
router.get('/api/vehicle-info', async (req, res) => {
    try {
        const { plate } = req.query;
        let query = 'SELECT * FROM timesheet_vehicles';
        let params = [];
        if (plate) { query += ' WHERE plate_no ILIKE $1 LIMIT 1'; params = [`%${plate}%`]; }
        const result = await pool.query(query, params);
        res.json({ success: true, data: plate ? result.rows[0] : result.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.get('/api/vehicle-logs', async (req, res) => {
    try {
        const { plate } = req.query;
        const driverLogs = await pool.query(`
            SELECT * FROM vehicle_driver_log 
            WHERE plate_no=$1 
            ORDER BY 
                CASE WHEN status = 'Running' THEN 1 ELSE 2 END ASC,
                COALESCE(work_start_date, work_end_date, '1970-01-01') DESC,
                id DESC
        `, [plate]);

        const siteLogs = await pool.query(`
            SELECT * FROM vehicle_site_log 
            WHERE plate_no=$1 
            ORDER BY 
                CASE WHEN status = 'Running' THEN 1 ELSE 2 END ASC,
                COALESCE(work_start_date, work_end_date, '1970-01-01') DESC,
                id DESC
        `, [plate]);

        res.json({ success: true, drivers: driverLogs.rows, sites: siteLogs.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.get('/api/all-logs', async (req, res) => {
    try {
        const driverLogs = await pool.query(`
            SELECT id, plate_no, driver_name, driver_mobile, 
            TO_CHAR(work_start_date, 'YYYY-MM-DD') as start_date, 
            TO_CHAR(work_end_date, 'YYYY-MM-DD') as end_date, status 
            FROM vehicle_driver_log 
            ORDER BY plate_no ASC,
            CASE WHEN status = 'Running' THEN 1 ELSE 2 END ASC,
            COALESCE(work_start_date, work_end_date, '1970-01-01') DESC
        `);

        // 🟢 Fetching new columns: rate, old_vehicle_no, new_vehicle_no
        const siteColCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='vehicle_site_log' AND column_name='asset_code'");
        let siteLogs;

        if (siteColCheck.rows.length > 0) {
            siteLogs = await pool.query(`
                SELECT id, plate_no, site_name, asset_code, work_order_no, rate, old_vehicle_no, new_vehicle_no,
                TO_CHAR(work_start_date, 'YYYY-MM-DD') as start_date, 
                TO_CHAR(work_end_date, 'YYYY-MM-DD') as end_date, status, replaced_by 
                FROM vehicle_site_log 
                ORDER BY plate_no ASC,
                CASE WHEN status = 'Running' THEN 1 ELSE 2 END ASC,
                COALESCE(work_start_date, work_end_date, '1970-01-01') DESC
            `);
        } else {
            siteLogs = await pool.query(`
                SELECT id, plate_no, site_name, rate, old_vehicle_no, new_vehicle_no,
                TO_CHAR(work_start_date, 'YYYY-MM-DD') as start_date, 
                TO_CHAR(work_end_date, 'YYYY-MM-DD') as end_date, status, replaced_by 
                FROM vehicle_site_log 
                ORDER BY plate_no ASC,
                CASE WHEN status = 'Running' THEN 1 ELSE 2 END ASC,
                COALESCE(work_start_date, work_end_date, '1970-01-01') DESC
            `);
        }
        res.json({ success: true, drivers: driverLogs.rows, sites: siteLogs.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

// 🟢 Fast inline update for Driver & Site Logs from Main Table
router.post('/api/fast-update-log', verifyEditor, async (req, res) => {
    try {
        const { type, id, plate_no, field, value } = req.body;
        if (!id) return res.json({ success: false, message: 'Log ID missing. Please create a log first.' });

        let dateVal = value || null;

        if (type === 'driver') {
            if (field === 'end') {
                let status = dateVal ? 'Released' : 'Running';
                await pool.query('UPDATE vehicle_driver_log SET work_end_date=$1, status=$2 WHERE id=$3', [dateVal, status, id]);
                if (status === 'Running') {
                    const dLog = await pool.query('SELECT driver_name, driver_mobile FROM vehicle_driver_log WHERE id=$1', [id]);
                    if (dLog.rows.length > 0) {
                        await pool.query(`UPDATE timesheet_vehicles SET driver_name=$1, driver_mobile=$2 WHERE UPPER(plate_no)=UPPER($3)`, [dLog.rows[0].driver_name, dLog.rows[0].driver_mobile, plate_no]);
                    }
                }
            } else if (field === 'start') {
                await pool.query('UPDATE vehicle_driver_log SET work_start_date=$1 WHERE id=$2', [dateVal, id]);
            }
        } else if (type === 'site') {
            if (field === 'end') {
                let status = dateVal ? 'Released' : 'Running';
                await pool.query('UPDATE vehicle_site_log SET work_end_date=$1, status=$2 WHERE id=$3', [dateVal, status, id]);
                if (status === 'Running') {
                    const sLog = await pool.query('SELECT site_name FROM vehicle_site_log WHERE id=$1', [id]);
                    if (sLog.rows.length > 0) {
                        await pool.query(`UPDATE timesheet_vehicles SET site_name=$1 WHERE UPPER(plate_no)=UPPER($2)`, [sLog.rows[0].site_name, plate_no]);
                    }
                }
            } else if (field === 'start') {
                await pool.query('UPDATE vehicle_site_log SET work_start_date=$1 WHERE id=$2', [dateVal, id]);
            }
            // 🟢 Inline Updates for new fields
            else if (field === 'rate') {
                await pool.query('UPDATE vehicle_site_log SET rate=$1 WHERE id=$2', [dateVal, id]);
                let sLog = await pool.query('SELECT status FROM vehicle_site_log WHERE id=$1', [id]);
                if (sLog.rows[0].status === 'Running') await pool.query('UPDATE timesheet_vehicles SET rate=$1 WHERE UPPER(plate_no)=UPPER($2)', [dateVal, plate_no]);
            } else if (field === 'old_veh') {
                await pool.query('UPDATE vehicle_site_log SET old_vehicle_no=$1 WHERE id=$2', [dateVal, id]);
            } else if (field === 'new_veh') {
                await pool.query('UPDATE vehicle_site_log SET new_vehicle_no=$1 WHERE id=$2', [dateVal, id]);
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 🟢 Reverse Sync for Driver Updates
router.post('/api/update-driver-log', verifyEditor, async (req, res) => {
    try {
        const { id, plate_no, driver_name, driver_mobile, work_start_date, work_end_date } = req.body;
        const status = work_end_date ? 'Released' : 'Running';
        if (id) {
            await pool.query('UPDATE vehicle_driver_log SET driver_name=$1, driver_mobile=$2, work_start_date=$3, work_end_date=$4, status=$5 WHERE id=$6', [driver_name, driver_mobile, work_start_date || null, work_end_date || null, status, id]);
        } else {
            await pool.query('INSERT INTO vehicle_driver_log (plate_no, driver_name, driver_mobile, work_start_date, work_end_date, status) VALUES ($1, $2, $3, $4, $5, $6)', [plate_no, driver_name, driver_mobile, work_start_date || null, work_end_date || null, status]);
        }

        if (status === 'Running') {
            await pool.query(`UPDATE timesheet_vehicles SET driver_name=$1, driver_mobile=$2 WHERE UPPER(plate_no)=UPPER($3)`, [driver_name, driver_mobile, plate_no]);
        }
        res.json({ success: true, calculated_status: status });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

// 🟢 Reverse Sync for Site Updates
router.post('/api/update-site-log', verifyEditor, async (req, res) => {
    try {
        const { id, plate_no, site_name, work_start_date, work_end_date, status, replaced_by, asset_code, work_order_no, rate, old_vehicle_no, new_vehicle_no } = req.body;

        let updateCols = ['site_name=$1', 'work_start_date=$2', 'work_end_date=$3', 'status=$4', 'replaced_by=$5', 'rate=$6', 'old_vehicle_no=$7', 'new_vehicle_no=$8'];
        let updateVals = [site_name, work_start_date || null, work_end_date || null, status, replaced_by || null, rate || null, old_vehicle_no || null, new_vehicle_no || null];

        let insertCols = ['plate_no', 'site_name', 'work_start_date', 'work_end_date', 'status', 'replaced_by', 'rate', 'old_vehicle_no', 'new_vehicle_no'];
        let insertVals = [plate_no, site_name, work_start_date || null, work_end_date || null, status, replaced_by || null, rate || null, old_vehicle_no || null, new_vehicle_no || null];

        if (asset_code !== undefined) {
            updateCols.push(`asset_code=$${updateVals.length + 1}`);
            updateVals.push(asset_code || null);
            insertCols.push('asset_code');
            insertVals.push(asset_code || null);
        }
        if (work_order_no !== undefined) {
            updateCols.push(`work_order_no=$${updateVals.length + 1}`);
            updateVals.push(work_order_no || null);
            insertCols.push('work_order_no');
            insertVals.push(work_order_no || null);
        }

        if (id) {
            updateVals.push(id);
            await pool.query(`UPDATE vehicle_site_log SET ${updateCols.join(', ')} WHERE id=$${updateVals.length}`, updateVals);
        } else {
            let placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
            await pool.query(`INSERT INTO vehicle_site_log (${insertCols.join(', ')}) VALUES (${placeholders})`, insertVals);
        }

        if (status === 'Running') {
            let tsUpdates = ['site_name=$1', 'rate=$2'];
            let tsVals = [site_name, rate || null];

            if (asset_code !== undefined) {
                tsUpdates.push(`asset_code=$${tsVals.length + 1}`);
                tsVals.push(asset_code || null);
            }
            if (work_order_no !== undefined) {
                tsUpdates.push(`wrk_order_no=$${tsVals.length + 1}`);
                tsVals.push(work_order_no || null);
            }
            tsVals.push(plate_no);
            await pool.query(`UPDATE timesheet_vehicles SET ${tsUpdates.join(', ')} WHERE UPPER(plate_no)=UPPER($${tsVals.length})`, tsVals);
        }
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/delete-log-entry', verifyEditor, async (req, res) => {
    try {
        const { type, id } = req.body;
        if (!id) throw new Error("Log ID missing");

        if (type === 'driver') {
            await pool.query('DELETE FROM vehicle_driver_log WHERE id=$1', [id]);
        } else if (type === 'site') {
            await pool.query('DELETE FROM vehicle_site_log WHERE id=$1', [id]);
        } else {
            throw new Error("Invalid log type");
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ==========================================
// GRID DATA ENTRY & BULK IMPORT
// ==========================================
router.get('/api/grid-data', verifyToken, async (req, res) => {
    try {
        const { month, year, plate } = req.query;
        let query = 'SELECT * FROM timesheet_daily_records WHERE month=$1 AND year=$2';
        let params = [month, year];
        if (plate) { query += ' AND plate_no=$3'; params.push(plate); }
        const result = await pool.query(query, params);
        let sortedData = result.rows.sort((a, b) => {
            if (a.plate_no !== b.plate_no) return a.plate_no.localeCompare(b.plate_no);
            return parseInt(a.record_date || 0) - parseInt(b.record_date || 0);
        });
        res.json({ success: true, data: sortedData });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/upsert-grid-cell', verifyEditor, async (req, res) => {
    try {
        const { month, year, plate_no, record_date, col_name, col_value, calc_distance, calc_time } = req.body;

        const allowedCols = ['wrk_start', 'wrk_end', 'hmr_start', 'hmr_end', 'fuel', 'bd', 'remark', 'nl_checked'];
        if (!allowedCols.includes(col_name)) {
            return res.json({ success: false, message: 'Invalid column parameter' });
        }

        const query = `
            INSERT INTO timesheet_daily_records (month, year, plate_no, record_date, "${col_name}", calc_distance, calc_time) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) 
            ON CONFLICT (month, year, plate_no, record_date) 
            DO UPDATE SET 
                "${col_name}" = EXCLUDED."${col_name}", 
                calc_distance = EXCLUDED.calc_distance, 
                calc_time = EXCLUDED.calc_time, 
                updated_at = CURRENT_TIMESTAMP
        `;

        await pool.query(query, [month, year, plate_no, record_date, col_value, calc_distance, calc_time]);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

router.post('/api/bulk-import', verifyEditor, async (req, res) => {
    let client;
    try {
        const { records } = req.body;
        if (!records || !Array.isArray(records)) {
            return res.json({ success: false, message: "Invalid data format received." });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        for (let row of records) {
            await client.query(`
                INSERT INTO timesheet_daily_records 
                (month, year, plate_no, record_date, wrk_start, wrk_end, hmr_start, hmr_end, fuel, bd, remark, nl_checked, calc_distance, calc_time) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
                ON CONFLICT (month, year, plate_no, record_date) 
                DO UPDATE SET 
                    wrk_start = EXCLUDED.wrk_start, 
                    wrk_end = EXCLUDED.wrk_end, 
                    hmr_start = EXCLUDED.hmr_start, 
                    hmr_end = EXCLUDED.hmr_end, 
                    fuel = EXCLUDED.fuel, 
                    bd = EXCLUDED.bd, 
                    remark = EXCLUDED.remark, 
                    nl_checked = EXCLUDED.nl_checked, 
                    calc_distance = EXCLUDED.calc_distance, 
                    calc_time = EXCLUDED.calc_time, 
                    updated_at = CURRENT_TIMESTAMP
            `, [
                row.month, row.year, row.plate_no, row.record_date,
                row.wrk_start, row.wrk_end, row.hmr_start, row.hmr_end,
                row.fuel, row.bd, row.remark, row.nl_checked,
                row.calc_distance, row.calc_time
            ]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Successfully imported ${records.length} records.` });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        res.json({ success: false, message: error.message });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// MASTER DATABASE MANAGEMENT & AUTO-HEAL
// ==========================================
router.get('/api/db/columns', async (req, res) => {
    try {
        const result = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'timesheet_vehicles' AND column_name != 'plate_no' ORDER BY ordinal_position`);
        res.json({ success: true, columns: result.rows.map(r => r.column_name) });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.get('/api/db/data', async (req, res) => {
    try {
        // 🟢 AUTO-HEAL 0: ADD NEW COLUMNS SAFELY IF THEY DON'T EXIST
        await pool.query(`ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS rate VARCHAR(255)`);
        await pool.query(`ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS old_vehicle_no VARCHAR(255)`);
        await pool.query(`ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS new_vehicle_no VARCHAR(255)`);
        await pool.query(`ALTER TABLE timesheet_vehicles ADD COLUMN IF NOT EXISTS rate VARCHAR(255)`);
        await pool.query(`ALTER TABLE timesheet_vehicles ADD COLUMN IF NOT EXISTS vat VARCHAR(255)`);

        // 🟢 AUTO-HEAL 1: Sync missing Driver Logs & Update existing blanks
        await pool.query(`
            INSERT INTO vehicle_driver_log (plate_no, driver_name, driver_mobile, status)
            SELECT plate_no, driver_name, driver_mobile, 'Running'
            FROM timesheet_vehicles
            WHERE driver_name IS NOT NULL AND TRIM(driver_name) != ''
            AND NOT EXISTS (
                SELECT 1 FROM vehicle_driver_log 
                WHERE UPPER(vehicle_driver_log.plate_no) = UPPER(timesheet_vehicles.plate_no)
            );
        `);

        await pool.query(`
            UPDATE vehicle_driver_log vdl
            SET driver_mobile = tv.driver_mobile
            FROM timesheet_vehicles tv
            WHERE UPPER(vdl.plate_no) = UPPER(tv.plate_no)
            AND vdl.status = 'Running'
            AND (vdl.driver_mobile IS NULL OR TRIM(vdl.driver_mobile) = '')
            AND tv.driver_mobile IS NOT NULL AND TRIM(tv.driver_mobile) != '';
        `);

        // 🟢 AUTO-HEAL 2: Sync missing Site Logs
        await pool.query(`
            INSERT INTO vehicle_site_log (plate_no, site_name, rate, status)
            SELECT plate_no, site_name, rate, 'Running'
            FROM timesheet_vehicles
            WHERE site_name IS NOT NULL AND TRIM(site_name) != ''
            AND NOT EXISTS (
                SELECT 1 FROM vehicle_site_log 
                WHERE UPPER(vehicle_site_log.plate_no) = UPPER(timesheet_vehicles.plate_no)
            );
        `);

        const siteColCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='vehicle_site_log' AND column_name='asset_code'");
        if (siteColCheck.rows.length > 0) {
            await pool.query(`
                UPDATE vehicle_site_log vsl
                SET asset_code = CASE WHEN vsl.asset_code IS NULL OR TRIM(vsl.asset_code) = '' THEN tv.asset_code ELSE vsl.asset_code END,
                    work_order_no = CASE WHEN vsl.work_order_no IS NULL OR TRIM(vsl.work_order_no) = '' THEN tv.wrk_order_no ELSE vsl.work_order_no END,
                    rate = CASE WHEN vsl.rate IS NULL OR TRIM(vsl.rate) = '' THEN tv.rate ELSE vsl.rate END
                FROM timesheet_vehicles tv
                WHERE UPPER(vsl.plate_no) = UPPER(tv.plate_no)
                AND vsl.status = 'Running';
            `);
        } else {
            await pool.query(`
                UPDATE vehicle_site_log vsl
                SET rate = CASE WHEN vsl.rate IS NULL OR TRIM(vsl.rate) = '' THEN tv.rate ELSE vsl.rate END
                FROM timesheet_vehicles tv
                WHERE UPPER(vsl.plate_no) = UPPER(tv.plate_no)
                AND vsl.status = 'Running';
            `);
        }

        const result = await pool.query('SELECT * FROM timesheet_vehicles ORDER BY plate_no ASC');
        res.json({ success: true, data: result.rows });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/db/update-cell', verifyEditor, async (req, res) => {
    try {
        const { plate_no, col_name, value } = req.body;
        const cleanCol = col_name.replace(/[^a-zA-Z0-9_]/g, '');
        await pool.query(`UPDATE timesheet_vehicles SET "${cleanCol}" = $1 WHERE plate_no = $2`, [value, plate_no]);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/db/delete-row', verifyEditor, async (req, res) => {
    try {
        const { plate_no } = req.body;
        await pool.query(`DELETE FROM timesheet_vehicles WHERE plate_no = $1`, [plate_no]);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/db/add-row', verifyEditor, async (req, res) => {
    try {
        let { plate_no } = req.body;
        plate_no = plate_no.trim().toUpperCase();
        await pool.query(`INSERT INTO timesheet_vehicles (plate_no) VALUES ($1) ON CONFLICT DO NOTHING`, [plate_no]);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/db/add-column', verifySuperAdmin, async (req, res) => {
    try {
        const { col_name } = req.body;
        const cleanCol = col_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        await pool.query(`ALTER TABLE timesheet_vehicles ADD COLUMN "${cleanCol}" VARCHAR(255)`);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/db/rename-column', verifySuperAdmin, async (req, res) => {
    try {
        const { old_name, new_name } = req.body;
        const cleanOld = old_name.replace(/[^a-zA-Z0-9_]/g, '');
        const cleanNew = new_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        await pool.query(`ALTER TABLE timesheet_vehicles RENAME COLUMN "${cleanOld}" TO "${cleanNew}"`);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

router.post('/api/db/delete-column', verifySuperAdmin, async (req, res) => {
    try {
        const { col_name } = req.body;
        const cleanCol = col_name.replace(/[^a-zA-Z0-9_]/g, '');
        await pool.query(`ALTER TABLE timesheet_vehicles DROP COLUMN "${cleanCol}"`);
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: error.message }); }
});

// 🟢 BULK IMPORT FIX: Safeguard against Header mismatch & wiping DB
router.post('/api/db/bulk-import', verifyEditor, async (req, res) => {
    let client;
    try {
        const { records, driverLogs, siteLogs } = req.body;

        if (!records || !Array.isArray(records)) {
            return res.json({ success: false, message: "Invalid data format received." });
        }

        if (records.length === 0) {
            return res.json({ success: false, message: "The uploaded file is empty." });
        }

        client = await pool.connect();
        await client.query('BEGIN');
        const colRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'timesheet_vehicles'`);
        const validCols = colRes.rows.map(r => r.column_name);

        let excelPlates = [];

        for (let row of records) {
            let pNo = row["PLATE NO (Key)"] || row["Plate No (Key)"] || row["plate_no"] || row["Plate No"] || row["PLATE NO"];
            if (pNo) excelPlates.push(String(pNo).trim().toUpperCase());
        }

        // 🟢 SAFETY LOCK: Abort if plates were not extracted
        if (excelPlates.length === 0) {
            throw new Error("Could not find Plate No column in the uploaded file. Import aborted to prevent data loss.");
        }

        await client.query(`DELETE FROM vehicle_driver_log WHERE NOT (UPPER(plate_no) = ANY($1))`, [excelPlates]);
        await client.query(`DELETE FROM vehicle_site_log WHERE NOT (UPPER(plate_no) = ANY($1))`, [excelPlates]);
        await client.query(`DELETE FROM timesheet_vehicles WHERE NOT (UPPER(plate_no) = ANY($1))`, [excelPlates]);

        for (let row of records) {
            let pNo = row["PLATE NO (Key)"] || row["Plate No (Key)"] || row["plate_no"] || row["Plate No"] || row["PLATE NO"];
            if (!pNo) continue;

            pNo = String(pNo).trim().toUpperCase();
            let keys = ['plate_no']; let vals = [pNo]; let updates = [];

            let i = 2;
            for (let key of Object.keys(row)) {
                let cleanKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');

                if (key.toUpperCase() === 'VAT (YES/NO)' || key.toUpperCase() === 'VAT') cleanKey = 'vat';
                if (key.toUpperCase() === 'VEHICLE TYPE') cleanKey = 'vehicle_type';
                if (key.toUpperCase() === 'RATE') cleanKey = 'rate';

                if (cleanKey !== 'plate_no' && validCols.includes(cleanKey)) {
                    keys.push(`"${cleanKey}"`); vals.push(row[key]); updates.push(`"${cleanKey}" = EXCLUDED."${cleanKey}"`); i++;
                }
            }
            let placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
            let updateQuery = updates.length > 0 ? `ON CONFLICT (plate_no) DO UPDATE SET ${updates.join(', ')}` : `ON CONFLICT (plate_no) DO NOTHING`;
            await client.query(`INSERT INTO timesheet_vehicles (${keys.join(', ')}) VALUES (${placeholders}) ${updateQuery}`, vals);
        }

        if (driverLogs !== undefined) {
            if (excelPlates.length > 0) {
                await client.query(`DELETE FROM vehicle_driver_log WHERE UPPER(plate_no) = ANY($1)`, [excelPlates]);
            }
            for (let row of driverLogs) {
                let pNo = row["Plate No"] || row["plate_no"];
                if (!pNo) continue;
                let dName = row["Driver Name"] || row["driver_name"];
                let dMob = row["Mobile No"] || row["mobile"] || row["driver_mobile"];
                let st = row["Start Date"] || row["start_date"];
                let ed = row["End Date"] || row["end_date"];
                let status = row["Status"] || row["status"] || "Running";

                st = (st && st !== "-" && String(st).trim() !== "") ? st : null;
                ed = (ed && ed !== "-" && String(ed).trim() !== "") ? ed : null;

                await client.query(
                    `INSERT INTO vehicle_driver_log (plate_no, driver_name, driver_mobile, work_start_date, work_end_date, status) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [String(pNo).trim().toUpperCase(), dName, dMob, st, ed, status]
                );
            }
        }

        if (siteLogs !== undefined) {
            if (excelPlates.length > 0) {
                await client.query(`DELETE FROM vehicle_site_log WHERE UPPER(plate_no) = ANY($1)`, [excelPlates]);
            }
            for (let row of siteLogs) {
                let pNo = row["Plate No"] || row["plate_no"];
                if (!pNo) continue;
                let sName = row["Site Name"] || row["site_name"];
                let st = row["Start Date"] || row["start_date"];
                let ed = row["End Date"] || row["end_date"];
                let status = row["Status"] || row["status"] || "Running";
                let oldV = row["Old Vehicle No"] || row["old_vehicle_no"];
                let newV = row["New Vehicle No"] || row["new_vehicle_no"];
                let assetCode = row["Asset Code"] || row["asset_code"];
                let workOrder = row["WO No"] || row["Work Order No"] || row["work_order_no"];
                let rate = row["Rate"] || row["rate"];

                st = (st && st !== "-" && String(st).trim() !== "") ? st : null;
                ed = (ed && ed !== "-" && String(ed).trim() !== "") ? ed : null;

                await client.query(
                    `INSERT INTO vehicle_site_log (plate_no, site_name, work_start_date, work_end_date, status, old_vehicle_no, new_vehicle_no, asset_code, work_order_no, rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [String(pNo).trim().toUpperCase(), sName, st, ed, status, oldV || null, newV || null, assetCode || null, workOrder || null, rate || null]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        res.json({ success: false, message: error.message });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// PUBLIC REPORT VIEW
// ==========================================
router.post('/api/public/view-report', async (req, res) => {
    try {
        const { month, year, filterType, filterValue } = req.body;

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const mIdx = monthNames.indexOf(month);
        if (mIdx === -1) throw new Error("Invalid Month Selection");

        const padMonth = String(mIdx + 1).padStart(2, '0');
        const lastDay = new Date(year, mIdx + 1, 0).getDate();
        const targetStartStr = `${year}-${padMonth}-01`;
        const targetEndStr = `${year}-${padMonth}-${lastDay}`;

        let vQuery = `
            SELECT tv.* FROM timesheet_vehicles tv
            WHERE EXISTS (
                SELECT 1 FROM vehicle_site_log vsl
                WHERE vsl.plate_no = tv.plate_no
                AND (vsl.work_start_date IS NULL OR vsl.work_start_date <= $1)
                AND (vsl.work_end_date IS NULL OR vsl.work_end_date >= $2)
        `;

        let vParams = [targetEndStr, targetStartStr];
        let paramCount = 2;

        if (filterValue) {
            if (filterType === 'Plate No') {
                paramCount++;
                vQuery += ` AND tv.plate_no ILIKE $${paramCount}`;
                vParams.push(`%${filterValue}%`);
            } else if (filterType === 'Owner Name') {
                paramCount++;
                vQuery += ` AND tv.owner_name ILIKE $${paramCount}`;
                vParams.push(`%${filterValue}%`);
            } else if (filterType === 'Asset Code') {
                const colCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='timesheet_vehicles' AND column_name='asset_code'");
                if (colCheck.rows.length > 0) {
                    paramCount++;
                    vQuery += ` AND tv.asset_code ILIKE $${paramCount}`;
                    vParams.push(`%${filterValue}%`);
                }
            } else if (filterType === 'Site Name') {
                const sites = filterValue.split(',').map(s => s.trim()).filter(Boolean);
                paramCount++;
                vQuery += ` AND vsl.site_name = ANY($${paramCount})`;
                vParams.push(sites);
            } else if (filterType === 'Bulk Mode') {
                const plates = filterValue.split(/[\n,]+/).map(p => p.trim().toUpperCase()).filter(p => p);
                paramCount++;
                vQuery += ` AND UPPER(tv.plate_no) = ANY($${paramCount})`;
                vParams.push(plates);
            }
        }

        vQuery += ` ) ORDER BY tv.plate_no ASC`;

        const vehiclesResult = await pool.query(vQuery, vParams);
        let vehicles = vehiclesResult.rows;

        if (vehicles.length === 0) {
            return res.json({ success: true, vehicles: [], records: [], logs: { drivers: [], sites: [] } });
        }

        const plates = vehicles.map(v => v.plate_no);

        const recordsResult = await pool.query('SELECT * FROM timesheet_daily_records WHERE month=$1 AND year=$2 AND plate_no = ANY($3)', [month, year, plates]);
        const driverLogs = await pool.query('SELECT * FROM vehicle_driver_log WHERE plate_no = ANY($1)', [plates]);
        const siteLogs = await pool.query('SELECT * FROM vehicle_site_log WHERE plate_no = ANY($1)', [plates]);

        res.json({
            success: true,
            vehicles: vehicles,
            records: recordsResult.rows,
            logs: { drivers: driverLogs.rows, sites: siteLogs.rows }
        });

    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;