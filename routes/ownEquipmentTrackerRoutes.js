const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const excelJS = require('exceljs');

// Fetch Equipment Master and Monthly Logs for Year
router.get('/data', async (req, res) => {
    const year = req.query.year || new Date().getFullYear();
    try {
        const equipments = await pool.query(`SELECT * FROM equipments ORDER BY id ASC`);
        const logs = await pool.query(`SELECT * FROM equipment_monthly_logs WHERE year = $1`, [year]);

        res.json({
            equipments: equipments.rows,
            logs: logs.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching tracker data." });
    }
});

// Add Equipment
router.post('/add-equipment', async (req, res) => {
    const { plate_no, purchase_date, purchase_cost } = req.body;
    try {
        await pool.query(
            `INSERT INTO equipments (plate_no, purchase_date, purchase_cost) VALUES ($1, $2, $3)`,
            [plate_no, purchase_date || null, purchase_cost || 0]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ message: "Equipment already exists or invalid data." });
    }
});

// Save Monthly Data
router.post('/save-log', async (req, res) => {
    const {
        equipment_id, year, month, maintenance_cost, basic_salary,
        overtime, santook_rent, kafil_comm, owner_comm, investor_comm, op_revenue
    } = req.body;

    try {
        const query = `
            INSERT INTO equipment_monthly_logs 
            (equipment_id, year, month, maintenance_cost, basic_salary, overtime, santook_rent, kafil_comm, owner_comm, investor_comm, op_revenue)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (equipment_id, year, month)
            DO UPDATE SET 
                maintenance_cost = EXCLUDED.maintenance_cost,
                basic_salary = EXCLUDED.basic_salary,
                overtime = EXCLUDED.overtime,
                santook_rent = EXCLUDED.santook_rent,
                kafil_comm = EXCLUDED.kafil_comm,
                owner_comm = EXCLUDED.owner_comm,
                investor_comm = EXCLUDED.investor_comm,
                op_revenue = EXCLUDED.op_revenue;
        `;

        await pool.query(query, [
            equipment_id, year, month, maintenance_cost || 0, basic_salary || 0,
            overtime || 0, santook_rent || 0, kafil_comm || 0, owner_comm || 0,
            investor_comm || 0, op_revenue || 0
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to save monthly log." });
    }
});


// EXPORT EXCEL ROUTE (FULLY STYLED)
router.get('/export-excel', async (req, res) => {
    const year = req.query.year || new Date().getFullYear();
    const monthsParam = req.query.months || "1,2,3,4,5,6,7,8,9,10,11,12";
    const visibleMonths = monthsParam.split(',').map(Number);
    
    const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    try {
        const equipments = await pool.query(`SELECT * FROM equipments ORDER BY id ASC`);
        const logs = await pool.query(`SELECT * FROM equipment_monthly_logs WHERE year = $1`, [year]);

        const workbook = new excelJS.Workbook();
        const worksheet = workbook.addWorksheet(`Tracker_${year}`);

        worksheet.properties.defaultRowHeight = 33;

        // Set View Configuration: Freeze Top 4 Rows, Left 4 Columns, Zoom 80%
        worksheet.views = [
            { state: 'frozen', xSplit: 4, ySplit: 4, zoomScale: 80 }
        ];

        // Default widths
        worksheet.getColumn(1).width = 5;
        worksheet.getColumn(2).width = 15;
        worksheet.getColumn(3).width = 15;
        worksheet.getColumn(4).width = 15;

        // Styles
        const borderStyle = { 
            top: { style: 'thin' }, left: { style: 'thin' }, 
            bottom: { style: 'thin' }, right: { style: 'thin' } 
        };
        const centerAlign = { vertical: 'middle', horizontal: 'center', wrapText: true };

        const colors = {
            master: 'FFD9E1F2',
            month: 'FFD9EBD3',
            sub: 'FFF2F2F2',
            opc: 'FFFFF2CC',
            total: 'FFFCE4D6',
            rev: 'FFE2EFDA',
            gl: 'FFEDD9FF',
            net: 'FFF8CBAD'
        };

        const setMergedCell = (r1, c1, r2, c2, value, bgColor) => {
            if (r1 !== r2 || c1 !== c2) worksheet.mergeCells(r1, c1, r2, c2);
            let cell = worksheet.getCell(r1, c1);
            cell.value = value;
            cell.font = { bold: true };
            cell.alignment = centerAlign;
            if (bgColor) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
            }
        };

        // 1. MASTER HEADERS
        setMergedCell(1, 1, 4, 1, 'SN', colors.master);
        setMergedCell(1, 2, 4, 2, 'Plate No', colors.master);
        setMergedCell(1, 3, 4, 3, 'Date of Purchase', colors.master);
        setMergedCell(1, 4, 4, 4, 'Purchase Cost', colors.master);

        // 2. MONTHLY HEADERS
        visibleMonths.forEach((m, idx) => {
            let sC = 5 + (idx * 12); // startCol for month
            
            // Adjust widths for monthly columns
            for(let i=0; i<12; i++) worksheet.getColumn(sC + i).width = 12;

            setMergedCell(1, sC, 1, sC + 11, `${fullMonthNames[m-1]} ${year}`, colors.month);
            
            setMergedCell(2, sC, 4, sC, 'Maint. Cost', colors.sub);
            setMergedCell(2, sC + 1, 2, sC + 6, 'Operating Expenses', colors.opc);
            setMergedCell(2, sC + 7, 4, sC + 7, 'Total Cost', colors.total);
            setMergedCell(2, sC + 8, 4, sC + 8, 'OP Revenue', colors.rev);
            setMergedCell(2, sC + 9, 4, sC + 9, 'Gain / Loss', colors.gl);
            setMergedCell(2, sC + 10, 4, sC + 10, 'Prv Month', colors.sub);
            setMergedCell(2, sC + 11, 4, sC + 11, 'Net OP G/L', colors.net);

            setMergedCell(3, sC + 1, 3, sC + 2, 'Salary', colors.opc);
            setMergedCell(3, sC + 3, 4, sC + 3, 'Santook Rent', colors.opc);
            setMergedCell(3, sC + 4, 3, sC + 6, 'Commission', colors.opc);

            setMergedCell(4, sC + 1, 4, sC + 1, 'Basic Sal', colors.opc);
            setMergedCell(4, sC + 2, 4, sC + 2, 'OT', colors.opc);
            setMergedCell(4, sC + 4, 4, sC + 4, 'Kafil', colors.opc);
            setMergedCell(4, sC + 5, 4, sC + 5, 'Owner', colors.opc);
            setMergedCell(4, sC + 6, 4, sC + 6, 'Investor', colors.opc);
        });

        // Explicitly set height for Header Rows to 30
        worksheet.getRow(1).height = 30;
        worksheet.getRow(2).height = 30;
        worksheet.getRow(3).height = 30;
        worksheet.getRow(4).height = 30;

        // Apply borders to all header cells
        for (let r = 1; r <= 4; r++) {
            for (let c = 1; c <= 4 + (visibleMonths.length * 12); c++) {
                worksheet.getCell(r, c).border = borderStyle;
            }
        }

        // Helper to format 0 as blank string
        const v = (num) => (num === 0 || num === "0.00" || num === null) ? '' : Number(num);
        
        // Month string formatter (e.g. May 26)
        const formatPurchaseDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '';
            const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${shortMonths[date.getMonth()]} ${date.getFullYear().toString().slice(-2)}`;
        };

        // 3. ADD DATA
        equipments.rows.forEach((eq, index) => {
            let rowData = [
                index + 1,
                eq.plate_no,
                formatPurchaseDate(eq.purchase_date),
                v(eq.purchase_cost)
            ];

            let carryForwardGL = 0;

            visibleMonths.forEach(m => {
                const log = logs.rows.find(l => l.equipment_id === eq.id && l.month === m) || {};

                const maint = Number(log.maintenance_cost || 0);
                const basic = Number(log.basic_salary || 0);
                const ot = Number(log.overtime || 0);
                const santook = Number(log.santook_rent || 0);
                const revenue = Number(log.op_revenue || 0);

                const kafilPct = Number(log.kafil_comm || 0);
                const ownerPct = Number(log.owner_comm || 0);
                const investorPct = Number(log.investor_comm || 0);

                const kafil = revenue * (kafilPct / 100);
                const owner = revenue * (ownerPct / 100);
                const investor = revenue * (investorPct / 100);

                const totalOPC = basic + ot + santook + kafil + owner + investor;
                const totalCost = maint + totalOPC;
                
                let gainLoss = 0;
                if (totalCost > 0 || revenue > 0) gainLoss = revenue - totalCost;
                
                const prvMonthGL = carryForwardGL;
                let netGL = 0;
                if (gainLoss !== 0 || prvMonthGL !== 0) netGL = gainLoss + prvMonthGL;
                
                carryForwardGL = netGL;

                rowData.push(
                    v(maint), v(basic), v(ot), v(santook), 
                    v(kafil), v(owner), v(investor), 
                    v(totalCost), v(revenue), v(gainLoss), 
                    v(prvMonthGL), v(netGL)
                );
            });

            let rowObj = worksheet.addRow(rowData);
            
            // Explicitly set Row Height to 33 for data rows
            rowObj.height = 33; 
            
            rowObj.alignment = { vertical: 'middle', horizontal: 'center' };

            // Apply borders and colors to data cells
            for (let c = 1; c <= 4 + (visibleMonths.length * 12); c++) {
                let cell = rowObj.getCell(c);
                cell.border = borderStyle;

                if (c > 4) {
                    let monthColIndex = (c - 5) % 12; // 0 to 11
                    
                    if (monthColIndex >= 1 && monthColIndex <= 6) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.opc } };
                    } else if (monthColIndex === 7) { 
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.total } };
                        cell.font = { bold: true };
                    } else if (monthColIndex === 8) { 
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.rev } };
                        cell.font = { bold: true };
                    } else if (monthColIndex === 9) { 
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.gl } };
                        cell.font = { bold: true, color: { argb: Number(cell.value) < 0 ? 'FFFF0000' : 'FF008000' } }; 
                    } else if (monthColIndex === 11) { 
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.net } };
                        cell.font = { bold: true, color: { argb: Number(cell.value) < 0 ? 'FFFF0000' : 'FF000000' } }; 
                    }
                }
            }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Equipment_Tracker_${year}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to generate Excel." });
    }
});

module.exports = router;