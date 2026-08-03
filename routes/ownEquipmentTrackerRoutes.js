const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const excelJS = require("exceljs");

// Active users tracking memory store
const activeUsers = new Map();

router.post("/active-users", (req, res) => {
  const { user } = req.body;
  if (user) {
    activeUsers.set(user, Date.now());
  }
  
  // Clean up inactive users (no ping for last 15 seconds)
  const now = Date.now();
  activeUsers.forEach((lastSeen, username) => {
    if (now - lastSeen > 15000) {
      activeUsers.delete(username);
    }
  });

  res.json({ active: Array.from(activeUsers.keys()) });
});

router.get("/data", async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  try {
    const equipments = await pool.query(
      `SELECT * FROM equipments ORDER BY id ASC`,
    );
    const logs = await pool.query(
      `SELECT * FROM equipment_monthly_logs WHERE year = $1`,
      [year],
    );
    res.json({ equipments: equipments.rows, logs: logs.rows });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

router.post("/add-equipment", async (req, res) => {
  const { plate_no, purchase_date, purchase_cost } = req.body;
  try {
    await pool.query(
      `INSERT INTO equipments (plate_no, purchase_date, purchase_cost) VALUES ($1, $2, $3)`,
      [plate_no, purchase_date || null, purchase_cost || 0],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: "Failed" });
  }
});

router.post("/save-log", async (req, res) => {
  const {
    equipment_id,
    year,
    month,
    maintenance_cost,
    basic_salary,
    overtime,
    penalty,
    santook_rent,
    kafil_comm,
    owner_comm,
    investor_comm,
    debit,
    other_expense,
    op_revenue,
  } = req.body;
  try {
    const query = `
            INSERT INTO equipment_monthly_logs (equipment_id, year, month, maintenance_cost, basic_salary, overtime, penalty, santook_rent, kafil_comm, owner_comm, investor_comm, debit, other_expense, op_revenue)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (equipment_id, year, month)
            DO UPDATE SET maintenance_cost = EXCLUDED.maintenance_cost, basic_salary = EXCLUDED.basic_salary, overtime = EXCLUDED.overtime, penalty = EXCLUDED.penalty, santook_rent = EXCLUDED.santook_rent, kafil_comm = EXCLUDED.kafil_comm, owner_comm = EXCLUDED.owner_comm, investor_comm = EXCLUDED.investor_comm, debit = EXCLUDED.debit, other_expense = EXCLUDED.other_expense, op_revenue = EXCLUDED.op_revenue;
        `;
    await pool.query(query, [
      equipment_id,
      year,
      month,
      maintenance_cost || 0,
      basic_salary || 0,
      overtime || 0,
      penalty || 0,
      santook_rent || 0,
      kafil_comm || 0,
      owner_comm || 0,
      investor_comm || 0,
      debit || 0,
      other_expense || 0,
      op_revenue || 0,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

// Summary Data logic covering all years
router.get("/summary-data", async (req, res) => {
  try {
    const eqRes = await pool.query(`SELECT id, purchase_cost FROM equipments`);
    const totalPurchaseCost = eqRes.rows.reduce(
      (sum, eq) => sum + Number(eq.purchase_cost || 0),
      0,
    );
    const logsRes = await pool.query(
      `SELECT * FROM equipment_monthly_logs ORDER BY year ASC, month ASC`,
    );

    let yearsData = {};
    logsRes.rows.forEach((log) => {
      if (!yearsData[log.year]) {
        yearsData[log.year] = {
          year: log.year,
          maint: 0,
          basic: 0,
          ot: 0,
          penalty: 0,
          santook: 0,
          kafil: 0,
          owner: 0,
          inv: 0,
          debit: 0,
          other_exp: 0,
          revenue: 0,
        };
      }
      let y = yearsData[log.year];
      y.maint += Number(log.maintenance_cost || 0);
      y.basic += Number(log.basic_salary || 0);
      y.ot += Number(log.overtime || 0);
      y.penalty += Number(log.penalty || 0);
      y.santook += Number(log.santook_rent || 0);
      y.debit += Number(log.debit || 0);
      y.other_exp += Number(log.other_expense || 0);
      const rev = Number(log.op_revenue || 0);
      y.revenue += rev;
      y.kafil += rev * (Number(log.kafil_comm || 0) / 100);
      y.owner += rev * (Number(log.owner_comm || 0) / 100);
      y.inv += rev * (Number(log.investor_comm || 0) / 100);
    });

    let summaryList = [];
    let prevOpBalance = 0; // Negative = Loss, Positive = Profit

    Object.keys(yearsData)
      .sort()
      .forEach((yr) => {
        let d = yearsData[yr];
        let grossSal = d.basic + d.ot;
        let netSal = grossSal - d.penalty;
        let opCost = netSal + d.santook + d.kafil + d.owner + d.inv + d.debit + d.other_exp;
        let currentOpProfitLoss = d.revenue - (d.maint + opCost);

        let expenseSide = totalPurchaseCost + d.maint + opCost;
        let incomeSide = d.revenue;

        if (prevOpBalance < 0) expenseSide += Math.abs(prevOpBalance);
        if (prevOpBalance > 0) incomeSide += prevOpBalance;

        let netDiff = Math.abs(incomeSide - expenseSide);
        let isNetLoss = expenseSide > incomeSide;

        summaryList.push({
          year: yr,
          purchaseCost: totalPurchaseCost,
          maint: d.maint,
          opCost: opCost,
          basic: d.basic,
          ot: d.ot,
          grossSal: grossSal,
          driverNet: netSal,
          driverPenalty: d.penalty,
          santook: d.santook,
          kafil: d.kafil,
          owner: d.owner,
          inv: d.inv,
          debit: d.debit,
          other_exp: d.other_exp,
          revenue: d.revenue,
          prevBalance: prevOpBalance,
          isNetLoss: isNetLoss,
          netDiff: netDiff,
          opDiff: Math.abs(currentOpProfitLoss),
          isOpLoss: currentOpProfitLoss < 0,
          totalBal: Math.max(expenseSide, incomeSide),
        });
        prevOpBalance = currentOpProfitLoss;
      });

    res.json(summaryList);
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

// EXPORT EXCEL ROUTE (SINGLE & BATCH WITH DESIGNED SUMMARY SHEET)
router.get('/export-excel', async (req, res) => {
    const type = req.query.type;
    const targetYear = req.query.year || new Date().getFullYear();
    const monthsParam = req.query.months || "1,2,3,4,5,6,7,8,9,10,11,12";
    const visibleMonths = monthsParam.split(',').map(Number);
    
    const workbook = new excelJS.Workbook();
    const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    try {
        const eqRes = await pool.query(`SELECT * FROM equipments ORDER BY id ASC`);
        const logsRes = await pool.query(`SELECT * FROM equipment_monthly_logs ORDER BY year ASC`);
        
        let years = [];
        if (type === 'batch') {
            years = [...new Set(logsRes.rows.map(x => x.year))];
            if(years.length === 0) years = [new Date().getFullYear()];
        } else {
            years = [Number(targetYear)];
        }

        // ==========================================
        // 1. CREATE SUMMARY SHEET (MATCHING HTML DESIGN)
        // ==========================================
        const sumSheet = workbook.addWorksheet('Summary');
        sumSheet.properties.defaultRowHeight = 24;
        sumSheet.views = [{ zoomScale: 80 }]; // 80% Zoom

        // Set Column Widths
        sumSheet.getColumn(1).width = 8;  // Date
        sumSheet.getColumn(2).width = 38; // Expense
        sumSheet.getColumn(3).width = 14; // Amount
        sumSheet.getColumn(4).width = 8;  // Date
        sumSheet.getColumn(5).width = 38; // Income
        sumSheet.getColumn(6).width = 14; // Amount

        const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const summaryHeadFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };

        let yearsData = {};
        const totalPurchaseCost = eqRes.rows.reduce((sum, eq) => sum + Number(eq.purchase_cost || 0), 0);
        
        logsRes.rows.forEach(log => {
            if (!yearsData[log.year]) yearsData[log.year] = { maint: 0, basic_ot: 0, penalty: 0, santook: 0, kafil: 0, owner: 0, inv: 0, debit: 0, other_exp: 0, revenue: 0 };
            let y = yearsData[log.year];
            y.maint += Number(log.maintenance_cost || 0);
            y.basic_ot += (Number(log.basic_salary || 0) + Number(log.overtime || 0));
            y.penalty += Number(log.penalty || 0);
            y.santook += Number(log.santook_rent || 0);
            y.debit += Number(log.debit || 0);
            y.other_exp += Number(log.other_expense || 0);
            const rev = Number(log.op_revenue || 0);
            y.revenue += rev;
            y.kafil += rev * (Number(log.kafil_comm || 0)/100);
            y.owner += rev * (Number(log.owner_comm || 0)/100);
            y.inv += rev * (Number(log.investor_comm || 0)/100);
        });

        let prevOpBalance = 0;
        
        Object.keys(yearsData).sort().forEach(yr => {
            let d = yearsData[yr];
            let opCost = (d.basic_ot - d.penalty) + d.santook + d.kafil + d.owner + d.inv + d.debit + d.other_exp;
            let currentOpProfitLoss = d.revenue - (d.maint + opCost);
            
            let expenseSide = totalPurchaseCost + d.maint + opCost;
            let incomeSide = d.revenue;
            if (prevOpBalance < 0) expenseSide += Math.abs(prevOpBalance);
            if (prevOpBalance > 0) incomeSide += prevOpBalance;
            let netDiff = Math.abs(incomeSide - expenseSide);
            let isNetLoss = expenseSide > incomeSide;

            if (type === 'batch' || yr == targetYear) {
                let startRow = sumSheet.rowCount + 2;

                // Title Row: Summary - Year
                sumSheet.getCell(`A${startRow}`).value = `Summary - ${yr}`;
                sumSheet.getCell(`A${startRow}`).font = { bold: true, size: 14 };
                sumSheet.addRow([]); // Blank row

                // Table Header
                let headRow = sumSheet.addRow(['Date', 'Expense', 'Amount', 'Date', 'Income', 'Amount']);
                headRow.font = { bold: true };
                headRow.alignment = { vertical: 'middle', horizontal: 'center' };
                headRow.eachCell(c => { c.fill = summaryHeadFill; c.border = borderStyle; });

                const addStyledRow = (dataArray, isBold = false, textColor = null) => {
                    let r = sumSheet.addRow(dataArray);
                    if (isBold) r.font = { bold: true };
                    r.eachCell({ includeEmpty: true }, (c, colNum) => {
                        c.border = borderStyle;
                        if (textColor && (colNum === 3 || colNum === 6)) {
                            c.font = { bold: isBold, color: { argb: textColor } };
                        }
                        // Date (1,4) and Amount (3,6) centered. Descriptions (2,5) left aligned.
                        if (colNum === 1 || colNum === 3 || colNum === 4 || colNum === 6) {
                            c.alignment = { vertical: 'middle', horizontal: 'center' };
                        } else {
                            c.alignment = { vertical: 'middle', horizontal: 'left' };
                        }
                    });
                    return r;
                };

                const v = (num) => (num === 0 || num === null) ? '' : Number(num);

                // 1. Purchase Cost
                addStyledRow([yr, 'Total Purchase Cost', v(totalPurchaseCost), '', '', '']);
                
                // 2. Previous Year Balance
                if (prevOpBalance < 0) addStyledRow([yr, 'Previous Year OP Loss', Math.abs(prevOpBalance), '', '', '']);
                if (prevOpBalance > 0) addStyledRow(['', '', '', yr, 'Previous Year OP Profit', prevOpBalance]);
                
                // 3. Maintenance & Revenue
                addStyledRow([yr, 'Total Maintenance Cost', v(d.maint), yr, 'Total Operational Revenue', v(d.revenue)]);
                
                // 4. Operating Expenses breakdown
                addStyledRow([yr, 'Total Operating Expenses', v(opCost), '', '', '']);
                addStyledRow(['', '   Basic Salary', v(d.basic), '', '', '']);
                addStyledRow(['', '   Over Time', v(d.ot), '', '', '']);
                addStyledRow(['', '   Gross Salary', v(d.basic + d.ot), '', '', ''], true);
                addStyledRow(['', '   less:: Penalty', v(d.penalty), '', '', '']);
                addStyledRow(['', '   Net Salary ::', v((d.basic + d.ot) - d.penalty), '', '', ''], true);
                addStyledRow(['', '   Santook Rent', v(d.santook), '', '', '']);
                addStyledRow(['', '   Commission Kafil', v(d.kafil), '', '', '']);
                addStyledRow(['', '   Commission Owner', v(d.owner), '', '', '']);
                addStyledRow(['', '   Commission Investor', v(d.inv), '', '', '']);
                addStyledRow(['', '   Debit', v(d.debit), '', '', '']);
                addStyledRow(['', '   Other Expense', v(d.other_exp), '', '', '']);
                
                // 5. Net Loss / Profit
                if (isNetLoss) {
                    addStyledRow(['', '', '', yr, 'Net Loss ::', netDiff], true, 'FFFF0000');
                    addStyledRow(['', '', '', '', '   Asset Cost', totalPurchaseCost]);
                    addStyledRow(['', '', '', yr, '   Operational Loss', Math.abs(currentOpProfitLoss)]);
                } else {
                    addStyledRow([yr, 'Net Profit ::', netDiff, '', '', ''], true, 'FF008000');
                    addStyledRow(['', '   Operational Profit', Math.abs(currentOpProfitLoss), '', '', '']);
                }
                
                // 6. Total Balance Row
                let totalBal = Math.max(expenseSide, incomeSide);
                addStyledRow(['', 'Total', totalBal, '', 'Total', totalBal], true);
                
                sumSheet.addRow([]); // Spacing between tables in batch view
            }
            prevOpBalance = currentOpProfitLoss;
        });

        // ==========================================
        // 2. CREATE TABS FOR EACH YEAR (TRACKER FORMAT)
        // ==========================================
        const centerAlign = { vertical: 'middle', horizontal: 'center', wrapText: true };
        const colors = {
            master: 'FFD9E1F2', month: 'FFD9EBD3', sub: 'FFF2F2F2',
            opc: 'FFFFF2CC', total: 'FFFCE4D6', rev: 'FFE2EFDA', gl: 'FFEDD9FF', net: 'FFF8CBAD'
        };

        const setMergedCell = (ws, r1, c1, r2, c2, value, bgColor) => {
            if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
            let cell = ws.getCell(r1, c1);
            cell.value = value;
            cell.font = { bold: true };
            cell.alignment = centerAlign;
            if (bgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        };

        years.forEach(yr => {
            const ws = workbook.addWorksheet(`${yr}`);
            ws.properties.defaultRowHeight = 33;
            ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 4, zoomScale: 80 }];
            
            ws.getColumn(1).width = 5; ws.getColumn(2).width = 15; ws.getColumn(3).width = 15; ws.getColumn(4).width = 15;

            setMergedCell(ws, 1, 1, 4, 1, 'SN', colors.master);
            setMergedCell(ws, 1, 2, 4, 2, 'Plate No', colors.master);
            setMergedCell(ws, 1, 3, 4, 3, 'Date of Purchase', colors.master);
            setMergedCell(ws, 1, 4, 4, 4, 'Purchase Cost', colors.master);

            let monthsToRender = type === 'batch' ? [1,2,3,4,5,6,7,8,9,10,11,12] : visibleMonths;

            monthsToRender.forEach((m, idx) => {
                let sC = 5 + (idx * 16);
                for(let i=0; i<16; i++) ws.getColumn(sC + i).width = 12;

                setMergedCell(ws, 1, sC, 1, sC + 15, `${fullMonthNames[m-1]} ${yr}`, colors.month);
                
                setMergedCell(ws, 2, sC, 4, sC, 'Maint. Cost', colors.sub);
                setMergedCell(ws, 2, sC + 1, 2, sC + 10, 'Operating Expenses', colors.opc);
                setMergedCell(ws, 2, sC + 11, 4, sC + 11, 'Total Cost', colors.total);
                setMergedCell(ws, 2, sC + 12, 4, sC + 12, 'OP Revenue', colors.rev);
                setMergedCell(ws, 2, sC + 13, 4, sC + 13, 'Gain / Loss', colors.gl);
                setMergedCell(ws, 2, sC + 14, 4, sC + 14, 'Prv Month', colors.sub);
                setMergedCell(ws, 2, sC + 15, 4, sC + 15, 'Net OP G/L', colors.net);

                setMergedCell(ws, 3, sC + 1, 3, sC + 4, 'For Driver', colors.opc);
                setMergedCell(ws, 3, sC + 5, 4, sC + 5, 'Santook Rent', colors.opc);
                setMergedCell(ws, 3, sC + 6, 3, sC + 8, 'Commission Paid', colors.opc);
                setMergedCell(ws, 3, sC + 9, 3, sC + 10, 'Other Expense', colors.opc);

                setMergedCell(ws, 4, sC + 1, 4, sC + 1, 'Basic Sal', colors.opc);
                setMergedCell(ws, 4, sC + 2, 4, sC + 2, 'OT', colors.opc);
                setMergedCell(ws, 4, sC + 3, 4, sC + 3, 'Penalty', colors.opc);
                setMergedCell(ws, 4, sC + 4, 4, sC + 4, 'Net Salary', colors.opc);
                
                setMergedCell(ws, 4, sC + 6, 4, sC + 6, 'Kafil', colors.opc);
                setMergedCell(ws, 4, sC + 7, 4, sC + 7, 'Owner', colors.opc);
                setMergedCell(ws, 4, sC + 8, 4, sC + 8, 'Investor', colors.opc);
                setMergedCell(ws, 4, sC + 9, 4, sC + 9, 'Debit', colors.opc);
                setMergedCell(ws, 4, sC + 10, 4, sC + 10, 'Other', colors.opc);
            });

            for (let r = 1; r <= 4; r++) {
                for (let c = 1; c <= 4 + (monthsToRender.length * 16); c++) {
                    ws.getCell(r, c).border = borderStyle;
                }
            }

            const v = (num) => (num === 0 || num === "0.00" || num === null) ? '' : Number(num);
            const formatPurchaseDate = (dateStr) => {
                if (!dateStr) return '';
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return '';
                return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]} ${date.getFullYear().toString().slice(-2)}`;
            };

            let carryGL = 0;
            eqRes.rows.forEach((eq, idx) => {
                let rowData = [idx + 1, eq.plate_no, formatPurchaseDate(eq.purchase_date), v(eq.purchase_cost)];

                monthsToRender.forEach(m => {
                    const l = logsRes.rows.find(x => x.equipment_id === eq.id && x.year === yr && x.month === m) || {};
                    const maint = Number(l.maintenance_cost||0), basic = Number(l.basic_salary||0), ot = Number(l.overtime||0), pen = Number(l.penalty||0), rent = Number(l.santook_rent||0), rev = Number(l.op_revenue||0);
                    const kaf = rev*(Number(l.kafil_comm||0)/100), own = rev*(Number(l.owner_comm||0)/100), inv = rev*(Number(l.investor_comm||0)/100);
                    const deb = Number(l.debit||0), oth = Number(l.other_expense||0);
                    const netSal = (basic + ot) - pen;
                    const opc = netSal + rent + kaf + own + inv + deb + oth;
                    const tc = maint + opc;
                    let gl = (tc>0||rev>0) ? rev - tc : 0;
                    let net = (gl!==0||carryGL!==0) ? gl + carryGL : 0;
                    carryGL = net;
                    
                    rowData.push(v(maint), v(basic), v(ot), v(pen), v(netSal), v(rent), v(kaf), v(own), v(inv), v(deb), v(oth), v(tc), v(rev), v(gl), v(carryGL), v(net));
                });

                let rowObj = ws.addRow(rowData);
                rowObj.height = 33;
                rowObj.alignment = centerAlign;

                for (let c = 1; c <= 4 + (monthsToRender.length * 16); c++) {
                    let cell = rowObj.getCell(c);
                    cell.border = borderStyle;
                    if (c > 4) {
                        let colIdx = (c - 5) % 16; 
                        if (colIdx >= 1 && colIdx <= 10) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.opc } };
                        else if (colIdx === 11) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.total } }; cell.font = { bold: true }; }
                        else if (colIdx === 12) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.rev } }; cell.font = { bold: true }; }
                        else if (colIdx === 13) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.gl } }; cell.font = { bold: true, color: { argb: Number(cell.value) < 0 ? 'FFFF0000' : 'FF008000' } }; }
                        else if (colIdx === 15) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.net } }; cell.font = { bold: true, color: { argb: Number(cell.value) < 0 ? 'FFFF0000' : 'FF000000' } }; }
                        
                        if (colIdx === 3 && cell.value !== '') cell.font = { color: { argb: 'FFFF0000' } };
                    }
                }
            });
        });

        const fileName = type === 'batch' ? 'Batch_Equipment_Tracker.xlsx' : `Equipment_Tracker_${targetYear}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        
        await workbook.xlsx.write(res);
        return res.end();
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to generate Excel." });
    }
});

module.exports = router;