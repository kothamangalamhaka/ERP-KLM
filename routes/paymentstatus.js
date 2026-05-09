const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
});

// 🟢 Get existing invoice data (ഇപ്പോൾ ഒരു വണ്ടിക്ക് ഒന്നിലധികം സൈറ്റിലെ ഇൻവോയ്സുകൾ ഉണ്ടാകാം)
router.get('/get-invoice', async (req, res) => {
    try {
        const { plate_no, month } = req.query;
        // ഒരു മാസം ആ വണ്ടിക്കുള്ള മുഴുവൻ ഇൻവോയ്സുകളും എടുക്കുന്നു (Array ആയി)
        const result = await pool.query('SELECT * FROM invoice_records WHERE plate_no = $1 AND month = $2', [plate_no, month]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// 🟢 Save or Update Invoice Data (Single Entry - with Site Name)
router.post('/save-invoice', async (req, res) => {
    try {
        const { plate_no, month, site_name, invoice_no, bill_no, bill_nr, bill_ot, invoice_amount, edit_reason } = req.body;

        // Plate No, Month, Site Name എന്നിവ വെച്ച് ചെക്ക് ചെയ്യുന്നു
        const check = await pool.query('SELECT id FROM invoice_records WHERE plate_no = $1 AND month = $2 AND site_name = $3', [plate_no, month, site_name]);

        if (check.rows.length > 0) {
            await pool.query(
                'UPDATE invoice_records SET invoice_no=$1, bill_no=$2, bill_nr=$3, bill_ot=$4, invoice_amount=$5, edit_reason=$6, updated_at=CURRENT_TIMESTAMP WHERE plate_no=$7 AND month=$8 AND site_name=$9',
                [invoice_no, bill_no, bill_nr, bill_ot, invoice_amount, edit_reason, plate_no, month, site_name]
            );
        } else {
            await pool.query(
                'INSERT INTO invoice_records (plate_no, month, site_name, invoice_no, bill_no, bill_nr, bill_ot, invoice_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [plate_no, month, site_name, invoice_no, bill_no, bill_nr, bill_ot, invoice_amount]
            );
        }
        res.json({ success: true, message: 'Invoice Info Saved Successfully!' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// 🟢 NEW & UPGRADED: Import Invoices & Sync with Billing DB (Super Sync)
router.post('/import-invoices', async (req, res) => {
    let client;
    try {
        const { records } = req.body;

        if (!records || !Array.isArray(records)) {
            return res.json({ success: false, message: "Invalid data format received." });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        for (let row of records) {
            let month = row['Month'];
            let plate_no = String(row['Plate No'] || '').trim().toUpperCase().replace(/\s{2,}/g, ' ');
            let site_name = String(row['Site Name'] || 'N/A').trim();

            // 🟢 Invoice Details (Customer Side)
            let inv_nhr = parseFloat(row['Inv N.Hr']) || 0;
            let inv_ot = parseFloat(row['Inv OT']) || 0;
            let invoice_no = row['Invoice No'] || '';
            let invoice_amount = parseFloat(row['Invoice Amount']) || 0;
            let bill_no = row['Bill No'] || '';

            // 🟢 Billing Details (Vendor Side)
            let bill_nhr = parseFloat(row['Bill N.Hr']) || 0;
            let bill_othr = parseFloat(row['Bill OT']) || 0;
            let bill_nrate = parseFloat(row['NR Rate']) || 0;
            let bill_otrate = parseFloat(row['OT Rate']) || 0;

            let edit_reason = row['Edit Note'] || '';
            let accounts_note = row['Accounts Note'] || '';

            if (!month || !plate_no) continue;

            // ============================================
            // 1. UPDATE INVOICE RECORDS (For Report Page)
            // ============================================
            const checkInv = await client.query('SELECT id FROM invoice_records WHERE plate_no = $1 AND month = $2 AND site_name = $3', [plate_no, month, site_name]);

            if (checkInv.rows.length > 0) {
                await client.query(
                    'UPDATE invoice_records SET invoice_no=$1, bill_no=$2, bill_nr=$3, bill_ot=$4, invoice_amount=$5, edit_reason=$6, accounts_note=$7, updated_at=CURRENT_TIMESTAMP WHERE plate_no=$8 AND month=$9 AND site_name=$10',
                    [invoice_no, bill_no, inv_nhr, inv_ot, invoice_amount, edit_reason, accounts_note, plate_no, month, site_name]
                );
            } else {
                if (invoice_no || inv_nhr > 0 || bill_no) {
                    await client.query(
                        'INSERT INTO invoice_records (plate_no, month, site_name, invoice_no, bill_no, bill_nr, bill_ot, invoice_amount, edit_reason, accounts_note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                        [plate_no, month, site_name, invoice_no, bill_no, inv_nhr, inv_ot, invoice_amount, edit_reason, accounts_note]
                    );
                }
            }

            // ============================================
            // 2. UPDATE BILLING RECORDS (For Dashboard)
            // ============================================
            // Checking if the vehicle exists in Billing Dashboard for this month
            const checkBill = await client.query('SELECT * FROM billing_records WHERE billing_month = $1 AND plate_no = $2 AND site_name = $3', [month, plate_no, site_name]);

            if (checkBill.rows.length > 0) {
                let b = checkBill.rows[0];

                // Auto-Calculating Rent and Totals
                let rent = (bill_nhr * bill_nrate) + (bill_othr * bill_otrate);
                let vat_percent = parseFloat(b.vat_percent) || 0;
                let vat_amt = rent * (vat_percent / 100);
                let total = rent + vat_amt;
                let after_adj = total + parseFloat(b.adjusted_amount || 0);

                await client.query(
                    `UPDATE billing_records 
                     SET nhr=$1, nrate=$2, othr=$3, otrate=$4, rent=$5, vat_amount=$6, total=$7, after_adjustment=$8 
                     WHERE id=$9`,
                    [bill_nhr, bill_nrate, bill_othr, bill_otrate, rent, vat_amt, total, after_adj, b.id]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Successfully imported & synced data across all modules.` });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error("Excel Import Error:", err);
        res.json({ success: false, message: err.message });
    } finally {
        if (client) client.release();
    }
});

// 🟢 Fetch Master Report Data
router.get('/master-report-data', async (req, res) => {
    try {
        const { month, year } = req.query;
        const fullMonth = `${month} ${year}`;

        // 🟢 THE FIX: Added 'site_name' to the query! 
        // ഇതാണ് ഞാൻ ചെയ്യാൻ മറന്ന ആ വലിയ തെറ്റ്.
        const vehicles = await pool.query('SELECT plate_no, owner_name, site_name FROM timesheet_vehicles');

        const sites = await pool.query('SELECT plate_no, site_name, work_start_date, work_end_date FROM vehicle_site_log');
        const timesheets = await pool.query('SELECT plate_no, record_date, calc_time, bd FROM timesheet_daily_records WHERE month=$1 AND year=$2', [month, year]);
        const invoices = await pool.query('SELECT * FROM invoice_records WHERE month=$1', [fullMonth]);
        const billing = await pool.query('SELECT * FROM billing_records WHERE billing_month=$1', [fullMonth]);

        res.json({
            success: true,
            vehicles: vehicles.rows,
            sites: sites.rows,
            timesheets: timesheets.rows,
            invoices: invoices.rows,
            billing: billing.rows
        });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// 🟢 Save Accounts Note via Double Click (with Site Name)
router.post('/save-accounts-note', async (req, res) => {
    try {
        const { plate_no, month, site_name, accounts_note } = req.body;
        const check = await pool.query('SELECT id FROM invoice_records WHERE plate_no = $1 AND month = $2 AND site_name = $3', [plate_no, month, site_name]);

        if (check.rows.length > 0) {
            await pool.query('UPDATE invoice_records SET accounts_note=$1, updated_at=CURRENT_TIMESTAMP WHERE plate_no=$2 AND month=$3 AND site_name=$4', [accounts_note, plate_no, month, site_name]);
        } else {
            await pool.query('INSERT INTO invoice_records (plate_no, month, site_name, invoice_no, bill_nr, accounts_note) VALUES ($1, $2, $3, $4, $5, $6)', [plate_no, month, site_name, '', 0, accounts_note]);
        }
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

module.exports = router;