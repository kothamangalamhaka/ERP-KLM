const express = require("express");
const pool = require("../config/db");
const router = express.Router();

// Custom Middleware to verify VAT code from .env
const verifyVatCode = (req, res, next) => {
    const clientCode = req.headers['x-vat-code'];
    const serverCode = process.env.VAT_TRACKER_CODE;
    
    if (!serverCode) {
        return res.status(500).json({ success: false, message: "Server configuration error: VAT_TRACKER_CODE not set" });
    }
    
    if (clientCode === serverCode) {
        next();
    } else {
        res.status(401).json({ success: false, message: "Invalid Access Code" });
    }
};

// Helper to determine company from site name
function getCompanyFromSite(siteName) {
    if (!siteName) return "Haka";
    const lowerSite = siteName.toLowerCase();
    if (lowerSite.includes("aljoda") || lowerSite.includes("al joda") || lowerSite.includes("al-joda")) return "Al Joda";
    if (lowerSite.includes("masar wheels")) return "Masar Wheels";
    if (lowerSite.includes("we1")) return "We1";
    return "Haka";
}

// GET DATA for VAT Tracking (With vehicle_owner_log mapping)
router.get("/data", verifyVatCode, async (req, res) => {
    try {
        const { year } = req.query;
        if (!year) throw new Error("Year is required");
        const currentYear = parseInt(year);

        // 1. Fetch exact column names safely
        const colCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='timesheet_vehicles'");
        const dbCols = colCheck.rows.map(r => r.column_name.toLowerCase());

        // Dynamic column mapping
        const getCol = (possibleNames) => {
            const normalizedDbCols = dbCols.map(c => c.replace(/[_ ]/g, ''));
            for (let name of possibleNames) {
                const normName = name.replace(/[_ ]/g, '');
                const idx = normalizedDbCols.indexOf(normName);
                if (idx !== -1) return `"${dbCols[idx]}"`;
            }
            return "''";
        };

        let displayCol = getCol(['company_display_name', 'display_name', 'company display name']);
        let vatNoCol = getCol(['vat_no', 'vat no']);
        let ownerCol = getCol(['owner_name', 'owner name']);

        // 2. Fetch unique vehicles where VAT is Yes
        const vehicleQuery = `
            SELECT plate_no, ${ownerCol} as supplier, ${vatNoCol} as vat_no, ${displayCol} as display_name 
            FROM timesheet_vehicles 
            WHERE LOWER(TRIM(vat)) IN ('yes', 'true', '15')
        `;
        const vehicleResult = await pool.query(vehicleQuery);
        if (vehicleResult.rows.length === 0) return res.json({ success: true, data: [] });

        const vehicles = vehicleResult.rows;
        const plates = vehicles.map(v => v.plate_no);

        // 2.1 Fetch Owner Logs to handle vehicles sold / transferred across owners
        const ownerLogQuery = `
            SELECT plate_no, owner_name, start_date, end_date 
            FROM vehicle_owner_log 
            WHERE plate_no = ANY($1) 
            ORDER BY start_date ASC
        `;
        let ownerLogs = [];
        try {
            const ownerLogRes = await pool.query(ownerLogQuery, [plates]);
            ownerLogs = ownerLogRes.rows;
        } catch (e) {
            console.warn("vehicle_owner_log check skipped or table missing:", e.message);
        }

        // Helper to determine accurate owner for a specific month
        const getOwnerForMonth = (plateNo, mIdx, fallbackOwner) => {
            const mStart = new Date(currentYear, mIdx, 1);
            const mEnd = new Date(currentYear, mIdx + 1, 0);

            const matched = ownerLogs.find(l => {
                if (l.plate_no !== plateNo) return false;
                const sDate = l.start_date ? new Date(l.start_date) : new Date(2000, 0, 1);
                const eDate = l.end_date ? new Date(l.end_date) : new Date(2100, 11, 31);
                return sDate <= mEnd && eDate >= mStart;
            });

            return (matched && matched.owner_name && matched.owner_name.trim()) 
                ? matched.owner_name.trim() 
                : fallbackOwner;
        };

        // 3. Fetch SITE LOGS history (Calculates active months)
        const siteLogQuery = `
            SELECT plate_no, site_name, work_start_date, work_end_date, status 
            FROM vehicle_site_log 
            WHERE plate_no = ANY($1) 
            AND site_name IS NOT NULL AND TRIM(site_name) != ''
        `;
        const siteLogResult = await pool.query(siteLogQuery, [plates]);

        // 4. Fetch billing records & ERP Totals
        const billingQuery = `SELECT * FROM vat_billing_records WHERE year = $1`;
        const billingResult = await pool.query(billingQuery, [currentYear]);
        const billingData = billingResult.rows;

const erpQuery = `
            SELECT 
                LOWER(REPLACE(TRIM(COALESCE(company, '')), ' ', '')) as norm_company,
                LOWER(TRIM(owner)) as norm_owner, 
                LOWER(TRIM(site_name)) as norm_site, 
                billing_month, 
                ROUND(SUM(COALESCE(after_adjustment::numeric, 0)), 2) as erp_total 
            FROM billing_records 
            WHERE billing_month LIKE $1  
            GROUP BY LOWER(REPLACE(TRIM(COALESCE(company, '')), ' ', '')), LOWER(TRIM(owner)), LOWER(TRIM(site_name)), billing_month
        `;
        const erpResult = await pool.query(erpQuery, [`%${currentYear}`]);
        const erpData = erpResult.rows;

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        // 5. Pre-process supplier master metadata (Vat No & Display Name)
        const supplierInfo = {};
        vehicles.forEach(v => {
            const sup = (v.supplier || "").trim();
            if (!sup) return;
            if (!supplierInfo[sup]) {
                supplierInfo[sup] = { vat_no: v.vat_no || "", display_name: v.display_name || "" };
            } else {
                if (!supplierInfo[sup].vat_no && v.vat_no) supplierInfo[sup].vat_no = v.vat_no;
                if (!supplierInfo[sup].display_name && v.display_name) supplierInfo[sup].display_name = v.display_name;
            }
        });

        // 6. Process and Group Data using Month-wise Accurate Owner
        const groupedData = {};

        siteLogResult.rows.forEach(log => {
            const vehicle = vehicles.find(v => v.plate_no === log.plate_no);
            if (!vehicle) return;

            const defaultOwner = (vehicle.supplier || "").trim();
            const company = getCompanyFromSite(log.site_name);
            const site = log.site_name.trim();

            let sd = log.work_start_date ? new Date(log.work_start_date) : new Date(2000, 0, 1);
            let ed = log.work_end_date ? new Date(log.work_end_date) : (log.status === 'Running' ? new Date(2100, 11, 31) : new Date(sd));

            for (let m = 0; m < 12; m++) {
                let mStart = new Date(currentYear, m, 1);
                let mEnd = new Date(currentYear, m + 1, 0);

                if (sd <= mEnd && ed >= mStart) {
                    const actualSupplier = getOwnerForMonth(log.plate_no, m, defaultOwner);
                    if (!actualSupplier || actualSupplier === "Unknown") continue;

                    const groupKey = `${company}_${actualSupplier}`;

                    if (!groupedData[groupKey]) {
                        const meta = supplierInfo[actualSupplier] || supplierInfo[defaultOwner] || { vat_no: "", display_name: "" };
                        groupedData[groupKey] = {
                            company: company,
                            supplier: actualSupplier,
                            vat_no: meta.vat_no || vehicle.vat_no || "",
                            display_name: meta.display_name || vehicle.display_name || "",
                            sites: {}
                        };
                    }

                    if (!groupedData[groupKey].sites[site]) {
                        groupedData[groupKey].sites[site] = {
                            site_name: site,
                            active_months: Array(12).fill(false),
                            billing: {}
                        };
                    }

                    groupedData[groupKey].sites[site].active_months[m] = true;
                }
            }
        });

        // 7. Convert object to array and attach billing & ERP Totals
        Object.values(groupedData).forEach(group => {
            group.sites = Object.values(group.sites).filter(s => s.active_months.includes(true));

            group.sites.forEach(siteObj => {
                for (let i = 0; i < 12; i++) {
                    const bill = billingData.find(b => 
                        b.company === group.company && 
                        b.supplier === group.supplier && 
                        b.site_name === siteObj.site_name && 
                        b.month_index === i
                    );

                    const monthString = `${monthNames[i]} ${currentYear}`;
                    const normSite = siteObj.site_name.trim().toLowerCase();
                    const normSupplier = group.supplier.trim().toLowerCase();
                    const normComp = group.company.replace(/\s+/g, '').trim().toLowerCase();

                    // 🟢 1. ആദ്യ പരിശോധന: കമ്പനി + ഓണർ + സൈറ്റ് + മാസം എന്നിവ കൃത്യമായി ഒത്തുനോക്കുന്നു
                    let erpRecord = erpData.find(e => 
                        e.norm_site === normSite && 
                        e.norm_owner === normSupplier && 
                        (e.norm_company === normComp || e.norm_company === "") &&
                        e.billing_month === monthString
                    );

                    // 🟢 2. കമ്പനി സ്പെല്ലിംഗ് മാറിയിട്ടുണ്ടെങ്കിൽ: ഓണർ + സൈറ്റ് + മാസം വെച്ച് ബാക്കപ്പ് ലുക്കപ്പ്
                    if (!erpRecord) {
                        erpRecord = erpData.find(e => 
                            e.norm_site === normSite && 
                            e.norm_owner === normSupplier && 
                            e.billing_month === monthString
                        );
                    }

                    const erpTotal = erpRecord ? erpRecord.erp_total : "";

                    siteObj.billing[i] = bill 
                        ? { 
                            bill_no: bill.bill_no, 
                            status: bill.status, 
                            amount: bill.amount, 
                            erp_total: erpTotal, 
                            qc_checked: bill.qc_checked === true || bill.qc_checked === 'true' 
                          } 
                        : { bill_no: "", status: "", amount: "", erp_total: erpTotal, qc_checked: false };
                }
            });
        });

        const finalArray = Object.values(groupedData)
            .filter(g => g.sites.length > 0)
            .sort((a, b) => a.company.localeCompare(b.company) || a.supplier.localeCompare(b.supplier));

        res.json({ success: true, data: finalArray });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});


// UPSERT Single Billing Cell
router.post("/update-cell", verifyVatCode, async (req, res) => {
    try {
        const { year, company, supplier, vat_no, display_name, site_name, month_index, field, value } = req.body;
        
        // Changed validFields to accept 'status' instead of 'bill_date'
        const validFields = ["bill_no", "status", "amount", "qc_checked"];
        if (!validFields.includes(field)) throw new Error("Invalid field update");

        let valToSave = (value === null || value === undefined || String(value).trim() === "") ? null : String(value).trim();

        const query = `
            INSERT INTO vat_billing_records (year, company, supplier, vat_no, display_name, site_name, month_index, ${field})
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (year, company, supplier, site_name, month_index) 
            DO UPDATE SET 
                ${field} = EXCLUDED.${field},
                vat_no = EXCLUDED.vat_no,
                display_name = EXCLUDED.display_name,
                updated_at = CURRENT_TIMESTAMP
        `;

        await pool.query(query, [year, company, supplier, vat_no, display_name, site_name, month_index, valToSave]);
        
        // Broadcast QC check toggle to all other connected clients
        if (field === "qc_checked") {
            broadcastQcUpdate({
                year: parseInt(year),
                supplier,
                site_name,
                month_index: parseInt(month_index),
                qc_checked: (valToSave === "true" || valToSave === true)
            });
        }

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});


// NEW API FOR BULK SAVE
router.post("/update-bulk", verifyVatCode, async (req, res) => {
    try {
        const { changes } = req.body;
        if (!changes || !Array.isArray(changes)) throw new Error("Invalid payload");

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (let change of changes) {
                const { year, company, supplier, vat_no, display_name, site_name, month_index, field, value } = change;
                
                // Changed validFields to accept 'status' instead of 'bill_date'
                const validFields = ["bill_no", "status", "amount"];
                if (!validFields.includes(field)) continue;

                let valToSave = (value === null || value === undefined || String(value).trim() === "") ? null : String(value).trim();

                const query = `
                    INSERT INTO vat_billing_records (year, company, supplier, vat_no, display_name, site_name, month_index, ${field})
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (year, company, supplier, site_name, month_index) 
                    DO UPDATE SET 
                        ${field} = EXCLUDED.${field},
                        vat_no = EXCLUDED.vat_no,
                        display_name = EXCLUDED.display_name,
                        updated_at = CURRENT_TIMESTAMP
                `;
                await client.query(query, [year, company, supplier, vat_no, display_name, site_name, month_index, valToSave]);
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// Vendor TS breakdown - using exact billing_records columns (nhr, othr, plate_no)
router.get("/vendor-breakdown", verifyVatCode, async (req, res) => {
    try {
        const { supplier, site, year, month } = req.query;
        if (!supplier || !site || !year || !month) {
            return res.status(400).json({ success: false, message: "Missing required query params" });
        }

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const mIdx = parseInt(month) - 1;
        const monthString = `${monthNames[mIdx]} ${year}`;

        // Exact match with billing_records using plate_no, nhr, othr, after_adjustment
        const query = `
            SELECT 
                COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A') AS plate_no,
                ROUND(COALESCE(SUM(nhr::numeric), 0), 2) AS nr_hours,
                ROUND(COALESCE(SUM(othr::numeric), 0), 2) AS ot_hours,
                ROUND(COALESCE(SUM(after_adjustment::numeric), 0), 2) AS total_amount
            FROM billing_records
            WHERE LOWER(TRIM(owner)) = LOWER(TRIM($1))
              AND LOWER(TRIM(site_name)) = LOWER(TRIM($2))
              AND billing_month = $3
            GROUP BY COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A')
            ORDER BY plate_no ASC;
        `;
        
        let result = await pool.query(query, [supplier, site, monthString]);
        let rows = result.rows;

        // Fallback for slight differences in site name spacing
        if (rows.length === 0) {
            const fallbackQuery = `
                SELECT 
                    COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A') AS plate_no,
                    ROUND(COALESCE(SUM(nhr::numeric), 0), 2) AS nr_hours,
                    ROUND(COALESCE(SUM(othr::numeric), 0), 2) AS ot_hours,
                    ROUND(COALESCE(SUM(after_adjustment::numeric), 0), 2) AS total_amount
                FROM billing_records
                WHERE LOWER(TRIM(owner)) = LOWER(TRIM($1))
                  AND LOWER(REGEXP_REPLACE(site_name, '[\\s\\-_]', '', 'g')) = LOWER(REGEXP_REPLACE($2, '[\\s\\-_]', '', 'g'))
                  AND billing_month = $3
                GROUP BY COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A')
                ORDER BY plate_no ASC;
            `;
            const fbResult = await pool.query(fallbackQuery, [supplier, site, monthString]);
            rows = fbResult.rows;
        }

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error("Error in vendor-breakdown:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Keep track of connected clients for live sync
let sseClients = [];

// SSE Connection Endpoint
router.get("/live-updates", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); 
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);

    req.on("close", () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
    });
});

// Helper function to broadcast updates to other users
function broadcastQcUpdate(payload) {
    sseClients.forEach(c => {
        c.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });
}

module.exports = router;