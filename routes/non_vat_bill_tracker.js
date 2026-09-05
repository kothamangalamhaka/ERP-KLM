const express = require("express");
const pool = require("../config/db");
const router = express.Router();

const verifyAccessCode = (req, res, next) => {
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

function isZSite(siteName) {
    if (!siteName) return true;
    const clean = siteName.trim();
    return /^z[\s\-_]*/i.test(clean);
}

function getSiteFirstName(siteName) {
    if (!siteName) return "";
    let cleaned = siteName.trim().replace(/^z[\s\-_]+/i, '').trim();
    return cleaned.split(/[\s\-_]+/)[0] || "";
}

router.get("/data", verifyAccessCode, async (req, res) => {
    try {
        const { year } = req.query;
        if (!year) throw new Error("Year is required");
        const currentYear = parseInt(year);

        const vehicleResult = await pool.query(`
            SELECT plate_no, owner_name, vat 
            FROM timesheet_vehicles
        `);
        if (vehicleResult.rows.length === 0) return res.json({ success: true, data: [] });

        const vehicles = vehicleResult.rows;
        const plates = vehicles.map(v => v.plate_no);

        let ownerLogs = [];
        try {
            const ownerLogRes = await pool.query(`
                SELECT plate_no, owner_name, vat, work_start_date, work_end_date 
                FROM vehicle_owner_log 
                WHERE plate_no = ANY($1) 
                ORDER BY COALESCE(work_start_date, '2000-01-01') ASC
            `, [plates]);
            ownerLogs = ownerLogRes.rows;
        } catch (e) {
            console.warn("vehicle_owner_log query warning:", e.message);
        }

        const getMonthOwnerInfo = (plateNo, mIdx, fallbackOwner, fallbackVat) => {
            const mStart = new Date(currentYear, mIdx, 1);
            const mEnd = new Date(currentYear, mIdx + 1, 0);

            const matchedLogs = ownerLogs.filter(l => {
                if ((l.plate_no || "").trim().toUpperCase() !== plateNo.trim().toUpperCase()) return false;
                const sDate = l.work_start_date ? new Date(l.work_start_date) : new Date(2000, 0, 1);
                const eDate = l.work_end_date ? new Date(l.work_end_date) : new Date(2099, 11, 31);
                return sDate <= mEnd && eDate >= mStart;
            });

            if (matchedLogs.length > 0) {
                const active = matchedLogs[matchedLogs.length - 1];
                return {
                    owner: (active.owner_name && active.owner_name.trim()) ? active.owner_name.trim() : fallbackOwner,
                    vat: String(active.vat || "").trim().toLowerCase()
                };
            }

            return {
                owner: fallbackOwner,
                vat: String(fallbackVat || "").trim().toLowerCase()
            };
        };

        const siteLogResult = await pool.query(`
            SELECT plate_no, site_name, work_start_date, work_end_date, status 
            FROM vehicle_site_log 
            WHERE plate_no = ANY($1) AND site_name IS NOT NULL AND TRIM(site_name) != ''
        `, [plates]);

        const billingResult = await pool.query(`
            SELECT supplier, site_name, month_index, quick_dice 
            FROM vat_billing_records 
            WHERE year = $1 AND company = 'NON_VAT'
        `, [currentYear]);
        const billingData = billingResult.rows;

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        // 🟢 billing_records ടേബിളിൽ ഉള്ള യഥാർത്ഥ കോളമായ after_adjustment മാത്രം സുരക്ഷിതമായി ഉപയോഗിക്കുന്നു
        const erpResult = await pool.query(`
            SELECT 
                LOWER(REGEXP_REPLACE(TRIM(COALESCE(owner, '')), '[^a-zA-Z0-9]', '', 'g')) as clean_owner,
                LOWER(TRIM(COALESCE(owner, ''))) as norm_owner,
                billing_month, 
                site_name,
                ROUND(SUM(COALESCE(after_adjustment::numeric, 0)), 2) as erp_total 
            FROM billing_records 
            WHERE billing_month LIKE $1 
            GROUP BY clean_owner, norm_owner, billing_month, site_name
        `, [`%${currentYear}`]);
        const erpData = erpResult.rows;

        const suppliersMap = {};

        siteLogResult.rows.forEach(log => {
            if (isZSite(log.site_name)) return;

            const vehicle = vehicles.find(v => (v.plate_no || "").trim().toUpperCase() === (log.plate_no || "").trim().toUpperCase());
            if (!vehicle) return;

            const defaultOwner = (vehicle.owner_name || "").trim();
            const defaultVat = vehicle.vat;

            let sd = log.work_start_date ? new Date(log.work_start_date) : new Date(2000, 0, 1);
            let ed = log.work_end_date ? new Date(log.work_end_date) : (log.status === 'Running' ? new Date(2099, 11, 31) : new Date(sd));

            for (let m = 0; m < 12; m++) {
                let mStart = new Date(currentYear, m, 1);
                let mEnd = new Date(currentYear, m + 1, 0);

                if (sd <= mEnd && ed >= mStart) {
                    const ownerInfo = getMonthOwnerInfo(log.plate_no, m, defaultOwner, defaultVat);
                    
                    // 🟢 VAT 'Yes', 'True', '15' ഒഴികെയുള്ള എല്ലാ VAT 'No', Blank, NULL റെക്കോർഡുകളും എടുക്കുന്നു
                    const isVat = ['yes', 'true', '15'].includes(ownerInfo.vat);
                    if (isVat) continue;

                    const supName = ownerInfo.owner;
                    if (!supName || supName === "Unknown" || supName === "COMPANY VEHICLE") continue;

                    const siteFirst = getSiteFirstName(log.site_name);
                    if (!siteFirst) continue;

                    if (!suppliersMap[supName]) {
                        suppliersMap[supName] = {
                            supplier: supName,
                            sites: {}
                        };
                    }

                    if (!suppliersMap[supName].sites[siteFirst]) {
                        suppliersMap[supName].sites[siteFirst] = {
                            site_first_name: siteFirst,
                            active_months: Array(12).fill(false),
                            billing: {}
                        };
                        for (let i = 0; i < 12; i++) {
                            suppliersMap[supName].sites[siteFirst].billing[i] = {
                                vendor_ts: 0,
                                quick_dice: ""
                            };
                        }
                    }

                    suppliersMap[supName].sites[siteFirst].active_months[m] = true;
                }
            }
        });

        Object.values(suppliersMap).forEach(sup => {
            const normSup = sup.supplier.toLowerCase().trim();

            Object.values(sup.sites).forEach(siteObj => {
                const sFirst = siteObj.site_first_name.toLowerCase();

                for (let m = 0; m < 12; m++) {
                    const monthStr = `${monthNames[m]} ${currentYear}`;

                    let monthTsTotal = 0;
                    const cleanSup = normSup.replace(/[^a-zA-Z0-9]/g, '');

                    erpData.forEach(e => {
                        const eSiteFirst = getSiteFirstName(e.site_name).toLowerCase();
                        
                        // സൈറ്റ് ഒത്തുനോക്കുന്നു
                        const siteMatched = (eSiteFirst === sFirst) || 
                                            (sFirst.includes(eSiteFirst) && eSiteFirst.length > 2) || 
                                            (eSiteFirst.includes(sFirst) && sFirst.length > 2);

                        if (e.billing_month === monthStr && siteMatched && !isZSite(e.site_name)) {
                            // 🟢 പേര് കൃത്യമായി ഒത്തുനോക്കൽ (ബ്രാക്കറ്റുകൾ, സ്പെല്ലിംഗ് വ്യത്യാസങ്ങൾ ഉൾപ്പെടെ)
                            const isOwnerMatch = (e.norm_owner === normSup) ||
                                                 (e.clean_owner === cleanSup) ||
                                                 (cleanSup.includes(e.clean_owner) && e.clean_owner.length > 3) ||
                                                 (e.clean_owner.includes(cleanSup) && cleanSup.length > 3);

                            if (isOwnerMatch) {
                                monthTsTotal += parseFloat(e.erp_total || 0);
                            }
                        }
                    });

                    const savedBill = billingData.find(b => 
                        b.supplier.toLowerCase().trim() === normSup && 
                        (b.site_name || "").toLowerCase().trim() === sFirst && 
                        b.month_index === m
                    );
                    
                    siteObj.billing[m] = {
                        vendor_ts: Number(monthTsTotal.toFixed(2)),
                        quick_dice: savedBill ? (savedBill.quick_dice || "") : ""
                    };

                    if (monthTsTotal > 0) siteObj.active_months[m] = true;
                }
            });

            sup.sites = Object.values(sup.sites).filter(s => s.active_months.includes(true));
        });

        const finalArray = Object.values(suppliersMap)
            .filter(s => s.sites.length > 0)
            .sort((a, b) => a.supplier.localeCompare(b.supplier));

        res.json({ success: true, data: finalArray });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 2. Breakdown Route for Popup
router.get("/vendor-breakdown", verifyAccessCode, async (req, res) => {
    try {
        const { supplier, site_first, year, month } = req.query;
        if (!supplier || !site_first || !year || !month) {
            return res.status(400).json({ success: false, message: "Missing required query params" });
        }

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const mIdx = parseInt(month) - 1;
        const monthString = `${monthNames[mIdx]} ${year}`;

        const query = `
            SELECT 
                COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A') AS plate_no,
                ROUND(COALESCE(SUM(nhr::numeric), 0), 2) AS nr_hours,
                ROUND(COALESCE(SUM(othr::numeric), 0), 2) AS ot_hours,
                ROUND(COALESCE(SUM(after_adjustment::numeric), 0), 2) AS total_amount
            FROM billing_records
            WHERE LOWER(TRIM(owner)) = LOWER(TRIM($1))
              AND billing_month = $2
              AND LOWER(REGEXP_REPLACE(site_name, '^z[\\s\\-_]*', '', 'i')) LIKE LOWER($3)
            GROUP BY COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A')
            ORDER BY plate_no ASC;
        `;
        
        const result = await pool.query(query, [supplier, monthString, `${site_first.trim().toLowerCase()}%`]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. UPSERT Quick Dice for Non-VAT per Site
router.post("/update-cell", verifyAccessCode, async (req, res) => {
    try {
        const { year, supplier, site_first_name, month_index, value } = req.body;
        if (!year || !supplier || !site_first_name || month_index === undefined) throw new Error("Missing parameters");

        let valToSave = (value === null || value === undefined || String(value).trim() === "") ? null : String(value).trim();

        const query = `
            INSERT INTO vat_billing_records (year, company, supplier, site_name, month_index, quick_dice)
            VALUES ($1, 'NON_VAT', $2, $3, $4, $5)
            ON CONFLICT (year, company, supplier, site_name, month_index)
            DO UPDATE SET 
                quick_dice = EXCLUDED.quick_dice,
                updated_at = CURRENT_TIMESTAMP
        `;

        await pool.query(query, [parseInt(year), supplier, site_first_name.trim().toLowerCase(), parseInt(month_index), valToSave]);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;