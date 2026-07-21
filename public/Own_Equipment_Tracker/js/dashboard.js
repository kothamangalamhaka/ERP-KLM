let rawEquipments = [];
let rawMonthlyLogs = [];

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

document.addEventListener('DOMContentLoaded', () => {
    initYearMonthDropdowns();
    loadDashboardData();
});

function initYearMonthDropdowns() {
    const yearSelect = document.getElementById('filterYear');
    const inputYear = document.getElementById('inputYear');
    const currentYear = new Date().getFullYear();

    yearSelect.innerHTML = '';
    inputYear.innerHTML = '';

    for (let y = currentYear - 2; y <= currentYear + 2; y++) {
        yearSelect.innerHTML += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
        inputYear.innerHTML += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
    }

    const monthSelect = document.getElementById('filterMonth');
    monthSelect.innerHTML = `<option value="all">All Months (Full Year)</option>`;
    monthNames.forEach((m, idx) => {
        monthSelect.innerHTML += `<option value="${idx + 1}">${m}</option>`;
    });
}

async function loadDashboardData() {
    const selectedYear = document.getElementById('filterYear').value;
    try {
        const res = await fetch(`/api/own-equipment/tracker/data?year=${selectedYear}`);
        const data = await res.json();
        
        rawEquipments = data.equipments || [];
        rawMonthlyLogs = data.logs || [];

        populateEquipmentDropdown();
        renderTable();
    } catch (err) {
        console.error("Error fetching data:", err);
    }
}

function renderTable() {
    const filterMonth = document.getElementById('filterMonth').value;
    const selectedYear = document.getElementById('filterYear').value;
    const header = document.getElementById('tableHeader');
    const body = document.getElementById('tableBody');

    let visibleMonths = [];
    if (filterMonth === "all") {
        visibleMonths = Array.from({length: 12}, (_, i) => i + 1);
    } else {
        visibleMonths = [parseInt(filterMonth)];
    }

    // Render Dynamic Header
    let row1 = `<tr>
        <th rowspan="4" class="master-head">SN</th>
        <th rowspan="4" class="master-head">Plate No</th>
        <th rowspan="4" class="master-head">Date of Purchase</th>
        <th rowspan="4" class="master-head">Purchase Cost</th>`;
    let row2 = `<tr>`;
    let row3 = `<tr>`;
    let row4 = `<tr>`;

    visibleMonths.forEach(m => {
        row1 += `<th colspan="12" class="month-head">${fullMonthNames[m-1]} ${selectedYear}</th>`;
        
        row2 += `<th rowspan="3" class="sub-head">Maint. Cost</th>`;
        row2 += `<th colspan="6" class="sub-head bg-opc">Operating Expenses</th>`;
        row2 += `<th rowspan="3" class="sub-head bg-total-cost">Total Cost</th>`;
        row2 += `<th rowspan="3" class="sub-head bg-revenue">OP Revenue</th>`;
        row2 += `<th rowspan="3" class="sub-head bg-gl">Gain / Loss</th>`;
        row2 += `<th rowspan="3" class="sub-head">Prv Month</th>`;
        row2 += `<th rowspan="3" class="sub-head bg-net">Net OP G/L</th>`;

        row3 += `<th colspan="2" class="sub-head bg-opc">Salary</th>`;
        row3 += `<th rowspan="2" class="sub-head bg-opc">Santook Rent</th>`;
        row3 += `<th colspan="3" class="sub-head bg-opc">Commission</th>`;

        row4 += `<th class="sub-head bg-opc">Basic Sal</th>`;
        row4 += `<th class="sub-head bg-opc">OT</th>`;
        row4 += `<th class="sub-head bg-opc">Kafil</th>`;
        row4 += `<th class="sub-head bg-opc">Owner</th>`;
        row4 += `<th class="sub-head bg-opc">Investor</th>`;
    });

    row1 += `</tr>`;
    row2 += `</tr>`;
    row3 += `</tr>`;
    row4 += `</tr>`;
    
    header.innerHTML = row1 + row2 + row3 + row4;

    // Render Table Rows with Automatic Calculation
    body.innerHTML = '';
    rawEquipments.forEach((eq, index) => {
        let tr = `<tr>
            <td><b>${index + 1}</b></td>
            <td><b>${eq.plate_no}</b></td>
            <td>${formatPurchaseDate(eq.purchase_date)}</td>
            <td>${Number(eq.purchase_cost).toLocaleString()}</td>`;

        let carryForwardGL = 0; // Previous Month Balance Track ചെയ്യാൻ

        for (let m = 1; m <= 12; m++) {
            const log = rawMonthlyLogs.find(l => l.equipment_id === eq.id && l.month === m) || {};

            const maint = Number(log.maintenance_cost || 0);
            const basic = Number(log.basic_salary || 0);
            const ot = Number(log.overtime || 0);
            const santook = Number(log.santook_rent || 0);
            const kafil = Number(log.kafil_comm || 0);
            const owner = Number(log.owner_comm || 0);
            const investor = Number(log.investor_comm || 0);

            const totalOPC = basic + ot + santook + kafil + owner + investor;
            const totalCost = maint + totalOPC;
            const revenue = Number(log.op_revenue || 0);
            const gainLoss = revenue - totalCost;
            
            const prvMonthGL = carryForwardGL;
            const netGL = gainLoss + prvMonthGL;
            
            carryForwardGL = netGL; // അടുത്ത മാസത്തേക്ക് ബാലൻസ് പാസ് ചെയ്യുന്നു

            if (visibleMonths.includes(m)) {
                tr += `
                    <td>${maint || 0}</td>
                    <td class="bg-opc">${basic || 0}</td>
                    <td class="bg-opc">${ot || 0}</td>
                    <td class="bg-opc">${santook || 0}</td>
                    <td class="bg-opc">${kafil || 0}</td>
                    <td class="bg-opc">${owner || 0}</td>
                    <td class="bg-opc">${investor || 0}</td>
                    <td class="bg-total-cost"><b>${totalCost}</b></td>
                    <td class="bg-revenue"><b>${revenue}</b></td>
                    <td class="bg-gl" style="color: ${gainLoss < 0 ? 'red' : 'green'};"><b>${gainLoss}</b></td>
                    <td>${prvMonthGL}</td>
                    <td class="bg-net" style="color: ${netGL < 0 ? 'red' : 'black'};">${netGL}</td>
                `;
            }
        }

        tr += `</tr>`;
        body.innerHTML += tr;
    });
}

function populateEquipmentDropdown() {
    const sel = document.getElementById('inputEquipmentId');
    sel.innerHTML = '';
    rawEquipments.forEach(e => {
        sel.innerHTML += `<option value="${e.id}">${e.plate_no}</option>`;
    });
}

// Modal Handlers
function openEquipmentModal() { document.getElementById('equipmentModal').style.display = 'flex'; }
function openDataModal() { document.getElementById('dataModal').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function saveEquipment() {
    const plate_no = document.getElementById('eqPlateNo').value;
    const purchase_date = document.getElementById('eqPurchaseDate').value;
    const purchase_cost = document.getElementById('eqPurchaseCost').value;

    const res = await fetch('/api/own-equipment/tracker/add-equipment', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ plate_no, purchase_date, purchase_cost })
    });

    if(res.ok) {
        closeModal('equipmentModal');
        loadDashboardData();
    } else {
        alert('Failed to add equipment.');
    }
}

async function saveMonthlyData() {
    const payload = {
        equipment_id: document.getElementById('inputEquipmentId').value,
        year: document.getElementById('inputYear').value,
        month: document.getElementById('inputMonth').value,
        maintenance_cost: document.getElementById('inputMaint').value,
        basic_salary: document.getElementById('inputBasicSalary').value,
        overtime: document.getElementById('inputOT').value,
        santook_rent: document.getElementById('inputSantook').value,
        kafil_comm: document.getElementById('inputKafil').value,
        owner_comm: document.getElementById('inputOwner').value,
        investor_comm: document.getElementById('inputInvestor').value,
        op_revenue: document.getElementById('inputRevenue').value
    };

    const res = await fetch('/api/own-equipment/tracker/save-log', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    if(res.ok) {
        closeModal('dataModal');
        loadDashboardData();
    } else {
        alert('Failed to save monthly data.');
    }
}

// Helper Function to format YYYY-MM-DD into "MMM YY" (e.g., May 26)
function formatPurchaseDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = shortMonths[date.getMonth()];
    const year = date.getFullYear().toString().slice(-2);

    return `${month} ${year}`;
}