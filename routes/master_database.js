const express = require('express');
const excelJS = require('exceljs');
const bcrypt = require('bcrypt');

module.exports = function (pool, middlewares, helpers) {
    const router = express.Router();
    const { verifyToken, verifySuperAdmin, verifyEditor } = middlewares;
    const { sendActivityTelegramMessage, generateAndSendBackup } = helpers;

    // ==========================================
    // ⚙️ GLOBAL CONFIGURATIONS & CONSTANTS
    // ==========================================
    // Centralized column mappings to avoid hardcoded strings scattering
    const COLUMNS = {
        SN: 'SN',
        PLATE_NUMBER: 'PLATE NUMBER',
        SITE: 'SITE',
        STATUS: 'STATUS',
        COMPANY: 'COMPANY',
        CUSTOMER: 'CUSTOMER',
        IF_SUB: 'IF SUB',
        WORK_START: 'WORK START',
        LAST_WORKING_DAY: 'LAST WORKING DAY',
        DAYS_WORKED: 'DAYS WORKED',
        MOBILIZATION: 'EQUIPMENT REACHED AT SITE',
        RELEASE_DATE: 'RELEASE DATE',
        REPLACED_DATE: 'REPLACED DATE',
        OLD_DRIVER: 'OLD DRIVER NAME',
        OD_WORK_END: 'OD WRK END',
        DRIVER_NAME: 'DRIVER NAME',
        MOBILE: 'MOBILE'
    };

    const FIXED_COLUMNS = [
        COLUMNS.MOBILIZATION, COLUMNS.WORK_START, COLUMNS.LAST_WORKING_DAY,
        COLUMNS.RELEASE_DATE, COLUMNS.REPLACED_DATE, COLUMNS.OD_WORK_END,
        COLUMNS.OLD_DRIVER, COLUMNS.DAYS_WORKED
    ];

    const STATUS_ENUM = {
        RUNNING: 'running',
        RELEASED: 'released',
        REPLACED: 'replaced',
        MOBILIZING: 'mobilizing'
    };

    // ==========================================
    // 🛠️ SHARED UTILITY FUNCTIONS
    // ==========================================

    /**
     * Formats the plate number to a standard structure.
     */
    function formatPlateNumber(val) {
        if (!val) return "";
        let p = String(val).toUpperCase().trim();
        let raw = p.replace(/\s+/g, '');
        let jMatch = raw.match(/^J(\d+)$/);
        if (jMatch) return "J" + jMatch[1];
        let normalMatch = raw.match(/^(\d+)([A-Z]+)$/);
        if (normalMatch) return normalMatch[1] + " " + normalMatch[2];
        return p.replace(/\s+/g, ' ');
    }

    /**
     * Auto-calculates dependent fields (e.g., Days Worked, Fallback dates).
     * @param {Object} rowData - The current JSON data of the row.
     * @returns {Object} - Returns ONLY the fields that were modified/calculated (for JSONB optimization).
     */
    function calculateDependentFields(rowData) {
        const updates = {};
        const getCol = (matchStr) => Object.keys(rowData).find(k => k.replace(/\s+/g, '').toUpperCase().includes(matchStr.replace(/\s+/g, '').toUpperCase()));

        const mobCol = getCol(COLUMNS.MOBILIZATION);
        const wsCol = getCol(COLUMNS.WORK_START);
        const lwdCol = getCol(COLUMNS.LAST_WORKING_DAY);
        const daysCol = getCol(COLUMNS.DAYS_WORKED);
        const statusCol = Object.keys(rowData).find(k => k.toUpperCase() === COLUMNS.STATUS);
        const relCol = getCol('RELEASEDATE') || getCol('RELEASEDDATE');
        const repCol = getCol('REPLACEDDATE') || getCol('REPLACEDATE');

        let mobVal = mobCol ? rowData[mobCol] : '';
        let wsVal = wsCol ? rowData[wsCol] : '';
        let lwdVal = lwdCol ? rowData[lwdCol] : '';
        let statusVal = statusCol ? String(rowData[statusCol] || '').toLowerCase() : '';

        // 1. Work Start Fallback Calculation
        if (mobVal && (!wsVal || String(wsVal).trim() === '') && wsCol) {
            updates[wsCol] = mobVal;
            wsVal = mobVal;
        }

        // 2. Days Worked Calculation
        if (wsVal && lwdVal && daysCol) {
            const parseDate = (dStr) => {
                if (!dStr) return null;
                const p = String(dStr).trim().split(/[\/\- \.]/);
                const mNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
                if (p.length === 3) {
                    let d = parseInt(p[0]);
                    let m = mNames.indexOf(p[1].toUpperCase().substring(0, 3));
                    let y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
                    if (!isNaN(d) && m !== -1 && !isNaN(y)) return new Date(y, m, d);
                }
                return null;
            };
            const d1 = parseDate(wsVal), d2 = parseDate(lwdVal);
            if (d1 && d2 && !isNaN(d1) && !isNaN(d2)) {
                const diffDays = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
                if (diffDays >= 0) updates[daysCol] = String(diffDays);
            }
        }

        // 3. Status Based Date Fallbacks
        if (statusVal === STATUS_ENUM.RELEASED && lwdVal && relCol && (!rowData[relCol] || String(rowData[relCol]).trim() === '')) {
            updates[relCol] = lwdVal;
        }
        if (statusVal === STATUS_ENUM.REPLACED && lwdVal && repCol && (!rowData[repCol] || String(rowData[repCol]).trim() === '')) {
            updates[repCol] = lwdVal;
        }

        return updates;
    }

    /**
     * Standardized Error Handler to prevent exposing DB vulnerabilities.
     */
    function handleError(res, error, role, context = "Error") {
        console.error(`[${context}]`, error);
        // Expose real error only to Super Admin for debugging, mask it for others
        const message = role === 'Super Admin' ? error.message : "A secure server error occurred. Please contact the administrator.";
        return res.json({ success: false, message });
    }


    // ==========================================
    // 🚀 MASTER DATA ROUTES
    // ==========================================

    /**
     * GET MASTER DATA
     * Excludes Soft-Deleted columns (deleted_at IS NULL)
     */
    router.post('/get-master-data', verifyToken, async (req, res) => {
        try {
            const { role, site } = req.user;

            // OPTIMIZATION: Filter out soft-deleted columns
            const headerResult = await pool.query(`
                SELECT header_name, is_locked, alignment, col_type 
                FROM erp_headers 
                WHERE deleted_at IS NULL 
                ORDER BY col_order ASC
            `);

            let headers = headerResult.rows.map(h => h.header_name);
            let lockedCols = headerResult.rows.filter(h => h.is_locked).map(h => h.header_name);
            let alignments = headerResult.rows.map(h => ({ name: h.header_name, align: h.alignment }));
            let colTypes = headerResult.rows.map(h => ({ name: h.header_name, type: h.col_type || 'varchar' }));

            let query = `
                SELECT * FROM erp_records 
                WHERE deleted_at IS NULL
                ORDER BY 
                    COALESCE(record_data->>'Site', '') ASC, 
                    COALESCE(record_data->>'Company', '') ASC, 
                    COALESCE(record_data->>'If Sub', '') ASC, 
                    CASE LOWER(TRIM(record_data->>'Status'))
                        WHEN 'mobilizing' THEN 1
                        WHEN 'running' THEN 2
                        WHEN 'replaced' THEN 3
                        WHEN 'released' THEN 4
                        ELSE 5
                    END ASC,
                    sn ASC
            `;
            let params = [];

            if (role !== 'Admin' && role !== 'Super Admin' && role !== 'Viewer') {
                query = `
                    SELECT * FROM erp_records 
                    WHERE site = $1 AND deleted_at IS NULL
                    ORDER BY 
                        COALESCE(record_data->>'Site', '') ASC, 
                        COALESCE(record_data->>'Company', '') ASC, 
                        COALESCE(record_data->>'If Sub', '') ASC, 
                        CASE LOWER(TRIM(record_data->>'Status'))
                            WHEN 'mobilizing' THEN 1
                            WHEN 'running' THEN 2
                            WHEN 'replaced' THEN 3
                            WHEN 'released' THEN 4
                            ELSE 5
                        END ASC,
                        sn ASC
                `;
                params = [site];
            }

            const dataResult = await pool.query(query, params);
            let rows = [], maxSN = 0;

            dataResult.rows.forEach(dbRow => {
                let rowArray = [];
                headers.forEach(h => rowArray.push(dbRow.record_data[h] || ""));
                rowArray.push(dbRow.id); // Push DB ID at the end
                rows.push(rowArray);
                if (dbRow.sn > maxSN) maxSN = dbRow.sn;
            });

            res.json({ success: true, headers, lockedCols, alignments, colTypes, rows, nextSN: maxSN + 1 });
        } catch (error) {
            handleError(res, error, req.user.role, "GET_MASTER_DATA");
        }
    });

    /**
     * UPDATE SINGLE CELL
     * Uses JSONB Concatenation (||) to prevent Race Conditions.
     */
    router.post('/update-cell', verifyToken, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let { dbId, colName, newValue } = req.body;
            if (req.user.role === 'Viewer') throw new Error('Access Denied: Viewers cannot edit data.');

            // Input Validation & Formatting
            if (!colName || dbId === undefined) throw new Error("Invalid payload data.");
            if (String(colName).trim().toUpperCase() === COLUMNS.PLATE_NUMBER) newValue = formatPlateNumber(newValue);

            // Fetch current row data to run calculations
            const recordRes = await client.query('SELECT record_data FROM erp_records WHERE id = $1 AND deleted_at IS NULL', [dbId]);
            if (recordRes.rows.length === 0) throw new Error("Record not found or has been deleted.");

            let currentData = recordRes.rows[0].record_data;
            let oldValue = currentData[colName] || "";
            let plateNumber = currentData[COLUMNS.PLATE_NUMBER] || currentData['Plate No'] || 'Unknown Plate';

            if (oldValue !== newValue) {
                // Prepare specific update payload
                let payload = { [colName]: newValue };

                // Simulate new row state for auto-calculation
                let simulatedRow = { ...currentData, ...payload };
                let calculatedUpdates = calculateDependentFields(simulatedRow);

                // Merge calculated fields into the payload
                Object.assign(payload, calculatedUpdates);

                // OPTIMIZATION: Use JSONB concatenation (||) to merge ONLY updated fields
                // This prevents overwriting another user's simultaneous edit on a different column!
                await client.query(`
                    UPDATE erp_records 
                    SET record_data = record_data || $1::jsonb, 
                        plate_number = COALESCE(($1::jsonb->>'${COLUMNS.PLATE_NUMBER}'), plate_number), 
                        site = COALESCE(($1::jsonb->>'${COLUMNS.SITE}'), site), 
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = $2`,
                    [JSON.stringify(payload), dbId]
                );

                await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'UPDATE_CELL', $2)", [
                    req.user.username,
                    JSON.stringify({ plate: plateNumber, column: colName, old_value: oldValue, new_value: newValue })
                ]);

                // Telegram Alert Trigger (Extracted for cleaner code)
                if (String(colName).toUpperCase() === COLUMNS.STATUS) {
                    await triggerStatusAlert(simulatedRow, plateNumber, oldValue, newValue, req.user.username);
                }
            }
            await client.query('COMMIT');
            res.json({ success: true });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "UPDATE_CELL");
        } finally {
            client.release();
        }
    });

    /**
     * BATCH UPDATE CELLS (NEW ROUTE)
     * Processes an array of edits in a single transaction to reduce server load.
     */
    router.post('/update-cells-batch', verifyToken, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { edits } = req.body; // Array of {dbId, colName, newValue}

            if (req.user.role === 'Viewer') throw new Error('Access Denied: Viewers cannot edit data.');
            if (!Array.isArray(edits) || edits.length === 0) throw new Error("No edits provided.");

            for (let edit of edits) {
                let { dbId, colName, newValue } = edit;
                if (String(colName).trim().toUpperCase() === COLUMNS.PLATE_NUMBER) newValue = formatPlateNumber(newValue);

                const recordRes = await client.query('SELECT record_data FROM erp_records WHERE id = $1', [dbId]);
                if (recordRes.rows.length === 0) continue;

                let currentData = recordRes.rows[0].record_data;
                let payload = { [colName]: newValue };
                let simulatedRow = { ...currentData, ...payload };
                let calculatedUpdates = calculateDependentFields(simulatedRow);
                Object.assign(payload, calculatedUpdates);

                await client.query(`
                    UPDATE erp_records 
                    SET record_data = record_data || $1::jsonb, 
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = $2`,
                    [JSON.stringify(payload), dbId]
                );
            }

            await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BATCH_UPDATE', $2)", [
                req.user.username, JSON.stringify({ count: edits.length })
            ]);

            await client.query('COMMIT');
            res.json({ success: true });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "BATCH_UPDATE");
        } finally {
            client.release();
        }
    });

    /**
     * Helper for Status Telegram Alerts
     */
    async function triggerStatusAlert(rowData, plateNumber, oldStatus, newStatus, username) {
        const getVal = (k) => {
            const fk = Object.keys(rowData).find(key => key.replace(/\s+/g, '').toLowerCase().includes(k.replace(/\s+/g, '').toLowerCase()));
            return fk ? rowData[fk] : null;
        };

        await sendActivityTelegramMessage(
            `🔄 <b>STATUS UPDATED</b>\n\n` +
            `<b>Plate:</b> ${plateNumber}\n` +
            `<b>Old Status:</b> ${oldStatus || 'Blank'}\n` +
            `<b>New Status:</b> ${newStatus}\n\n` +
            `<b>Site:</b> ${getVal(COLUMNS.SITE) || 'N/A'}\n` +
            `<b>Company:</b> ${getVal(COLUMNS.COMPANY) || 'N/A'}\n` +
            `<b>Customer:</b> ${getVal(COLUMNS.CUSTOMER) || 'N/A'}\n\n` +
            `<b>Work Start:</b> ${getVal(COLUMNS.WORK_START) || 'N/A'}\n` +
            `<b>Last Working Day:</b> ${getVal(COLUMNS.LAST_WORKING_DAY) || 'N/A'}\n` +
            `<b>Days Worked:</b> ${getVal(COLUMNS.DAYS_WORKED) || 'N/A'}\n\n` +
            `<b>Updated by:</b> @${username}`
        );
    }

    /**
     * UPDATE DRIVER
     */
    router.post('/update-driver', verifyToken, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (req.user.role === 'Viewer') throw new Error('Access Denied: Viewers cannot edit data.');

            const { dbId, plate_number, currentDriver, currentMob, oldWorkStart, workEnd, newDriver, newMob, newWorkStart } = req.body;
            if (!dbId || !plate_number || !newDriver) throw new Error("Missing required driver details.");

            const recordRes = await client.query('SELECT record_data FROM erp_records WHERE id = $1', [dbId]);
            if (recordRes.rows.length === 0) throw new Error("Record not found.");

            let data = recordRes.rows[0].record_data;
            const getCol = (k) => Object.keys(data).find(key => key.replace(/\s+/g, '').toUpperCase() === k.replace(/\s+/g, '').toUpperCase()) || k;

            let payload = {
                [getCol(COLUMNS.OLD_DRIVER)]: currentDriver,
                [getCol(COLUMNS.OD_WORK_END)]: workEnd,
                [getCol(COLUMNS.DRIVER_NAME)]: newDriver,
                [getCol(COLUMNS.MOBILE)]: newMob,
                [getCol(COLUMNS.WORK_START)]: newWorkStart
            };

            let simulatedRow = { ...data, ...payload };
            let calculatedUpdates = calculateDependentFields(simulatedRow);
            Object.assign(payload, calculatedUpdates);

            // Optimized Update
            await client.query('UPDATE erp_records SET record_data = record_data || $1::jsonb WHERE id = $2', [JSON.stringify(payload), dbId]);

            // Archive to driver_logs
            await client.query(
                `INSERT INTO driver_logs (plate_number, driver_name, mobile, work_start, work_end, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [plate_number, currentDriver, currentMob, oldWorkStart, workEnd, req.user.username]
            );

            await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'UPDATE_DRIVER', $2)", [
                req.user.username,
                JSON.stringify({ plate: plate_number, old_driver: currentDriver, new_driver: newDriver, work_start: newWorkStart })
            ]);

            await sendActivityTelegramMessage(
                `🧑‍✈️ <b>DRIVER CHANGED</b>\n\n` +
                `<b>Plate:</b> ${plate_number}\n\n` +
                `<b>[ OLD DRIVER ]</b>\n` +
                `<b>Name:</b> ${currentDriver || 'None'}\n` +
                `<b>Work Start:</b> ${oldWorkStart || 'N/A'}\n` +
                `<b>Work End:</b> ${workEnd}\n\n` +
                `<b>[ NEW DRIVER ]</b>\n` +
                `<b>Name:</b> ${newDriver}\n` +
                `<b>Work Start:</b> ${newWorkStart}\n\n` +
                `<b>Updated by:</b> @${req.user.username}`
            );

            await client.query('COMMIT');
            res.json({ success: true, message: "Driver updated and logged successfully!" });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "UPDATE_DRIVER");
        } finally {
            client.release();
        }
    });

    /**
     * GET DRIVER LOGS
     */
    router.post('/get-driver-logs', verifyToken, async (req, res) => {
        try {
            const { plate_number } = req.body;
            const result = await pool.query('SELECT id, plate_number, driver_name, mobile, work_start, work_end, updated_by, created_at FROM driver_logs WHERE plate_number = $1 ORDER BY created_at DESC', [plate_number]);

            const curRes = await pool.query('SELECT record_data FROM erp_records WHERE plate_number = $1 AND deleted_at IS NULL', [plate_number]);
            let currentLog = null;

            if (curRes.rows.length > 0) {
                const data = curRes.rows[0].record_data;
                const getCol = (k) => Object.keys(data).find(key => key.replace(/\s+/g, '').toUpperCase() === k.replace(/\s+/g, '').toUpperCase()) || k;

                const dName = data[getCol(COLUMNS.DRIVER_NAME)];
                if (dName && dName.trim() !== '') {
                    currentLog = {
                        id: 'current',
                        plate_number: plate_number,
                        driver_name: dName,
                        mobile: data[getCol(COLUMNS.MOBILE)] || '',
                        work_start: data[getCol(COLUMNS.WORK_START)] || 'IDK',
                        work_end: 'Present',
                        updated_by: 'System'
                    };
                }
            }

            let finalLogs = [];
            if (currentLog) finalLogs.push(currentLog);
            finalLogs = finalLogs.concat(result.rows);

            res.json({ success: true, logs: finalLogs });
        } catch (error) {
            handleError(res, error, req.user.role, "GET_DRIVER_LOGS");
        }
    });

    /**
     * EDIT SPECIFIC DRIVER LOG
     */
    router.post('/edit-driver-log', verifyToken, async (req, res) => {
        try {
            if (req.user.role === 'Viewer') throw new Error('Viewer cannot edit logs.');
            const { logId, driverName, mobile, workStart, workEnd } = req.body;

            await pool.query(
                `UPDATE driver_logs SET driver_name=$1, mobile=$2, work_start=$3, work_end=$4, updated_by=$5, created_at=NOW() WHERE id=$6`,
                [driverName, mobile, workStart, workEnd, req.user.username, logId]
            );

            await pool.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'EDIT_DRIVER_LOG', $2)", [
                req.user.username,
                JSON.stringify({ log_id: logId, driver_name: driverName })
            ]);

            res.json({ success: true, message: 'Driver log updated successfully!' });
        } catch (error) {
            handleError(res, error, req.user.role, "EDIT_DRIVER_LOG");
        }
    });

    /**
     * ADD NEW ROW ENTRY
     */
    router.post('/add-row', verifyToken, async (req, res) => {
        try {
            if (req.user.role === 'Viewer') throw new Error('Viewers cannot add rows.');
            let { rowDataObj } = req.body;

            let sn = parseInt(rowDataObj[COLUMNS.SN] || 1);
            let plate = formatPlateNumber(rowDataObj[COLUMNS.PLATE_NUMBER] || '');
            let site = rowDataObj[COLUMNS.SITE] || '';

            // Apply calculations before inserting
            let calculatedUpdates = calculateDependentFields(rowDataObj);
            Object.assign(rowDataObj, calculatedUpdates);

            await pool.query('INSERT INTO erp_records (sn, plate_number, site, record_data) VALUES ($1, $2, $3, $4)', [sn, plate, site, rowDataObj]);

            await pool.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_ROW', $2)", [req.user.username, JSON.stringify({ plate: plate, site: site })]);

            await sendActivityTelegramMessage(
                `🟢 <b>NEW VEHICLE ADDED</b>\n\n` +
                `<b>Plate:</b> ${plate}\n` +
                `<b>Site:</b> ${site || 'N/A'}\n` +
                `<b>Added by:</b> @${req.user.username}`
            );

            res.json({ success: true });
        } catch (error) {
            handleError(res, error, req.user.role, "ADD_ROW");
        }
    });

    /**
     * IMPORT EXCEL MASTER DATA
     */
    router.post('/admin/import-excel', verifySuperAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            const { fileBase64 } = req.body;
            const buffer = Buffer.from(fileBase64.split(',')[1], 'base64');
            const workbook = new excelJS.Workbook();
            await workbook.xlsx.load(buffer);

            const sheet1 = workbook.worksheets[0];
            let headers = [];

            sheet1.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
                headers[colNumber] = cell.value ? String(cell.value).trim() : `Col${colNumber}`;
            });

            let hasPlate = headers.some(h => h && h.toUpperCase().includes('PLATE'));
            let hasSite = headers.some(h => h && h.toUpperCase() === 'SITE');

            if (!hasPlate || !hasSite) {
                return res.json({ success: false, message: "Validation Failed: 'Plate Number' and 'Site' columns are mandatory. Import aborted." });
            }

            await generateAndSendBackup();

            await client.query('BEGIN');

            // NOTE: Using Hard delete for imports to ensure clean wipe.
            await client.query('TRUNCATE TABLE erp_records RESTART IDENTITY CASCADE');
            await client.query('TRUNCATE TABLE erp_headers RESTART IDENTITY CASCADE');

            let validHeadersCount = 1;
            for (let i = 1; i < headers.length; i++) {
                let hName = headers[i];
                if (hName) {
                    let type = 'varchar';
                    if (hName.toUpperCase().includes('DATE') || hName.toUpperCase().includes('EXPIRE') || hName.toUpperCase().includes('EQUIPMENT REACHED')) type = 'date';
                    await client.query('INSERT INTO erp_headers (header_name, col_order, col_type) VALUES ($1, $2, $3)', [hName, validHeadersCount++, type]);
                }
            }

            let snCounter = 1;
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            sheet1.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                let rowData = {};
                let plateVal = '';
                let siteVal = '';

                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    let hName = headers[colNumber];
                    if (hName) {
                        let val = cell.value;
                        if (val && typeof val === 'object' && val.text) val = val.text;
                        if (val && val instanceof Date) {
                            val = `${String(val.getDate()).padStart(2, '0')}-${months[val.getMonth()]}-${val.getFullYear()}`;
                        }
                        val = val !== null && val !== undefined ? String(val).trim() : '';
                        rowData[hName] = val;

                        if (hName.toUpperCase().includes('PLATE')) plateVal = val;
                        if (hName.toUpperCase() === 'SITE') siteVal = val;
                    }
                });

                let calculatedUpdates = calculateDependentFields(rowData);
                Object.assign(rowData, calculatedUpdates);

                client.query('INSERT INTO erp_records (sn, plate_number, site, record_data) VALUES ($1, $2, $3, $4)',
                    [snCounter++, formatPlateNumber(plateVal), siteVal, rowData]);
            });

            let logSheet = workbook.getWorksheet('Driver Logs');
            if (logSheet) {
                await client.query('TRUNCATE TABLE driver_logs RESTART IDENTITY CASCADE');
                let logHeaders = [];
                logSheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    logHeaders[colNumber] = cell.value ? String(cell.value).toUpperCase().trim() : '';
                });

                logSheet.eachRow((row, rowNumber) => {
                    if (rowNumber === 1) return;
                    let rowD = {};
                    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        let hName = logHeaders[colNumber];
                        if (hName) {
                            let val = cell.value;
                            if (val && typeof val === 'object' && val.text) val = val.text;
                            if (val && val instanceof Date) {
                                val = `${String(val.getDate()).padStart(2, '0')}-${months[val.getMonth()]}-${val.getFullYear()}`;
                            }
                            rowD[hName] = val !== null && val !== undefined ? String(val).trim() : '';
                        }
                    });
                    if (rowD['PLATE NUMBER']) {
                        client.query(`INSERT INTO driver_logs (plate_number, driver_name, mobile, work_start, work_end, updated_by, created_at)
                                      VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                            [rowD['PLATE NUMBER'], rowD['DRIVER NAME'], rowD['MOBILE'], rowD['WORK START'], rowD['WORK END'], rowD['UPDATED BY']]);
                    }
                });
            }

            await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'BULK_IMPORT', $2)", [req.user.username, JSON.stringify({})]);

            await client.query('COMMIT');
            res.json({ success: true, message: "Database wiped and imported successfully!" });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "IMPORT_EXCEL");
        } finally {
            client.release();
        }
    });

    /**
     * ADD COLUMN (RELATIVE POSITION)
     */
    router.post('/add-column-relative', verifyEditor, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { colName, relativeTo, position, colType } = req.body;

            const headersRes = await client.query('SELECT header_name, col_order FROM erp_headers WHERE deleted_at IS NULL ORDER BY col_order ASC');
            const currentHeaders = headersRes.rows;
            const relativeIdx = currentHeaders.findIndex(h => h.header_name === relativeTo);

            if (relativeIdx === -1) throw new Error("Relative column not found.");

            const newOrder = position === 'left' ? currentHeaders[relativeIdx].col_order : currentHeaders[relativeIdx].col_order + 1;

            await client.query('UPDATE erp_headers SET col_order = col_order + 1 WHERE col_order >= $1 AND deleted_at IS NULL', [newOrder]);
            await client.query('INSERT INTO erp_headers (header_name, col_order, col_type) VALUES ($1, $2, $3)', [colName, newOrder, colType || 'varchar']);

            await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_COLUMN', $2)", [
                req.user.username,
                JSON.stringify({ column: colName, type: colType })
            ]);

            await client.query('COMMIT');
            res.json({ success: true });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "ADD_COLUMN_RELATIVE");
        } finally {
            client.release();
        }
    });

    /**
     * DELETE COLUMN (SOFT DELETE IMPLEMETATION)
     */
    router.post('/admin/delete-column', verifySuperAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { colName, adminPassword } = req.body;

            const normCol = String(colName).replace(/\s+/g, ' ').trim().toUpperCase();
            if (FIXED_COLUMNS.includes(normCol)) {
                throw new Error("This is a core system column and cannot be deleted.");
            }

            const adminRes = await client.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
            const isValid = await bcrypt.compare(adminPassword, adminRes.rows[0].password_hash);
            if (!isValid) throw new Error("Incorrect Super Admin Password. Action Denied.");

            // OPTIMIZATION: Soft Delete applied here. (Requires deleted_at column in erp_headers)
            await client.query('UPDATE erp_headers SET deleted_at = CURRENT_TIMESTAMP WHERE header_name = $1', [colName]);

            // We DO NOT remove the data from erp_records JSONB. It remains hidden and recoverable.
            // A separate cron job can clean up data where deleted_at > 30 days.

            await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'DELETE_COLUMN', $2)", [
                req.user.username,
                JSON.stringify({ column: colName })
            ]);

            await client.query('COMMIT');
            res.json({ success: true, message: "Column moved to recycle bin (Soft Delete)!" });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "DELETE_COLUMN");
        } finally {
            client.release();
        }
    });

    /**
     * SET COLUMN ALIGNMENT
     */
    router.post('/admin/set-alignment', verifySuperAdmin, async (req, res) => {
        try {
            const { colName, alignment } = req.body;
            await pool.query('UPDATE erp_headers SET alignment = $1 WHERE header_name = $2', [alignment, colName]);
            res.json({ success: true });
        } catch (error) {
            handleError(res, error, req.user.role, "SET_ALIGNMENT");
        }
    });

    /**
     * ADD COLUMN (END OF TABLE)
     */
    router.post('/add-column', verifyToken, async (req, res) => {
        try {
            if (req.user.role === 'Viewer') throw new Error('Access Denied');
            const { colName, colType } = req.body;
            const countRes = await pool.query('SELECT COUNT(*) FROM erp_headers WHERE deleted_at IS NULL');
            await pool.query('INSERT INTO erp_headers (header_name, col_order, col_type) VALUES ($1, $2, $3)', [colName, parseInt(countRes.rows[0].count) + 1, colType || 'varchar']);

            await pool.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'ADD_COLUMN', $2)", [req.user.username, JSON.stringify({ column: colName, type: colType })]);

            res.json({ success: true });
        } catch (error) {
            handleError(res, error, req.user.role, "ADD_COLUMN");
        }
    });

    /**
     * TOGGLE COLUMN LOCK
     */
    router.post('/admin/toggle-lock', verifySuperAdmin, async (req, res) => {
        try {
            const { colName, isLocked } = req.body;
            await pool.query('UPDATE erp_headers SET is_locked = $1 WHERE header_name = $2', [isLocked, colName]);
            res.json({ success: true });
        } catch (error) {
            handleError(res, error, req.user.role, "TOGGLE_LOCK");
        }
    });

    /**
     * RENAME COLUMN
     */
    router.post('/admin/rename-column', verifySuperAdmin, async (req, res) => {
        try {
            const { oldName, newName, colType } = req.body;
            if (!oldName || !newName) throw new Error("Invalid names.");

            let finalNewName = newName.trim();
            let finalType = colType || 'varchar';

            const normOld = String(oldName).replace(/\s+/g, ' ').trim().toUpperCase();
            if (FIXED_COLUMNS.includes(normOld)) {
                throw new Error("This is a core system column and cannot be renamed.");
            }

            if (oldName !== finalNewName) {
                const check = await pool.query('SELECT * FROM erp_headers WHERE header_name = $1 AND deleted_at IS NULL', [finalNewName]);
                if (check.rows.length > 0) throw new Error("Column name already exists.");

                await pool.query('UPDATE erp_headers SET header_name = $1, col_type = $3 WHERE header_name = $2', [finalNewName, oldName, finalType]);

                // Merges the old key's value into the new key, then removes the old key
                await pool.query(`
                    UPDATE erp_records 
                    SET record_data = (record_data - $2) || jsonb_build_object($1::text, record_data->$2) 
                    WHERE record_data ? $2`,
                    [finalNewName, oldName]
                );
            } else {
                await pool.query('UPDATE erp_headers SET col_type = $1 WHERE header_name = $2', [finalType, oldName]);
            }
            res.json({ success: true, message: "Column updated successfully!" });
        } catch (error) {
            handleError(res, error, req.user.role, "RENAME_COLUMN");
        }
    });

    /**
     * UPDATE OWNER NAME (Global Replace)
     */
    router.post('/admin/update-owner-name', verifySuperAdmin, async (req, res) => {
        try {
            const { oldName, newName } = req.body;
            if (!oldName || !newName || oldName.trim() === newName.trim()) throw new Error("Invalid names.");

            await pool.query(`
                UPDATE erp_records 
                SET record_data = jsonb_set(record_data, '{Owner}', $1::jsonb) 
                WHERE record_data->>'Owner' = $2`,
                [`"${newName.trim()}"`, oldName]
            );
            res.json({ success: true, message: "Owner name updated successfully!" });
        } catch (error) {
            handleError(res, error, req.user.role, "UPDATE_OWNER_NAME");
        }
    });

    // ==========================================
    // 🗑️ RECYCLE BIN ROUTES (SOFT DELETE MANAGEMENT)
    // ==========================================

    /**
     * GET DELETED COLUMNS (Recycle Bin)
     */
    router.get('/admin/recycle-bin/columns', verifySuperAdmin, async (req, res) => {
        try {
            // Fetch headers that have a deleted_at timestamp
            const result = await pool.query(`
                SELECT header_name, deleted_at 
                FROM erp_headers 
                WHERE deleted_at IS NOT NULL 
                ORDER BY deleted_at DESC
            `);

            res.json({ success: true, columns: result.rows });
        } catch (error) {
            handleError(res, error, req.user.role, "GET_RECYCLE_BIN");
        }
    });

    /**
     * RESTORE DELETED COLUMN
     */
    router.post('/admin/recycle-bin/restore-column', verifySuperAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { colName } = req.body;

            if (!colName) throw new Error("Column name is required.");

            // Remove the deleted_at timestamp to restore the column
            await client.query('UPDATE erp_headers SET deleted_at = NULL WHERE header_name = $1', [colName]);

            await client.query("INSERT INTO activity_logs (username, action, details) VALUES ($1, 'RESTORE_COLUMN', $2)", [
                req.user.username,
                JSON.stringify({ column: colName })
            ]);

            await client.query('COMMIT');
            res.json({ success: true, message: "Column restored successfully!" });
        } catch (error) {
            await client.query('ROLLBACK');
            handleError(res, error, req.user.role, "RESTORE_COLUMN");
        } finally {
            client.release();
        }
    });

    return router;
};