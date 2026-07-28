const express = require("express");
const excelJS = require("exceljs");
const bcrypt = require("bcrypt");

module.exports = function (pool, middlewares, helpers) {
  const router = express.Router();
  const { verifyToken, verifySuperAdmin, verifyEditor } = middlewares;
  const { sendActivityTelegramMessage, generateAndSendBackup } = helpers;

  // ==========================================
  // ? GLOBAL CONFIGURATIONS & CONSTANTS
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
  // ? SHARED UTILITY FUNCTIONS
  // ==========================================

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
          let d = parseInt(p[0]);
          let m = isNaN(parseInt(p[1]))
            ? mNames.indexOf(p[1].toUpperCase().substring(0, 3))
            : parseInt(p[1]) - 1;
          let y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);

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

    // JSON Array to Multi-line String Logic for Excel & UI
    if (rowData.driver_history && Array.isArray(rowData.driver_history)) {
      let names = [],
        mobs = [],
        dates = [];
      rowData.driver_history.forEach((log) => {
        names.push(log.name || "-");
        mobs.push(log.mob || "-");
        dates.push(`${log.start || "?"} to ${log.end || "?"}`);
      });
      updates[getCol(COLUMNS.OLD_DRIVER)] = names.join("\n");
      updates[getCol(COLUMNS.OD_MOB)] = mobs.join("\n");
      updates[getCol(COLUMNS.OD_WORK_END)] = dates.join("\n");
    }

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
              let d = parseInt(p[0]),
                m = mNames.indexOf(p[1].toUpperCase().substring(0, 3)),
                y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
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
  // ? MASTER DATA ROUTES
  // ==========================================

  router.post("/get-master-data", verifyToken, async (req, res) => {
    try {
      const { role, site } = req.user;
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
          SELECT * FROM erp_records WHERE site = $1 AND deleted_at IS NULL
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

  // ? BACKEND API FOR BULK EDIT / BATCH UPDATE
  router.post("/update-cells-batch", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { edits } = req.body;

      if (req.user.role === "Viewer")
        throw new Error("Access Denied: Viewers cannot edit data.");
      if (!Array.isArray(edits) || edits.length === 0)
        throw new Error("No edits provided.");

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
        let payload = { [colName]: newValue };
        let simulatedRow = { ...currentData, ...payload };

        let calculatedUpdates = calculateDependentFields(simulatedRow);
        Object.assign(payload, calculatedUpdates);

        // Single update query for each row dynamically mapping changes
        await client.query(
          `UPDATE erp_records SET record_data = record_data || $1::jsonb, plate_number = COALESCE(($1::jsonb->>'${COLUMNS.PLATE_NUMBER}'), plate_number), site = COALESCE(($1::jsonb->>'${COLUMNS.SITE}'), site), updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [JSON.stringify(payload), dbId],
        );
      }

      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BATCH_UPDATE', $2)",
        [req.user.username, JSON.stringify({ count: edits.length })],
      );

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "BATCH_UPDATE");
    } finally {
      client.release();
    }
  });

  router.post("/update-cell", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let { dbId, colName, newValue } = req.body;
      if (req.user.role === "Viewer")
        throw new Error("Access Denied: Viewers cannot edit data.");
      if (!colName || dbId === undefined)
        throw new Error("Invalid payload data.");
      if (String(colName).trim().toUpperCase() === COLUMNS.PLATE_NUMBER)
        newValue = formatPlateNumber(newValue);

      const recordRes = await client.query(
        "SELECT record_data FROM erp_records WHERE id = $1 AND deleted_at IS NULL",
        [dbId],
      );
      if (recordRes.rows.length === 0)
        throw new Error("Record not found or has been deleted.");

      let currentData = recordRes.rows[0].record_data;
      let oldValue = currentData[colName] || "";
      let plateNumber =
        currentData[COLUMNS.PLATE_NUMBER] ||
        currentData["Plate No"] ||
        "Unknown Plate";

      if (oldValue !== newValue) {
        let payload = { [colName]: newValue };
        let simulatedRow = { ...currentData, ...payload };
        let calculatedUpdates = calculateDependentFields(simulatedRow);
        Object.assign(payload, calculatedUpdates);

        await client.query(
          `UPDATE erp_records SET record_data = record_data || $1::jsonb, plate_number = COALESCE(($1::jsonb->>'${COLUMNS.PLATE_NUMBER}'), plate_number), site = COALESCE(($1::jsonb->>'${COLUMNS.SITE}'), site), updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [JSON.stringify(payload), dbId],
        );
        await client.query(
          "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'UPDATE_CELL', $2)",
          [
            req.user.username,
            JSON.stringify({
              plate: plateNumber,
              column: colName,
              old_value: oldValue,
              new_value: newValue,
            }),
          ],
        );

        if (String(colName).toUpperCase() === COLUMNS.STATUS) {
          await triggerStatusAlert(
            simulatedRow,
            plateNumber,
            oldValue,
            newValue,
            req.user.username,
          );
        }
      }
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "UPDATE_CELL");
    } finally {
      client.release();
    }
  });

  async function triggerStatusAlert(
    rowData,
    plateNumber,
    oldStatus,
    newStatus,
    username,
  ) {
    const getVal = (k) => {
      const fk = Object.keys(rowData).find((key) =>
        key
          .replace(/\s+/g, "")
          .toLowerCase()
          .includes(k.replace(/\s+/g, "").toLowerCase()),
      );
      return fk ? rowData[fk] : null;
    };
    await sendActivityTelegramMessage(
      `🔔 <b>STATUS UPDATED</b>\n\n<b>Plate:</b> ${plateNumber}\n<b>Old Status:</b> ${oldStatus || "Blank"}\n<b>New Status:</b> ${newStatus}\n\n<b>Site:</b> ${getVal(COLUMNS.SITE) || "N/A"}\n<b>Company:</b> ${getVal(COLUMNS.COMPANY) || "N/A"}\n<b>Customer:</b> ${getVal(COLUMNS.CUSTOMER) || "N/A"}\n\n<b>Work Start:</b> ${getVal(COLUMNS.WORK_START) || "N/A"}\n<b>Last Working Day:</b> ${getVal(COLUMNS.LAST_WORKING_DAY) || "N/A"}\n<b>Days Worked:</b> ${getVal(COLUMNS.DAYS_WORKED) || "N/A"}\n\n<b>Updated by:</b> @${username}`,
    );
  }

  // ==========================================
  // ? EXCEL BULK IMPORT (WITH STRING DATE FIX)
  // ==========================================
  router.post("/admin/import-excel", verifySuperAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { fileBase64, importMode } = req.body;
      const buffer = Buffer.from(fileBase64.split(",")[1], "base64");

      const workbook = new excelJS.Workbook();
      workbook.date1904 = false;
      await workbook.xlsx.load(buffer);

      const sheet1 = workbook.worksheets[0];
      let headers = [];
      sheet1.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber] = cell.value
          ? String(cell.value).trim()
          : `Col${colNumber}`;
      });

      let hasPlate = headers.some(
        (h) => h && h.toUpperCase().includes("PLATE"),
      );
      let hasSite = headers.some((h) => h && h.toUpperCase() === "SITE");

      if (!hasPlate || !hasSite)
        return res.json({
          success: false,
          message:
            "Validation Failed: 'Plate Number' and 'Site' columns are mandatory. Import aborted.",
        });

      if (importMode === "rewrite") await generateAndSendBackup();

      await client.query("BEGIN");
      let snCounter = 1;

      if (importMode === "rewrite") {
        await client.query(
          "TRUNCATE TABLE erp_records RESTART IDENTITY CASCADE",
        );
        await client.query(
          "TRUNCATE TABLE erp_headers RESTART IDENTITY CASCADE",
        );
        let validHeadersCount = 1;
        for (let i = 1; i < headers.length; i++) {
          let hName = headers[i];
          if (hName) {
            let type = "varchar";
            if (
              hName.toUpperCase().includes("DATE") ||
              hName.toUpperCase().includes("EXPIRE") ||
              hName.toUpperCase().includes("EQUIPMENT REACHED")
            ) {
              type = "date";
            }
            await client.query(
              "INSERT INTO erp_headers (header_name, col_order, col_type) VALUES ($1, $2, $3)",
              [hName, validHeadersCount++, type],
            );
          }
        }
      } else {
        const snRes = await client.query(
          "SELECT COALESCE(MAX(sn), 0) as max_sn FROM erp_records",
        );
        snCounter = parseInt(snRes.rows[0].max_sn) + 1;
      }

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

      sheet1.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        let rowData = {};
        let plateVal = "",
          siteVal = "";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          let hName = headers[colNumber];
          if (hName) {
            let val = cell.value;

            if (val && typeof val === "object" && val.result !== undefined) {
              val = val.result;
            }

            // 2. STRICT EXCEL DATE CONVERSION (IST offset fix)
            if (val && val instanceof Date) {
              const istOffset = 5.5 * 60 * 60 * 1000;
              const corrected = new Date(val.getTime() + istOffset);
              let day = String(corrected.getUTCDate()).padStart(2, "0");
              let month = corrected.getUTCMonth();
              let year = corrected.getUTCFullYear();
              val = `${day}-${months[month]}-${year}`;
            } else if (
              typeof val === "string" &&
              val.match(/^\d{4}-\d{2}-\d{2}T/)
            ) {
              const istOffset = 5.5 * 60 * 60 * 1000;
              const corrected = new Date(new Date(val).getTime() + istOffset);
              let day = String(corrected.getUTCDate()).padStart(2, "0");
              let month = corrected.getUTCMonth();
              let year = corrected.getUTCFullYear();
              val = `${day}-${months[month]}-${year}`;
            }
            // 3. Fallback for Rich Text / Formatted objects
            else if (val && typeof val === "object" && val.text) {
              val = val.text;
            }

            val = val !== null && val !== undefined ? String(val).trim() : "";
            rowData[hName] = val;
            if (hName.toUpperCase().includes("PLATE")) plateVal = val;
            if (hName.toUpperCase() === "SITE") siteVal = val;
          }
        });

        const getColName = (matchStr) =>
          Object.keys(rowData).find((k) =>
            k
              .replace(/\s+/g, "")
              .toUpperCase()
              .includes(matchStr.replace(/\s+/g, "").toUpperCase()),
          );

        let oldNames = rowData[getColName(COLUMNS.OLD_DRIVER)]
          ? String(rowData[getColName(COLUMNS.OLD_DRIVER)]).split("\n")
          : [];
        let oldMobs = rowData[getColName(COLUMNS.OD_MOB)]
          ? String(rowData[getColName(COLUMNS.OD_MOB)]).split("\n")
          : [];
        let oldDates = rowData[getColName(COLUMNS.OD_WORK_END)]
          ? String(rowData[getColName(COLUMNS.OD_WORK_END)]).split("\n")
          : [];

        if (oldNames.length > 0) {
          rowData.driver_history = [];
          for (let i = 0; i < oldNames.length; i++) {
            if (oldNames[i].trim() !== "" || oldDates[i]) {
              let parts = (oldDates[i] || "").split("to");
              rowData.driver_history.push({
                id:
                  Date.now().toString(36) +
                  Math.random().toString(36).substr(2, 5),
                name: oldNames[i].trim(),
                mob: oldMobs[i] ? oldMobs[i].trim() : "",
                start: parts[0] ? parts[0].trim() : "IDK",
                end: parts[1] ? parts[1].trim() : "IDK",
                updated_by: "Excel Import",
              });
            }
          }
        }

        let calculatedUpdates = calculateDependentFields(rowData);
        Object.assign(rowData, calculatedUpdates);

        let wsColNew = getColName(COLUMNS.WORK_START);
        let wsValNew = wsColNew ? rowData[wsColNew] : null;
        autoClosePreviousRecord(client, formatPlateNumber(plateVal), wsValNew);

        client.query(
          "INSERT INTO erp_records (sn, plate_number, site, record_data) VALUES ($1, $2, $3, $4)",
          [snCounter++, formatPlateNumber(plateVal), siteVal, rowData],
        );
      });

      const actionLabel =
        importMode === "rewrite" ? "BULK_IMPORT_REWRITE" : "BULK_IMPORT_APPEND";
      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, $2, $3)",
        [req.user.username, actionLabel, JSON.stringify({})],
      );

      await client.query("COMMIT");
      const successMessage =
        importMode === "rewrite"
          ? "Database wiped and imported successfully!"
          : "New data appended to the database successfully!";
      res.json({ success: true, message: successMessage });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "IMPORT_EXCEL");
    } finally {
      client.release();
    }
  });

  // ==========================================
  // ? OTHER ROUTES
  // ==========================================
  router.post("/update-driver", verifyToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (req.user.role === "Viewer")
        throw new Error("Access Denied: Viewers cannot edit data.");

      const {
        dbId,
        plate_number,
        currentDriver,
        currentMob,
        oldWorkStart,
        workEnd,
        newDriver,
        newMob,
        newWorkStart,
      } = req.body;
      if (!dbId || !plate_number || !workEnd)
        throw new Error(
          "Missing required driver details (End Date is mandatory).",
        );

      const recordRes = await client.query(
        "SELECT record_data FROM erp_records WHERE id = $1",
        [dbId],
      );
      if (recordRes.rows.length === 0) throw new Error("Record not found.");

      let data = recordRes.rows[0].record_data;
      if (!data.driver_history) data.driver_history = [];
      const getCol = (k) =>
        Object.keys(data).find(
          (key) =>
            key.replace(/\s+/g, "").toUpperCase() ===
            k.replace(/\s+/g, "").toUpperCase(),
        ) || k;

      if (currentDriver && currentDriver.trim() !== "") {
        data.driver_history.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          name: currentDriver,
          mob: currentMob,
          start: oldWorkStart,
          end: workEnd,
          updated_by: req.user.username,
        });
      }

      let payload = {};
      if (newDriver && newDriver.trim() !== "") {
        payload = {
          [getCol(COLUMNS.DRIVER_NAME)]: newDriver,
          [getCol(COLUMNS.MOBILE)]: newMob,
          [getCol(COLUMNS.WORK_START)]: newWorkStart,
          [getCol(COLUMNS.STATUS)]: "Running",
          driver_history: data.driver_history,
        };
      } else {
        payload = {
          [getCol(COLUMNS.DRIVER_NAME)]: "",
          [getCol(COLUMNS.MOBILE)]: "",
          [getCol(COLUMNS.WORK_START)]: "",
          [getCol(COLUMNS.LAST_WORKING_DAY)]: workEnd,
          [getCol(COLUMNS.STATUS)]: "Released",
          driver_history: data.driver_history,
        };
      }

      let simulatedRow = { ...data, ...payload };
      let calculatedUpdates = calculateDependentFields(simulatedRow);
      Object.assign(payload, calculatedUpdates);

      await client.query(
        "UPDATE erp_records SET record_data = record_data || $1::jsonb WHERE id = $2",
        [JSON.stringify(payload), dbId],
      );

      let newDName = newDriver ? newDriver : "None (Released)";
      let newDStart = newWorkStart ? newWorkStart : "N/A";

      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'UPDATE_DRIVER', $2)",
        [
          req.user.username,
          JSON.stringify({
            plate: plate_number,
            old_driver: currentDriver,
            new_driver: newDName,
          }),
        ],
      );
      await sendActivityTelegramMessage(
        `🔄 <b>DRIVER UPDATED</b>\n\n<b>Plate:</b> ${plate_number}\n\n<b>[ OLD DRIVER ]</b>\n<b>Name:</b> ${currentDriver || "None"}\n<b>Work Start:</b> ${oldWorkStart || "N/A"}\n<b>Work End:</b> ${workEnd}\n\n<b>[ NEW DRIVER ]</b>\n<b>Name:</b> ${newDName}\n<b>Work Start:</b> ${newDStart}\n\n<b>Updated by:</b> @${req.user.username}`,
      );
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Driver updated and logged successfully!",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "UPDATE_DRIVER");
    } finally {
      client.release();
    }
  });

  router.post("/get-driver-logs", verifyToken, async (req, res) => {
    try {
      const { dbId } = req.body;
      if (!dbId) throw new Error("Record ID required.");

      let curRes = await pool.query(
        "SELECT record_data FROM erp_records WHERE id = $1 AND deleted_at IS NULL",
        [dbId],
      );
      if (curRes.rows.length === 0)
        return res.json({ success: true, logs: [] });

      const data = curRes.rows[0].record_data;
      const getCol = (k) =>
        Object.keys(data).find(
          (key) =>
            key.replace(/\s+/g, "").toUpperCase() ===
            k.replace(/\s+/g, "").toUpperCase(),
        ) || k;

      let currentLog = null;
      const dName = data[getCol(COLUMNS.DRIVER_NAME)];
      const statusVal = String(
        data[getCol(COLUMNS.STATUS)] || "",
      ).toLowerCase();

      if (
        dName &&
        dName.trim() !== "" &&
        (statusVal === "running" || statusVal === "mobilizing")
      ) {
        currentLog = {
          id: "current",
          driver_name: dName,
          mobile: data[getCol(COLUMNS.MOBILE)] || "",
          work_start: data[getCol(COLUMNS.WORK_START)] || "IDK",
          work_end: "Present",
          updated_by: "System",
        };
      }

      let historyArray = data.driver_history || [];
      let finalLogs = [];
      if (currentLog) finalLogs.push(currentLog);

      historyArray
        .slice()
        .reverse()
        .forEach((h) => {
          finalLogs.push({
            id: h.id,
            driver_name: h.name,
            mobile: h.mob,
            work_start: h.start,
            work_end: h.end,
            updated_by: h.updated_by,
          });
        });

      res.json({ success: true, logs: finalLogs });
    } catch (error) {
      handleError(res, error, req.user.role, "GET_DRIVER_LOGS");
    }
  });

  router.post("/add-past-driver-log", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer")
        throw new Error("Access Denied: Viewers cannot edit data.");
      const { dbId, driverName, mobile, workStart, workEnd } = req.body;
      if (!dbId || !driverName || !workStart || !workEnd)
        throw new Error("Missing required fields for past log.");

      let curRes = await pool.query(
        "SELECT record_data FROM erp_records WHERE id = $1",
        [dbId],
      );
      let data = curRes.rows[0].record_data;
      if (!data.driver_history) data.driver_history = [];

      data.driver_history.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        name: driverName,
        mob: mobile,
        start: workStart,
        end: workEnd,
        updated_by: req.user.username,
      });

      let calcUpdates = calculateDependentFields(data);
      Object.assign(data, calcUpdates);

      await pool.query(
        "UPDATE erp_records SET record_data = $1 WHERE id = $2",
        [data, dbId],
      );
      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_PAST_LOG', $2)",
        [req.user.username, JSON.stringify({ driver_name: driverName })],
      );
      res.json({
        success: true,
        message: "Past driver log added successfully!",
      });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_PAST_LOG");
    }
  });

  router.post("/edit-driver-log", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer")
        throw new Error("Viewer cannot edit logs.");
      const { dbId, logId, driverName, mobile, workStart, workEnd } = req.body;

      let curRes = await pool.query(
        "SELECT record_data FROM erp_records WHERE id = $1",
        [dbId],
      );
      let data = curRes.rows[0].record_data;
      let history = data.driver_history || [];
      let logIndex = history.findIndex((h) => h.id === logId);

      if (logIndex !== -1) {
        history[logIndex].name = driverName;
        history[logIndex].mob = mobile;
        history[logIndex].start = workStart;
        history[logIndex].end = workEnd;
        history[logIndex].updated_by = req.user.username;

        let calcUpdates = calculateDependentFields(data);
        Object.assign(data, calcUpdates);
        await pool.query(
          "UPDATE erp_records SET record_data = $1 WHERE id = $2",
          [data, dbId],
        );
      }

      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'EDIT_DRIVER_LOG', $2)",
        [req.user.username, JSON.stringify({ driver_name: driverName })],
      );
      res.json({ success: true, message: "Driver log updated successfully!" });
    } catch (error) {
      handleError(res, error, req.user.role, "EDIT_DRIVER_LOG");
    }
  });

  router.post("/delete-driver-log", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer")
        throw new Error("Access Denied: Viewers cannot delete logs.");
      const { dbId, logId } = req.body;
      if (!dbId || !logId) throw new Error("Log ID and DB ID are required.");

      let curRes = await pool.query(
        "SELECT record_data FROM erp_records WHERE id = $1",
        [dbId],
      );
      let data = curRes.rows[0].record_data;
      if (data.driver_history) {
        data.driver_history = data.driver_history.filter((h) => h.id !== logId);
        let calcUpdates = calculateDependentFields(data);
        Object.assign(data, calcUpdates);
        await pool.query(
          "UPDATE erp_records SET record_data = $1 WHERE id = $2",
          [data, dbId],
        );
      }

      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'DELETE_DRIVER_LOG', $2)",
        [req.user.username, JSON.stringify({ log_id: logId })],
      );
      res.json({ success: true, message: "Driver log deleted successfully!" });
    } catch (error) {
      handleError(res, error, req.user.role, "DELETE_DRIVER_LOG");
    }
  });

  router.post("/add-row", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer")
        throw new Error("Viewers cannot add rows.");
      let { rowDataObj } = req.body;
      let sn = parseInt(rowDataObj[COLUMNS.SN] || 1);
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

  router.post("/add-column-relative", verifyEditor, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { colName, relativeTo, position, colType } = req.body;
      const headersRes = await client.query(
        "SELECT header_name, col_order FROM erp_headers WHERE deleted_at IS NULL ORDER BY col_order ASC",
      );
      const currentHeaders = headersRes.rows;
      const relativeIdx = currentHeaders.findIndex(
        (h) => h.header_name === relativeTo,
      );
      if (relativeIdx === -1) throw new Error("Relative column not found.");
      const newOrder =
        position === "left"
          ? currentHeaders[relativeIdx].col_order
          : currentHeaders[relativeIdx].col_order + 1;
      await client.query(
        "UPDATE erp_headers SET col_order = col_order + 1 WHERE col_order >= $1 AND deleted_at IS NULL",
        [newOrder],
      );
      await client.query(
        "INSERT INTO erp_headers (header_name, col_order, col_type) VALUES ($1, $2, $3)",
        [colName, newOrder, colType || "varchar"],
      );
      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_COLUMN', $2)",
        [req.user.username, JSON.stringify({ column: colName, type: colType })],
      );
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "ADD_COLUMN_RELATIVE");
    } finally {
      client.release();
    }
  });

  router.post("/admin/delete-column", verifySuperAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { colName, adminPassword } = req.body;
      const normCol = String(colName).replace(/\s+/g, " ").trim().toUpperCase();
      if (FIXED_COLUMNS.includes(normCol))
        throw new Error("This is a core system column and cannot be deleted.");
      const adminRes = await client.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [req.user.id],
      );
      const isValid = await bcrypt.compare(
        adminPassword,
        adminRes.rows[0].password_hash,
      );
      if (!isValid)
        throw new Error("Incorrect Super Admin Password. Action Denied.");
      await client.query(
        "UPDATE erp_headers SET deleted_at = CURRENT_TIMESTAMP WHERE header_name = $1",
        [colName],
      );
      await client.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'DELETE_COLUMN', $2)",
        [req.user.username, JSON.stringify({ column: colName })],
      );
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Column moved to recycle bin (Soft Delete)!",
      });
    } catch (error) {
      await client.query("ROLLBACK");
      handleError(res, error, req.user.role, "DELETE_COLUMN");
    } finally {
      client.release();
    }
  });

  router.post("/admin/set-alignment", verifySuperAdmin, async (req, res) => {
    try {
      const { colName, alignment } = req.body;
      await pool.query(
        "UPDATE erp_headers SET alignment = $1 WHERE header_name = $2",
        [alignment, colName],
      );
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, req.user.role, "SET_ALIGNMENT");
    }
  });

  router.post("/add-column", verifyToken, async (req, res) => {
    try {
      if (req.user.role === "Viewer") throw new Error("Access Denied");
      const { colName, colType } = req.body;
      const countRes = await pool.query(
        "SELECT COUNT(*) FROM erp_headers WHERE deleted_at IS NULL",
      );
      await pool.query(
        "INSERT INTO erp_headers (header_name, col_order, col_type) VALUES ($1, $2, $3)",
        [colName, parseInt(countRes.rows[0].count) + 1, colType || "varchar"],
      );
      await pool.query(
        "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_COLUMN', $2)",
        [req.user.username, JSON.stringify({ column: colName, type: colType })],
      );
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, req.user.role, "ADD_COLUMN");
    }
  });

  router.post("/admin/toggle-lock", verifySuperAdmin, async (req, res) => {
    try {
      const { colName, isLocked } = req.body;
      await pool.query(
        "UPDATE erp_headers SET is_locked = $1 WHERE header_name = $2",
        [isLocked, colName],
      );
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, req.user.role, "TOGGLE_LOCK");
    }
  });

  router.post("/admin/rename-column", verifySuperAdmin, async (req, res) => {
    try {
      const { oldName, newName, colType } = req.body;
      if (!oldName || !newName) throw new Error("Invalid names.");
      let finalNewName = newName.trim();
      let finalType = colType || "varchar";
      const normOld = String(oldName).replace(/\s+/g, " ").trim().toUpperCase();
      if (FIXED_COLUMNS.includes(normOld))
        throw new Error("This is a core system column and cannot be renamed.");

      if (oldName !== finalNewName) {
        const check = await pool.query(
          "SELECT * FROM erp_headers WHERE header_name = $1 AND deleted_at IS NULL",
          [finalNewName],
        );
        if (check.rows.length > 0)
          throw new Error("Column name already exists.");
        await pool.query(
          "UPDATE erp_headers SET header_name = $1, col_type = $3 WHERE header_name = $2",
          [finalNewName, oldName, finalType],
        );
        await pool.query(
          `UPDATE erp_records SET record_data = (record_data - $2) || jsonb_build_object($1::text, record_data->$2) WHERE record_data ? $2`,
          [finalNewName, oldName],
        );
      } else {
        await pool.query(
          "UPDATE erp_headers SET col_type = $1 WHERE header_name = $2",
          [finalType, oldName],
        );
      }
      res.json({ success: true, message: "Column updated successfully!" });
    } catch (error) {
      handleError(res, error, req.user.role, "RENAME_COLUMN");
    }
  });

  router.post(
    "/admin/update-owner-name",
    verifySuperAdmin,
    async (req, res) => {
      try {
        const { oldName, newName } = req.body;
        if (!oldName || !newName || oldName.trim() === newName.trim())
          throw new Error("Invalid names.");
        await pool.query(
          `UPDATE erp_records SET record_data = jsonb_set(record_data, '{Owner}', $1::jsonb) WHERE record_data->>'Owner' = $2`,
          [`"${newName.trim()}"`, oldName],
        );
        res.json({
          success: true,
          message: "Owner name updated successfully!",
        });
      } catch (error) {
        handleError(res, error, req.user.role, "UPDATE_OWNER_NAME");
      }
    },
  );

  router.get(
    "/admin/recycle-bin/columns",
    verifySuperAdmin,
    async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT header_name, deleted_at FROM erp_headers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
        );
        res.json({ success: true, columns: result.rows });
      } catch (error) {
        handleError(res, error, req.user.role, "GET_RECYCLE_BIN");
      }
    },
  );

  router.post(
    "/admin/recycle-bin/restore-column",
    verifySuperAdmin,
    async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { colName } = req.body;
        if (!colName) throw new Error("Column name is required.");
        await client.query(
          "UPDATE erp_headers SET deleted_at = NULL WHERE header_name = $1",
          [colName],
        );
        await client.query(
          "INSERT INTO activity_logs (username, action, details) VALUES ($1, 'RESTORE_COLUMN', $2)",
          [req.user.username, JSON.stringify({ column: colName })],
        );
        await client.query("COMMIT");
        res.json({ success: true, message: "Column restored successfully!" });
      } catch (error) {
        await client.query("ROLLBACK");
        handleError(res, error, req.user.role, "RESTORE_COLUMN");
      } finally {
        client.release();
      }
    },
  );

  return router;
};