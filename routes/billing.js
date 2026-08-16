const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const JWT_SECRET = process.env.JWT_SECRET;

const verifyBillingEditor = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res
      .status(401)
      .json({ success: false, message: "No token provided. Access Denied." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const allowedRoles = ["Super Admin", "Admin", "User"];

    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Viewers cannot access billing.",
      });
    }
    req.user = decoded;
    next();
  } catch (e) {
    res
      .status(401)
      .json({ success: false, message: "Invalid or expired session" });
  }
};

router.get("/dashboard", (req, res) => {
  res.sendFile("Billing/Vendor_bill_summary_Dashboard.html", {
    root: "./public",
  });
});

router.use(verifyBillingEditor);

router.get("/verify-session", (req, res) => {
  res.status(200).json({ success: true, message: "Session is valid" });
});

// 1. Fetch Vehicle Data (100% FIXED: RELEASED VEHICLES & MULTIPLE SITES LOGIC)
router.get("/vehicles", async (req, res) => {
  try {
    const { month } = req.query;

    // Fetch Timesheet DB
    const tsVehiclesResult = await pool.query(
      "SELECT * FROM timesheet_vehicles",
    );
    const driverLogs = await pool.query(
      "SELECT plate_no, driver_name, work_start_date, work_end_date FROM vehicle_driver_log",
    );
    const siteLogs = await pool.query(
      "SELECT plate_no, site_name, rate, work_start_date, work_end_date FROM vehicle_site_log",
    );

    let savedResult = { rows: [] };
    let targetStart, targetEnd;

    if (month && month !== "All") {
      const savedQuery = `SELECT * FROM billing_records WHERE billing_month = $1`;
      savedResult = await pool.query(savedQuery, [month]);

      const [mName, yStr] = month.trim().split(" ");
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
      const mIdx = monthNames.indexOf(mName);

      if (mIdx !== -1 && yStr) {
        targetStart = new Date(parseInt(yStr), mIdx, 1);
        targetEnd = new Date(parseInt(yStr), mIdx + 1, 0);
      }
    }

    let validVehicles = [];
    let processedPlates = new Set();

    tsVehiclesResult.rows.forEach((tsItem) => {
      let plate = (tsItem.plate_no || "").toUpperCase().trim();
      if (!plate || processedPlates.has(plate)) return;
      processedPlates.add(plate);

      let correctDriver = (tsItem.driver_name || "").trim();

      if (targetStart && targetEnd) {
        // --- DRIVER LOGIC ---
        let dLogs = driverLogs.rows.filter(
          (l) => (l.plate_no || "").toUpperCase() === plate,
        );
        let validDLogs = dLogs.filter((l) => {
          let st = l.work_start_date
            ? new Date(l.work_start_date)
            : new Date("2000-01-01");
          let ed = l.work_end_date
            ? new Date(l.work_end_date)
            : new Date("2099-01-01");
          return st <= targetEnd && ed >= targetStart;
        });

        if (validDLogs.length > 0) {
          validDLogs.sort(
            (a, b) =>
              new Date(a.work_start_date || "2000-01-01") -
              new Date(b.work_start_date || "2000-01-01"),
          );
          let driverNames = validDLogs
            .map((l) => l.driver_name)
            .filter(Boolean);
          correctDriver = [...new Set(driverNames)].join(" / ");
        }

        // --- SITE LOGIC ---
        let sLogs = siteLogs.rows.filter(
          (l) => (l.plate_no || "").toUpperCase() === plate,
        );
        let validSLogs = sLogs.filter((l) => {
          let st = l.work_start_date
            ? new Date(l.work_start_date)
            : new Date("2000-01-01");
          let ed = l.work_end_date
            ? new Date(l.work_end_date)
            : new Date("2099-01-01");
          return st <= targetEnd && ed >= targetStart;
        });

        // 🟢 BUG FIX 1: ആ മാസം വണ്ടിക്ക് ആക്ടീവ് സൈറ്റ് ലോഗ് ഇല്ലെങ്കിൽ (അതായത് മുമ്പേ റിലീസ് ആയെങ്കിൽ) ഒഴിവാക്കുക!
        if (validSLogs.length === 0) return;

        // 🟢 BUG FIX 2: ഒരു വണ്ടി രണ്ട് സൈറ്റിൽ ഓടിയാൽ, രണ്ട് റെക്കോർഡ് ആയിട്ട് തന്നെ വരാൻ!
        let uniqueSitesMap = new Map();
        validSLogs.forEach((s) => {
          if (s.site_name) uniqueSitesMap.set(s.site_name, s.rate);
        });

        uniqueSitesMap.forEach((rate, siteName) => {
          let activeSiteRate = parseFloat(rate) || parseFloat(tsItem.rate) || 0;
          pushVehicle(plate, tsItem, correctDriver, siteName, activeSiteRate);
        });
      } else {
        // ഒരു പ്രത്യേക മാസവും തിരഞ്ഞെടുത്തല്ലെങ്കിൽ (All)
        let defaultSite = (tsItem.site_name || "N/A").trim();
        let defaultRate = parseFloat(tsItem.rate) || 0;
        pushVehicle(plate, tsItem, correctDriver, defaultSite, defaultRate);
      }

      function pushVehicle(pPlate, pItem, pDriver, pSite, pRate) {
        let vtype =
          pItem.vehicle_type || pItem.vtype || pItem["vehicle type"] || "";
        let vatRaw = String(
          pItem.vat || pItem.vat_bill || pItem["vat (yes/no)"] || "No",
        )
          .trim()
          .toLowerCase();
        let isVatBill =
          vatRaw === "yes" ||
          vatRaw === "true" ||
          vatRaw === "15" ||
          vatRaw === "15%"
            ? "Yes"
            : "No";
        let ownerName = (pItem.owner_name || pItem.owner || "").trim();
        // 🟢 Fetch Owner Mobile
        let ownerMobile = (pItem.owner_mobile || "").trim();

        validVehicles.push({
          plate_number: pPlate,
          vehicle_type: vtype,
          rate: pRate,
          nrate: pRate / 260,
          otrate: (pRate / 260) * 0.7,
          owner: ownerName,
          owner_mobile: ownerMobile, // 🟢 Add to validVehicles
          site: pSite,
          driver_name: pDriver,
          vat_bill: isVatBill,
        });
      }
    });

    res.status(200).json({
      success: true,
      data: validVehicles,
      saved_bills: savedResult.rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Save Billing Data (WITH ZERO-ROW PROTECTION)
router.post("/save", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { billing_period, items } = req.body;

    for (let row of items) {
      await client.query(
        `DELETE FROM billing_records WHERE billing_month = $1 AND plate_no = $2 AND site_name = $3`,
        [billing_period, row.plate, row.site_name],
      );

      // 🟢 ZERO ROW PROTECTION (Updated to allow remarks)
      const nhr = parseFloat(row.nhr) || 0;
      const othr = parseFloat(row.othr) || 0;
      const rent = parseFloat(row.rent) || 0;
      const adjAmt = parseFloat(row.adjusted_amount) || 0;
      const remark = (row.remark || "").trim();

      if (nhr === 0 && othr === 0 && rent === 0 && adjAmt === 0 && remark === "") {
        continue; // Skip saving empty row ONLY if remark is also empty
      }

      const query = `INSERT INTO billing_records 
                (billing_month, date, company, owner, site_name, db_rate, vtype, driver, plate_no, nhr, nrate, othr, otrate, rent, vat_percent, vat_amount, total, adjustment_desc, adjusted_amount, after_adjustment, remark) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`;

      await client.query(query, [
        billing_period,
        row.date,
        row.company,
        row.owner,
        row.site_name,
        row.db_rate,
        row.vtype,
        row.driver,
        row.plate,
        nhr,
        row.nrate,
        othr,
        row.otrate,
        rent,
        row.vat_percent,
        row.vat_amount,
        row.total,
        row.adjustment_desc,
        adjAmt,
        row.after_adjustment,
        row.remark
      ]);
    }
    await client.query("COMMIT");
    res.status(200).json({ success: true, message: "Saved successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

// 3. Fetch Dashboard Data (FILTER OUT ZERO ROWS BUT KEEP REMARKS)
router.get("/dashboard-data", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM billing_records WHERE rent > 0 OR nhr > 0 OR othr > 0 OR adjusted_amount != 0 OR (remark IS NOT NULL AND remark != '') ORDER BY TO_DATE(billing_month, 'Month YYYY') DESC, id ASC`,
    );

    const tsRes = await pool.query(
      "SELECT plate_no, site_name, owner_name FROM timesheet_vehicles",
    );
    let tsMap = {};
    tsRes.rows.forEach((r) => {
      if (r.plate_no) tsMap[r.plate_no.toUpperCase()] = r;
    });

    result.rows.forEach((row) => {
      let pNo = (row.plate_no || "").toUpperCase();
      if (tsMap[pNo]) {
        if (!row.site_name || row.site_name === "-" || row.site_name === "N/A")
          row.site_name = tsMap[pNo].site_name;
        if (!row.owner || row.owner === "-" || row.owner === "")
          row.owner = tsMap[pNo].owner_name;
      }
    });

    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Export Excel (FILTER OUT ZERO ROWS BUT KEEP REMARKS)
router.get("/export-excel", async (req, res) => {
  try {
    const { month } = req.query;
    let query = `SELECT * FROM billing_records WHERE rent > 0 OR nhr > 0 OR othr > 0 OR adjusted_amount != 0 OR (remark IS NOT NULL AND remark != '') ORDER BY TO_DATE(billing_month, 'Month YYYY') DESC, id ASC`;
    let params = [];

    if (month && month !== "All") {
      query = `SELECT * FROM billing_records WHERE billing_month = $1 AND (rent > 0 OR nhr > 0 OR othr > 0 OR adjusted_amount != 0 OR (remark IS NOT NULL AND remark != '')) ORDER BY id ASC`;
      params = [month];
    }

    const result = await pool.query(query, params);

    const tsRes = await pool.query(
      "SELECT plate_no, site_name, owner_name FROM timesheet_vehicles",
    );
    let tsMap = {};
    tsRes.rows.forEach((r) => {
      if (r.plate_no) tsMap[r.plate_no.toUpperCase()] = r;
    });

    result.rows.forEach((row) => {
      let pNo = (row.plate_no || "").toUpperCase();
      let tSite = tsMap[pNo];
      if (tSite) {
        if (!row.site_name || row.site_name === "-" || row.site_name === "N/A")
          row.site_name = tSite.site_name;
        if (!row.owner || row.owner === "-" || row.owner === "")
          row.owner = tSite.owner_name;
      }
    });

    const workbook = new ExcelJS.Workbook();
    let sheetName = month === "All" || !month ? "All_Months" : month;
    sheetName = sheetName.substring(0, 31);
    const worksheet = workbook.addWorksheet(sheetName);

    worksheet.columns = [
      { header: "Month", key: "billing_month", width: 15 },
      { header: "Date", key: "date", width: 15 },
      { header: "Owner", key: "owner", width: 25 },
      { header: "Site", key: "site_name", width: 25 },
      { header: "Vehicle Type", key: "vtype", width: 20 },
      { header: "Driver", key: "driver", width: 20 },
      { header: "Plate No", key: "plate_no", width: 15 },
      { header: "N.Hr", key: "nhr", width: 10 },
      { header: "N.Rate", key: "nrate", width: 10 },
      { header: "OT Hr", key: "othr", width: 10 },
      { header: "OT Rate", key: "otrate", width: 10 },
      { header: "Rent", key: "rent", width: 15 },
      { header: "VAT %", key: "vat_percent", width: 10 },
      { header: "VAT Amt", key: "vat_amount", width: 15 },
      { header: "Adjustment", key: "adjustment_desc", width: 25 },
      { header: "Adj. Amt", key: "adjusted_amount", width: 15 },
      { header: "Grand Total", key: "after_adjustment", width: 15 },
      { header: "Remark", key: "remark", width: 25 },
    ];

    result.rows.forEach((row) => {
      worksheet.addRow(row);
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Billing_${sheetName.replace(/ /g, "_")}.xlsx`,
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).send("Error generating Excel: " + error.message);
  }
});

// 🟢 5. Combined Multi-Month Bill Generator API for a Specific Vehicle
router.get("/combined-bill", async (req, res) => {
  try {
    const { plate_no, from_month, from_year, to_month, to_year } = req.query;

    if (!plate_no || !from_month || !from_year || !to_month || !to_year) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: plate_no, from_month, from_year, to_month, to_year",
      });
    }

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    const fromMIdx = monthNames.indexOf(from_month.trim());
    const toMIdx = monthNames.indexOf(to_month.trim());
    const startYr = parseInt(from_year, 10);
    const endYr = parseInt(to_year, 10);

    if (fromMIdx === -1 || toMIdx === -1 || isNaN(startYr) || isNaN(endYr)) {
      return res.status(400).json({ success: false, message: "Invalid month or year selection." });
    }

    // Build ordered list of target months
    let targetMonths = [];
    let curDate = new Date(startYr, fromMIdx, 1);
    let endDate = new Date(endYr, toMIdx, 1);

    while (curDate <= endDate) {
      let mName = monthNames[curDate.getMonth()];
      let yNum = curDate.getFullYear();
      targetMonths.push(`${mName} ${yNum}`);
      curDate.setMonth(curDate.getMonth() + 1);
    }

    const cleanPlate = plate_no.trim().toUpperCase();

    // Query saved billing records
    const savedResult = await pool.query(
      `SELECT * FROM billing_records 
       WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM($1)) 
         AND billing_month = ANY($2::text[])
       ORDER BY TO_DATE(billing_month, 'Month YYYY') ASC, id ASC`,
      [cleanPlate, targetMonths]
    );

    // Also fetch vehicle master info
    const tsVehicleRes = await pool.query(
      `SELECT * FROM timesheet_vehicles WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM($1)) LIMIT 1`,
      [cleanPlate]
    );

    const vehicleInfo = tsVehicleRes.rows[0] || {};

    let combinedRows = [];
    let totals = { nhr: 0, othr: 0, rent: 0, vat_amount: 0, total: 0, adjusted_amount: 0, after_adjustment: 0 };

    targetMonths.forEach((mStr) => {
      let savedRow = savedResult.rows.find((r) => r.billing_month === mStr);

      const [mName, yStr] = mStr.split(" ");
      const shortDate = mName.substring(0, 3) + " " + (yStr ? yStr.substring(2, 4) : "");

      if (savedRow) {
        let nhr = parseFloat(savedRow.nhr) || 0;
        let othr = parseFloat(savedRow.othr) || 0;
        let rent = parseFloat(savedRow.rent) || 0;
        let vatAmt = parseFloat(savedRow.vat_amount) || 0;
        let total = parseFloat(savedRow.total) || (rent + vatAmt);
        let adjAmt = parseFloat(savedRow.adjusted_amount) || 0;
        let afterAdj = parseFloat(savedRow.after_adjustment) || (total + adjAmt);

        totals.nhr += nhr;
        totals.othr += othr;
        totals.rent += rent;
        totals.vat_amount += vatAmt;
        totals.total += total;
        totals.adjusted_amount += adjAmt;
        totals.after_adjustment += afterAdj;

        combinedRows.push({
          billing_month: mStr,
          date: savedRow.date || shortDate,
          company: savedRow.company || vehicleInfo.company || "Haka",
          owner: savedRow.owner || vehicleInfo.owner_name || "COMPANY VEHICLE",
          site_name: savedRow.site_name || vehicleInfo.site_name || "N/A",
          vtype: savedRow.vtype || vehicleInfo.vehicle_type || "N/A",
          driver: savedRow.driver || vehicleInfo.driver_name || "N/A",
          plate_no: cleanPlate,
          nhr: nhr,
          nrate: parseFloat(savedRow.nrate) || 0,
          othr: othr,
          otrate: parseFloat(savedRow.otrate) || 0,
          rent: rent,
          vat_percent: parseFloat(savedRow.vat_percent) || 0,
          vat_amount: vatAmt,
          total: total,
          adjustment_desc: savedRow.adjustment_desc || "",
          adjusted_amount: adjAmt,
          after_adjustment: afterAdj,
          remark: savedRow.remark || ""
        });
      } else {
        combinedRows.push({
          billing_month: mStr,
          date: shortDate,
          company: vehicleInfo.company || "Haka",
          owner: vehicleInfo.owner_name || "COMPANY VEHICLE",
          site_name: vehicleInfo.site_name || "N/A",
          vtype: vehicleInfo.vehicle_type || "N/A",
          driver: vehicleInfo.driver_name || "N/A",
          plate_no: cleanPlate,
          nhr: 0,
          nrate: parseFloat(vehicleInfo.rate) || 0,
          othr: 0,
          otrate: (parseFloat(vehicleInfo.rate) || 0) * 0.7,
          rent: 0,
          vat_percent: 0,
          vat_amount: 0,
          total: 0,
          adjustment_desc: "",
          adjusted_amount: 0,
          after_adjustment: 0,
          remark: ""
        });
      }
    });

    res.status(200).json({
      success: true,
      plate_no: cleanPlate,
      vehicle_info: vehicleInfo,
      rows: combinedRows,
      totals: totals
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 🟢 6. Security Code Verification for Combined Bill Generator Images
router.post("/verify-combined-security", (req, res) => {
  try {
    const { code } = req.body;
    const validCode = process.env.COMBINED_GENERATOR_CODE || "12345";

    if (code === validCode) {
      res.json({ success: true, message: "Security Code Verified!" });
    } else {
      res.json({ success: false, message: "Invalid Security Code!" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
