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
  ];

  const STATUS_ENUM = {
    RUNNING: "running",
    RELEASED: "released",
    REPLACED: "replaced",
    MOBILIZING: "mobilizing",
  };

  // ==========================================
  // 🛠️ SHARED UTILITY FUNCTIONS (Leak-Free)
  // ==========================================
  let telegramAlertBuffer = [];
  let telegramAlertTimer = null;

  function scheduleTelegramAlert(username, changeLogs) {
    if (!changeLogs || changeLogs.length === 0) return;

    changeLogs.forEach((log) => {
      telegramAlertBuffer.push({ ...log, username });
    });

    if (!telegramAlertTimer) {
      telegramAlertTimer = setTimeout(async () => {
        const changesToSend = [...telegramAlertBuffer];
        telegramAlertBuffer = [];
        telegramAlertTimer = null;

        if (changesToSend.length === 0) return;

        try {
          const users = [...new Set(changesToSend.map((c) => `@${c.username}`))].join(", ");

          const groupedByPlate = {};
          changesToSend.forEach((item) => {
            const plate = item.plate || "N/A";
            if (!groupedByPlate[plate]) groupedByPlate[plate] = [];
            groupedByPlate[plate].push(item);
          });

          let bodySections = [];
          for (const [plate, items] of Object.entries(groupedByPlate)) {
            let lines = items.map(
              (i) => `    <b>${i.colName}:</b> <del>${i.oldVal}</del> ➔ <b>${i.newVal}</b>`
            );
            bodySections.push(`• [<b>${plate}</b>]\n${lines.join("\n\n")}`);
          }

          const finalMessage = `📝 <b>DATA UPDATED</b>\n\n<b>User:</b> ${users}\n<b>Total Changes:</b> ${changesToSend.length}\n\n${bodySections.join("\n\n\n")}`;

          await sendActivityTelegramMessage(finalMessage);
        } catch (err) {
          console.error("Telegram Alert Error:", err.message);
        }
      }, 30000); // 30 seconds batch window
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
        const dStartCol = getCol(COLUMNS.WORK_START);

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
                start: prevData[dStartCol] || "IDK",
                end: autoLwdVal,
                updated_by: "System",
              });
              prevData[dNameCol] = "";
              prevData[dMobCol] = "";
              prevData[dStartCol] = "";
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

  pool.query(`
    CREATE TABLE IF NOT EXISTS active_users (
      username VARCHAR PRIMARY KEY,
      last_seen TIMESTAMP
    )
  `).catch(err => console.error("Failed to create active_users table:", err));

  router.post("/get-master-data", verifyToken, async (req, res) => {
    try {
      const { username, role, site } = req.user;

      await pool.query(
        `INSERT INTO active_users (username, last_seen) VALUES ($1, CURRENT_TIMESTAMP) 
         ON CONFLICT (username) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`,
        [username]
      );
      
      // Fetch users active in the last 45 seconds
      const activeRes = await pool.query(
        `SELECT username FROM active_users WHERE last_seen > NOW() - INTERVAL '45 seconds'`
      );
      const activeUsersList = activeRes.rows.map(r => r.username);

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
      let rows = [],
        maxSN = 0;
      dataResult.rows.forEach((dbRow) => {
        let rowArray = [];
        headers.forEach((h) => rowArray.push(dbRow.record_data[h] || ""));
        rowArray.push(dbRow.id);
        rows.push(rowArray);
        if (dbRow.sn > maxSN) maxSN = dbRow.sn;
      });

      res.json({
        success: true,
        headers,
        lockedCols,
        alignments,
        colTypes,
        colWidths,
        rows,
        nextSN: maxSN + 1,
        activeUsers: activeUsersList,
      });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_MASTER_DATA");
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
          "SELECT record_data FROM erp_records WHERE id = $1",
          [dbId],
        );
        if (recordRes.rows.length === 0) continue;

        let currentData = recordRes.rows[0].record_data;
        let oldValue = currentData[colName] || "(Blank)";
        let displayNewValue = newValue || "(Blank)";
        let plateNo = currentData[COLUMNS.PLATE_NUMBER] || currentData["PLATE NUMBER"] || currentData["Plate Number"] || "N/A";

        if (String(oldValue).trim() !== String(displayNewValue).trim()) {
          changeLogs.push({
            plate: plateNo,
            colName: colName,
            oldVal: oldValue,
            newVal: displayNewValue,
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
        [req.user.username, JSON.stringify({ count: edits.length, changes: changeLogs })],
      );

      await client.query("COMMIT");

      // Send changes to 30-second Batching Buffer
      if (changeLogs.length > 0) {
        scheduleTelegramAlert(req.user.username, changeLogs);
      }

      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "BATCH_UPDATE");
    } finally {
      client.release();
    }
  });

  router.post("/add-row", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer")
        throw new Error("Viewers cannot add rows.");
      let { rowDataObj } = req.body;
      let sn = parseInt(rowDataObj[COLUMNS.SN] || 1, 10);
      let plate = formatPlateNumber(rowDataObj[COLUMNS.PLATE_NUMBER] || "");
      let site = rowDataObj[COLUMNS.SITE] || "";

      let calculatedUpdates = calculateDependentFields(rowDataObj);
      Object.assign(rowDataObj, calculatedUpdates);

      const getColName = (matchStr) =>
        Object.keys(rowDataObj).find((k) =>
          k
            .replace(/\s+/g, "")
            .toUpperCase()
            .includes(matchStr.replace(/\s+/g, "").toUpperCase()),
        );
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
      await sendActivityTelegramMessage(
        `➕ <b>NEW VEHICLE ADDED</b>\n\n<b>Plate:</b> ${plate}\n<b>Site:</b> ${site || "N/A"}\n<b>Added by:</b> @${req.user.username}`,
      );
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_ROW");
    }
  });


  // ==========================================
  // 🐍 PYTHON ENGINE CONNECTED EXCEL EXPORT
  // ==========================================

  router.post("/export-excel-py", verifyToken, async (req, res) => {
    try {
      const { headers, rows } = req.body;
      
      // Python FastAPI സർവീസിലേക്ക് ഡാറ്റ നൽകുന്നു
      const pyResponse = await axios.post("http://127.0.0.1:8001/py/export-excel", {
        headers: headers,
        rows: rows,
        sheet_name: "Haka Master Database"
      }, {
        responseType: "arraybuffer" // എക്സൽ ബൈനറി ഡാറ്റ കൈപ്പറ്റാൻ
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Master_Database_Export.xlsx");
      res.send(pyResponse.data);
    } catch (error) {
      handleError(res, error, req.user.role, "PYTHON_EXCEL_EXPORT");
    }
  });

  // ==========================================
  // 🐍 HIGH-SPEED PYTHON BULK UPDATE PROXY
  // ==========================================
  router.post("/update-cells-batch-py", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer") {
        return res.json({ success: false, message: "Access Denied: Viewers cannot edit data." });
      }

      const { edits } = req.body;
      if (!Array.isArray(edits) || edits.length === 0) {
        return res.json({ success: false, message: "No edits provided." });
      }

      // Forwarding batch edits to Python Engine (Port 8001)
      const pyResponse = await axios.post("http://127.0.0.1:8001/py/bulk-update-cells", {
        edits: edits,
        username: req.user.username
      });

      // Log activity in background
      pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BATCH_UPDATE_PY', $2)",
        [req.user.username, JSON.stringify({ count: edits.length })]
      ).catch(err => console.error("Log error:", err.message));

      res.json(pyResponse.data);
    } catch (error) {
      handleError(res, error, req.user.role, "PYTHON_BATCH_UPDATE");
    }
  });

  // ==========================================
  // 🐍 HIGH-SPEED PYTHON BULK IMPORT PROXY
  // ==========================================
  router.post("/admin/import-excel-py", verifyToken, async (req, res) => {
    try {
      if (req.user.role !== "Super Admin") {
        return res.json({ success: false, message: "Super Admin Access Required." });
      }

      const { fileBase64, importMode } = req.body;
      if (!fileBase64) {
        return res.json({ success: false, message: "No file data received." });
      }

      // Forwarding Import request to Python Engine (Port 8001)
      const pyResponse = await axios.post("http://127.0.0.1:8001/py/import-excel", {
        fileBase64: fileBase64,
        importMode: importMode,
        username: req.user.username
      });

      // Log import activity
      pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BULK_IMPORT_PY', $2)",
        [req.user.username, JSON.stringify({ mode: importMode })]
      ).catch(err => console.error("Log error:", err.message));

      res.json(pyResponse.data);
    } catch (error) {
      handleError(res, error, req.user.role, "PYTHON_BULK_IMPORT");
    }
  });

  return router;
};

