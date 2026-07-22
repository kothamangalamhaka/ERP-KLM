let rawEquipments = [],
  rawMonthlyLogs = [];
const monthNames = [
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
const fullMonthNames = [
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

document.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem('eq_user')) {
    window.location.replace('index.html');
  }
  initYearMonthDropdowns();
  loadDashboardData();

  const modalInputs = document.querySelectorAll("#dataModal input[type='number']");
  modalInputs.forEach((input, index) => {
    input.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft"].includes(e.key)) {
        e.preventDefault();
        
        let nextInput;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          nextInput = modalInputs[index + 1];
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          nextInput = modalInputs[index - 1];
        }
        
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }
    });
  });
});
function fmt(val, isDec = false) {
  const num = Number(val);
  if (num === 0) return "";
  return isDec ? num.toFixed(2) : num;
}
function initYearMonthDropdowns() {
  const yearSelect = document.getElementById("filterYear"),
    inputYear = document.getElementById("inputYear"),
    cy = new Date().getFullYear();
  yearSelect.innerHTML = inputYear.innerHTML = "";
  for (let y = cy - 2; y <= cy + 2; y++) {
    let opt = `<option value="${y}" ${y === cy ? "selected" : ""}>${y}</option>`;
    yearSelect.innerHTML += opt;
    inputYear.innerHTML += opt;
  }
  let liHTML = `<li><label><input type="checkbox" id="chkAllMonths" checked onchange="toggleAllMonths(this)"> All Months</label></li>`;
  monthNames.forEach((m, idx) => {
    liHTML += `<li><label><input type="checkbox" class="month-chk" value="${idx + 1}" checked onchange="uncheckAll(this)"> ${m}</label></li>`;
  });
  document.getElementById("monthCheckboxes").innerHTML = liHTML;
}
function toggleAllMonths(src) {
  document
    .querySelectorAll(".month-chk")
    .forEach((chk) => (chk.checked = src.checked));
}
function uncheckAll(src) {
  if (!src.checked) document.getElementById("chkAllMonths").checked = false;
}
async function loadDashboardData() {
  const y = document.getElementById("filterYear").value;
  try {
    const res = await fetch(`/api/own-equipment/tracker/data?year=${y}`);
    const data = await res.json();
    rawEquipments = data.equipments || [];
    rawMonthlyLogs = data.logs || [];
    populateEquipmentDropdown();
    renderTable();
  } catch (err) {
    console.error(err);
  }
}
function renderTable() {
  const y = document.getElementById("filterYear").value;
  const header = document.getElementById("tableHeader"),
    body = document.getElementById("tableBody");
  let vM = Array.from(document.querySelectorAll(".month-chk:checked")).map(
    (b) => parseInt(b.value),
  );
  if (vM.length === 0) vM = Array.from({ length: 12 }, (_, i) => i + 1);

  let r1 = `<tr><th rowspan="4" class="master-head">SN</th><th rowspan="4" class="master-head">Plate No</th><th rowspan="4" class="master-head">Date of Purchase</th><th rowspan="4" class="master-head">Purchase Cost</th>`;
  let r2 = `<tr>`,
    r3 = `<tr>`,
    r4 = `<tr>`;

  vM.forEach((m) => {
    r1 += `<th colspan="14" class="month-head">${fullMonthNames[m - 1]} ${y}</th>`;
    r2 += `<th rowspan="3" class="sub-head">Equipment <br> Maintanance <br> Cost</th><th colspan="8" class="sub-head bg-opc">Operating Expenses</th><th rowspan="3" class="sub-head bg-total-cost">Total Cost</th><th rowspan="3" class="sub-head bg-revenue">OPerational <br> Revenue</th><th rowspan="3" class="sub-head bg-gl"> This Month <br> Gain / Loss</th><th rowspan="3" class="sub-head">Prv Month <br> Balance</th><th rowspan="3" class="sub-head bg-net">Net OP <br> Gain/Loss</th>`;
    r3 += `<th colspan="4" class="sub-head bg-opc">Driver Side Expenses</th><th rowspan="2" class="sub-head bg-opc">Santook <br> Rent</th><th colspan="3" class="sub-head bg-opc">Commission Paid</th>`;
    r4 += `<th class="sub-head bg-opc">Basic</th><th class="sub-head bg-opc">OT</th><th class="sub-head bg-opc" style="color:red;">Penalty</th><th class="sub-head bg-opc" style="font-weight:bold;">Net Salary</th><th class="sub-head bg-opc">Kafil</th><th class="sub-head bg-opc">Owner</th><th class="sub-head bg-opc">Investor</th>`;
  });
  header.innerHTML = r1 + `</tr>` + r2 + `</tr>` + r3 + `</tr>` + r4 + `</tr>`;

  body.innerHTML = "";
  rawEquipments.forEach((eq, idx) => {
    let tr = `<tr><td><b>${idx + 1}</b></td><td><b>${eq.plate_no}</b></td><td>${formatPurchaseDate(eq.purchase_date)}</td><td>${fmt(eq.purchase_cost)}</td>`;
    let carryGL = 0;
    for (let m = 1; m <= 12; m++) {
      const l =
        rawMonthlyLogs.find((x) => x.equipment_id === eq.id && x.month === m) ||
        {};
      const maint = Number(l.maintenance_cost || 0),
        basic = Number(l.basic_salary || 0),
        ot = Number(l.overtime || 0),
        penalty = Number(l.penalty || 0),
        santook = Number(l.santook_rent || 0),
        rev = Number(l.op_revenue || 0);
      const netSal = basic + ot - penalty;
      const kafil = rev * (Number(l.kafil_comm || 0) / 100),
        owner = Number(l.owner_comm || 0),
        inv = Number(l.investor_comm || 0);
      const opc = basic + ot + santook + kafil + owner + inv;
      const tCost = maint + opc;
      let gl = 0;
      if (tCost > 0 || rev > 0) gl = rev - tCost;
      let net = 0;
      if (gl !== 0 || carryGL !== 0) net = gl + carryGL;
      if (vM.includes(m)) {
        tr += `<td>${fmt(maint)}</td><td class="bg-opc">${fmt(basic)}</td><td class="bg-opc">${fmt(ot)}</td><td class="bg-opc" style="color:red;">${fmt(penalty)}</td><td class="bg-opc"><b>${fmt(netSal)}</b></td><td class="bg-opc">${fmt(santook)}</td><td class="bg-opc">${fmt(kafil, 1)}</td><td class="bg-opc">${fmt(owner, 1)}</td><td class="bg-opc">${fmt(inv, 1)}</td><td class="bg-total-cost"><b>${fmt(tCost, 1)}</b></td><td class="bg-revenue"><b>${fmt(rev)}</b></td><td class="bg-gl" style="color:${gl < 0 ? "red" : "green"};"><b>${fmt(gl, 1)}</b></td><td>${fmt(carryGL, 1)}</td><td class="bg-net" style="color:${net < 0 ? "red" : "black"};">${fmt(net, 1)}</td>`;
      }
      carryGL = net;
    }
    body.innerHTML += tr + `</tr>`;
  });
}
function populateEquipmentDropdown() {
  const select = document.getElementById("inputEquipmentId");
  const currentVal = select.value; 
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  if (currentVal) select.value = currentVal; 
}
function openEquipmentModal() {
  document.getElementById("equipmentModal").style.display = "flex";
}
function openDataModal() {
  document.getElementById("dataModal").style.display = "flex";
  populateModalFields(); 
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
async function saveEquipment() {
  const d = {
    plate_no: document.getElementById("eqPlateNo").value,
    purchase_date: document.getElementById("eqPurchaseDate").value,
    purchase_cost: document.getElementById("eqPurchaseCost").value,
  };
  const res = await fetch("/api/own-equipment/tracker/add-equipment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  });
  if (res.ok) {
    closeModal("equipmentModal");
    loadDashboardData();
  } else alert("Failed.");
}

// സേവ് ചെയ്യാൻ മാത്രമുള്ള ഒരു കോമൺ ഫംഗ്ഷൻ
async function postLogData() {
  const d = {
    equipment_id: document.getElementById("inputEquipmentId").value,
    year: document.getElementById("inputYear").value,
    month: document.getElementById("inputMonth").value,
    maintenance_cost: document.getElementById("inputMaint").value,
    basic_salary: document.getElementById("inputBasicSalary").value,
    overtime: document.getElementById("inputOT").value,
    penalty: document.getElementById("inputPenalty").value,
    santook_rent: document.getElementById("inputSantook").value,
    kafil_comm: document.getElementById("inputKafil").value,
    owner_comm: document.getElementById("inputOwner").value,
    investor_comm: document.getElementById("inputInvestor").value,
    op_revenue: document.getElementById("inputRevenue").value,
  };
  const res = await fetch("/api/own-equipment/tracker/save-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  });
  return res.ok;
}

// 1. Save & Close Button Logic
async function saveMonthlyData() {
  const success = await postLogData();
  if (success) {
    closeModal("dataModal");
    loadDashboardData();
  } else {
    alert("Failed to save.");
  }
}

// 2. Save & Next Button Logic (പുതിയ വണ്ടിയിലേക്ക് തനിയെ പോകും)
async function saveAndAddNew() {
  const success = await postLogData();
  if (success) {
    const eqSelect = document.getElementById("inputEquipmentId");
    const currIndex = eqSelect.selectedIndex;
    let nextVal = eqSelect.value;
    
    if (currIndex < eqSelect.options.length - 1) {
      nextVal = eqSelect.options[currIndex + 1].value;
    } else {
      alert("Saved! This was the last equipment in the list.");
    }
    
    await loadDashboardData(); 
    
    eqSelect.value = nextVal;
    populateModalFields();
    
  } else {
    alert("Failed to save.");
  }
}

function formatPurchaseDate(d) {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  return `${monthNames[x.getMonth()]} ${x.getFullYear().toString().slice(-2)}`;
}
function exportToExcel() {
    document.getElementById('exportModal').style.display = 'flex';
}

function executeExport(type) {
    const y = document.getElementById('filterYear').value;
    closeModal('exportModal');

    if (type === 'batch') {
        window.location.href = `/api/own-equipment/tracker/export-excel?type=batch`;
    } else {
        let vM = Array.from(document.querySelectorAll('.month-chk:checked')).map(b => parseInt(b.value));
        if (vM.length === 0) vM = Array.from({length: 12}, (_, i) => i + 1);
        window.location.href = `/api/own-equipment/tracker/export-excel?type=single&year=${y}&months=${vM.join(',')}`;
    }
}

window.onclick = (e) => {
  if (!e.target.matches(".anchor") && !e.target.closest(".dropdown-check-list"))
    document
      .querySelectorAll(".dropdown-check-list.visible")
      .forEach((el) => el.classList.remove("visible"));
};
function logout() {
    localStorage.removeItem('eq_user');
    window.location.replace('index.html');
}

function populateModalFields() {
  const eqId = document.getElementById("inputEquipmentId").value;
  const y = document.getElementById("inputYear").value;
  const m = document.getElementById("inputMonth").value;

  const log = rawMonthlyLogs.find(x => x.equipment_id == eqId && x.year == y && x.month == m);

  document.getElementById("inputMaint").value = (log && Number(log.maintenance_cost) !== 0) ? log.maintenance_cost : "";
  document.getElementById("inputBasicSalary").value = (log && Number(log.basic_salary) !== 0) ? log.basic_salary : "";
  document.getElementById("inputOT").value = (log && Number(log.overtime) !== 0) ? log.overtime : "";
  document.getElementById("inputPenalty").value = (log && Number(log.penalty) !== 0) ? log.penalty : "";
  document.getElementById("inputSantook").value = (log && Number(log.santook_rent) !== 0) ? log.santook_rent : "";
  document.getElementById("inputKafil").value = (log && Number(log.kafil_comm) !== 0) ? log.kafil_comm : "";
  document.getElementById("inputOwner").value = (log && Number(log.owner_comm) !== 0) ? log.owner_comm : "";
  document.getElementById("inputInvestor").value = (log && Number(log.investor_comm) !== 0) ? log.investor_comm : "";
  document.getElementById("inputRevenue").value = (log && Number(log.op_revenue) !== 0) ? log.op_revenue : "";
}