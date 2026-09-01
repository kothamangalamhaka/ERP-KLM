const express = require("express");
const excelJS = require("exceljs");
const bcrypt = require("bcrypt");
const axios = require("axios");

module.exports = function (pool, middlewares, helpers) {
  const router = express.Router();
  const { verifyToken, verifySuperAdmin, verifyEditor } = middlewares;
  const { sendActivityTelegramMessage, generateAndSendBackup } = helpers;

  // ==========================================
  // 📌 GLOBAL CONFIGURATIONS & CONSTANTS
  // ==========================================
  const COLUMNS = {
  SN: "SN",
  PLATE_NUMBER: "PLATE NUMBER",
  SITE: "SITE",
  STATUS: "STATUS",
  COMPANY: "COMPANY",
  CUSTOMER: "CUSTOMER",
  IF_SUB: "IF SUB",
  WORK_START: "WORK START",
  LAST_WORKING_DAY: "LAST WORKING DAY",
  DAYS_WORKED: "DAYS WORKED",
  MOBILIZATION: "EQUIPMENT REACHED AT SITE",
  RELEASE_DATE: "RELEASE DATE",
  REPLACED_DATE: "REPLACED DATE",
  OLD_DRIVER: "OLD DRIVER NAME",
  OD_MOB: "OD MOB",
  OD_WORK_END: "OD WRK END",
  DRIVER_NAME: "DRIVER NAME",
  MOBILE: "MOBILE",
  DRIVER_START_DATE: "DRIVER START DATE",
};

  const FIXED_COLUMNS = [
    COLUMNS.MOBILIZATION,
    COLUMNS.WORK_START,
    COLUMNS.LAST_WORKING_DAY,
    COLUMNS.RELEASE_DATE,
    COLUMNS.REPLACED_DATE,
    COLUMNS.OD_WORK_END,
    COLUMNS.OLD_DRIVER,
    COLUMNS.OD_MOB,
    COLUMNS.DAYS_WORKED,
    "DRIVER STATUS REMARK",
  ];

  const STATUS_ENUM = {
    RUNNING: "running",
    RELEASED: "released",
    REPLACED: "replaced",
    MOBILIZING: "mobilizing",
  };

  // ==========================================
  // 🛠️ SHARED UTILITY FUNCTIONS (Leak-Free & LIVE)
  // ==========================================

  // 🟢 NEW CODE: In-Memory Cell Lock System (Zero Memory Leak)
  const activeCellLocks = {}; 

  // Auto-cleanup stale locks (Unlocks cell if abandoned for more than 2 minutes)
  setInterval(() => {
    const now = Date.now();
    for (let key in activeCellLocks) {
      if (now - activeCellLocks[key].time > 120000) {
        delete activeCellLocks[key];
      }
    }
  }, 60000);

  router.post("/lock-cell", verifyToken, (req, res) => {
    const { dbId, colName } = req.body;
    const key = `${dbId}_${colName}`;
    const currentUser = req.user.username;

    if (activeCellLocks[key] && activeCellLocks[key].user !== currentUser) {
      return res.json({ locked: true, lockedBy: activeCellLocks[key].user });
    }
    
    activeCellLocks[key] = { user: currentUser, time: Date.now() };
    res.json({ locked: false });
  });

  router.post("/unlock-cell", verifyToken, (req, res) => {
    const { dbId, colName } = req.body;
    const key = `${dbId}_${colName}`;
    
    if (activeCellLocks[key] && activeCellLocks[key].user === req.user.username) {
      delete activeCellLocks[key];
    }
    res.json({ success: true });
  });

  // 🟢 NEW CODE: Live Telegram Alert function (Guaranteed Trigger)
  async function sendLiveTelegramAlert(username, changeLogs) {
    if (!changeLogs || changeLogs.length === 0) return;

    try {
      const timeStr = new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });

      let alertBlocks = [];
      changeLogs.forEach((item) => {
        const plate = item.plate || "N/A";
        const colHeader = item.colName || "N/A";
        const oldVal = item.oldVal !== undefined && item.oldVal !== "" ? item.oldVal : "(Blank)";
        const newVal = item.newVal !== undefined && item.newVal !== "" ? item.newVal : "(Blank)";

        alertBlocks.push(
          `🚚 <b>PLATE NO:</b> [ <code>${plate}</code> ]\n` +
          `📌 <b>COLUMN:</b> <b>${colHeader}</b>\n` +
          `🔄 <b>CHANGE:</b> <del>${oldVal}</del> ➔ <b>${newVal}</b>`
        );
      });

      const finalMessage =
        `🔔 <b>LIVE MASTER DB UPDATE</b>\n\n` +
        `👤 <b>Modified By:</b> @${username}\n` +
        `⏰ <b>Time:</b> ${timeStr}\n` +
        `-----------------------------------\n\n` +
        alertBlocks.join("\n\n-----------------------------------\n\n");

      await sendActivityTelegramMessage(finalMessage);
    } catch (err) {
      console.error("Live Telegram Alert Error:", err.message);
    }
  }

  function formatPlateNumber(val) {
    if (!val) return "";
    let p = String(val).toUpperCase().trim();
    let raw = p.replace(/\s+/g, "");
    let jMatch = raw.match(/^J(\d+)$/);
    if (jMatch) return "J" + jMatch[1];
    let normalMatch = raw.match(/^(\d+)([A-Z]+)$/);
    if (normalMatch) return normalMatch[1] + " " + normalMatch[2];
    return p.replace(/\s+/g, " ");
  }

  function calculateDependentFields(rowData) {
    const updates = {};
    const getCol = (matchStr) =>
      Object.keys(rowData).find((k) =>
        k
          .replace(/\s+/g, "")
          .toUpperCase()
          .includes(matchStr.replace(/\s+/g, "").toUpperCase()),
      ) || matchStr;

    const mobCol = getCol(COLUMNS.MOBILIZATION);
    const wsCol = getCol(COLUMNS.WORK_START);
    const lwdCol = getCol(COLUMNS.LAST_WORKING_DAY);
    const daysCol = getCol(COLUMNS.DAYS_WORKED);
    const statusCol = Object.keys(rowData).find(
      (k) => k.toUpperCase() === COLUMNS.STATUS,
    );
    const relCol = getCol("RELEASEDATE") || getCol("RELEASEDDATE");
    const repCol = getCol("REPLACEDDATE") || getCol("REPLACEDATE");

    let mobVal = mobCol ? rowData[mobCol] : "";
    let wsVal = wsCol ? rowData[wsCol] : "";
    let lwdVal = lwdCol ? rowData[lwdCol] : "";
    let statusVal = statusCol
      ? String(rowData[statusCol] || "").toLowerCase()
      : "";

    if (mobVal && (!wsVal || String(wsVal).trim() === "") && wsCol) {
      updates[wsCol] = mobVal;
      wsVal = mobVal;
    }

    if (wsVal && lwdVal && daysCol) {
      const parseDate = (dStr) => {
        if (!dStr) return null;
        let parsedDate = new Date(dStr);
        if (!isNaN(parsedDate.getTime())) return parsedDate;

        const p = String(dStr)
          .trim()
          .split(/[\/\- \.]/);
        const mNames = [
          "JAN",
          "FEB",
          "MAR",
          "APR",
          "MAY",
          "JUN",
          "JUL",
          "AUG",
          "SEP",
          "OCT",
          "NOV",
          "DEC",
        ];

        if (p.length === 3) {
          let d = parseInt(p[0], 10);
          let m = isNaN(parseInt(p[1], 10))
            ? mNames.indexOf(p[1].toUpperCase().substring(0, 3))
            : parseInt(p[1], 10) - 1;
          let y =
            p[2].length === 2 ? 2000 + parseInt(p[2], 10) : parseInt(p[2], 10);

          if (!isNaN(d) && m !== -1 && !isNaN(y)) {
            return new Date(y, m, d);
          }
        }
        return null;
      };

      const d1 = parseDate(wsVal);
      const d2 = parseDate(lwdVal);

      if (d1 && d2 && !isNaN(d1) && !isNaN(d2)) {
        const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
        if (diffDays > 0) {
          updates[daysCol] = String(diffDays);
        }
      }
    }

    if (
      statusVal === STATUS_ENUM.RELEASED &&
      lwdVal &&
      relCol &&
      (!rowData[relCol] || String(rowData[relCol]).trim() === "")
    )
      updates[relCol] = lwdVal;

    if (
      statusVal === STATUS_ENUM.REPLACED &&
      lwdVal &&
      repCol &&
      (!rowData[repCol] || String(rowData[repCol]).trim() === "")
    )
      updates[repCol] = lwdVal;

    return updates;
  }

  async function autoClosePreviousRecord(
    dbClient,
    plateNumber,
    newWorkStartStr,
  ) {
    if (!plateNumber) return;
    try {
      const prevRecordRes = await dbClient.query(
        "SELECT id, record_data FROM erp_records WHERE plate_number = $1 AND deleted_at IS NULL ORDER BY sn DESC LIMIT 1",
        [plateNumber],
      );
      if (prevRecordRes.rows.length > 0) {
        let prevId = prevRecordRes.rows[0].id;
        let prevData = prevRecordRes.rows[0].record_data;
        const getCol = (matchStr) =>
          Object.keys(prevData).find((k) =>
            k
              .replace(/\s+/g, "")
              .toUpperCase()
              .includes(matchStr.replace(/\s+/g, "").toUpperCase()),
          ) || matchStr;

        const pLwdCol = getCol(COLUMNS.LAST_WORKING_DAY);
        const pStatusCol = Object.keys(prevData).find(
          (k) => k.toUpperCase() === COLUMNS.STATUS,
        );
        const dNameCol = getCol(COLUMNS.DRIVER_NAME);
        const dMobCol = getCol(COLUMNS.MOBILE);
        const dStartCol = getCol(COLUMNS.DRIVER_START_DATE) || getCol("DRIVER START DATE");

        if (
          pLwdCol &&
          (!prevData[pLwdCol] || String(prevData[pLwdCol]).trim() === "")
        ) {
          let autoLwdVal = "";
          if (newWorkStartStr) {
            const p = String(newWorkStartStr)
              .trim()
              .split(/[\/\- \.]/);
            const mNames = [
              "JAN",
              "FEB",
              "MAR",
              "APR",
              "MAY",
              "JUN",
              "JUL",
              "AUG",
              "SEP",
              "OCT",
              "NOV",
              "DEC",
            ];
            if (p.length === 3) {
              let d = parseInt(p[0], 10),
                m = mNames.indexOf(p[1].toUpperCase().substring(0, 3)),
                y =
                  p[2].length === 2
                    ? 2000 + parseInt(p[2], 10)
                    : parseInt(p[2], 10);
              if (!isNaN(d) && m !== -1 && !isNaN(y)) {
                let dObj = new Date(y, m, d);
                dObj.setDate(dObj.getDate() - 1);
                const months = [
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "Jun",
                  "Jul",
                  "Aug",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Dec",
                ];
                autoLwdVal = `${String(dObj.getDate()).padStart(2, "0")}-${months[dObj.getMonth()]}-${dObj.getFullYear()}`;
              }
            }
          }

          if (autoLwdVal) {
            prevData[pLwdCol] = autoLwdVal;
            if (pStatusCol) prevData[pStatusCol] = "Released";

            if (
              prevData[dNameCol] &&
              String(prevData[dNameCol]).trim() !== ""
            ) {
              if (!prevData.driver_history) prevData.driver_history = [];
              prevData.driver_history.push({
                id:
                  Date.now().toString(36) +
                  Math.random().toString(36).substr(2, 5),
                name: prevData[dNameCol],
                mob: prevData[dMobCol] || "",
                start: (dStartCol && prevData[dStartCol]) ? prevData[dStartCol] : "IDK",
                end: autoLwdVal,
                updated_by: "System",
              });
              prevData[dNameCol] = "";
              prevData[dMobCol] = "";
              if (dStartCol) prevData[dStartCol] = "";
            }

            let calcUpdates = calculateDependentFields(prevData);
            Object.assign(prevData, calcUpdates);
            await dbClient.query(
              "UPDATE erp_records SET record_data = $1 WHERE id = $2",
              [prevData, prevId],
            );
          }
        }
      }
    } catch (e) {
      console.error("Auto Close Previous Record Error:", e);
    }
  }

  function handleError(res, error, role, context = "Error") {
    console.error(`[${context}]`, error);
    const message =
      role === "Super Admin"
        ? error.message
        : "A secure server error occurred. Please contact the administrator.";
    return res.json({ success: false, message });
  }

  // ==========================================
  // 🚀 API ROUTES (Memory-Optimized)
  // ==========================================

  pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS active_users (
      username VARCHAR PRIMARY KEY,
      last_seen TIMESTAMP
    )
  `,
    )
    .catch((err) => console.error("Failed to create active_users table:", err));

// 🟢 NEW CODE: Add Column 
  router.post("/add-column", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") {
         return res.json({ success: false, message: "Super Admin Access Required." });
      }
      const { colName, colType } = req.body;
      if (!colName) return res.json({ success: false, message: "Column name required." });

      // നിലവിൽ ആ പേരിൽ ഒരു കോളം ഉണ്ടോയെന്ന് നോക്കുക
      const checkRes = await pool.query(
        "SELECT id FROM erp_headers WHERE header_name = $1 AND deleted_at IS NULL", 
        [colName]
      );
      if (checkRes.rows.length > 0) {
        return res.json({ success: false, message: "Column already exists." });
      }

      // ഏറ്റവും വലിയ col_order കണ്ടുപിടിക്കുക
      const orderRes = await pool.query("SELECT MAX(col_order) as max_order FROM erp_headers");
      let nextOrder = (orderRes.rows[0].max_order || 0) + 1;

      // പുതിയ കോളം ടേബിളിൽ ചേർക്കുക
      await pool.query(
        "INSERT INTO erp_headers (header_name, col_type, col_order) VALUES ($1, $2, $3)",
        [colName, colType || "varchar", nextOrder]
      );

      // ആക്ടിവിറ്റി ലോഗ് ചെയ്യുക
      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_COLUMN', $2)",
        [req.user.username, JSON.stringify({ colName: colName })]
      );

      res.json({ success: true, message: "Column added successfully." });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_COLUMN");
    }
  });

  // 🟢 NEW CODE: Add Column Relative (Right/Left)
  router.post("/add-column-relative", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") {
         return res.json({ success: false, message: "Super Admin Access Required." });
      }
      const { colName, relativeTo, position, colType } = req.body;
      if (!colName || !relativeTo) return res.json({ success: false, message: "Missing data." });

      // നിലവിൽ ആ പേരിൽ ഒരു കോളം ഉണ്ടോയെന്ന് നോക്കുക
      const checkRes = await pool.query(
        "SELECT id FROM erp_headers WHERE header_name = $1 AND deleted_at IS NULL", 
        [colName]
      );
      if (checkRes.rows.length > 0) {
        return res.json({ success: false, message: "Column already exists." });
      }

      // relativeTo കോളത്തിന്റെ ഓർഡർ കണ്ടുപിടിക്കുക
      const targetRes = await pool.query(
        "SELECT col_order FROM erp_headers WHERE header_name = $1 AND deleted_at IS NULL",
        [relativeTo]
      );
      
      if (targetRes.rows.length === 0) {
        return res.json({ success: false, message: "Target column not found." });
      }

      let targetOrder = targetRes.rows[0].col_order;
      let newOrder = position === "left" ? targetOrder : targetOrder + 1;

      // ബാക്കിയുള്ള കോളങ്ങളുടെ ഓർഡർ അഡ്ജസ്റ്റ് ചെയ്യുക
      await pool.query(
        "UPDATE erp_headers SET col_order = col_order + 1 WHERE col_order >= $1 AND deleted_at IS NULL",
        [newOrder]
      );

      // പുതിയ കോളം ടേബിളിൽ ചേർക്കുക
      await pool.query(
        "INSERT INTO erp_headers (header_name, col_type, col_order) VALUES ($1, $2, $3)",
        [colName, colType || "varchar", newOrder]
      );

      // ആക്ടിവിറ്റി ലോഗ് ചെയ്യുക
      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_COLUMN_RELATIVE', $2)",
        [req.user.username, JSON.stringify({ colName: colName, relativeTo: relativeTo, position: position })]
      );

      res.json({ success: true, message: "Column added successfully." });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_COLUMN_RELATIVE");
    }
  });


  router.post("/get-master-data", verifyToken, async (req, res) => {
    try {
      const { username, role, site } = req.user;

      await pool.query(
        `INSERT INTO active_users (username, last_seen) VALUES ($1, CURRENT_TIMESTAMP) 
         ON CONFLICT (username) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`,
        [username],
      );

      // Fetch users active in the last 45 seconds
      const activeRes = await pool.query(
        `SELECT username FROM active_users WHERE last_seen > NOW() - INTERVAL '45 seconds'`,
      );
      const activeUsersList = activeRes.rows.map((r) => r.username);

      const headerResult = await pool.query(
        `SELECT header_name, is_locked, alignment, col_type, col_width FROM erp_headers WHERE deleted_at IS NULL ORDER BY col_order ASC`,
      );
      let headers = headerResult.rows.map((h) => h.header_name);
      let lockedCols = headerResult.rows
        .filter((h) => h.is_locked)
        .map((h) => h.header_name);
      let alignments = headerResult.rows.map((h) => ({
        name: h.header_name,
        align: h.alignment,
      }));
      let colTypes = headerResult.rows.map((h) => ({
        name: h.header_name,
        type: h.col_type || "varchar",
      }));
      let colWidths = headerResult.rows.map((h) => ({
        name: h.header_name,
        width: h.col_width || "100px",
      }));

      let query = `
        SELECT * FROM erp_records WHERE deleted_at IS NULL
        ORDER BY COALESCE(record_data->>'Site', '') ASC, COALESCE(record_data->>'Company', '') ASC, COALESCE(record_data->>'If Sub', '') ASC, 
        CASE LOWER(TRIM(record_data->>'Status')) WHEN 'mobilizing' THEN 1 WHEN 'running' THEN 2 WHEN 'replaced' THEN 3 WHEN 'released' THEN 4 ELSE 5 END ASC, sn ASC
      `;
      let params = [];
      if (role !== "Admin" && role !== "Super Admin" && role !== "Viewer") {
        query = `
          SELECT * FROM erp_records WHERE TRIM(LOWER(COALESCE(record_data->>'Site', site, ''))) = TRIM(LOWER($1)) AND deleted_at IS NULL
          ORDER BY COALESCE(record_data->>'Site', '') ASC, COALESCE(record_data->>'Company', '') ASC, COALESCE(record_data->>'If Sub', '') ASC, 
          CASE LOWER(TRIM(record_data->>'Status')) WHEN 'mobilizing' THEN 1 WHEN 'running' THEN 2 WHEN 'replaced' THEN 3 WHEN 'released' THEN 4 ELSE 5 END ASC, sn ASC
        `;
        params = [site];
      }

      const dataResult = await pool.query(query, params);
      let rows = [];
      dataResult.rows.forEach((dbRow) => {
        let rowArray = [];
        headers.forEach((h) => {
          let val = dbRow.record_data[h];
          if (val === undefined) {
             // Case-insensitive fallback if exact case is missing
             let foundKey = Object.keys(dbRow.record_data).find(k => k.replace(/\s+/g, "").toUpperCase() === h.replace(/\s+/g, "").toUpperCase());
             if (foundKey) val = dbRow.record_data[foundKey];
          }
          rowArray.push(val || "");
        });
        rowArray.push(dbRow.id);
        rows.push(rowArray);
      });

      // 🟢 FIX: Get global max SN regardless of user role or site filter
      const snResult = await pool.query("SELECT MAX(sn) as max_sn FROM erp_records");
      let globalNextSN = (snResult.rows[0].max_sn || 0) + 1;

      res.json({
        success: true,
        headers,
        lockedCols,
        alignments,
        colTypes,
        colWidths,
        rows,
        nextSN: globalNextSN,
        activeUsers: activeUsersList,
      });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_MASTER_DATA");
    }
  });

  // ==========================================
  // 🟢 NEW CODE: DYNAMIC COMPANIES LIST API
  // ==========================================
  router.get("/companies-list", verifyToken, async (req, res) => {
    try {
      // erp_records-ലെ record_data-യിൽ നിന്നും നിലവിലുള്ള എല്ലാ കമ്പനികളുടെയും ലിസ്റ്റ് ഡ്യൂപ്ലിക്കേറ്റ് ഇല്ലാതെ എടുക്കുന്നു
      const companyRes = await pool.query(
        `SELECT DISTINCT TRIM(record_data->>'Company') AS company_name 
         FROM erp_records 
         WHERE deleted_at IS NULL 
           AND record_data->>'Company' IS NOT NULL 
           AND TRIM(record_data->>'Company') != '' 
         ORDER BY company_name ASC`
      );

      let companies = companyRes.rows.map((r) => r.company_name);

      // ഡാറ്റാബേസിൽ റെക്കോർഡുകൾ ഒന്നും ഇല്ലെങ്കിൽ പോലും ഡിഫോൾട്ട് 4 കമ്പനികൾ എപ്പോഴും ലിസ്റ്റിൽ ഉണ്ടാകും
      const defaultCompanies = ["Haka", "Aljoda", "Masar Wheels", "We1"];
      let combinedCompanies = [...new Set([...defaultCompanies, ...companies])];

      res.json({ success: true, companies: combinedCompanies });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_COMPANIES_LIST");
    }
  });

  router.post("/update-col-width", verifyToken, async (req, res) => {
    try {
      const { colName, width } = req.body;
      await pool.query(
        "UPDATE erp_headers SET col_width = $1 WHERE header_name = $2",
        [width, colName],
      );
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, req.user.role, "UPDATE_COL_WIDTH");
    }
  });

  router.post("/update-cells-batch", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { edits } = req.body;

      if (req.user.role === "Viewer")
        throw new Error("Access Denied: Viewers cannot edit data.");
      if (!Array.isArray(edits) || edits.length === 0)
        throw new Error("No edits provided.");

      let changeLogs = [];

      for (let edit of edits) {
        let { dbId, colName, newValue } = edit;
        if (String(colName).trim().toUpperCase() === COLUMNS.PLATE_NUMBER) {
          newValue = formatPlateNumber(newValue);
        }

        const recordRes = await client.query(
          "SELECT plate_number, record_data FROM erp_records WHERE id = $1",
          [dbId],
        );
        if (recordRes.rows.length === 0) continue;

        let currentData = recordRes.rows[0].record_data || {};
        
        // 🟢 FIX 1: Null/Undefined സുരക്ഷിതമായി സ്ട്രിങ്ങിലേക്ക് മാറ്റുന്നു
        let rawOldVal = currentData[colName] !== undefined && currentData[colName] !== null ? String(currentData[colName]).trim() : "";
        let rawNewVal = newValue !== undefined && newValue !== null ? String(newValue).trim() : "";

        // 🟢 FIX 2: പ്ലേറ്റ് നമ്പർ കൃത്യമായി കിട്ടാൻ DB കോളവും ഒപ്പം ഫ്രണ്ട്-എൻഡിൽ നിന്ന് വരുന്ന പ്ലേറ്റ് നമ്പറും ചെക്ക് ചെയ്യുന്നു
        let plateNo =
          edit.plate ||
          recordRes.rows[0].plate_number ||
          currentData[COLUMNS.PLATE_NUMBER] ||
          currentData["PLATE NUMBER"] ||
          currentData["Plate Number"] ||
          "N/A";

        // 🟢 FIX 3: കൃത്യമായ മാറ്റം ഉണ്ടെങ്കിൽ മാത്രം ലോഗിൽ ചേർക്കുന്നു
        if (rawOldVal !== rawNewVal) {
          changeLogs.push({
            plate: plateNo,
            colName: colName,
            oldVal: rawOldVal !== "" ? rawOldVal : "(Blank)",
            newVal: rawNewVal !== "" ? rawNewVal : "(Blank)",
          });
        }

        let payload = { [colName]: newValue };
        let simulatedRow = { ...currentData, ...payload };

        let calculatedUpdates = calculateDependentFields(simulatedRow);
        Object.assign(payload, calculatedUpdates);

        await client.query(
          `UPDATE erp_records SET record_data = record_data || $1::jsonb, plate_number = COALESCE(($1::jsonb->>'${COLUMNS.PLATE_NUMBER}'), plate_number), site = COALESCE(($1::jsonb->>'${COLUMNS.SITE}'), ($1::jsonb->>'Site'), site), updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [JSON.stringify(payload), dbId],
        );
      }

      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BATCH_UPDATE', $2)",
        [
          req.user.username,
          JSON.stringify({ count: edits.length, changes: changeLogs }),
        ],
      );

      await client.query("COMMIT");

      // 🟢 NEW CODE: Live Telegram Alert Trigger (Instant - 0 Delay)
      if (changeLogs.length > 0) {
        await sendLiveTelegramAlert(req.user.username, changeLogs);
      }

      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "BATCH_UPDATE");
    } finally {
      client.release();
    }
  });

  // 🟢 DELETE ROW (SOFT DELETE)
  router.post("/delete-row", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin" && req.user.role !== "Admin") {
        return res.json({ success: false, message: "Access Denied." });
      }
      const { dbId } = req.body;
      
      const recordRes = await pool.query("SELECT plate_number FROM erp_records WHERE id = $1", [dbId]);
      let plate = recordRes.rows.length > 0 ? recordRes.rows[0].plate_number : "Unknown";

      await pool.query("UPDATE erp_records SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1", [dbId]);
      
      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'DELETE_ROW', $2)",
        [req.user.username, JSON.stringify({ dbId, plate })]
      );

      await sendActivityTelegramMessage(
        `🗑️ <b>ROW DELETED (To Recycle Bin)</b>\n\n<b>Plate:</b> ${plate}\n<b>Deleted by:</b> @${req.user.username}`
      );

      res.json({ success: true, message: "Row moved to recycle bin." });
    } catch (error) {
      handleError(res, error, req.user.role, "DELETE_ROW");
    }
  });

  router.post("/add-row", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer")
        throw new Error("Viewers cannot add rows.");
      let { rowDataObj } = req.body;

      const getColName = (matchStr) =>
        Object.keys(rowDataObj).find((k) =>
          k
            .replace(/\s+/g, "")
            .toUpperCase()
            .includes(matchStr.replace(/\s+/g, "").toUpperCase()),
        );

      let snCol = getColName("SN");
      let plateCol = getColName("PLATENUMBER") || getColName("PLATENO");
      let siteCol = getColName("SITE");

      let sn = parseInt((snCol ? rowDataObj[snCol] : rowDataObj[COLUMNS.SN]) || 1, 10);
      let plate = formatPlateNumber((plateCol ? rowDataObj[plateCol] : rowDataObj[COLUMNS.PLATE_NUMBER]) || "");
      let site = (siteCol ? rowDataObj[siteCol] : rowDataObj[COLUMNS.SITE]) || "";

      let calculatedUpdates = calculateDependentFields(rowDataObj);
      Object.assign(rowDataObj, calculatedUpdates);

      let wsColNew = getColName(COLUMNS.WORK_START);
      let wsValNew = wsColNew ? rowDataObj[wsColNew] : null;
      await autoClosePreviousRecord(pool, plate, wsValNew);

      await pool.query(
        "INSERT INTO erp_records (sn, plate_number, site, record_data) VALUES ($1, $2, $3, $4)",
        [sn, plate, site, rowDataObj],
      );
      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_ROW', $2)",
        [req.user.username, JSON.stringify({ plate: plate, site: site })],
      );

      // 🟢 തീയതികളും എക്സ്പയറി അലർട്ടുകളും ഉൾപ്പെടുത്തിക്കൊണ്ടുള്ള ടെലിഗ്രാം മെസ്സേജ് നിർമ്മാണം
      const timeStr = new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });

      let alertDetails = [
        `🚚 <b>PLATE NO:</b> [ <code>${plate || "N/A"}</code> ]`,
        `📍 <b>Site:</b> ${site || "N/A"}`
      ];

      let compCol = getColName("COMPANY");
      if (compCol && rowDataObj[compCol]) alertDetails.push(`🏢 <b>Company:</b> ${rowDataObj[compCol]}`);

      let custCol = getColName("CUSTOMER");
      if (custCol && rowDataObj[custCol]) alertDetails.push(`🤝 <b>Customer:</b> ${rowDataObj[custCol]}`);

      let statusCol = getColName("STATUS");
      if (statusCol && rowDataObj[statusCol]) alertDetails.push(`⚡ <b>Status:</b> ${rowDataObj[statusCol]}`);

      let drvCol = getColName("DRIVERNAME");
      let mobCol = getColName("MOBILE");
      if (drvCol && rowDataObj[drvCol]) {
        alertDetails.push(`👤 <b>Driver:</b> ${rowDataObj[drvCol]} ${mobCol && rowDataObj[mobCol] ? `(${rowDataObj[mobCol]})` : ""}`);
      }

      // തീയതികളും എക്സ്പയറി അലർട്ടുകളും കണ്ടെത്തുന്നു
      let dateAlerts = [];
      if (wsColNew && rowDataObj[wsColNew]) dateAlerts.push(`📅 <b>Work Start:</b> ${rowDataObj[wsColNew]}`);

      let mobReachedCol = getColName("EQUIPMENTREACHEDATSITE");
      if (mobReachedCol && rowDataObj[mobReachedCol]) dateAlerts.push(`🚛 <b>Mobilization:</b> ${rowDataObj[mobReachedCol]}`);

      let iqamaExpCol = getColName("IQAMAEXPIREDATE") || getColName("IQAMAEXPIRE");
      if (iqamaExpCol && rowDataObj[iqamaExpCol]) dateAlerts.push(`🪪 <b>Iqama Expire:</b> <code>${rowDataObj[iqamaExpCol]}</code>`);

      let licExpCol = getColName("LICENSEEXPIREDATE") || getColName("LICENCEEXPIREDATE") || getColName("LICENSEEXPIRE");
      if (licExpCol && rowDataObj[licExpCol]) dateAlerts.push(`💳 <b>License Expire:</b> <code>${rowDataObj[licExpCol]}</code>`);

      let insExpCol = getColName("EQINSURAN");
      if (insExpCol && rowDataObj[insExpCol]) dateAlerts.push(`🛡️ <b>Insurance Expire:</b> <code>${rowDataObj[insExpCol]}</code>`);

      let fahsExpCol = getColName("FAHSMVPI");
      if (fahsExpCol && rowDataObj[fahsExpCol]) dateAlerts.push(`🔍 <b>Fahs MVPI Expire:</b> <code>${rowDataObj[fahsExpCol]}</code>`);

      if (dateAlerts.length > 0) {
        alertDetails.push(`-----------------------------------\n<b>📌 DATE & EXPIRY DETAILS:</b>\n` + dateAlerts.join("\n"));
      }

      const telegramMsg =
        `➕ <b>NEW VEHICLE / ENTRY ADDED</b>\n\n` +
        `👤 <b>Added By:</b> @${req.user.username}\n` +
        `⏰ <b>Time:</b> ${timeStr}\n` +
        `-----------------------------------\n` +
        alertDetails.join("\n");

      await sendActivityTelegramMessage(telegramMsg).catch((e) => console.error("Telegram Error:", e));

      res.json({ success: true });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_ROW");
    }
  });

  // 🟢 NEW CODE: BATCH ADD ROWS ON EXCEL PASTE OVERFLOW
  router.post("/add-rows-batch", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (req.user.role === "Viewer") {
        throw new Error("Viewers cannot add rows.");
      }
      let { newRows } = req.body;
      if (!Array.isArray(newRows) || newRows.length === 0) {
        throw new Error("No rows provided.");
      }

      for (let rowObj of newRows) {
        let sn = parseInt(rowObj[COLUMNS.SN] || 1, 10);
        let plate = formatPlateNumber(rowObj[COLUMNS.PLATE_NUMBER] || "");
        let site = rowObj[COLUMNS.SITE] || "";

        let calculatedUpdates = calculateDependentFields(rowObj);
        Object.assign(rowObj, calculatedUpdates);

        await client.query(
          "INSERT INTO erp_records (sn, plate_number, site, record_data) VALUES ($1, $2, $3, $4)",
          [sn, plate, site, rowObj],
        );
      }

      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BATCH_ADD_ROWS', $2)",
        [req.user.username, JSON.stringify({ count: newRows.length })],
      );
      await client.query("COMMIT");

      await sendActivityTelegramMessage(
        `➕ <b>EXCEL PASTE: ${newRows.length} NEW ROWS ADDED</b>\n<b>Added by:</b> @${req.user.username}`,
      );
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "BATCH_ADD_ROWS");
    } finally {
      client.release();
    }
  });

  // ==========================================
  // 🐍 PYTHON ENGINE CONNECTED EXCEL EXPORT
  // ==========================================

  router.post("/export-excel-py", verifyToken, async (req, res) => {
    try {
      const { headers, rows } = req.body;

      // Python FastAPI സർവീസിലേക്ക് ഡാറ്റ നൽകുന്നു
      const pyResponse = await axios.post(
        "http://127.0.0.1:8001/py/export-excel",
        {
          headers: headers,
          rows: rows,
          sheet_name: "Haka Master Database",
        },
        {
          responseType: "arraybuffer", // എക്സൽ ബൈനറി ഡാറ്റ കൈപ്പറ്റാൻ
        },
      );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Master_Database_Export.xlsx",
      );
      res.send(pyResponse.data);
    } catch (error) {
      handleError(res, error, req.user.role, "PYTHON_EXCEL_EXPORT");
    }
  });

  // ==========================================
  // 🐍 HIGH-SPEED PYTHON BULK UPDATE PROXY
  // ==========================================
  router.post("/update-cells-batch-py", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (req.user.role === "Viewer") {
        return res.json({
          success: false,
          message: "Access Denied: Viewers cannot edit data.",
        });
      }

      const { edits } = req.body;
      if (!Array.isArray(edits) || edits.length === 0) {
        return res.json({ success: false, message: "No edits provided." });
      }

      let changeLogs = [];
      let additionalEdits = []; 

      for (let edit of edits) {
        let { dbId, colName, newValue, plate } = edit;
        const recordRes = await client.query(
          "SELECT plate_number, record_data FROM erp_records WHERE id = $1",
          [dbId],
        );
        if (recordRes.rows.length > 0) {
          let currentData = recordRes.rows[0].record_data || {};
          let rawOldVal = currentData[colName] !== undefined && currentData[colName] !== null ? String(currentData[colName]).trim() : "";
          let rawNewVal = newValue !== undefined && newValue !== null ? String(newValue).trim() : "";
          let plateNo = plate || recordRes.rows[0].plate_number || currentData["PLATE NUMBER"] || currentData["Plate Number"] || "N/A";

          if (rawOldVal !== rawNewVal) {
            changeLogs.push({
              plate: plateNo,
              colName: colName,
              oldVal: rawOldVal !== "" ? rawOldVal : "(Blank)",
              newVal: rawNewVal !== "" ? rawNewVal : "(Blank)",
            });
          }

          // 🟢 FIX: പൈത്തണിലേക്ക് അയക്കുന്നതിന് മുൻപ് Node.js-ൽ വെച്ച് തന്നെ Days Worked കാൽക്കുലേറ്റ് ചെയ്യുന്നു
          let simulatedRow = { ...currentData, [colName]: newValue };
          let calculatedUpdates = calculateDependentFields(simulatedRow);
          
          for (let calcCol in calculatedUpdates) {
             if (calculatedUpdates[calcCol] !== currentData[calcCol]) {
                additionalEdits.push({
                   dbId: dbId,
                   colName: calcCol,
                   newValue: calculatedUpdates[calcCol]
                });
             }
          }
        }
      }

      // 🟢 കാൽക്കുലേറ്റ് ചെയ്ത Days Worked ഉൾപ്പെടെയുള്ള പുതിയ ഡാറ്റ കൂടി മെയിൻ എഡിറ്റ് ലിസ്റ്റിലേക്ക് ചേർക്കുന്നു
      edits.push(...additionalEdits);

      // Forwarding batch edits to Python Engine (Port 8001)
      const pyResponse = await axios.post(
        "http://127.0.0.1:8001/py/bulk-update-cells",
        {
          edits: edits,
          username: req.user.username,
        },
      );

      // Log activity in background
      pool
        .query(
          "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BATCH_UPDATE_PY', $2)",
          [
            req.user.username, 
            JSON.stringify({ count: edits.length, changes: changeLogs })
          ],
        )
        .catch((err) => console.error("Log error:", err.message));

      // 🟢 FIX: നിലവിലുള്ള sendLiveTelegramAlert ഫങ്ഷൻ കൃത്യമായി വിളിക്കുന്നു
      if (changeLogs.length > 0) {
        await sendLiveTelegramAlert(req.user.username, changeLogs);
      }

      res.json(pyResponse.data);
    } catch (error) {
      handleError(res, error, req.user.role, "PYTHON_BATCH_UPDATE");
    } finally {
      client.release();
    }
  });

  // ==========================================
  // 🐍 HIGH-SPEED PYTHON BULK IMPORT PROXY
  // ==========================================
  router.post("/admin/import-excel-py", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") {
        return res.json({
          success: false,
          message: "Super Admin Access Required.",
        });
      }

      const { fileBase64, importMode } = req.body;
      if (!fileBase64) {
        return res.json({ success: false, message: "No file data received." });
      }

      // Forwarding Import request to Python Engine (Port 8001)
      const pyResponse = await axios.post(
        "http://127.0.0.1:8001/py/import-excel",
        {
          fileBase64: fileBase64,
          importMode: importMode,
          username: req.user.username,
        },
      );

      // Log import activity
      pool
        .query(
          "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BULK_IMPORT_PY', $2)",
          [req.user.username, JSON.stringify({ mode: importMode })],
        )
        .catch((err) => console.error("Log error:", err.message));

      res.json(pyResponse.data);
    } catch (error) {
      handleError(res, error, req.user.role, "PYTHON_BULK_IMPORT");
    }
  });

  // ==========================================
  // 🚀 DRIVER LOGIC & ONE-TIME MIGRATION APIs
  // ==========================================

  router.post("/admin/migrate-legacy-logs", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Super Admin Access Required." });
      
      const records = await pool.query("SELECT id, record_data FROM erp_records WHERE deleted_at IS NULL");
      let migratedCount = 0;

      for (let row of records.rows) {
        let data = row.record_data;
        const getCol = (matchStr) => Object.keys(data).find((k) => k.replace(/\s+/g, "").toUpperCase() === matchStr.replace(/\s+/g, "").toUpperCase()) || matchStr;
        
        let oldDriverCol = getCol("Old Driver Name");
        let odMobCol = getCol("OD Mob");
        let odEndCol = getCol("OD Wrk End");
        let statusRemarkCol = getCol("Driver Status Remark");
        
        let oldName = data[oldDriverCol];
        if (oldName && String(oldName).trim() !== "") {
          if (!data.driver_history) data.driver_history = [];
          
          let alreadyExists = data.driver_history.find(h => h.name === oldName && h.end === (data[odEndCol] || "01-Jan-1990"));
          
          if (!alreadyExists) {
            data.driver_history.push({
              id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
              name: oldName,
              mob: data[odMobCol] || "",
              start: "IDK",
              end: data[odEndCol] && String(data[odEndCol]).trim() !== "" ? data[odEndCol] : "01-Jan-1990",
              status_remark: data[statusRemarkCol] || "",
              updated_by: "System Migration",
              timestamp: Date.now()
            });
            
            await pool.query("UPDATE erp_records SET record_data = $1 WHERE id = $2", [data, row.id]);
            migratedCount++;
          }
        }
      }
      res.json({ success: true, message: `Successfully migrated ${migratedCount} legacy records.` });
    } catch (error) {
      handleError(res, error, req.user.role, "MIGRATE_LEGACY");
    }
  });

  // 🟢 /update-driver API: WORK START ഡേറ്റിൽ തൊടാതെ DRIVER START DATE മാത്രം അപ്‌ഡേറ്റ് ചെയ്യുന്നു
router.post("/update-driver", verifyToken, async (req, res) => {
  try {
    if (req.user.role === "Viewer") return res.json({ success: false, message: "Access Denied." });

    const { dbId, plate_number, currentDriver, currentMob, oldWorkStart, workEnd, newDriver, newMob, newWorkStart, statusRemark, iqamaNo, iqamaExp, licenceExp, iqamaNote, licenceNote, nationality } = req.body;
    
    const recordRes = await pool.query("SELECT record_data FROM erp_records WHERE id = $1", [dbId]);
    if (recordRes.rows.length === 0) return res.json({ success: false, message: "Record not found." });
    
    let prevData = recordRes.rows[0].record_data;
    if (!prevData.driver_history) prevData.driver_history = [];

    let finalWorkEnd = workEnd && workEnd.trim() !== "" ? workEnd : "01-Jan-1990";
    
    if (currentDriver && currentDriver.trim() !== "") {
      prevData.driver_history.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        name: currentDriver,
        mob: currentMob || "",
        start: oldWorkStart || "IDK",
        end: finalWorkEnd,
        status_remark: statusRemark || "",
        updated_by: req.user.username,
        timestamp: Date.now()
      });
    }

    let latestLog = null;
    if (prevData.driver_history.length > 0) {
      let sortedHistory = [...prevData.driver_history].sort((a, b) => {
         let timeA = new Date(a.end === "01-Jan-1990" ? 0 : a.end).getTime();
         let timeB = new Date(b.end === "01-Jan-1990" ? 0 : b.end).getTime();
         return timeA - timeB; 
      });
      latestLog = sortedHistory[sortedHistory.length - 1];
    }

    const getCol = (matchStr) => Object.keys(prevData).find(k => k.replace(/\s+/g, "").toUpperCase() === matchStr.replace(/\s+/g, "").toUpperCase()) || matchStr;
    
    if (latestLog) {
       prevData[getCol("Old Driver Name")] = latestLog.name;
       prevData[getCol("OD Mob")] = latestLog.mob;
       prevData[getCol("OD Wrk End")] = latestLog.end;
       prevData[getCol("Driver Status Remark")] = latestLog.status_remark || "";
    }

    const drvStartCol = getCol("DRIVER START DATE") || "DRIVER START DATE";

    if (newDriver) {
       prevData[getCol("DRIVER NAME")] = newDriver;
       prevData[getCol("MOBILE")] = newMob;
       prevData[drvStartCol] = newWorkStart || "";
       
       // Set new document details or clear them if left blank
       prevData[getCol("Iqama Number")] = iqamaNo !== undefined ? iqamaNo : "";
       prevData[getCol("Iqama Expire Date")] = iqamaExp !== undefined ? iqamaExp : "";
       prevData[getCol("License Expire Date")] = licenceExp !== undefined ? licenceExp : "";
       prevData[getCol("Iqama Note")] = iqamaNote !== undefined ? iqamaNote : "";
       prevData[getCol("Licence Note")] = licenceNote !== undefined ? licenceNote : "";
       prevData[getCol("Nationality")] = nationality !== undefined ? nationality : "";
    } else {
       prevData[getCol("DRIVER NAME")] = "";
       prevData[getCol("MOBILE")] = "";
       prevData[drvStartCol] = "";
       
       // Clear documents when driver is removed completely
       prevData[getCol("Iqama Number")] = "";
       prevData[getCol("Iqama Expire Date")] = "";
       prevData[getCol("License Expire Date")] = "";
       prevData[getCol("Iqama Note")] = "";
       prevData[getCol("Licence Note")] = "";
       prevData[getCol("Nationality")] = "";
    }

    await pool.query("UPDATE erp_records SET record_data = $1 WHERE id = $2", [prevData, dbId]);

    // Telegram Alert
    let alertMsg = `🔄 <b>DRIVER UPDATED / HANDOVER</b>\n\n<b>Plate:</b> ${plate_number || "N/A"}\n<b>Old Driver:</b> ${currentDriver || "None"}\n<b>New Driver:</b> ${newDriver || "None"}\n<b>Updated by:</b> @${req.user.username}`;
    await sendActivityTelegramMessage(alertMsg).catch(e => console.error("Telegram Error:", e));

    res.json({ success: true, message: "Driver updated securely." });
  } catch (error) {
    handleError(res, error, req.user.role, "UPDATE_DRIVER");
  }
});

  router.post("/add-past-driver-log", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer") return res.json({ success: false, message: "Access Denied." });

      const { dbId, driverName, mobile, workStart, workEnd, statusRemark } = req.body;
      
      // Fetching plate_number along with record_data
      const recordRes = await pool.query("SELECT plate_number, record_data FROM erp_records WHERE id = $1", [dbId]);
      if (recordRes.rows.length === 0) return res.json({ success: false, message: "Record not found." });
      
      let prevData = recordRes.rows[0].record_data;
      if (!prevData.driver_history) prevData.driver_history = [];

      let finalWorkEnd = workEnd && workEnd.trim() !== "" ? workEnd : "01-Jan-1990";
      
      prevData.driver_history.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        name: driverName,
        mob: mobile || "",
        start: workStart || "IDK",
        end: finalWorkEnd,
        status_remark: statusRemark || "",
        updated_by: req.user.username,
        timestamp: Date.now()
      });

      let sortedHistory = [...prevData.driver_history].sort((a, b) => {
           let timeA = new Date(a.end === "01-Jan-1990" ? 0 : a.end).getTime();
           let timeB = new Date(b.end === "01-Jan-1990" ? 0 : b.end).getTime();
           return timeA - timeB; 
      });
      let latestLog = sortedHistory[sortedHistory.length - 1];

      const getCol = (matchStr) => Object.keys(prevData).find(k => k.replace(/\s+/g, "").toUpperCase() === matchStr.replace(/\s+/g, "").toUpperCase()) || matchStr;
      
      if (latestLog) {
         prevData[getCol("Old Driver Name")] = latestLog.name;
         prevData[getCol("OD Mob")] = latestLog.mob;
         prevData[getCol("OD Wrk End")] = latestLog.end;
         prevData[getCol("Driver Status Remark")] = latestLog.status_remark || "";
      }

      await pool.query("UPDATE erp_records SET record_data = $1 WHERE id = $2", [prevData, dbId]);

      // Telegram Alert
      let alertMsg = `📜 <b>PAST DRIVER LOG ADDED</b>\n\n<b>Plate:</b> ${recordRes.rows[0].plate_number || "N/A"}\n<b>Driver:</b> ${driverName}\n<b>Updated by:</b> @${req.user.username}`;
      await sendActivityTelegramMessage(alertMsg).catch(e => console.error("Telegram Error:", e));

      res.json({ success: true, message: "Past driver log added." });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_PAST_DRIVER");
    }
  });

  router.post("/get-driver-logs", verifyToken, async (req, res) => {
    try {
      const { dbId } = req.body;
      const recordRes = await pool.query("SELECT record_data FROM erp_records WHERE id = $1", [dbId]);
      if (recordRes.rows.length === 0) return res.json({ success: false, logs: [] });
      
      let recData = recordRes.rows[0].record_data || {};
      let pastLogs = [...(recData.driver_history || [])];

      const getCol = (matchStr) => Object.keys(recData).find(k => k.replace(/\s+/g, "").toUpperCase() === matchStr.replace(/\s+/g, "").toUpperCase()) || matchStr;

      let currentDriverName = recData[getCol("DRIVER NAME")];
      let currentMob = recData[getCol("MOBILE")];
      let currentStart = recData[getCol("DRIVER START DATE")] || recData["driver_start_date"] || "";

      let allLogs = [];

      // 🟢 നിലവിൽ ഡ്രൈവർ ഉണ്ടെങ്കിൽ അയാളെ CURRENT ആയി ഏറ്റവും മുകളിൽ ചേർക്കുന്നു
      if (currentDriverName && String(currentDriverName).trim() !== "") {
        allLogs.push({
          id: "current",
          name: currentDriverName.trim(),
          mob: currentMob || "-",
          start: currentStart || "IDK",
          end: "Present",
          updated_by: "Active Driver",
          is_current: true
        });
      }

      // പഴയ ഡ്രൈവർമാരെ തീയതി ക്രമത്തിൽ ചേർക്കുന്നു (Newest First)
      pastLogs.sort((a, b) => new Date(b.end === "01-Jan-1990" ? 0 : b.end) - new Date(a.end === "01-Jan-1990" ? 0 : a.end));
      allLogs.push(...pastLogs);

      res.json({ 
        success: true, 
        logs: allLogs,
        currentDriverStart: currentStart
      });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_LOGS");
    }
  });

  // 🟢 NEW API: Edit Driver Log
  router.post("/edit-driver-log", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer") return res.json({ success: false, message: "Access Denied." });

      const { dbId, logId, driverName, mobile, workStart, workEnd, statusRemark } = req.body;
      
      // Fetching plate_number along with record_data
      const recordRes = await pool.query("SELECT plate_number, record_data FROM erp_records WHERE id = $1", [dbId]);
      if (recordRes.rows.length === 0) return res.json({ success: false, message: "Record not found." });
      
      let prevData = recordRes.rows[0].record_data;
      if (!prevData.driver_history) return res.json({ success: false, message: "History not found." });

      let logIndex = prevData.driver_history.findIndex(l => l.id === logId);
      if (logIndex === -1) return res.json({ success: false, message: "Log not found." });

      prevData.driver_history[logIndex].name = driverName;
      prevData.driver_history[logIndex].mob = mobile;
      prevData.driver_history[logIndex].start = workStart || "IDK";
      prevData.driver_history[logIndex].end = workEnd || "01-Jan-1990";
      prevData.driver_history[logIndex].status_remark = statusRemark || "";
      prevData.driver_history[logIndex].updated_by = req.user.username;
      prevData.driver_history[logIndex].timestamp = Date.now();

      // Sort and update the main cell dependency
      let sortedHistory = [...prevData.driver_history].sort((a, b) => {
           let timeA = new Date(a.end === "01-Jan-1990" ? 0 : a.end).getTime();
           let timeB = new Date(b.end === "01-Jan-1990" ? 0 : b.end).getTime();
           return timeA - timeB; 
      });
      let latestLog = sortedHistory[sortedHistory.length - 1];

      const getCol = (matchStr) => Object.keys(prevData).find(k => k.replace(/\s+/g, "").toUpperCase() === matchStr.replace(/\s+/g, "").toUpperCase()) || matchStr;
      
      if (latestLog) {
         prevData[getCol("Old Driver Name")] = latestLog.name;
         prevData[getCol("OD Mob")] = latestLog.mob;
         prevData[getCol("OD Wrk End")] = latestLog.end;
         prevData[getCol("Driver Status Remark")] = latestLog.status_remark || "";
      }

      await pool.query("UPDATE erp_records SET record_data = $1 WHERE id = $2", [prevData, dbId]);

      // Telegram Alert
      let alertMsg = `✏️ <b>DRIVER LOG EDITED</b>\n\n<b>Plate:</b> ${recordRes.rows[0].plate_number || "N/A"}\n<b>Driver:</b> ${driverName}\n<b>Updated by:</b> @${req.user.username}`;
      await sendActivityTelegramMessage(alertMsg).catch(e => console.error("Telegram Error:", e));

      res.json({ success: true, message: "Log updated successfully." });
    } catch (error) {
      handleError(res, error, req.user.role, "EDIT_DRIVER_LOG");
    }
  });

  // 🟢 NEW API: Delete Driver Log
  router.post("/delete-driver-log", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer") return res.json({ success: false, message: "Access Denied." });

      const { dbId, logId } = req.body;
      
      // Fetching plate_number along with record_data
      const recordRes = await pool.query("SELECT plate_number, record_data FROM erp_records WHERE id = $1", [dbId]);
      if (recordRes.rows.length === 0) return res.json({ success: false, message: "Record not found." });
      
      let prevData = recordRes.rows[0].record_data;
      if (!prevData.driver_history) return res.json({ success: false, message: "History not found." });

      // Identify the driver name before removing the log
      let logToDelete = prevData.driver_history.find(l => l.id === logId);
      let deletedDriverName = logToDelete ? logToDelete.name : "Unknown";

      // Remove the specific log
      prevData.driver_history = prevData.driver_history.filter(l => l.id !== logId);

      const getCol = (matchStr) => Object.keys(prevData).find(k => k.replace(/\s+/g, "").toUpperCase() === matchStr.replace(/\s+/g, "").toUpperCase()) || matchStr;

      if (prevData.driver_history.length > 0) {
          let sortedHistory = [...prevData.driver_history].sort((a, b) => {
               let timeA = new Date(a.end === "01-Jan-1990" ? 0 : a.end).getTime();
               let timeB = new Date(b.end === "01-Jan-1990" ? 0 : b.end).getTime();
               return timeA - timeB; 
          });
          let latestLog = sortedHistory[sortedHistory.length - 1];
          
          prevData[getCol("OLD DRIVER NAME")] = latestLog.name;
          prevData[getCol("OD MOB")] = latestLog.mob;
          prevData[getCol("OD WRK END")] = latestLog.end;
          prevData[getCol("DRIVER STATUS REMARK")] = latestLog.status_remark || "";
      } else {
          // If history is completely empty after deletion
          prevData[getCol("Old Driver Name")] = "";
          prevData[getCol("OD Mob")] = "";
          prevData[getCol("OD Wrk End")] = "";
          prevData[getCol("Driver Status Remark")] = "";
      }

      await pool.query("UPDATE erp_records SET record_data = $1 WHERE id = $2", [prevData, dbId]);

      // Telegram Alert
      let alertMsg = `🗑️ <b>DRIVER LOG DELETED</b>\n\n<b>Plate:</b> ${recordRes.rows[0].plate_number || "N/A"}\n<b>Deleted Driver:</b> ${deletedDriverName}\n<b>Deleted by:</b> @${req.user.username}`;
      await sendActivityTelegramMessage(alertMsg).catch(e => console.error("Telegram Error:", e));

      res.json({ success: true, message: "Log deleted successfully." });
    } catch (error) {
      handleError(res, error, req.user.role, "DELETE_DRIVER_LOG");
    }
  });

  // ==========================================
  // 🟢 COLUMN MANAGEMENT APIs (RENAME, LOCK, DELETE)
  // ==========================================

  // 1. Rename Column API
  router.post("/admin/rename-column", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (req.user.role !== "Super Admin") {
        return res.json({ success: false, message: "Super Admin Access Required." });
      }

      const { oldName, newName, colType } = req.body;
      if (!oldName || !newName) {
        return res.json({ success: false, message: "Names cannot be empty." });
      }

      await client.query("BEGIN");

      // പുതിയ പേരിൽ കോളം നേരത്തെ ഉണ്ടോ എന്ന് നോക്കുന്നു
      const checkRes = await client.query(
        "SELECT id FROM erp_headers WHERE header_name = $1 AND deleted_at IS NULL",
        [newName]
      );
      if (checkRes.rows.length > 0) {
        throw new Error("A column with this new name already exists.");
      }

      // Header ടേബിളിൽ പേര് മാറ്റുന്നു
      await client.query(
        "UPDATE erp_headers SET header_name = $1, col_type = $2 WHERE header_name = $3",
        [newName, colType || "varchar", oldName]
      );

      // JSON റെക്കോർഡുകളിലെ പഴയ കീ മാറ്റി പുതിയ കീ ആക്കുന്നു (Data Loss ഇല്ലാതെ)
      await client.query(
        `UPDATE erp_records 
         SET record_data = (record_data - $1) || jsonb_build_object($2::text, record_data->> $1) 
         WHERE record_data ? $1`,
        [oldName, newName]
      );

      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'RENAME_COLUMN', $2)",
        [req.user.username, JSON.stringify({ oldName, newName })]
      );

      await client.query("COMMIT");
      res.json({ success: true, message: "Column renamed successfully." });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "RENAME_COLUMN");
    } finally {
      client.release();
    }
  });

  // 2. Toggle Lock API
  router.post("/admin/toggle-lock", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") {
        return res.json({ success: false, message: "Super Admin Access Required." });
      }

      const { colName, isLocked } = req.body;
      if (!colName) return res.json({ success: false, message: "Column name required." });

      await pool.query(
        "UPDATE erp_headers SET is_locked = $1 WHERE header_name = $2",
        [isLocked, colName]
      );

      res.json({ success: true, message: `Column ${isLocked ? "Locked" : "Unlocked"} successfully.` });
    } catch (error) {
      handleError(res, error, req.user.role, "TOGGLE_LOCK");
    }
  });

  // 🟢 GET RECYCLE BIN ROWS
  router.get("/admin/recycle-bin/rows", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Access Denied." });
      const result = await pool.query("SELECT id, plate_number, record_data, deleted_at FROM erp_records WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
      res.json({ success: true, rows: result.rows });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_RECYCLE_BIN_ROWS");
    }
  });

  // 🟢 RESTORE DELETED ROW
  router.post("/admin/recycle-bin/restore-row", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Access Denied." });
      const { dbId } = req.body;
      await pool.query("UPDATE erp_records SET deleted_at = NULL WHERE id = $1", [dbId]);
      res.json({ success: true, message: "Row restored." });
    } catch (error) {
      handleError(res, error, req.user.role, "RESTORE_ROW");
    }
  });

  // 🟢 GET RECYCLE BIN COLUMNS
  router.get("/admin/recycle-bin/columns", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Access Denied." });
      const result = await pool.query("SELECT header_name, deleted_at FROM erp_headers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
      res.json({ success: true, columns: result.rows });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_RECYCLE_BIN_COLUMNS");
    }
  });

  // 🟢 RESTORE DELETED COLUMN
  router.post("/admin/recycle-bin/restore-column", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Access Denied." });
      const { colName } = req.body;
      await pool.query("UPDATE erp_headers SET deleted_at = NULL WHERE header_name = $1", [colName]);
      res.json({ success: true, message: "Column restored." });
    } catch (error) {
      handleError(res, error, req.user.role, "RESTORE_COLUMN");
    }
  });

  // 🟢 PURGE DELETED ROW (PERMANENT DELETE)
  router.post("/admin/recycle-bin/purge-row", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Access Denied." });
      const { dbId } = req.body;
      await pool.query("DELETE FROM erp_records WHERE id = $1 AND deleted_at IS NOT NULL", [dbId]);
      res.json({ success: true, message: "Row permanently deleted." });
    } catch (error) {
      handleError(res, error, req.user.role, "PURGE_ROW");
    }
  });

  // 🟢 PURGE DELETED COLUMN (PERMANENT DELETE)
  router.post("/admin/recycle-bin/purge-column", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") return res.json({ success: false, message: "Access Denied." });
      const { colName } = req.body;
      
      // 1. Delete the header definition
      await pool.query("DELETE FROM erp_headers WHERE header_name = $1 AND deleted_at IS NOT NULL", [colName]);
      
      // 2. Remove the key and data completely from JSON objects in all records to free up DB space
      await pool.query("UPDATE erp_records SET record_data = record_data - $1 WHERE record_data ? $1", [colName]);
      
      res.json({ success: true, message: "Column and its data permanently deleted." });
    } catch (error) {
      handleError(res, error, req.user.role, "PURGE_COLUMN");
    }
  });

  // 3. Delete Column API
  router.post("/admin/delete-column", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") {
        return res.json({ success: false, message: "Super Admin Access Required." });
      }

      const { colName, adminPassword } = req.body;
      if (!colName || !adminPassword) return res.json({ success: false, message: "Missing required fields." });

      // Super Admin പാസ്സ്‌വേർഡ് ശരിയാണോ എന്ന് നോക്കുന്നു
      const adminRes = await pool.query("SELECT password FROM users WHERE username = $1 AND role = 'Super Admin'", [req.user.username]);
      if (adminRes.rows.length === 0) return res.json({ success: false, message: "Admin not found." });

      const isValid = await bcrypt.compare(adminPassword, adminRes.rows[0].password);
      if (!isValid) return res.json({ success: false, message: "Incorrect Admin Password." });

   
      await pool.query(
        "UPDATE erp_headers SET deleted_at = CURRENT_TIMESTAMP WHERE header_name = $1",
        [colName]
      );

      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'DELETE_COLUMN', $2)",
        [req.user.username, JSON.stringify({ colName })]
      );

      res.json({ success: true, message: "Column moved to Recycle Bin." });
    } catch (error) {
      handleError(res, error, req.user.role, "DELETE_COLUMN");
    }
  });

  return router;
};