const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const ExcelJS = require('exceljs');
const jwt = require('jsonwebtoken');



const JWT_SECRET = process.env.JWT_SECRET;

const verifyBillingEditor = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided. Access Denied.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const allowedRoles = ['Super Admin', 'Admin', 'Site Coordinator'];

        if (!allowedRoles.includes(decoded.role)) {
            return res.status(403).json({ success: false, message: 'Access Denied: Viewers cannot access billing.' });
        }
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
};

router.get('/dashboard', (req, res) => {
    res.sendFile('Billing/Vendor_bill_summary_Dashboard.html', { root: './public' });
});

router.use(verifyBillingEditor);

router.get('/verify-session', (req, res) => {
    res.status(200).json({ success: true, message: "Session is valid" });
});

// 1. Fetch Vehicle Data (100% FROM TIMESHEET DB NOW)
router.get('/vehicles', async (req, res) => {
    try {
        const { month } = req.query;

        // Fetch Timesheet DB (The New Foundation)
        const tsVehiclesResult = await pool.query('SELECT * FROM timesheet_vehicles');
        const driverLogs = await pool.query('SELECT plate_no, driver_name, work_start_date, work_end_date FROM vehicle_driver_log');
        const siteLogs = await pool.query('SELECT plate_no, site_name, rate, work_start_date, work_end_date FROM vehicle_site_log');

        let savedResult = { rows: [] };
        let targetStart, targetEnd;

        if (month && month !== 'All') {
            const savedQuery = `SELECT * FROM billing_records WHERE billing_month = $1`;
            savedResult = await pool.query(savedQuery, [month]);

            const [mName, yStr] = month.trim().split(' ');
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const mIdx = monthNames.indexOf(mName);

            if (mIdx !== -1 && yStr) {
                targetStart = new Date(parseInt(yStr), mIdx, 1);
                targetEnd = new Date(parseInt(yStr), mIdx + 1, 0);
            }
        }

        let validVehicles = [];
        let processedPlates = new Set();

        // Loop through Timesheet DB
        tsVehiclesResult.rows.forEach(tsItem => {
            let plate = (tsItem.plate_no || "").toUpperCase().trim();
            if (!plate || processedPlates.has(plate)) return;
            processedPlates.add(plate);

            let correctDriver = "";
            let activeSites = [];
            let activeSiteRate = 0;

            if (targetStart && targetEnd) {
                // Determine accurate driver from logs
                let dLogs = driverLogs.rows.filter(l => (l.plate_no || "").toUpperCase() === plate);
                let validDLogs = dLogs.filter(l => {
                    let st = l.work_start_date ? new Date(l.work_start_date) : new Date('2000-01-01');
                    let ed = l.work_end_date ? new Date(l.work_end_date) : new Date('2099-01-01');
                    return st <= targetEnd && ed >= targetStart;
                });

                if (validDLogs.length > 0) {
                    validDLogs.sort((a, b) => new Date(a.work_start_date || '2000-01-01') - new Date(b.work_start_date || '2000-01-01'));
                    let driverNames = validDLogs.map(l => l.driver_name).filter(Boolean);
                    correctDriver = [...new Set(driverNames)].join(" / ");
                }

                // Determine accurate site and RATE from logs
                let sLogs = siteLogs.rows.filter(l => (l.plate_no || "").toUpperCase() === plate);
                let validSLogs = sLogs.filter(l => {
                    let st = l.work_start_date ? new Date(l.work_start_date) : new Date('2000-01-01');
                    let ed = l.work_end_date ? new Date(l.work_end_date) : new Date('2099-01-01');
                    return st <= targetEnd && ed >= targetStart;
                });

                if (validSLogs.length > 0) {
                    validSLogs.sort((a, b) => new Date(a.work_start_date || '2000-01-01') - new Date(b.work_start_date || '2000-01-01'));
                    activeSites = [...new Set(validSLogs.map(s => s.site_name).filter(Boolean))];

                    // Take rate from the most recent valid site log
                    let latestLog = validSLogs[validSLogs.length - 1];
                    activeSiteRate = parseFloat(latestLog.rate) || 0;
                }
            }

            // Fallback to primary Timesheet DB Data if no log exists for the month
            if (activeSites.length === 0) {
                let defaultSite = (tsItem.site_name || "N/A").trim();
                activeSites = [defaultSite];
            }
            if (activeSiteRate === 0) {
                activeSiteRate = parseFloat(tsItem.rate) || 0;
            }

            // Fallback driver
            if (!correctDriver) {
                correctDriver = (tsItem.driver_name || "").trim();
            }

            // Safe extraction of Dynamic Columns from Timesheet DB
            let vtype = tsItem.vehicle_type || tsItem.vtype || tsItem['vehicle type'] || "";
            let vatRaw = String(tsItem.vat || tsItem.vat_bill || tsItem['vat (yes/no)'] || "No").trim().toLowerCase();
            let isVatBill = (vatRaw === 'yes' || vatRaw === 'true' || vatRaw === '15' || vatRaw === '15%') ? "Yes" : "No";
            let ownerName = (tsItem.owner_name || tsItem.owner || "").trim();

            validVehicles.push({
                plate_number: plate,
                vehicle_type: vtype,
                rate: activeSiteRate,
                nrate: activeSiteRate / 260,
                otrate: (activeSiteRate / 260) * 0.7,
                owner: ownerName,
                site: activeSites[0],
                active_sites: activeSites,
                driver_name: correctDriver,
                vat_bill: isVatBill
            });
        });

        res.status(200).json({ success: true, data: validVehicles, saved_bills: savedResult.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Save Billing Data
router.post('/save', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { billing_period, items } = req.body;

        for (let row of items) {
            await client.query(`DELETE FROM billing_records WHERE billing_month = $1 AND plate_no = $2 AND site_name = $3`, [billing_period, row.plate, row.site_name]);

            const query = `INSERT INTO billing_records 
                (billing_month, date, company, owner, site_name, db_rate, vtype, driver, plate_no, nhr, nrate, othr, otrate, rent, vat_percent, vat_amount, total, adjustment_desc, adjusted_amount, after_adjustment) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`;

            await client.query(query, [
                billing_period, row.date, row.company, row.owner, row.site_name, row.db_rate, row.vtype, row.driver, row.plate,
                row.nhr, row.nrate, row.othr, row.otrate, row.rent, row.vat_percent, row.vat_amount, row.total,
                row.adjustment_desc, row.adjusted_amount, row.after_adjustment
            ]);
        }
        await client.query('COMMIT');
        res.status(200).json({ success: true, message: "Saved successfully" });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
});

// 3. Fetch Dashboard Data
router.get('/dashboard-data', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM billing_records ORDER BY TO_DATE(billing_month, 'Month YYYY') DESC, id ASC`);

        const tsRes = await pool.query('SELECT plate_no, site_name, owner_name FROM timesheet_vehicles');
        let tsMap = {};
        tsRes.rows.forEach(r => {
            if (r.plate_no) tsMap[r.plate_no.toUpperCase()] = r;
        });

        // Ensure legacy blanks are overridden by Timesheet DB
        result.rows.forEach(row => {
            let pNo = (row.plate_no || "").toUpperCase();
            if (tsMap[pNo]) {
                if (!row.site_name || row.site_name === "-" || row.site_name === "N/A") row.site_name = tsMap[pNo].site_name;
                if (!row.owner || row.owner === "-" || row.owner === "") row.owner = tsMap[pNo].owner_name;
            }
        });

        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. Export Excel
router.get('/export-excel', async (req, res) => {
    try {
        const { month } = req.query;
        let query = `SELECT * FROM billing_records ORDER BY TO_DATE(billing_month, 'Month YYYY') DESC, id ASC`;
        let params = [];

        if (month && month !== 'All') {
            query = `SELECT * FROM billing_records WHERE billing_month = $1 ORDER BY id ASC`;
            params = [month];
        }

        const result = await pool.query(query, params);

        const tsRes = await pool.query('SELECT plate_no, site_name, owner_name FROM timesheet_vehicles');
        let tsMap = {};
        tsRes.rows.forEach(r => {
            if (r.plate_no) tsMap[r.plate_no.toUpperCase()] = r;
        });

        result.rows.forEach(row => {
            let pNo = (row.plate_no || "").toUpperCase();
            let tSite = tsMap[pNo];
            if (tSite) {
                if (!row.site_name || row.site_name === "-" || row.site_name === "N/A") row.site_name = tSite.site_name;
                if (!row.owner || row.owner === "-" || row.owner === "") row.owner = tSite.owner_name;
            }
        });

        const workbook = new ExcelJS.Workbook();
        let sheetName = (month === 'All' || !month) ? 'All_Months' : month;
        sheetName = sheetName.substring(0, 31);
        const worksheet = workbook.addWorksheet(sheetName);

        worksheet.columns = [
            { header: 'Month', key: 'billing_month', width: 15 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Owner', key: 'owner', width: 25 },
            { header: 'Site', key: 'site_name', width: 25 },
            { header: 'Vehicle Type', key: 'vtype', width: 20 },
            { header: 'Driver', key: 'driver', width: 20 },
            { header: 'Plate No', key: 'plate_no', width: 15 },
            { header: 'N.Hr', key: 'nhr', width: 10 },
            { header: 'N.Rate', key: 'nrate', width: 10 },
            { header: 'OT Hr', key: 'othr', width: 10 },
            { header: 'OT Rate', key: 'otrate', width: 10 },
            { header: 'Rent', key: 'rent', width: 15 },
            { header: 'VAT %', key: 'vat_percent', width: 10 },
            { header: 'VAT Amt', key: 'vat_amount', width: 15 },
            { header: 'Adjustment', key: 'adjustment_desc', width: 25 },
            { header: 'Adj. Amt', key: 'adjusted_amount', width: 15 },
            { header: 'Grand Total', key: 'after_adjustment', width: 15 }
        ];

        result.rows.forEach(row => { worksheet.addRow(row); });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Billing_${sheetName.replace(/ /g, '_')}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).send("Error generating Excel: " + error.message);
    }
});

module.exports = router;