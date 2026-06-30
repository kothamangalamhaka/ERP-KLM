const express = require("express");
const pool = require("../config/db");
const { verifyToken, verifyEditor } = require("../middlewares/auth");
const router = express.Router();

// Helper to determine company from site name
function getCompanyFromSite(siteName) {
    if (!siteName) return "Haka";
    const lowerSite = siteName.toLowerCase();
    if (lowerSite.includes("aljoda") || lowerSite.includes("al joda") || lowerSite.includes("al-joda")) return "Al Joda";
    if (lowerSite.includes("masar wheels")) return "Masar Wheels";
    if (lowerSite.includes("we1")) return "We1";
    return "Haka";
}

// GET DATA for VAT Tracking
router.get("/data", verifyToken, async (req, res) => {
    try {
        const { year } = req.query;
        if (!year) throw new Error("Year is required");
        const currentYear = parseInt(year);

        // 1. Fetch exact column names safely
        const colCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='timesheet_vehicles'");
        const dbCols = colCheck.rows.map(r => r.column_name.toLowerCase());

        // Dynamic column mapping (Case Insensitive & Space Insensitive)
        const getCol = (possibleNames) => {
            const normalizedDbCols = dbCols.map(c => c.replace(/[_ ]/g, '')); // Remove spaces and underscores
            for (let name of possibleNames) {
                const normName = name.replace(/[_ ]/g, '');
                const idx = normalizedDbCols.indexOf(normName);
                if (idx !== -1) return `"${dbCols[idx]}"`;
            }
            return "''"; // Return empty string alias if column not found
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
        const vehicles = vehicleResult.rows.filter(v => v.supplier && v.supplier.trim() !== "" && v.supplier.trim() !== "Unknown");
        
        if (vehicles.length === 0) return res.json({ success: true, data: [] });
        const plates = vehicles.map(v => v.plate_no);

        // 3. Fetch SITE LOGS history (Calculates exact active months)
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

        // 🟢 Fetch aggregated ERP totals from billing_records for the selected year
        const erpQuery = `
            SELECT owner, site_name, billing_month, SUM(after_adjustment) as erp_total 
            FROM billing_records 
            WHERE billing_month LIKE $1 
            GROUP BY owner, site_name, billing_month
        `;
        const erpResult = await pool.query(erpQuery, [`%${currentYear}`]);
        const erpData = erpResult.rows;
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        // 5. Process and Group Data
        const groupedData = {};

        // PRE-PROCESS: ഒരു സപ്ലെയറുടെ ഏതെങ്കിലും വണ്ടിയിൽ display name ഉണ്ടെങ്കിൽ അത് മുഴുവൻ വണ്ടികൾക്കും നൽകാൻ (മുൻപ് ചെയ്ത ഫിക്സ്)
        const supplierInfo = {};
        vehicles.forEach(v => {
            const sup = v.supplier.trim();
            if (!supplierInfo[sup]) {
                supplierInfo[sup] = { vat_no: v.vat_no || "", display_name: v.display_name || "" };
            } else {
                if (!supplierInfo[sup].vat_no && v.vat_no) supplierInfo[sup].vat_no = v.vat_no;
                if (!supplierInfo[sup].display_name && v.display_name) supplierInfo[sup].display_name = v.display_name;
            }
        });

        siteLogResult.rows.forEach(log => {
            const vehicle = vehicles.find(v => v.plate_no === log.plate_no);
            if (!vehicle) return;

            const company = getCompanyFromSite(log.site_name);
            const supplier = vehicle.supplier.trim();
            const site = log.site_name.trim();
            const groupKey = `${company}_${supplier}`;

            if (!groupedData[groupKey]) {
                groupedData[groupKey] = {
                    company: company,
                    supplier: supplier,
                    vat_no: supplierInfo[supplier].vat_no, // Use pre-processed complete data
                    display_name: supplierInfo[supplier].display_name, // Use pre-processed complete data
                    sites: {}
                };
            }

            if (!groupedData[groupKey].sites[site]) {
                groupedData[groupKey].sites[site] = {
                    site_name: site,
                    active_months: Array(12).fill(false), // Check active months
                    billing: {}
                };
            }

            // Month calculation based on Start & End Date
            let sd = log.work_start_date ? new Date(log.work_start_date) : new Date(2000, 0, 1);
            let ed = log.work_end_date ? new Date(log.work_end_date) : (log.status === 'Running' ? new Date(2100, 11, 31) : new Date(sd));

            for (let m = 0; m < 12; m++) {
                let mStart = new Date(currentYear, m, 1);
                let mEnd = new Date(currentYear, m + 1, 0); 
                
                // Active if the site dates overlap with this month
                if (sd <= mEnd && ed >= mStart) {
                    groupedData[groupKey].sites[site].active_months[m] = true;
                }
            }
        });

        // Convert object to array and attach billing
        Object.values(groupedData).forEach(group => {
            // Keep only sites that were active for at least one month in the selected year
            group.sites = Object.values(group.sites).filter(s => s.active_months.includes(true)); 
            
            group.sites.forEach(siteObj => {
                for (let i = 0; i < 12; i++) {
                    const bill = billingData.find(b => b.company === group.company && b.supplier === group.supplier && b.site_name === siteObj.site_name && b.month_index === i);
                    
                    // 🟢 Match ERP Total based on Site, Supplier(Owner), and Month
                    const monthString = `${monthNames[i]} ${currentYear}`;
                    const erpRecord = erpData.find(e => 
                        (e.site_name || "").trim() === siteObj.site_name && 
                        (e.owner || "").trim() === group.supplier && 
                        e.billing_month === monthString
                    );
                    const erpTotal = erpRecord ? erpRecord.erp_total : "";

                    siteObj.billing[i] = bill 
                        ? { bill_no: bill.bill_no, bill_date: bill.bill_date, amount: bill.amount, erp_total: erpTotal } 
                        : { bill_no: "", bill_date: "", amount: "", erp_total: erpTotal };
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

// UPSERT Billing Cell
router.post("/update-cell", verifyEditor, async (req, res) => {
    try {
        const { year, company, supplier, vat_no, display_name, site_name, month_index, field, value } = req.body;
        const validFields = ["bill_no", "bill_date", "amount"];
        if (!validFields.includes(field)) throw new Error("Invalid field update");

        const valToSave = value.trim() === "" ? null : value.trim();

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
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;