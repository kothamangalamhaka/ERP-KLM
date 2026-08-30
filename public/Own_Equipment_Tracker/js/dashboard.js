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
  startActiveUserTracking();

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
function filterByPlateNo() {
  renderTable();
}

function renderTable() {
  const y = document.getElementById("filterYear").value;
  const searchTerm = (document.getElementById("searchPlateNo") ? document.getElementById("searchPlateNo").value : "").trim().toLowerCase();
  const header = document.getElementById("tableHeader"),
    body = document.getElementById("tableBody");
  let vM = Array.from(document.querySelectorAll(".month-chk:checked")).map(
    (b) => parseInt(b.value),
  );
  if (vM.length === 0) vM = Array.from({ length: 12 }, (_, i) => i + 1);

  let r1 = `<tr><th rowspan="4" class="master-head">SN</th><th rowspan="4" class="master-head">Plate No</th><th rowspan="4" class="master-head">Date of <br> Purchase</th><th rowspan="4" class="master-head">Purchase <br> Cost Paid</th><th rowspan="4" class="master-head">Remaining <br> Purchase <br> Cost</th>`;
  let r2 = `<tr>`,
    r3 = `<tr>`,
    r4 = `<tr>`;

  vM.forEach((m) => {
    r1 += `<th colspan="17" class="month-head">${fullMonthNames[m - 1]} ${y}</th>`;
    r2 += `<th rowspan="3" class="sub-head">Equipment <br> Maintanance <br> Cost</th><th colspan="11" class="sub-head bg-opc">Operating Expenses</th><th rowspan="3" class="sub-head bg-total-cost">Total Cost</th><th rowspan="3" class="sub-head bg-revenue">OPerational <br> Revenue</th><th rowspan="3" class="sub-head bg-gl"> This Month <br> Gain / Loss</th><th rowspan="3" class="sub-head">Prv Month <br> Balance</th><th rowspan="3" class="sub-head bg-net">Net OP <br> Gain/Loss</th>`;
    r3 += `<th colspan="4" class="sub-head bg-opc">Driver Side Expenses</th><th rowspan="2" class="sub-head bg-opc">Santook <br> Rent</th><th colspan="3" class="sub-head bg-opc">Commission Paid</th><th colspan="3" class="sub-head bg-opc">Other Expense</th>`;
    r4 += `<th class="sub-head bg-opc">Basic</th><th class="sub-head bg-opc">OT</th><th class="sub-head bg-opc" style="color:red;">Penalty</th><th class="sub-head bg-opc" style="font-weight:bold;">Net Salary</th><th class="sub-head bg-opc">Kafil</th><th class="sub-head bg-opc">Owner</th><th class="sub-head bg-opc">Investor</th><th class="sub-head bg-opc">Debit</th><th class="sub-head bg-opc">PWAS</th><th class="sub-head bg-opc">Other</th>`;
  });
  header.innerHTML = r1 + `</tr>` + r2 + `</tr>` + r3 + `</tr>` + r4 + `</tr>`;

  body.innerHTML = "";
  
  // Chronological sorting based on Purchase Date (oldest to newest)
  const sortedEquipments = [...rawEquipments].sort((a, b) => {
    const dateA = a.purchase_date ? new Date(a.purchase_date).getTime() : 0;
    const dateB = b.purchase_date ? new Date(b.purchase_date).getTime() : 0;
    return dateA - dateB;
  });

  const filteredEquipments = sortedEquipments.filter(eq => 
    !searchTerm || (eq.plate_no && eq.plate_no.toString().toLowerCase().includes(searchTerm))
  );

  filteredEquipments.forEach((eq, idx) => {
    let tr = `<tr>
      <td><b>${idx + 1}</b></td>
      <td><b>${eq.plate_no}</b></td>
      <td>${formatPurchaseDate(eq.purchase_date)}</td>
      <td>${fmt(eq.purchase_cost)}</td>
      <td style="color: #b91c1c; font-weight: bold;">${fmt(eq.remaining_purchase_cost)}</td>`;
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
        rev = Number(l.op_revenue || 0),
        debit = Number(l.debit || 0),
        pwas = Number(l.pwas || 0),
        other_exp = Number(l.other_expense || 0);
      const netSal = basic + ot - penalty;
      const kafil = rev * (Number(l.kafil_comm || 0) / 100),
        owner = Number(l.owner_comm || 0),
        inv = Number(l.investor_comm || 0);
      const opc = netSal + santook + kafil + owner + inv + debit + pwas + other_exp;
      const tCost = maint + opc;
      let gl = 0;
      if (tCost > 0 || rev > 0) gl = rev - tCost;
      let net = 0;
      if (gl !== 0 || carryGL !== 0) net = gl + carryGL;
      if (vM.includes(m)) {
        tr += `
          <td class="editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="maintenance_cost">${fmt(maint)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="basic_salary">${fmt(basic)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="overtime">${fmt(ot)}</td>
          <td class="bg-opc editable-cell" style="color:red;" data-eq="${eq.id}" data-month="${m}" data-field="penalty">${fmt(penalty)}</td>
          <td class="bg-opc"><b>${fmt(netSal)}</b></td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="santook_rent">${fmt(santook)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="kafil_comm">${fmt(kafil, 1)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="owner_comm">${fmt(owner, 1)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="investor_comm">${fmt(inv, 1)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="debit">${fmt(debit)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="pwas">${fmt(pwas)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="other_expense">${fmt(other_exp)}</td>
          <td class="bg-total-cost"><b>${fmt(tCost, 1)}</b></td>
          <td class="bg-revenue editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="op_revenue"><b>${fmt(rev)}</b></td>
          <td class="bg-gl" style="color:${gl < 0 ? "red" : "green"};"><b>${fmt(gl, 1)}</b></td>
          <td>${fmt(carryGL, 1)}</td>
          <td class="bg-net" style="color:${net < 0 ? "red" : "black"};">${fmt(net, 1)}</td>`;
      }
      carryGL = net;
    }
    body.innerHTML += tr + `</tr>`;
  });
}

let isEditMode = false;

function toggleEditMode() {
  const btn = document.getElementById("btnEditInline");
  const cells = document.querySelectorAll(".editable-cell");

  if (!isEditMode) {
    isEditMode = true;
    btn.innerHTML = "💾 Save Data";
    btn.style.background = "#27ae60";
    cells.forEach(cell => {
      cell.setAttribute("contenteditable", "true");
      cell.style.backgroundColor = "#fffbcc";
      cell.style.outline = "1px solid #f39c12";
    });
  } else {
    saveInlineData();
  }
}

async function saveInlineData() {
  const y = Number(document.getElementById("filterYear").value);
  const cells = document.querySelectorAll(".editable-cell");
  let groupedLogs = {};

  cells.forEach(cell => {
    const eqId = Number(cell.getAttribute("data-eq"));
    const month = Number(cell.getAttribute("data-month"));
    const field = cell.getAttribute("data-field");
    const val = parseFloat(cell.innerText.trim()) || 0;

    const key = `${eqId}_${month}`;
    if (!groupedLogs[key]) {
      groupedLogs[key] = {
        equipment_id: eqId,
        year: y,
        month: month,
        maintenance_cost: 0, basic_salary: 0, overtime: 0, penalty: 0,
        santook_rent: 0, kafil_comm: 0, owner_comm: 0, investor_comm: 0,
        debit: 0, pwas: 0, other_expense: 0, op_revenue: 0
      };
    }
    groupedLogs[key][field] = val;
  });

  const payload = {
    logs: Object.values(groupedLogs)
  };

  try {
    const res = await fetch("/py/own-equipment/bulk-save-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (res.ok && result.success) {
      isEditMode = false;
      const btn = document.getElementById("btnEditInline");
      btn.innerHTML = "✏️ Edit Data";
      btn.style.background = "#8e44ad";
      
      cells.forEach(cell => {
        cell.removeAttribute("contenteditable");
        cell.style.backgroundColor = "";
        cell.style.outline = "";
      });

      await loadDashboardData();
      showToast("All changes successfully updated..!", "success");
    } else {
      showToast("Save failed: " + (result.detail || result.message || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Inline Save Error:", err);
    showToast("Error communicating with Server.", "error");
  }
}
function populateEquipmentDropdown() {
  const select = document.getElementById("inputEquipmentId");
  const currentVal = select.value; 
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  if (currentVal) select.value = currentVal; 
}
function resetEquipmentForm() {
  document.getElementById("eqPlateNo").value = "";
  document.getElementById("eqPurchaseDate").value = "";
  document.getElementById("eqPurchaseCost").value = "0";
  document.getElementById("eqRemainingCost").value = "0";
}

function openEquipmentModal() {
  resetEquipmentForm();
  document.getElementById("equipmentModal").style.display = "flex";
  document.getElementById("eqPlateNo").focus();
}

function openDataModal() {
  document.getElementById("dataModal").style.display = "flex";
  populateModalFields(); 
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

async function saveEquipment(isNext = false) {
  const plateNo = document.getElementById("eqPlateNo").value.trim();
  if (!plateNo) {
    showToast("Please enter Plate No!", "error");
    return;
  }

  const d = {
    plate_no: plateNo,
    purchase_date: document.getElementById("eqPurchaseDate").value,
    purchase_cost: document.getElementById("eqPurchaseCost").value,
    remaining_purchase_cost: document.getElementById("eqRemainingCost").value || 0,
  };

  try {
    const res = await fetch("/api/own-equipment/tracker/add-equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });

    if (res.ok) {
      await loadDashboardData();
      showToast("Equipment added successfully!", "success");

      if (isNext) {
        resetEquipmentForm();
        document.getElementById("eqPlateNo").focus();
      } else {
        closeModal("equipmentModal");
      }
    } else {
      showToast("Failed to add equipment.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Server error while adding equipment.", "error");
  }
}

// 🟢 OPEN EDIT COST MODAL
function openEditCostModal() {
  const select = document.getElementById("editCostEqId");
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  populateEditCostFields();
  document.getElementById("editCostModal").style.display = "flex";
}

// 🟢 POPULATE SELECTED EQUIPMENT VALUES
function populateEditCostFields() {
  const eqId = Number(document.getElementById("editCostEqId").value);
  const eq = rawEquipments.find((x) => x.id === eqId);
  if (eq) {
    document.getElementById("editCostPaid").value = eq.purchase_cost || 0;
    document.getElementById("editCostRemaining").value = eq.remaining_purchase_cost || 0;
  }
}

// 🟢 TOAST NOTIFICATION HELPER FUNCTION
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === "success" ? "✅ " : "❌ "} ${message}</span>`;

  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add("show"), 10);

  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 🟢 SAVE EDITED PURCHASE COST TO DATABASE (WITH TOAST)
async function saveEditedCost() {
  const eqId = Number(document.getElementById("editCostEqId").value);
  const paid = parseFloat(document.getElementById("editCostPaid").value) || 0;
  const remaining = parseFloat(document.getElementById("editCostRemaining").value) || 0;

  try {
    const res = await fetch("/api/own-equipment/tracker/edit-equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: eqId,
        purchase_cost: paid,
        remaining_purchase_cost: remaining
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeModal("editCostModal");
      await loadDashboardData();
      showToast("Purchase Cost updated successfully!", "success");
    } else {
      showToast("Failed to update: " + (data.message || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Edit Cost Error:", err);
    showToast("Error updating equipment cost.", "error");
  }
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
    debit: document.getElementById("inputDebit").value,
    pwas: document.getElementById("inputPwas").value,
    other_expense: document.getElementById("inputOtherExpense").value,
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
    showToast("Monthly data saved successfully!", "success");
  } else {
    showToast("Failed to save data.", "error");
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
      showToast("Data saved. Moving to next equipment.", "success");
    } else {
      showToast("Saved! This was the last equipment in the list.", "success");
    }
    
    await loadDashboardData(); 
    
    eqSelect.value = nextVal;
    populateModalFields();
    
  } else {
    showToast("Failed to save data.", "error");
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
  document.getElementById("inputDebit").value = (log && Number(log.debit) !== 0) ? log.debit : "";
  document.getElementById("inputPwas").value = (log && Number(log.pwas) !== 0) ? log.pwas : "";
  document.getElementById("inputOtherExpense").value = (log && Number(log.other_expense) !== 0) ? log.other_expense : "";
  document.getElementById("inputRevenue").value = (log && Number(log.op_revenue) !== 0) ? log.op_revenue : "";
}

// === Real-time Active Users Tracking Logic ===

let currentActiveUsers = [];

function startActiveUserTracking() {
  const userStr = localStorage.getItem('eq_user');
  let username = "Unknown User";
  
  // Extracting username securely
  if (userStr) {
    try {
      const userObj = JSON.parse(userStr);
      username = userObj.name || userObj.username || userStr;
    } catch (e) {
      username = userStr;
    }
  }

  // Ping server every 5 seconds
  setInterval(async () => {
    try {
      const res = await fetch('/api/own-equipment/tracker/active-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: username })
      });
      const data = await res.json();
      currentActiveUsers = data.active;
      updateActiveUserBadge();
    } catch (err) {
      console.error("Active user tracking error:", err);
    }
  }, 5000);
}

function updateActiveUserBadge() {
  const badge = document.getElementById('activeUserBadge');
  if (currentActiveUsers.length === 0) {
    badge.style.display = 'none';
  } else if (currentActiveUsers.length === 1) {
    badge.style.display = 'flex';
    badge.innerText = `🟢 Active: ${currentActiveUsers[0]}`;
  } else {
    badge.style.display = 'flex';
    badge.innerText = `🟢 Active Users: ${currentActiveUsers.length}`;
  }
}

function showActiveUsersModal() {
  if (currentActiveUsers.length <= 1) return; // Open modal only if more than 1 user is active
  const list = document.getElementById('activeUsersList');
  list.innerHTML = currentActiveUsers
    .map(u => `<li style="padding: 10px; border-bottom: 1px solid #eee; color: #2c3e50; font-weight: 500;"><span style="color: #2ecc71;">●</span> ${u}</li>`)
    .join('');
  document.getElementById('activeUsersModal').style.display = 'flex';
}

// ==========================================
// 💰 REVENUE MODAL LOGIC
// ==========================================

function openRevenueModal() {
  const select = document.getElementById("revenueEqId");
  select.innerHTML = rawEquipments
    .map(e => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  populateRevenueTable();
  document.getElementById("revenueModal").style.display = "flex";
}

function populateRevenueTable() {
  const eqId = Number(document.getElementById("revenueEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  const tbody = document.getElementById("revenueTableBody");
  
  let html = "";
  for (let m = 1; m <= 12; m++) {
    const log = rawMonthlyLogs.find(x => x.equipment_id === eqId && x.year === y && x.month === m);
    const rev = (log && Number(log.op_revenue) !== 0) ? log.op_revenue : "";
    
    html += `
      <tr>
        <td style="font-weight: bold; background: #fafafa; text-align: center; width: 50%;">
          ${fullMonthNames[m-1]} ${y}
        </td>
        <td style="padding: 0; background: #fff; width: 50%;">
          <input type="number" id="rev_input_${m}" class="rev-input-cell" data-index="${m}" value="${rev}" 
                 style="width: 100%; border: none; text-align: center; font-weight: bold; background: transparent; padding: 12px 0; outline: none; box-shadow: none;" 
                 placeholder="0" />
        </td>
      </tr>
    `;
  }
  tbody.innerHTML = html;

  const inputs = document.querySelectorAll('.rev-input-cell');
  inputs.forEach((input, index) => {
    // Keydown Event Listener for Arrow & Enter keys
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (inputs[index + 1]) inputs[index + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (inputs[index - 1]) inputs[index - 1].focus();
      }
    });

    // Paste Event Listener for Excel bulk copy-paste
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      
      // Split pasted text by newline characters
      const rows = pasteData.split(/\r?\n/);
      let currentIndex = index;

      rows.forEach(row => {
        if (currentIndex < inputs.length) {
          // Remove non-numeric characters (like commas) but keep decimals
          let cleanVal = row.replace(/[^0-9.-]+/g, ""); 
          
          if (cleanVal !== "" || row.trim() !== "") {
            inputs[currentIndex].value = cleanVal;
          }
          currentIndex++;
        }
      });
    });
  });
}

// Helper Function for Saving Data
async function postRevenueData() {
  const eqId = Number(document.getElementById("revenueEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let groupedLogs = {};

  for (let m = 1; m <= 12; m++) {
    const inputVal = document.getElementById(`rev_input_${m}`).value;
    const revVal = parseFloat(inputVal) || 0;
    const existingLog = rawMonthlyLogs.find(x => x.equipment_id === eqId && x.year === y && x.month === m) || {};
    
    groupedLogs[`${eqId}_${m}`] = {
      equipment_id: eqId,
      year: y,
      month: m,
      maintenance_cost: existingLog.maintenance_cost || 0,
      basic_salary: existingLog.basic_salary || 0,
      overtime: existingLog.overtime || 0,
      penalty: existingLog.penalty || 0,
      santook_rent: existingLog.santook_rent || 0,
      kafil_comm: existingLog.kafil_comm || 0,
      owner_comm: existingLog.owner_comm || 0,
      investor_comm: existingLog.investor_comm || 0,
      debit: existingLog.debit || 0,
      pwas: existingLog.pwas || 0,
      other_expense: existingLog.other_expense || 0,
      op_revenue: revVal // Only updates operational revenue
    };
  }

  try {
    const res = await fetch("/py/own-equipment/bulk-save-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: Object.values(groupedLogs) })
    });
    const result = await res.json();
    return res.ok && result.success;
  } catch (err) {
    console.error("Revenue Save Error:", err);
    return false;
  }
}

// Triggered by 'Save & Close'
async function saveRevenueData() {
  if (await postRevenueData()) {
    closeModal("revenueModal");
    await loadDashboardData();
    showToast("Revenue updated successfully!", "success");
  } else {
    showToast("Failed to save revenue.", "error");
  }
}

// Triggered by 'Save & Next'
async function saveAndNextRevenue() {
  if (await postRevenueData()) {
    const select = document.getElementById("revenueEqId");
    
    if (select.selectedIndex < select.options.length - 1) {
      select.selectedIndex += 1; // Move to next equipment
      showToast("Saved! Moving to next equipment.", "success");
      copyRevenuePlateNo(); // Automatically copy the new plate number
    } else {
      showToast("Saved! This is the last equipment.", "success");
    }
    
    await loadDashboardData(); // Refresh background data
    populateRevenueTable(); // Load the new equipment into the modal
  } else {
    showToast("Failed to save revenue.", "error");
  }
}

// Function to copy the selected plate number in Revenue Modal
function copyRevenuePlateNo() {
  const select = document.getElementById("revenueEqId");
  if (select.selectedIndex === -1) return;
  
  const plateNo = select.options[select.selectedIndex].text;
  
  navigator.clipboard.writeText(plateNo).then(() => {
    showToast(`Copied: ${plateNo}`, "success");
  }).catch(err => {
    console.error("Failed to copy text: ", err);
    showToast("Failed to copy Plate No.", "error");
  });
}

// ==========================================
// 🚀 GENERIC GRID PASTE & NAVIGATION LOGIC
// ==========================================

function copyModalPlateNo(selectId) {
  const select = document.getElementById(selectId);
  if (select.selectedIndex === -1) return;
  navigator.clipboard.writeText(select.options[select.selectedIndex].text)
    .then(() => showToast(`Copied Plate No!`, "success"))
    .catch(() => showToast("Failed to copy", "error"));
}

function attachGridListeners(className) {
  const inputs = document.querySelectorAll('.' + className);
  inputs.forEach(input => {
    // Arrow Key Navigation
    input.addEventListener('keydown', (e) => {
      const row = parseInt(input.getAttribute('data-row'));
      const col = parseInt(input.getAttribute('data-col'));
      let nextInput;

      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        nextInput = document.querySelector(`.${className}[data-row="${row + 1}"][data-col="${col}"]`);
      } else if (e.key === 'ArrowUp') {
        nextInput = document.querySelector(`.${className}[data-row="${row - 1}"][data-col="${col}"]`);
      } else if (e.key === 'ArrowRight') {
        nextInput = document.querySelector(`.${className}[data-row="${row}"][data-col="${col + 1}"]`);
      } else if (e.key === 'ArrowLeft') {
        nextInput = document.querySelector(`.${className}[data-row="${row}"][data-col="${col - 1}"]`);
      }

      if (nextInput) {
        e.preventDefault();
        nextInput.focus();
        nextInput.select();
      }
    });

    // Multi-column Paste from Excel
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const rows = pasteData.split(/\r?\n/);
      const startRow = parseInt(input.getAttribute('data-row'));
      const startCol = parseInt(input.getAttribute('data-col'));

      rows.forEach((rowData, rIdx) => {
        if (!rowData.trim()) return;
        const cells = rowData.split('\t');
        cells.forEach((cellData, cIdx) => {
          const targetRow = startRow + rIdx;
          const targetCol = startCol + cIdx;
          const targetInput = document.querySelector(`.${className}[data-row="${targetRow}"][data-col="${targetCol}"]`);
          if (targetInput) {
            let cleanVal = cellData.replace(/[^0-9.-]+/g, "");
            if (cleanVal !== "") {
              targetInput.value = cleanVal;
              // Explicitly trigger the Net Salary calculation on paste
              if (className === 'sal-input') {
                calculateNetSalary(targetRow);
              }
            }
          }
        });
      });
    });
  });
}

function getBaseLog(eqId, y, m) {
  return rawMonthlyLogs.find(x => x.equipment_id === eqId && x.year === y && x.month === m) || {};
}

// ==========================================
// 🧾 EXPENSE MODAL
// ==========================================
function openExpenseModal() {
  const select = document.getElementById("expenseEqId");
  select.innerHTML = rawEquipments.map(e => `<option value="${e.id}">${e.plate_no}</option>`).join("");
  populateExpenseTable();
  document.getElementById("expenseModal").style.display = "flex";
}

function populateExpenseTable() {
  const eqId = Number(document.getElementById("expenseEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let html = "";
  
  for (let m = 1; m <= 12; m++) {
    const log = getBaseLog(eqId, y, m);
    html += `<tr>
      <td style="font-weight: bold; background: #fafafa; text-align: center;">${fullMonthNames[m-1]} ${y}</td>
      <td style="padding:0;"><input type="number" class="exp-input" data-row="${m}" data-col="1" id="exp_maint_${m}" value="${log.maintenance_cost || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-row="${m}" data-col="2" id="exp_santook_${m}" value="${log.santook_rent || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-row="${m}" data-col="3" id="exp_debit_${m}" value="${log.debit || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-row="${m}" data-col="4" id="exp_pwas_${m}" value="${log.pwas || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-row="${m}" data-col="5" id="exp_other_${m}" value="${log.other_expense || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
    </tr>`;
  }
  document.getElementById("expenseTableBody").innerHTML = html;
  attachGridListeners('exp-input');
}

async function postExpenseData() {
  const eqId = Number(document.getElementById("expenseEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let logs = [];
  for (let m = 1; m <= 12; m++) {
    let log = getBaseLog(eqId, y, m);
    log.equipment_id = eqId; log.year = y; log.month = m;
    log.maintenance_cost = parseFloat(document.getElementById(`exp_maint_${m}`).value) || 0;
    log.santook_rent = parseFloat(document.getElementById(`exp_santook_${m}`).value) || 0;
    log.debit = parseFloat(document.getElementById(`exp_debit_${m}`).value) || 0;
    log.pwas = parseFloat(document.getElementById(`exp_pwas_${m}`).value) || 0;
    log.other_expense = parseFloat(document.getElementById(`exp_other_${m}`).value) || 0;
    logs.push(log);
  }
  return await fetch("/py/own-equipment/bulk-save-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logs }) }).then(r => r.json());
}
async function saveExpenseData() { if((await postExpenseData()).success) { closeModal("expenseModal"); await loadDashboardData(); showToast("Expenses saved!", "success"); } }
async function saveAndNextExpense() {
  if((await postExpenseData()).success) {
    const s = document.getElementById("expenseEqId");
    if(s.selectedIndex < s.options.length - 1) { s.selectedIndex++; copyModalPlateNo('expenseEqId'); }
    await loadDashboardData(); populateExpenseTable(); showToast("Saved & Moved Next!", "success");
  }
}

// ==========================================
// 💵 SALARY MODAL (Auto Calculate Net)
// ==========================================
function openSalaryModal() {
  const select = document.getElementById("salaryEqId");
  select.innerHTML = rawEquipments.map(e => `<option value="${e.id}">${e.plate_no}</option>`).join("");
  populateSalaryTable();
  document.getElementById("salaryModal").style.display = "flex";
}

function calculateNetSalary(m) {
  const basic = parseFloat(document.getElementById(`sal_basic_${m}`).value) || 0;
  const ot = parseFloat(document.getElementById(`sal_ot_${m}`).value) || 0;
  const penalty = parseFloat(document.getElementById(`sal_penalty_${m}`).value) || 0;
  document.getElementById(`sal_net_${m}`).innerText = (basic + ot - penalty).toFixed(2);
}

function populateSalaryTable() {
  const eqId = Number(document.getElementById("salaryEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let html = "";
  
  for (let m = 1; m <= 12; m++) {
    const log = getBaseLog(eqId, y, m);
    // Explicitly convert to Numbers to avoid string concatenation issues
    const basic = Number(log.basic_salary) || 0; 
    const ot = Number(log.overtime) || 0; 
    const penalty = Number(log.penalty) || 0;
    const net = basic + ot - penalty;
    
    html += `<tr>
      <td style="font-weight: bold; background: #fafafa; text-align: center;">${fullMonthNames[m-1]} ${y}</td>
      <td style="padding:0;"><input type="number" class="sal-input" data-row="${m}" data-col="1" id="sal_basic_${m}" value="${basic || ''}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="sal-input" data-row="${m}" data-col="2" id="sal_ot_${m}" value="${ot || ''}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="sal-input" data-row="${m}" data-col="3" id="sal_penalty_${m}" value="${penalty || ''}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0; color:red;"></td>
      <td style="background: #f8f9fa; text-align: center; font-weight: bold;"><span id="sal_net_${m}">${net.toFixed(2)}</span></td>
    </tr>`;
  }
  document.getElementById("salaryTableBody").innerHTML = html;
  attachGridListeners('sal-input');
}

async function postSalaryData() {
  const eqId = Number(document.getElementById("salaryEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let logs = [];
  for (let m = 1; m <= 12; m++) {
    let log = getBaseLog(eqId, y, m);
    log.equipment_id = eqId; log.year = y; log.month = m;
    log.basic_salary = parseFloat(document.getElementById(`sal_basic_${m}`).value) || 0;
    log.overtime = parseFloat(document.getElementById(`sal_ot_${m}`).value) || 0;
    log.penalty = parseFloat(document.getElementById(`sal_penalty_${m}`).value) || 0;
    logs.push(log);
  }
  return await fetch("/py/own-equipment/bulk-save-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logs }) }).then(r => r.json());
}
async function saveSalaryData() { if((await postSalaryData()).success) { closeModal("salaryModal"); await loadDashboardData(); showToast("Salary saved!", "success"); } }
async function saveAndNextSalary() {
  if((await postSalaryData()).success) {
    const s = document.getElementById("salaryEqId");
    if(s.selectedIndex < s.options.length - 1) { s.selectedIndex++; copyModalPlateNo('salaryEqId'); }
    await loadDashboardData(); populateSalaryTable(); showToast("Saved & Moved Next!", "success");
  }
}

// ==========================================
// 🤝 COMMISSION MODAL
// ==========================================
function openCommissionModal() {
  const select = document.getElementById("commissionEqId");
  select.innerHTML = rawEquipments.map(e => `<option value="${e.id}">${e.plate_no}</option>`).join("");
  populateCommissionTable();
  document.getElementById("commissionModal").style.display = "flex";
}

function populateCommissionTable() {
  const eqId = Number(document.getElementById("commissionEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let html = "";
  
  for (let m = 1; m <= 12; m++) {
    const log = getBaseLog(eqId, y, m);
    html += `<tr>
      <td style="font-weight: bold; background: #fafafa; text-align: center;">${fullMonthNames[m-1]} ${y}</td>
      <td style="padding:0;"><input type="number" class="comm-input" data-row="${m}" data-col="1" id="comm_kafil_${m}" value="${log.kafil_comm || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="comm-input" data-row="${m}" data-col="2" id="comm_owner_${m}" value="${log.owner_comm || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="comm-input" data-row="${m}" data-col="3" id="comm_investor_${m}" value="${log.investor_comm || ''}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
    </tr>`;
  }
  document.getElementById("commissionTableBody").innerHTML = html;
  attachGridListeners('comm-input');
}

async function postCommissionData() {
  const eqId = Number(document.getElementById("commissionEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let logs = [];
  for (let m = 1; m <= 12; m++) {
    let log = getBaseLog(eqId, y, m);
    log.equipment_id = eqId; log.year = y; log.month = m;
    log.kafil_comm = parseFloat(document.getElementById(`comm_kafil_${m}`).value) || 0;
    log.owner_comm = parseFloat(document.getElementById(`comm_owner_${m}`).value) || 0;
    log.investor_comm = parseFloat(document.getElementById(`comm_investor_${m}`).value) || 0;
    logs.push(log);
  }
  return await fetch("/py/own-equipment/bulk-save-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logs }) }).then(r => r.json());
}
async function saveCommissionData() { if((await postCommissionData()).success) { closeModal("commissionModal"); await loadDashboardData(); showToast("Commission saved!", "success"); } }
async function saveAndNextCommission() {
  if((await postCommissionData()).success) {
    const s = document.getElementById("commissionEqId");
    if(s.selectedIndex < s.options.length - 1) { s.selectedIndex++; copyModalPlateNo('commissionEqId'); }
    await loadDashboardData(); populateCommissionTable(); showToast("Saved & Moved Next!", "success");
  }
}