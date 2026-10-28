const express = require("express");
const router = express.Router();
const pool = require("../config/db");

// കമ്പനി നെയിം കൃത്യമായി മാപ്പ് ചെയ്യാനുള്ള ഹെൽപ്പർ
function normalizeCompanyName(rawSite) {
  if (!rawSite) return null;
  const s = rawSite.trim().toLowerCase();

  if (s.includes("haka")) return "Haka";
  if (s.includes("aljoda") || s.includes("al joda") || s.includes("joda")) return "Al Joda";
  if (s.includes("masar") || s.includes("wheel")) return "Masar Wheels";
  if (s.includes("we1") || s.includes("we 1") || s.includes("we-1")) return "We1";

  return null;
}

// സൈറ്റ് നെയിമിൽ നിന്ന് അനാവശ്യ വാക്കുകളും കമ്പനി നെയിമും ട്രിം ചെയ്യാനുള്ള ഹെൽപ്പർ
function cleanSiteName(rawSite) {
  if (!rawSite) return "";
  let clean = rawSite.toString().trim();

  // ഒഴിവാക്കേണ്ട പ്രത്യേക വാക്കുകൾ
  const unwantedPatterns = [
    /\bL\s*&\s*T\s+Solar\b/gi,
    /\bL\s*&\s*T\b/gi,
    /\bHydro\b/gi,
    /\brerunning\b/gi,
    /\b22\b/g,
    /\bZ\b/gi,
    /\bHaka\b/gi,
    /\bAl\s*Joda\b/gi,
    /\bAljoda\b/gi,
    /\bMasar\s*Wheels\b/gi,
    /\bMasar\b/gi,
    /\bWe\s*1\b/gi,
    /\bWe1\b/gi,
    /\bWe-1\b/gi
  ];

  unwantedPatterns.forEach(pattern => {
    clean = clean.replace(pattern, " ");
  });

  // ചിഹ്നങ്ങളും അധിക സ്പേസുകളും ക്ലീൻ ചെയ്യുന്നു
  clean = clean.replace(/[-–—_/\\,|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean;
}

// Year തിരിച്ചുള്ള മാസം തോറുമുള്ള Company മാപ്പിംഗ് API
router.get("/monthly-companies", async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();

  try {
    const siteLogsRes = await pool.query(
      `SELECT plate_no, site_name, work_start_date, work_end_date, status 
       FROM vehicle_site_log 
       ORDER BY COALESCE(work_start_date, '1970-01-01') ASC, id ASC`
    );

    const plateLogsRes = await pool.query(
      `SELECT old_plate_no, new_plate_no, change_date FROM vehicle_plate_log ORDER BY change_date ASC`
    );

    const logs = siteLogsRes.rows;
    const plateLogs = plateLogsRes.rows;

    // Response structure: { [plate_no]: { [month]: "Haka" | "Not Work" | "Haka & Al Joda" } }
    const companyMap = {};

    // 1 മുതൽ 12 വരെയുള്ള മാസങ്ങൾ പരിശോധിക്കുന്നു
    for (let m = 1; m <= 12; m++) {
      const monthStart = new Date(year, m - 1, 1);
      const monthEnd = new Date(year, m, 0); // Last day of month

      logs.forEach((log) => {
        const pNo = (log.plate_no || "").trim().toUpperCase();
        if (!pNo) return;

        if (!companyMap[pNo]) companyMap[pNo] = {};

        const logStart = log.work_start_date ? new Date(log.work_start_date) : null;
        const logEnd = log.work_end_date ? new Date(log.work_end_date) : null;

        // ആ മാസത്തിൽ സൈറ്റ് പ്രവർത്തിച്ചിട്ടുണ്ടോ എന്ന് പരിശോധിക്കുന്നു
        const isStarted = !logStart || logStart <= monthEnd;
        const isNotEnded = !logEnd || logEnd >= monthStart;

        if (isStarted && isNotEnded) {
          const matchedComp = normalizeCompanyName(log.site_name);
          const cleanedSite = cleanSiteName(log.site_name);
          if (matchedComp || cleanedSite) {
            if (!companyMap[pNo][m]) companyMap[pNo][m] = { comps: [], sites: [] };
            if (matchedComp && !companyMap[pNo][m].comps.includes(matchedComp)) {
              companyMap[pNo][m].comps.push(matchedComp);
            }
            if (cleanedSite && !companyMap[pNo][m].sites.includes(cleanedSite)) {
              companyMap[pNo][m].sites.push(cleanedSite);
            }
          }
        }
      });
    }

    // കമ്പനിയും സൈറ്റ് നെയിമും ഒരുമിച്ച് ഫോർമാറ്റ് ചെയ്യുന്നു
    const finalResult = {};
    for (const [pNo, months] of Object.entries(companyMap)) {
      finalResult[pNo] = {};
      for (let m = 1; m <= 12; m++) {
        const item = months[m];
        if (!item || item.comps.length === 0) {
          finalResult[pNo][m] = { company: "Not Work", site: "" };
        } else {
          finalResult[pNo][m] = {
            company: item.comps.join(" & "),
            site: item.sites.join(" & ")
          };
        }
      }
    }

    res.json({ success: true, companies: finalResult });
  } catch (err) {
    console.error("Company Identifier API Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;