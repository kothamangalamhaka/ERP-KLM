const express = require("express");
const pool = require("../config/db");
const router = express.Router();

const verifyAccessCode = (req, res, next) => {
  const clientCode = req.headers["x-vat-code"];
  const serverCode = process.env.VAT_TRACKER_CODE;

  if (!serverCode) {
    return res.status(500).json({
      success: false,
      message: "Server configuration error: VAT_TRACKER_CODE not set",
    });
  }

  if (clientCode === serverCode) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Invalid Access Code" });
  }
};

// 🟢 അനുവദനീയമായ സൈറ്റുകളുടെ മാസ്റ്റർ ലിസ്റ്റ് (Afif, Bisha, Humaij, Khushaibi, Taif)
const KNOWN_SITES = [
  "afif",
  "bisha",
  "humaij",
  "khushaibi",
  "taif"
];

function getSiteFirstName(siteName) {
  if (!siteName) return "";
  const clean = siteName.trim().toLowerCase();

  // 🟢 ലിസ്റ്റിലുള്ള സൈറ്റ് പേര് എവിടെയുണ്ടെങ്കിലും (Z-Prefix, Case വ്യത്യാസങ്ങൾ ഉൾപ്പെടെ) കൃത്യമായി കണ്ടെത്തുന്നു
  for (const site of KNOWN_SITES) {
    if (clean.includes(site)) {
      return site;
    }
  }

  let noZ = clean.replace(/^z[\s\-_]+/i, "").trim();
  let firstWord = noZ.split(/\s+/)[0] || "";
  return firstWord.replace(/[^a-zA-Z0-9]/g, "");
}

function isZSite(siteName) {
  if (!siteName) return true;
  const clean = siteName.trim().toLowerCase();

  // നമ്മുടെ ലിസ്റ്റിലുള്ള പ്രധാന സൈറ്റുകൾ (Bisha, Khushaibi, etc.) ഉണ്ടെങ്കിൽ Z ആണെങ്കിലും തള്ളിക്കളയില്ല
  for (const site of KNOWN_SITES) {
    if (clean.includes(site)) return false;
  }

  return /^z(\s*[-_]?\s*(site|dummy|closed|na|none|$))/i.test(clean);
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
    if (vehicleResult.rows.length === 0)
      return res.json({ success: true, data: [] });

    const vehicles = vehicleResult.rows;
    const plates = vehicles.map((v) => v.plate_no);

    let ownerLogs = [];
    try {
      const ownerLogRes = await pool.query(
        `
                SELECT plate_no, owner_name, vat, work_start_date, work_end_date 
                FROM vehicle_owner_log 
                WHERE plate_no = ANY($1) 
                ORDER BY COALESCE(work_start_date, '2000-01-01') ASC
            `,
        [plates],
      );
      ownerLogs = ownerLogRes.rows;
    } catch (e) {
      console.warn("vehicle_owner_log query warning:", e.message);
    }

    const getMonthOwnerInfo = (plateNo, mIdx, fallbackOwner, fallbackVat) => {
      const mStart = new Date(currentYear, mIdx, 1);
      const mEnd = new Date(currentYear, mIdx + 1, 0);

      const matchedLogs = ownerLogs.filter((l) => {
        if (
          (l.plate_no || "").trim().toUpperCase() !==
          plateNo.trim().toUpperCase()
        )
          return false;
        const sDate = l.work_start_date
          ? new Date(l.work_start_date)
          : new Date(2000, 0, 1);
        const eDate = l.work_end_date
          ? new Date(l.work_end_date)
          : new Date(2099, 11, 31);
        return sDate <= mEnd && eDate >= mStart;
      });

      if (matchedLogs.length > 0) {
        const active = matchedLogs[matchedLogs.length - 1];
        return {
          owner:
            active.owner_name && active.owner_name.trim()
              ? active.owner_name.trim()
              : fallbackOwner,
          vat: String(active.vat || "")
            .trim()
            .toLowerCase(),
        };
      }

      return {
        owner: fallbackOwner,
        vat: String(fallbackVat || "")
          .trim()
          .toLowerCase(),
      };
    };

    const siteLogResult = await pool.query(
      `
            SELECT plate_no, site_name, work_start_date, work_end_date, status 
            FROM vehicle_site_log 
            WHERE plate_no = ANY($1) AND site_name IS NOT NULL AND TRIM(site_name) != ''
        `,
      [plates],
    );

    const billingResult = await pool.query(
      `
            SELECT supplier, site_name, month_index, quick_dice 
            FROM vat_billing_records 
            WHERE year = $1 AND company = 'NON_VAT'
        `,
      [currentYear],
    );
    const billingData = billingResult.rows;

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const shortYear = currentYear.toString().slice(-2);

    // 🟢 billing_records-ൽ നിന്ന് rent, total, after_adjustment കോളങ്ങളിൽ ഉള്ള തുക സുരക്ഷിതമായി എടുക്കുന്നു
    const erpResult = await pool.query(
      `
            SELECT 
                LOWER(REGEXP_REPLACE(TRIM(COALESCE(owner, '')), '[^a-zA-Z0-9]', '', 'g')) as clean_owner,
                LOWER(TRIM(COALESCE(owner, ''))) as norm_owner,
                LOWER(TRIM(COALESCE(site_name, ''))) as clean_site_name,
                LOWER(TRIM(COALESCE(billing_month, ''))) as raw_billing_month,
                ROUND(COALESCE(
                    NULLIF(after_adjustment::numeric, 0), 
                    NULLIF(rent::numeric, 0), 
                    NULLIF(total::numeric, 0), 
                    0
                ), 2) as row_total
            FROM billing_records
            WHERE billing_month ILIKE $1 OR billing_month ILIKE $2
        `,
      [`%${currentYear}%`, `%${shortYear}%`],
    );
    const erpData = erpResult.rows;

    const suppliersMap = {};

    siteLogResult.rows.forEach((log) => {
      if (isZSite(log.site_name)) return;

      const vehicle = vehicles.find(
        (v) =>
          (v.plate_no || "").trim().toUpperCase() ===
          (log.plate_no || "").trim().toUpperCase(),
      );
      if (!vehicle) return;

      const defaultOwner = (vehicle.owner_name || "").trim();
      const defaultVat = vehicle.vat;

      let sd = log.work_start_date
        ? new Date(log.work_start_date)
        : new Date(2000, 0, 1);
      let ed = log.work_end_date
        ? new Date(log.work_end_date)
        : log.status === "Running"
          ? new Date(2099, 11, 31)
          : new Date(sd);

      for (let m = 0; m < 12; m++) {
        let mStart = new Date(currentYear, m, 1);
        let mEnd = new Date(currentYear, m + 1, 0);

        if (sd <= mEnd && ed >= mStart) {
          const ownerInfo = getMonthOwnerInfo(
            log.plate_no,
            m,
            defaultOwner,
            defaultVat,
          );

          // 🟢 VAT 'Yes', 'True', '15' ഒഴികെയുള്ള എല്ലാ VAT 'No', Blank, NULL റെക്കോർഡുകളും എടുക്കുന്നു
          const isVat = ["yes", "true", "15"].includes(ownerInfo.vat);
          if (isVat) continue;

          const supName = ownerInfo.owner;
          if (
            !supName ||
            supName === "Unknown" ||
            supName === "COMPANY VEHICLE"
          )
            continue;

          const siteFirst = getSiteFirstName(log.site_name);
          if (!siteFirst) continue;

          if (!suppliersMap[supName]) {
            suppliersMap[supName] = {
              supplier: supName,
              sites: {},
            };
          }

          if (!suppliersMap[supName].sites[siteFirst]) {
            suppliersMap[supName].sites[siteFirst] = {
              site_first_name: siteFirst,
              active_months: Array(12).fill(false),
              billing: {},
            };
            for (let i = 0; i < 12; i++) {
              suppliersMap[supName].sites[siteFirst].billing[i] = {
                vendor_ts: 0,
                quick_dice: "",
              };
            }
          }

          suppliersMap[supName].sites[siteFirst].active_months[m] = true;
        }
      }
    });

    Object.values(suppliersMap).forEach((sup) => {
      const normSup = sup.supplier.toLowerCase().trim();

      Object.values(sup.sites).forEach((siteObj) => {
        const sFirst = siteObj.site_first_name.toLowerCase();

        for (let m = 0; m < 12; m++) {
          const shortM = monthNames[m].substring(0, 3).toLowerCase();
          const fullM = monthNames[m].toLowerCase();

          let monthTsTotal = 0;
          const cleanSup = normSup.replace(/[^a-zA-Z0-9]/g, "");

          erpData.forEach((e) => {
            const bMonth = (e.raw_billing_month || "").trim().toLowerCase();

            // 🟢 മാസം ഒത്തുനോക്കൽ: bMonth-ൽ shortM (feb, mar, apr) അടങ്ങിയിട്ടുണ്ടോ എന്ന് പരിശോധിക്കുന്നു
            const isMonthMatch =
              bMonth.includes(shortM) || bMonth.includes(fullM);

            // 🟢 സൈറ്റ് ഒത്തുനോക്കൽ (getSiteFirstName വഴി കൃത്യമായി സൈറ്റ് കണ്ടെത്തുന്നു)
            const eSiteFirst = getSiteFirstName(e.clean_site_name);
            const isSiteMatch = (eSiteFirst === sFirst) || e.clean_site_name.includes(sFirst);

            if (isMonthMatch && isSiteMatch && !isZSite(e.clean_site_name)) {
              // 🟢 പേര് പൂർണ്ണമായി കൃത്യമാണെങ്കിൽ മാത്രം (Strict Exact Match - സബ്സ്ട്രിംഗ് ഒഴിവാക്കി)
              const isOwnerMatch = (e.norm_owner === normSup) || (e.clean_owner === cleanSup);

              if (isOwnerMatch) {
                monthTsTotal += parseFloat(e.row_total || 0);
              }
            }
          });

          const savedBill = billingData.find(
            (b) =>
              b.supplier.toLowerCase().trim() === normSup &&
              (b.site_name || "").toLowerCase().trim() === sFirst &&
              b.month_index === m,
          );

          siteObj.billing[m] = {
            vendor_ts: Number(monthTsTotal.toFixed(2)),
            quick_dice: savedBill ? savedBill.quick_dice || "" : "",
          };

          if (monthTsTotal > 0) siteObj.active_months[m] = true;
        }
      });

      sup.sites = Object.values(sup.sites).filter((s) =>
        s.active_months.includes(true),
      );
    });

    const finalArray = Object.values(suppliersMap)
      .filter((s) => s.sites.length > 0)
      .sort((a, b) => a.supplier.localeCompare(b.supplier));

    res.json({ success: true, data: finalArray });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// 2. Breakdown Route for Popup (Matches accurately like /data route)
router.get("/vendor-breakdown", verifyAccessCode, async (req, res) => {
  try {
    const { supplier, site_first, year, month } = req.query;
    if (!supplier || !site_first || !year || !month) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required query params" });
    }

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const mIdx = parseInt(month) - 1;
    const mName = monthNames[mIdx];
    const shortM = mName.substring(0, 3);
    const shortY = year.toString().slice(-2);

    const normSup = supplier.trim().toLowerCase();
    const cleanSup = normSup.replace(/[^a-zA-Z0-9]/g, "");
    const targetSiteFirst = getSiteFirstName(site_first).toLowerCase();

    const query = `
            SELECT 
                COALESCE(NULLIF(TRIM(plate_no), ''), 'N/A') AS plate_no,
                LOWER(TRIM(COALESCE(owner, ''))) AS norm_owner,
                LOWER(REGEXP_REPLACE(TRIM(COALESCE(owner, '')), '[^a-zA-Z0-9]', '', 'g')) AS clean_owner,
                TRIM(COALESCE(billing_month, '')) AS billing_month,
                site_name,
                COALESCE(nhr::numeric, 0) AS nhr,
                COALESCE(othr::numeric, 0) AS othr,
                ROUND(COALESCE(
                    NULLIF(after_adjustment::numeric, 0), 
                    NULLIF(rent::numeric, 0), 
                    NULLIF(total::numeric, 0), 
                    0
                ), 2) AS after_adjustment
            FROM billing_records
            WHERE billing_month ILIKE $1 OR billing_month ILIKE $2
        `;

    const result = await pool.query(query, [
      `%${shortM}%${year}%`,
      `%${shortM}%${shortY}%`,
    ]);

    const plateGroups = {};

    result.rows.forEach((row) => {
      if (isZSite(row.site_name)) return;

      const rowSiteClean = (row.site_name || "").trim().toLowerCase();
      const rowSiteFirst = getSiteFirstName(row.site_name);
      const siteMatched = (rowSiteFirst === targetSiteFirst) || rowSiteClean.includes(targetSiteFirst);

      if (!siteMatched) return;

      // 🟢 പേര് പൂർണ്ണമായി കൃത്യമാണെങ്കിൽ മാത്രം (Strict Exact Match - സബ്സ്ട്രിംഗ് ഒഴിവാക്കി)
      const isOwnerMatch = (row.norm_owner === normSup) || (row.clean_owner === cleanSup);

      if (isOwnerMatch) {
        const p = row.plate_no;
        if (!plateGroups[p]) {
          plateGroups[p] = {
            plate_no: p,
            nr_hours: 0,
            ot_hours: 0,
            total_amount: 0,
          };
        }
        plateGroups[p].nr_hours += parseFloat(row.nhr || 0);
        plateGroups[p].ot_hours += parseFloat(row.othr || 0);
        plateGroups[p].total_amount += parseFloat(row.after_adjustment || 0);
      }
    });

    const finalRows = Object.values(plateGroups)
      .map((p) => ({
        plate_no: p.plate_no,
        nr_hours: Number(p.nr_hours.toFixed(2)),
        ot_hours: Number(p.ot_hours.toFixed(2)),
        total_amount: Number(p.total_amount.toFixed(2)),
      }))
      .sort((a, b) => a.plate_no.localeCompare(b.plate_no));

    res.json({ success: true, data: finalRows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Keep track of connected SSE clients for Non-VAT live sync
let sseNonVatClients = [];

// SSE Connection Endpoint
router.get("/live-updates", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseNonVatClients.push(newClient);

  req.on("close", () => {
    sseNonVatClients = sseNonVatClients.filter((c) => c.id !== clientId);
  });
});

// Broadcast changes to all connected users
function broadcastNonVatUpdate(payload) {
  sseNonVatClients.forEach((c) => {
    c.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
}

// 3. UPSERT Quick Dice for Non-VAT per Site
router.post("/update-cell", verifyAccessCode, async (req, res) => {
  try {
    const { year, supplier, site_first_name, month_index, value } = req.body;
    if (!year || !supplier || !site_first_name || month_index === undefined)
      throw new Error("Missing parameters");

    let valToSave =
      value === null || value === undefined || String(value).trim() === ""
        ? null
        : String(value).trim();

    const query = `
            INSERT INTO vat_billing_records (year, company, supplier, site_name, month_index, quick_dice)
            VALUES ($1, 'NON_VAT', $2, $3, $4, $5)
            ON CONFLICT (year, company, supplier, site_name, month_index)
            DO UPDATE SET 
                quick_dice = EXCLUDED.quick_dice,
                updated_at = CURRENT_TIMESTAMP
        `;

    await pool.query(query, [
      parseInt(year),
      supplier,
      site_first_name.trim().toLowerCase(),
      parseInt(month_index),
      valToSave,
    ]);

    // 🟢 Broadcast live update to other users
    broadcastNonVatUpdate({
      year: parseInt(year),
      supplier: supplier,
      site_first_name: site_first_name.trim().toLowerCase(),
      month_index: parseInt(month_index),
      value: valToSave || "",
    });

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;
