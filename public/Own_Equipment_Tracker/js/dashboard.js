let rawEquipments = [],
  rawMonthlyLogs = [];
let activeColumnFilters = {
  plate_no: null,
  purchase_date: null,
  remaining_purchase_cost: null,
};
let currentFilterColumn = null;
let currentSort = { column: null, direction: null }; 
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
  if (!localStorage.getItem("eq_user")) {
    window.location.replace("index.html");
  }
  initYearMonthDropdowns();
  loadDashboardData();
  startActiveUserTracking();

  // 🟢 Number inputs-il mouse wheel scroll cheythu value maarunnath prevent cheyyunnu
  document.addEventListener("wheel", (e) => {
    if (document.activeElement.type === "number") {
      document.activeElement.blur();
    }
  });

  window.addEventListener("click", () => closePlateFilterMenu());

  const modalInputs = document.querySelectorAll(
    "#dataModal input[type='number']",
  );
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
function updateMonthSelectorLabel() {
  const lbl = document.getElementById("monthSelectorLabel");
  if (!lbl) return;
  const checked = Array.from(document.querySelectorAll(".month-chk:checked")).map((c) => parseInt(c.value));
  if (checked.length === 12 || checked.length === 0) {
    lbl.innerText = "All Months";
  } else if (checked.length === 1) {
    lbl.innerText = `${monthNames[checked[0] - 1]}`;
  } else {
    lbl.innerText = `${checked.length} Months`;
  }
}

function toggleAllMonths(src) {
  document
    .querySelectorAll(".month-chk")
    .forEach((chk) => (chk.checked = src.checked));
  updateMonthSelectorLabel();
}
function uncheckAll(src) {
  if (!src.checked) {
    document.getElementById("chkAllMonths").checked = false;
  } else {
    const allChecked = Array.from(document.querySelectorAll(".month-chk")).every((c) => c.checked);
    document.getElementById("chkAllMonths").checked = allChecked;
  }
  updateMonthSelectorLabel();
}

async function navigateMonth(direction) {
  const yearSelect = document.getElementById("filterYear");
  let currentYear = parseInt(yearSelect.value);
  const checked = Array.from(document.querySelectorAll(".month-chk:checked")).map((c) => parseInt(c.value));
  
  let targetMonth = 1;
  if (checked.length === 1) {
    targetMonth = checked[0] + direction;
  } else {
    targetMonth = direction > 0 ? 1 : 12;
  }

  let yearChanged = false;
  if (targetMonth > 12) {
    targetMonth = 1;
    currentYear += 1;
    yearChanged = true;
  } else if (targetMonth < 1) {
    targetMonth = 12;
    currentYear -= 1;
    yearChanged = true;
  }

  if (yearChanged) {
    let yearOption = Array.from(yearSelect.options).find((opt) => parseInt(opt.value) === currentYear);
    if (!yearOption) {
      yearSelect.innerHTML += `<option value="${currentYear}">${currentYear}</option>`;
    }
    yearSelect.value = currentYear;
  }

  document.getElementById("chkAllMonths").checked = false;
  document.querySelectorAll(".month-chk").forEach((chk) => {
    chk.checked = parseInt(chk.value) === targetMonth;
  });

  updateMonthSelectorLabel();

  if (yearChanged) {
    await loadDashboardData();
  } else {
    renderTable();
  }
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
  updateMonthSelectorLabel();
  const y = document.getElementById("filterYear").value;
  const searchTerm = (
    document.getElementById("searchPlateNo")
      ? document.getElementById("searchPlateNo").value
      : ""
  )
    .trim()
    .toLowerCase();
  const header = document.getElementById("tableHeader"),
    body = document.getElementById("tableBody");
  let vM = Array.from(document.querySelectorAll(".month-chk:checked")).map(
    (b) => parseInt(b.value),
  );
  if (vM.length === 0) vM = Array.from({ length: 12 }, (_, i) => i + 1);

  const plateInd = activeColumnFilters.plate_no !== null ? " 🔽" : "";
  const dateInd = activeColumnFilters.purchase_date !== null ? " 🔽" : "";
  const remInd = activeColumnFilters.remaining_purchase_cost !== null ? " 🔽" : "";
  const fInd = (k) => (activeColumnFilters[k] !== undefined && activeColumnFilters[k] !== null ? " 🔽" : "");

  let r1 = `<tr><th rowspan="4" class="master-head">SN</th><th rowspan="4" class="master-head" id="thPlateNo" style="cursor:context-menu;" title="Right-click to filter">Plate No${plateInd}</th><th rowspan="4" class="master-head" id="thPurchaseDate" style="cursor:context-menu;" title="Right-click to filter">Date of <br> Purchase${dateInd}</th><th rowspan="4" class="master-head">Purchase <br> Cost Paid</th><th rowspan="4" class="master-head" id="thRemainingCost" style="cursor:context-menu;" title="Right-click to filter">Remaining <br> Purchase <br> Cost${remInd}</th>`;
  let r2 = `<tr>`,
    r3 = `<tr>`,
    r4 = `<tr>`;

  vM.forEach((m) => {
    r1 += `<th colspan="19" class="month-head">${fullMonthNames[m - 1]} ${y}</th>`;
    r2 += `<th rowspan="3" class="sub-head col-filter-th" data-col="maint_${m}" style="cursor:context-menu;" title="Right-click to filter">Equipment <br> Maintanance <br> Cost${fInd(`maint_${m}`)}</th>
           <th colspan="13" class="sub-head bg-opc">Operating Expenses</th>
           <th rowspan="3" class="sub-head bg-total-cost col-filter-th" data-col="tcost_${m}" style="cursor:context-menu;" title="Right-click to filter">Total Cost${fInd(`tcost_${m}`)}</th>
           <th rowspan="3" class="sub-head bg-revenue col-filter-th" data-col="rev_${m}" style="cursor:context-menu;" title="Right-click to filter">OPerational <br> Revenue${fInd(`rev_${m}`)}</th>
           <th rowspan="3" class="sub-head bg-gl col-filter-th" data-col="gl_${m}" style="cursor:context-menu;" title="Right-click to filter"> This Month <br> Gain / Loss${fInd(`gl_${m}`)}</th>
           <th rowspan="3" class="sub-head col-filter-th" data-col="prv_${m}" style="cursor:context-menu;" title="Right-click to filter">Prv Month <br> Balance${fInd(`prv_${m}`)}</th>
           <th rowspan="3" class="sub-head bg-net col-filter-th" data-col="net_${m}" style="cursor:context-menu;" title="Right-click to filter">Net OP <br> Gain/Loss${fInd(`net_${m}`)}</th>`;
    r3 += `<th colspan="5" class="sub-head bg-opc">Driver Side Expenses</th>
           <th rowspan="2" class="sub-head bg-opc col-filter-th" data-col="santook_${m}" style="cursor:context-menu;" title="Right-click to filter">Santook <br> Rent${fInd(`santook_${m}`)}</th>
           <th colspan="4" class="sub-head bg-opc">Commission Paid</th>
           <th colspan="3" class="sub-head bg-opc">Other Expense</th>`;
    r4 += `<th class="sub-head bg-opc col-filter-th" data-col="basic_${m}" style="cursor:context-menu;" title="Right-click to filter">Basic${fInd(`basic_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="ot_${m}" style="cursor:context-menu;" title="Right-click to filter">OT${fInd(`ot_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="allowance_${m}" style="cursor:context-menu;" title="Right-click to filter">Allowance${fInd(`allowance_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="penalty_${m}" style="color:red; cursor:context-menu;" title="Right-click to filter">Penalty${fInd(`penalty_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="netSal_${m}" style="font-weight:bold; cursor:context-menu;" title="Right-click to filter">Net Salary${fInd(`netSal_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="kafilpct_${m}" style="width:50px; cursor:context-menu;" title="Right-click to filter">%${fInd(`kafilpct_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="kafil_${m}" style="cursor:context-menu;" title="Right-click to filter">Kafil${fInd(`kafil_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="owner_${m}" style="cursor:context-menu;" title="Right-click to filter">Owner${fInd(`owner_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="inv_${m}" style="cursor:context-menu;" title="Right-click to filter">Investor${fInd(`inv_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="debit_${m}" style="cursor:context-menu;" title="Right-click to filter">Debit${fInd(`debit_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="pwas_${m}" style="cursor:context-menu;" title="Right-click to filter">PWAS${fInd(`pwas_${m}`)}</th>
           <th class="sub-head bg-opc col-filter-th" data-col="other_${m}" style="cursor:context-menu;" title="Right-click to filter">Other${fInd(`other_${m}`)}</th>`;
  });
  header.innerHTML = r1 + `</tr>` + r2 + `</tr>` + r3 + `</tr>` + r4 + `</tr>`;

  body.innerHTML = "";

  // Sorting: Plate No A-Z / Z-A അല്ലെങ്കിൽ Purchase Date (oldest to newest)
  const sortedEquipments = [...rawEquipments].sort((a, b) => {
    if (currentSort.column === "plate_no") {
      const pA = (a.plate_no || "").toString().trim();
      const pB = (b.plate_no || "").toString().trim();
      return currentSort.direction === "asc"
        ? pA.localeCompare(pB, undefined, { numeric: true })
        : pB.localeCompare(pA, undefined, { numeric: true });
    }
    const dateA = a.purchase_date ? new Date(a.purchase_date).getTime() : 0;
    const dateB = b.purchase_date ? new Date(b.purchase_date).getTime() : 0;
    return dateA - dateB;
  });

  const filteredEquipments = sortedEquipments.filter((eq) => {
    const pNo = (eq.plate_no || "").toString().trim();
    if (searchTerm && !pNo.toLowerCase().includes(searchTerm)) return false;

    // 1. Plate No Filter
    if (activeColumnFilters.plate_no !== null && activeColumnFilters.plate_no !== undefined) {
      if (pNo === "" && !activeColumnFilters.plate_no.includes("__BLANK__")) return false;
      if (pNo !== "" && !activeColumnFilters.plate_no.includes(pNo)) return false;
    }

    // 2. Date of Purchase Filter
    if (activeColumnFilters.purchase_date !== null && activeColumnFilters.purchase_date !== undefined) {
      const formattedDate = formatPurchaseDate(eq.purchase_date);
      if (formattedDate === "" && !activeColumnFilters.purchase_date.includes("__BLANK__")) return false;
      if (formattedDate !== "" && !activeColumnFilters.purchase_date.includes(formattedDate)) return false;
    }

    // 3. Remaining Purchase Cost Filter
    if (activeColumnFilters.remaining_purchase_cost !== null && activeColumnFilters.remaining_purchase_cost !== undefined) {
      const remVal = eq.remaining_purchase_cost !== null && eq.remaining_purchase_cost !== undefined ? String(eq.remaining_purchase_cost) : "";
      if (remVal === "" && !activeColumnFilters.remaining_purchase_cost.includes("__BLANK__")) return false;
      if (remVal !== "" && !activeColumnFilters.remaining_purchase_cost.includes(remVal)) return false;
    }

    // Dynamic Monthly Columns Filter Check
    for (const [colKey, selectedVals] of Object.entries(activeColumnFilters)) {
      if (selectedVals === null || ["plate_no", "purchase_date", "remaining_purchase_cost"].includes(colKey)) continue;
      const val = getEquipmentColumnValue(eq, colKey);
      const strVal = (val === "" || val === null || val === undefined) ? "__BLANK__" : String(val);
      if (!selectedVals.includes(strVal)) return false;
    }

    return true;
  });

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
        allowance = Number(l.allowance || 0),
        penalty = Number(l.penalty || 0),
        santook = Number(l.santook_rent || 0),
        rev = Number(l.op_revenue || 0),
        debit = Number(l.debit || 0),
        pwas = Number(l.pwas || 0),
        other_exp = Number(l.other_expense || 0);
      const netSal = basic + ot + allowance - penalty;
      
      // Kafil %: നൽകിയിട്ടുണ്ടെങ്കിൽ അത്, ഇല്ലെങ്കിൽ 3
      const kafilPctVal = (l.kafil_pct !== null && l.kafil_pct !== undefined) ? Number(l.kafil_pct) : 3;
      
      // Kafil Amount: % നൽകിയിട്ടുണ്ടെങ്കിൽ റവന്യൂവിന്റെ ശതമാനം, അല്ലെങ്കിൽ നേരിട്ട് നൽകിയ kafil_comm എമൗണ്ട്
      let kafil = 0;
      if (kafilPctVal > 0) {
        kafil = rev > 0 ? (rev * (kafilPctVal / 100)) : 0;
      } else {
        kafil = Number(l.kafil_comm || 0);
      }

      const owner = Number(l.owner_comm || 0),
        inv = Number(l.investor_comm || 0);
      const opc =
        netSal + santook + kafil + owner + inv + debit + pwas + other_exp;
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
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="allowance">${fmt(allowance)}</td>
          <td class="bg-opc editable-cell" style="color:red;" data-eq="${eq.id}" data-month="${m}" data-field="penalty">${fmt(penalty)}</td>
          <td class="bg-opc"><b>${fmt(netSal)}</b></td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="santook_rent">${fmt(santook)}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="kafil_pct" id="cell_kafil_pct_${eq.id}_${m}">${kafilPctVal > 0 ? kafilPctVal : ""}</td>
          <td class="bg-opc editable-cell" data-eq="${eq.id}" data-month="${m}" data-field="kafil_comm" id="cell_kafil_${eq.id}_${m}">${fmt(kafil, 1)}</td>
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

  if (isEditMode) {
    applyInlineEditStateToRenderedCells();
  }

  const attachHeaderContextMenu = (elId, columnKey) => {
    const thEl = document.getElementById(elId);
    if (thEl) {
      thEl.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openColumnFilterMenu(columnKey, e.clientX, e.clientY);
      };
    }
  };

  attachHeaderContextMenu("thPlateNo", "plate_no");
  attachHeaderContextMenu("thPurchaseDate", "purchase_date");
  attachHeaderContextMenu("thRemainingCost", "remaining_purchase_cost");

  // Attach context menu to all monthly columns
  document.querySelectorAll(".col-filter-th").forEach((th) => {
    const colKey = th.getAttribute("data-col");
    if (colKey) {
      th.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openColumnFilterMenu(colKey, e.clientX, e.clientY);
      };
    }
  });
}

function getEquipmentColumnValue(eq, colKey) {
  if (colKey === "plate_no") return (eq.plate_no || "").toString().trim();
  if (colKey === "purchase_date") return formatPurchaseDate(eq.purchase_date);
  if (colKey === "remaining_purchase_cost") return eq.remaining_purchase_cost !== null && eq.remaining_purchase_cost !== undefined ? String(eq.remaining_purchase_cost) : "";

  const parts = colKey.split("_");
  const field = parts[0];
  const targetMonth = parseInt(parts[1]);

  let carryGL = 0;
  for (let m = 1; m <= 12; m++) {
    const l = rawMonthlyLogs.find((x) => x.equipment_id === eq.id && x.month === m) || {};
    const maint = Number(l.maintenance_cost || 0),
      basic = Number(l.basic_salary || 0),
      ot = Number(l.overtime || 0),
      allowance = Number(l.allowance || 0),
      penalty = Number(l.penalty || 0),
      santook = Number(l.santook_rent || 0),
      rev = Number(l.op_revenue || 0),
      debit = Number(l.debit || 0),
      pwas = Number(l.pwas || 0),
      other_exp = Number(l.other_expense || 0);

    const netSal = basic + ot + allowance - penalty;
    const kafil = rev * (Number(l.kafil_comm || 0) / 100);
    const owner = Number(l.owner_comm || 0);
    const inv = Number(l.investor_comm || 0);
    const opc = netSal + santook + kafil + owner + inv + debit + pwas + other_exp;
    const tCost = maint + opc;

    let gl = (tCost > 0 || rev > 0) ? (rev - tCost) : 0;
    let net = (gl !== 0 || carryGL !== 0) ? (gl + carryGL) : 0;
    let prv = carryGL;

    if (m === targetMonth) {
      const pctVal = (l.kafil_pct !== null && l.kafil_pct !== undefined) ? Number(l.kafil_pct) : 3;
      const vMap = {
        maint: maint, basic: basic, ot: ot, allowance: allowance,
        penalty: penalty, netSal: netSal, santook: santook, kafilpct: pctVal, kafil: Number(kafil.toFixed(1)),
        owner: Number(owner.toFixed(1)), inv: Number(inv.toFixed(1)), debit: debit,
        pwas: pwas, other: other_exp, tcost: Number(tCost.toFixed(1)), rev: rev,
        gl: Number(gl.toFixed(1)), prv: Number(prv.toFixed(1)), net: Number(net.toFixed(1))
      };
      const numVal = vMap[field];
      return (numVal === 0 || numVal === undefined) ? "" : String(numVal);
    }
    carryGL = net;
  }
  return "";
}

function sortPlateNo(dir) {
  currentSort = { column: "plate_no", direction: dir };
  closePlateFilterMenu();
  renderTable();
}

function openColumnFilterMenu(columnKey, x, y) {
  currentFilterColumn = columnKey;
  const menu = document.getElementById("plateNoFilterMenu");
  if (!menu) return;

  // Plate No ആണെങ്കിൽ മാത്രം A-Z, Z-A സെക്ഷനും Copy ബട്ടണും കാണിക്കുക
  const sortSec = document.getElementById("plateSortSection");
  if (sortSec) {
    sortSec.style.display = columnKey === "plate_no" ? "flex" : "none";
  }

  const copyBtn = document.getElementById("btnCopyPlateList");
  if (copyBtn) {
    copyBtn.style.display = columnKey === "plate_no" ? "inline-block" : "none";
  }

  const baseTitleMap = {
    plate_no: "Plate No",
    purchase_date: "Date of Purchase",
    remaining_purchase_cost: "Remaining Purchase Cost",
    maint: "Maint Cost", basic: "Basic Salary", ot: "Over Time",
    allowance: "Allowance", penalty: "Penalty", netSal: "Net Salary",
    santook: "Santook Rent", kafil: "Kafil Comm", owner: "Owner Comm",
    inv: "Investor Comm", debit: "Debit Note", pwas: "PWAS", other: "Other Exp",
    tcost: "Total Cost", rev: "OP Revenue", gl: "Gain / Loss",
    prv: "Prv Month", net: "Net OP G/L"
  };

  let title = baseTitleMap[columnKey];
  if (!title && columnKey.includes("_")) {
    const [f, m] = columnKey.split("_");
    const mName = monthNames[parseInt(m) - 1] || "";
    title = `${baseTitleMap[f] || f} (${mName})`;
  }

  const headerTitle = menu.querySelector(".excel-filter-header span");
  if (headerTitle) headerTitle.innerText = `Filter: ${title || columnKey}`;

  const searchInput = document.getElementById("plateFilterSearch");
  if (searchInput) searchInput.value = "";

  populateColumnFilterItems(columnKey);

  menu.style.display = "block";
  const menuWidth = 240;
  const menuHeight = 320;
  const posX = (x + menuWidth > window.innerWidth) ? (window.innerWidth - menuWidth - 10) : x;
  const posY = (y + menuHeight > window.innerHeight) ? (window.innerHeight - menuHeight - 10) : y;

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

function closePlateFilterMenu() {
  const menu = document.getElementById("plateNoFilterMenu");
  if (menu) menu.style.display = "none";
}

function populateColumnFilterItems(columnKey) {
  const list = document.getElementById("plateFilterList");
  if (!list) return;

  const valueSet = new Set();
  let hasBlank = false;

  rawEquipments.forEach((eq) => {
    let val = getEquipmentColumnValue(eq, columnKey);

    if (val === "" || val === null || val === undefined) {
      hasBlank = true;
    } else {
      valueSet.add(val);
    }
  });

  let sortedValues = [];
  if (columnKey === "plate_no" || columnKey === "purchase_date") {
    sortedValues = Array.from(valueSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } else {
    sortedValues = Array.from(valueSet).sort((a, b) => Number(a) - Number(b));
  }

  const selectedList = activeColumnFilters[columnKey] !== undefined ? activeColumnFilters[columnKey] : null;

  let html = `
    <li>
      <input type="checkbox" id="plateFilterSelectAll" onchange="toggleSelectAllPlates(this)" checked />
      <label for="plateFilterSelectAll"><b>(Select All)</b></label>
    </li>
  `;

  if (hasBlank) {
    const isChecked = selectedList === null || selectedList.includes("__BLANK__");
    html += `
      <li class="plate-filter-item" data-text="(blanks)">
        <input type="checkbox" class="plate-chk" value="__BLANK__" id="filter_blank" ${isChecked ? "checked" : ""} onchange="onSinglePlateCheckChange()" />
        <label for="filter_blank">(Blanks)</label>
      </li>
    `;
  }

  sortedValues.forEach((itemVal, i) => {
    const isChecked = selectedList === null || selectedList.includes(itemVal);
    html += `
      <li class="plate-filter-item" data-text="${String(itemVal).toLowerCase()}">
        <input type="checkbox" class="plate-chk" value="${itemVal}" id="filter_item_${i}" ${isChecked ? "checked" : ""} onchange="onSinglePlateCheckChange()" />
        <label for="filter_item_${i}">${itemVal}</label>
      </li>
    `;
  });

  list.innerHTML = html;
  syncSelectAllPlateState();
}

function searchPlateFilterItems() {
  const q = document.getElementById("plateFilterSearch").value.trim().toLowerCase();
  document.querySelectorAll(".plate-filter-item").forEach((li) => {
    const txt = li.getAttribute("data-text") || "";
    li.style.display = txt.includes(q) ? "flex" : "none";
  });
}

function toggleSelectAllPlates(master) {
  const visibleItems = Array.from(document.querySelectorAll(".plate-filter-item")).filter((li) => li.style.display !== "none");
  visibleItems.forEach((li) => {
    const chk = li.querySelector(".plate-chk");
    if (chk) chk.checked = master.checked;
  });
}

function onSinglePlateCheckChange() {
  syncSelectAllPlateState();
}

function syncSelectAllPlateState() {
  const chks = Array.from(document.querySelectorAll(".plate-chk"));
  const master = document.getElementById("plateFilterSelectAll");
  if (!master) return;
  master.checked = chks.length > 0 && chks.every((c) => c.checked);
}

function applyPlateFilter() {
  if (!currentFilterColumn) return;
  const chks = Array.from(document.querySelectorAll(".plate-chk"));
  const checkedVals = chks.filter((c) => c.checked).map((c) => c.value);

  if (checkedVals.length === chks.length) {
    activeColumnFilters[currentFilterColumn] = null;
  } else {
    activeColumnFilters[currentFilterColumn] = checkedVals;
  }

  closePlateFilterMenu();
  renderTable();
}

function clearPlateFilter() {
  if (!currentFilterColumn) return;
  activeColumnFilters[currentFilterColumn] = null;
  closePlateFilterMenu();
  renderTable();
}

function copyVisiblePlates() {
  // നിലവിൽ ടേബിൾ ബോഡിയിൽ കാണുന്ന rows-ൽ നിന്നുള്ള Plate No (രണ്ടാമത്തെ കോളം) എടുക്കുന്നു
  const rows = document.querySelectorAll("#tableBody tr");
  const plates = [];

  rows.forEach((tr) => {
    const td = tr.querySelector("td:nth-child(2)");
    if (td) {
      const val = td.innerText.trim();
      if (val) plates.push(val);
    }
  });

  if (plates.length === 0) {
    showToast("No plate numbers to copy!", "error");
    return;
  }

  const textToCopy = plates.join("\n");
  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      showToast(`Copied ${plates.length} Plate No(s)!`, "success");
      closePlateFilterMenu();
    })
    .catch((err) => {
      console.error("Copy error:", err);
      showToast("Failed to copy plates.", "error");
    });
}

function applyInlineEditStateToRenderedCells() {
  // Inline edit mode-ൽ മാത്രം 3% checkbox enable ചെയ്യുക
  document.querySelectorAll(".kafil-pct-chk").forEach((chk) => {
    chk.removeAttribute("disabled");
    chk.style.cursor = "pointer";
  });

  document.querySelectorAll(".editable-cell").forEach((cell) => {
    cell.setAttribute("contenteditable", "true");
    cell.style.backgroundColor = "#fffbcc";
    cell.style.outline = "1px solid #f39c12";

    const eqId = cell.getAttribute("data-eq");
    const month = cell.getAttribute("data-month");
    const field = cell.getAttribute("data-field");
    const key = `${eqId}_${month}_${field}`;

    if (!cell.dataset.initialValue) {
      cell.dataset.initialValue = cell.innerText.trim();
    }

    if (unsavedInlineChanges[key] !== undefined) {
      cell.innerText = unsavedInlineChanges[key].value === 0 ? "" : unsavedInlineChanges[key].value;
      cell.classList.add("dirty-cell");
    }

    cell.oninput = () => {
      const currentText = cell.innerText.trim();
      const initialText = cell.dataset.initialValue || "";

      if (currentText !== initialText) {
        cell.classList.add("dirty-cell");
        const parsedVal = currentText === "" || isNaN(parseFloat(currentText)) ? 0 : parseFloat(currentText);
        unsavedInlineChanges[key] = {
          equipment_id: Number(eqId),
          year: Number(document.getElementById("filterYear").value),
          month: Number(month),
          field: field,
          value: parsedVal
        };

        // OP Revenue അല്ലെങ്കിൽ Kafil % മാറ്റുമ്പോൾ Kafil Commission തനിയെ recalculate ചെയ്യുക
        if (field === "kafil_pct" || field === "op_revenue") {
          const revCell = document.querySelector(`.editable-cell[data-eq="${eqId}"][data-month="${month}"][data-field="op_revenue"]`);
          const pctCell = document.getElementById(`cell_kafil_pct_${eqId}_${month}`);
          const commCell = document.getElementById(`cell_kafil_${eqId}_${month}`);

          const cRev = revCell ? (parseFloat(revCell.innerText.trim()) || 0) : 0;
          const cPct = pctCell ? (parseFloat(pctCell.innerText.trim()) || 0) : 0;

          if (cPct > 0) {
            const calculatedComm = cRev > 0 ? Number(((cRev * cPct) / 100).toFixed(1)) : 0;
            if (commCell) commCell.innerText = calculatedComm > 0 ? calculatedComm : "";
            
            const commKey = `${eqId}_${month}_kafil_comm`;
            unsavedInlineChanges[commKey] = {
              equipment_id: Number(eqId),
              year: Number(document.getElementById("filterYear").value),
              month: Number(month),
              field: "kafil_comm",
              value: calculatedComm
            };
          }
        }
      } else {
        cell.classList.remove("dirty-cell");
        delete unsavedInlineChanges[key];
      }
    };
  });
}

let isEditMode = false;
let unsavedInlineChanges = {};

function toggleEditMode() {
  const btn = document.getElementById("btnEditInline");

  if (!isEditMode) {
    isEditMode = true;
    unsavedInlineChanges = {};
    btn.innerHTML = "💾 Save Data";
    btn.style.background = "#27ae60";
    applyInlineEditStateToRenderedCells();
  } else {
    saveInlineData();
  }
}

async function saveInlineData() {
  const updates = Object.values(unsavedInlineChanges);

  if (updates.length === 0) {
    isEditMode = false;
    const btn = document.getElementById("btnEditInline");
    if (btn) {
      btn.innerHTML = "✏️ Edit All Data";
      btn.style.background = "#8e44ad";
    }
    document.querySelectorAll(".kafil-pct-chk").forEach((chk) => {
      chk.setAttribute("disabled", "true");
      chk.style.cursor = "default";
    });

    document.querySelectorAll(".editable-cell").forEach((cell) => {
      cell.removeAttribute("contenteditable");
      cell.style.backgroundColor = "";
      cell.style.outline = "";
      cell.oninput = null;
    });
    showToast("No changes detected to save.", "success");
    return;
  }

  try {
    const res = await fetch("/py/own-equipment/cell-level-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });

    const result = await res.json();
    if (res.ok && result.success) {
      isEditMode = false;
      unsavedInlineChanges = {};
      const btn = document.getElementById("btnEditInline");
      if (btn) {
        btn.innerHTML = "✏️ Edit All Data";
        btn.style.background = "#8e44ad";
      }

      document.querySelectorAll(".editable-cell").forEach((cell) => {
        cell.removeAttribute("contenteditable");
        cell.style.backgroundColor = "";
        cell.style.outline = "";
        cell.oninput = null;
      });

      await loadDashboardData();
      showToast("All changes successfully updated..!", "success");
    } else {
      showToast(
        "Save failed: " + (result.detail || result.message || "Unknown error"),
        "error",
      );
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
    remaining_purchase_cost:
      document.getElementById("eqRemainingCost").value || 0,
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
    document.getElementById("editCostRemaining").value =
      eq.remaining_purchase_cost || 0;
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
  const remaining =
    parseFloat(document.getElementById("editCostRemaining").value) || 0;

  try {
    const res = await fetch("/api/own-equipment/tracker/edit-equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: eqId,
        purchase_cost: paid,
        remaining_purchase_cost: remaining,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeModal("editCostModal");
      await loadDashboardData();
      showToast("Purchase Cost updated successfully!", "success");
    } else {
      showToast(
        "Failed to update: " + (data.message || "Unknown error"),
        "error",
      );
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
    allowance: document.getElementById("inputAllowance") ? document.getElementById("inputAllowance").value : 0,
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
  document.getElementById("exportModal").style.display = "flex";
}

function executeExport(type) {
  const y = document.getElementById("filterYear").value;
  closeModal("exportModal");

  if (type === "batch") {
    window.location.href = `/api/own-equipment/tracker/export-excel?type=batch`;
  } else {
    let vM = Array.from(document.querySelectorAll(".month-chk:checked")).map(
      (b) => parseInt(b.value),
    );
    if (vM.length === 0) vM = Array.from({ length: 12 }, (_, i) => i + 1);
    window.location.href = `/api/own-equipment/tracker/export-excel?type=single&year=${y}&months=${vM.join(",")}`;
  }
}

window.onclick = (e) => {
  if (!e.target.matches(".anchor") && !e.target.closest(".dropdown-check-list"))
    document
      .querySelectorAll(".dropdown-check-list.visible")
      .forEach((el) => el.classList.remove("visible"));
};
function logout() {
  localStorage.removeItem("eq_user");
  window.location.replace("index.html");
}

function populateModalFields() {
  const eqId = document.getElementById("inputEquipmentId").value;
  const y = document.getElementById("inputYear").value;
  const m = document.getElementById("inputMonth").value;

  const log = rawMonthlyLogs.find(
    (x) => x.equipment_id == eqId && x.year == y && x.month == m,
  );

  document.getElementById("inputMaint").value =
    log && Number(log.maintenance_cost) !== 0 ? log.maintenance_cost : "";
  document.getElementById("inputBasicSalary").value =
    log && Number(log.basic_salary) !== 0 ? log.basic_salary : "";
  document.getElementById("inputOT").value =
    log && Number(log.overtime) !== 0 ? log.overtime : "";
  document.getElementById("inputAllowance").value =
    log && Number(log.allowance) !== 0 ? log.allowance : "";
  document.getElementById("inputPenalty").value =
    log && Number(log.penalty) !== 0 ? log.penalty : "";
  document.getElementById("inputSantook").value =
    log && Number(log.santook_rent) !== 0 ? log.santook_rent : "";
  document.getElementById("inputKafil").value =
    log && Number(log.kafil_comm) !== 0 ? log.kafil_comm : "";
  document.getElementById("inputOwner").value =
    log && Number(log.owner_comm) !== 0 ? log.owner_comm : "";
  document.getElementById("inputInvestor").value =
    log && Number(log.investor_comm) !== 0 ? log.investor_comm : "";
  document.getElementById("inputDebit").value =
    log && Number(log.debit) !== 0 ? log.debit : "";
  document.getElementById("inputPwas").value =
    log && Number(log.pwas) !== 0 ? log.pwas : "";
  document.getElementById("inputOtherExpense").value =
    log && Number(log.other_expense) !== 0 ? log.other_expense : "";
  document.getElementById("inputRevenue").value =
    log && Number(log.op_revenue) !== 0 ? log.op_revenue : "";
}

// === Real-time Active Users Tracking Logic ===

let currentActiveUsers = [];

function startActiveUserTracking() {
  const userStr = localStorage.getItem("eq_user");
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
      const res = await fetch("/api/own-equipment/tracker/active-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: username }),
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
  const badge = document.getElementById("activeUserBadge");
  if (currentActiveUsers.length === 0) {
    badge.style.display = "none";
  } else if (currentActiveUsers.length === 1) {
    badge.style.display = "flex";
    badge.innerText = `🟢 Active: ${currentActiveUsers[0]}`;
  } else {
    badge.style.display = "flex";
    badge.innerText = `🟢 Active Users: ${currentActiveUsers.length}`;
  }
}

function showActiveUsersModal() {
  if (currentActiveUsers.length <= 1) return; // Open modal only if more than 1 user is active
  const list = document.getElementById("activeUsersList");
  list.innerHTML = currentActiveUsers
    .map(
      (u) =>
        `<li style="padding: 10px; border-bottom: 1px solid #eee; color: #2c3e50; font-weight: 500;"><span style="color: #2ecc71;">●</span> ${u}</li>`,
    )
    .join("");
  document.getElementById("activeUsersModal").style.display = "flex";
}

// ==========================================
// 💰 REVENUE MODAL LOGIC
// ==========================================

function openRevenueModal() {
  const select = document.getElementById("revenueEqId");
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
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
    const log = rawMonthlyLogs.find(
      (x) => x.equipment_id === eqId && x.year === y && x.month === m,
    );
    const rev = log && Number(log.op_revenue) !== 0 ? log.op_revenue : "";

    html += `
      <tr>
        <td style="font-weight: bold; background: #fafafa; text-align: center; width: 50%;">
          ${fullMonthNames[m - 1]} ${y}
        </td>
        <td style="padding: 0; background: #fff; width: 50%;">
          <input type="number" id="rev_input_${m}" class="rev-input-cell" data-month="${m}" data-initial="${rev}" value="${rev}" 
                 style="width: 100%; border: none; text-align: center; font-weight: bold; background: transparent; padding: 12px 0; outline: none; box-shadow: none;" 
                 placeholder="0" />
        </td>
      </tr>
    `;
  }
  tbody.innerHTML = html;

  const inputs = document.querySelectorAll(".rev-input-cell");
  inputs.forEach((input, index) => {
    // Keydown Event Listener for Arrow & Enter keys
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        if (inputs[index + 1]) inputs[index + 1].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (inputs[index - 1]) inputs[index - 1].focus();
      }
    });

    // Paste Event Listener for Excel bulk copy-paste
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData(
        "text",
      );

      // Split pasted text by newline characters
      const rows = pasteData.split(/\r?\n/);
      let currentIndex = index;

      rows.forEach((row) => {
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
  const inputs = document.querySelectorAll(".rev-input-cell");
  let updates = [];

  inputs.forEach((input) => {
    const currentVal = input.value.trim();
    const initialVal = (input.dataset.initial || "").trim();

    if (currentVal !== initialVal) {
      updates.push({
        equipment_id: eqId,
        year: y,
        month: Number(input.getAttribute("data-month")),
        field: "op_revenue",
        value: currentVal === "" ? 0 : parseFloat(currentVal) || 0,
      });
    }
  });

  if (updates.length === 0) return true;

  try {
    const res = await fetch("/py/own-equipment/cell-level-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
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

  navigator.clipboard
    .writeText(plateNo)
    .then(() => {
      showToast(`Copied: ${plateNo}`, "success");
    })
    .catch((err) => {
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
  navigator.clipboard
    .writeText(select.options[select.selectedIndex].text)
    .then(() => showToast(`Copied Plate No!`, "success"))
    .catch(() => showToast("Failed to copy", "error"));
}

function attachGridListeners(className) {
  const inputs = document.querySelectorAll("." + className);
  inputs.forEach((input) => {
    // Arrow Key Navigation
    input.addEventListener("keydown", (e) => {
      const row = parseInt(input.getAttribute("data-row"));
      const col = parseInt(input.getAttribute("data-col"));
      let nextInput;

      if (e.key === "ArrowDown" || e.key === "Enter") {
        nextInput = document.querySelector(
          `.${className}[data-row="${row + 1}"][data-col="${col}"]`,
        );
      } else if (e.key === "ArrowUp") {
        nextInput = document.querySelector(
          `.${className}[data-row="${row - 1}"][data-col="${col}"]`,
        );
      } else if (e.key === "ArrowRight") {
        nextInput = document.querySelector(
          `.${className}[data-row="${row}"][data-col="${col + 1}"]`,
        );
      } else if (e.key === "ArrowLeft") {
        nextInput = document.querySelector(
          `.${className}[data-row="${row}"][data-col="${col - 1}"]`,
        );
      }

      if (nextInput) {
        e.preventDefault();
        nextInput.focus();
        nextInput.select();
      }
    });

    // Multi-column Paste from Excel
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData(
        "text",
      );
      const rows = pasteData.split(/\r?\n/);
      const startRow = parseInt(input.getAttribute("data-row"));
      const startCol = parseInt(input.getAttribute("data-col"));

      rows.forEach((rowData, rIdx) => {
        if (!rowData.trim()) return;
        const cells = rowData.split("\t");
        cells.forEach((cellData, cIdx) => {
          const targetRow = startRow + rIdx;
          const targetCol = startCol + cIdx;
          const targetInput = document.querySelector(
            `.${className}[data-row="${targetRow}"][data-col="${targetCol}"]`,
          );
          if (targetInput) {
            let cleanVal = cellData.replace(/[^0-9.-]+/g, "");
            if (cleanVal !== "") {
              targetInput.value = cleanVal;
              // Explicitly trigger the Net Salary calculation on paste
              if (className === "sal-input") {
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
  return (
    rawMonthlyLogs.find(
      (x) => x.equipment_id === eqId && x.year === y && x.month === m,
    ) || {}
  );
}

// ==========================================
// 🧾 EXPENSE MODAL
// ==========================================
function openExpenseModal() {
  const select = document.getElementById("expenseEqId");
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  populateExpenseTable();
  document.getElementById("expenseModal").style.display = "flex";
}

function populateExpenseTable() {
  const eqId = Number(document.getElementById("expenseEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let html = "";

  // 🟢 0 അല്ലെങ്കിൽ 0.0 ആണെങ്കിൽ Blank ആക്കുന്ന ഹെൽപ്പർ
  const cleanZero = (val) => (!val || Number(val) === 0 ? "" : val);

  for (let m = 1; m <= 12; m++) {
    const log = getBaseLog(eqId, y, m);
    const maintVal = cleanZero(log.maintenance_cost);
    const santookVal = cleanZero(log.santook_rent);
    const debitVal = cleanZero(log.debit);
    const pwasVal = cleanZero(log.pwas);
    const otherVal = cleanZero(log.other_expense);

    html += `<tr>
      <td style="font-weight: bold; background: #fafafa; text-align: center;">${fullMonthNames[m - 1]} ${y}</td>
      <td style="padding:0;"><input type="number" class="exp-input" data-month="${m}" data-field="maintenance_cost" data-initial="${maintVal}" data-row="${m}" data-col="1" id="exp_maint_${m}" value="${maintVal}" placeholder="-" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-month="${m}" data-field="santook_rent" data-initial="${santookVal}" data-row="${m}" data-col="2" id="exp_santook_${m}" value="${santookVal}" placeholder="-" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-month="${m}" data-field="debit" data-initial="${debitVal}" data-row="${m}" data-col="3" id="exp_debit_${m}" value="${debitVal}" placeholder="-" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-month="${m}" data-field="pwas" data-initial="${pwasVal}" data-row="${m}" data-col="4" id="exp_pwas_${m}" value="${pwasVal}" placeholder="-" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="exp-input" data-month="${m}" data-field="other_expense" data-initial="${otherVal}" data-row="${m}" data-col="5" id="exp_other_${m}" value="${otherVal}" placeholder="-" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
    </tr>`;
  }
  document.getElementById("expenseTableBody").innerHTML = html;
  attachGridListeners("exp-input");
}

async function postExpenseData() {
  const eqId = Number(document.getElementById("expenseEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  const inputs = document.querySelectorAll(".exp-input");
  let updates = [];

  inputs.forEach((input) => {
    const currentVal = input.value.trim();
    const initialVal = (input.dataset.initial || "").trim();

    if (currentVal !== initialVal) {
      updates.push({
        equipment_id: eqId,
        year: y,
        month: Number(input.getAttribute("data-month")),
        field: input.getAttribute("data-field"),
        value: currentVal === "" ? 0 : parseFloat(currentVal) || 0,
      });
    }
  });

  if (updates.length === 0) return { success: true };

  return await fetch("/py/own-equipment/cell-level-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  }).then((r) => r.json());
}
async function saveExpenseData() {
  if ((await postExpenseData()).success) {
    closeModal("expenseModal");
    await loadDashboardData();
    showToast("Expenses saved!", "success");
  }
}
async function saveAndNextExpense() {
  if ((await postExpenseData()).success) {
    const s = document.getElementById("expenseEqId");
    if (s.selectedIndex < s.options.length - 1) {
      s.selectedIndex++;
      copyModalPlateNo("expenseEqId");
    }
    await loadDashboardData();
    populateExpenseTable();
    showToast("Saved & Moved Next!", "success");
  }
}

// ==========================================
// 💵 SALARY MODAL (Auto Calculate Net)
// ==========================================
function openSalaryModal() {
  const select = document.getElementById("salaryEqId");
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  populateSalaryTable();
  document.getElementById("salaryModal").style.display = "flex";
}

function calculateNetSalary(m) {
  const basic =
    parseFloat(document.getElementById(`sal_basic_${m}`).value) || 0;
  const ot = parseFloat(document.getElementById(`sal_ot_${m}`).value) || 0;
  const allowance =
    parseFloat(document.getElementById(`sal_allowance_${m}`).value) || 0;
  const penalty =
    parseFloat(document.getElementById(`sal_penalty_${m}`).value) || 0;
  document.getElementById(`sal_net_${m}`).innerText = (
    basic +
    ot +
    allowance -
    penalty
  ).toFixed(2);
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
    const allowance = Number(log.allowance) || 0;
    const penalty = Number(log.penalty) || 0;
    const net = basic + ot + allowance - penalty;
    const bVal = basic || "";
    const otVal = ot || "";
    const alVal = allowance || "";
    const penVal = penalty || "";

    html += `<tr>
      <td style="font-weight: bold; background: #fafafa; text-align: center;">${fullMonthNames[m - 1]} ${y}</td>
      <td style="padding:0;"><input type="number" class="sal-input" data-month="${m}" data-field="basic_salary" data-initial="${bVal}" data-row="${m}" data-col="1" id="sal_basic_${m}" value="${bVal}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="sal-input" data-month="${m}" data-field="overtime" data-initial="${otVal}" data-row="${m}" data-col="2" id="sal_ot_${m}" value="${otVal}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="sal-input" data-month="${m}" data-field="allowance" data-initial="${alVal}" data-row="${m}" data-col="3" id="sal_allowance_${m}" value="${alVal}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="sal-input" data-month="${m}" data-field="penalty" data-initial="${penVal}" data-row="${m}" data-col="4" id="sal_penalty_${m}" value="${penVal}" oninput="calculateNetSalary(${m})" style="width:100%; border:none; text-align:center; padding:10px 0; color:red;"></td>
      <td style="background: #f8f9fa; text-align: center; font-weight: bold;"><span id="sal_net_${m}">${net.toFixed(2)}</span></td>
    </tr>`;
  }
  document.getElementById("salaryTableBody").innerHTML = html;
  attachGridListeners("sal-input");
}

async function postSalaryData() {
  const eqId = Number(document.getElementById("salaryEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  const inputs = document.querySelectorAll(".sal-input");
  let updates = [];

  inputs.forEach((input) => {
    const currentVal = input.value.trim();
    const initialVal = (input.dataset.initial || "").trim();

    if (currentVal !== initialVal) {
      updates.push({
        equipment_id: eqId,
        year: y,
        month: Number(input.getAttribute("data-month")),
        field: input.getAttribute("data-field"),
        value: currentVal === "" ? 0 : parseFloat(currentVal) || 0,
      });
    }
  });

  if (updates.length === 0) return { success: true };

  return await fetch("/py/own-equipment/cell-level-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  }).then((r) => r.json());
}
async function saveSalaryData() {
  if ((await postSalaryData()).success) {
    closeModal("salaryModal");
    await loadDashboardData();
    showToast("Salary saved!", "success");
  }
}
async function saveAndNextSalary() {
  if ((await postSalaryData()).success) {
    const s = document.getElementById("salaryEqId");
    if (s.selectedIndex < s.options.length - 1) {
      s.selectedIndex++;
      copyModalPlateNo("salaryEqId");
    }
    await loadDashboardData();
    populateSalaryTable();
    showToast("Saved & Moved Next!", "success");
  }
}

// ==========================================
// 🤝 COMMISSION MODAL
// ==========================================
function openCommissionModal() {
  const select = document.getElementById("commissionEqId");
  select.innerHTML = rawEquipments
    .map((e) => `<option value="${e.id}">${e.plate_no}</option>`)
    .join("");
  populateCommissionTable();
  document.getElementById("commissionModal").style.display = "flex";
}

function populateCommissionTable() {
  const eqId = Number(document.getElementById("commissionEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  let html = "";

  for (let m = 1; m <= 12; m++) {
    const log = getBaseLog(eqId, y, m);
    const kafilVal = log.kafil_comm || "";
    const ownerVal = log.owner_comm || "";
    const invVal = log.investor_comm || "";
    html += `<tr>
      <td style="font-weight: bold; background: #fafafa; text-align: center;">${fullMonthNames[m - 1]} ${y}</td>
      <td style="padding:0;"><input type="number" class="comm-input" data-month="${m}" data-field="kafil_comm" data-initial="${kafilVal}" data-row="${m}" data-col="1" id="comm_kafil_${m}" value="${kafilVal}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="comm-input" data-month="${m}" data-field="owner_comm" data-initial="${ownerVal}" data-row="${m}" data-col="2" id="comm_owner_${m}" value="${ownerVal}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
      <td style="padding:0;"><input type="number" class="comm-input" data-month="${m}" data-field="investor_comm" data-initial="${invVal}" data-row="${m}" data-col="3" id="comm_investor_${m}" value="${invVal}" style="width:100%; border:none; text-align:center; padding:10px 0;"></td>
    </tr>`;
  }
  document.getElementById("commissionTableBody").innerHTML = html;
  attachGridListeners("comm-input");
}

async function postCommissionData() {
  const eqId = Number(document.getElementById("commissionEqId").value);
  const y = Number(document.getElementById("filterYear").value);
  const inputs = document.querySelectorAll(".comm-input");
  let updates = [];

  inputs.forEach((input) => {
    const currentVal = input.value.trim();
    const initialVal = (input.dataset.initial || "").trim();

    if (currentVal !== initialVal) {
      updates.push({
        equipment_id: eqId,
        year: y,
        month: Number(input.getAttribute("data-month")),
        field: input.getAttribute("data-field"),
        value: currentVal === "" ? 0 : parseFloat(currentVal) || 0,
      });
    }
  });

  if (updates.length === 0) return { success: true };

  return await fetch("/py/own-equipment/cell-level-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  }).then((r) => r.json());
}
async function saveCommissionData() {
  if ((await postCommissionData()).success) {
    closeModal("commissionModal");
    await loadDashboardData();
    showToast("Commission saved!", "success");
  }
}
async function saveAndNextCommission() {
  if ((await postCommissionData()).success) {
    const s = document.getElementById("commissionEqId");
    if (s.selectedIndex < s.options.length - 1) {
      s.selectedIndex++;
      copyModalPlateNo("commissionEqId");
    }
    await loadDashboardData();
    populateCommissionTable();
    showToast("Saved & Moved Next!", "success");
  }
}

function onKafilPercentChange(chk, eqId, month) {
  const isChecked = chk.checked;
  const keyPct = `${eqId}_${month}_kafil_is_percent`;
  const keyComm = `${eqId}_${month}_kafil_comm`;
  const y = Number(document.getElementById("filterYear").value);

  unsavedInlineChanges[keyPct] = {
    equipment_id: Number(eqId),
    year: y,
    month: Number(month),
    field: "kafil_is_percent",
    value: isChecked,
  };

  // OP Revenue എത്രയാണെന്ന് നോക്കി തത്സമയം Kafil സെല്ലിൽ 3% അപ്ഡേറ്റ് ചെയ്യുന്നു
  const revCell = document.querySelector(`.editable-cell[data-eq="${eqId}"][data-month="${month}"][data-field="op_revenue"]`);
  const kafilCell = document.getElementById(`cell_kafil_${eqId}_${month}`);
  const currentRev = revCell ? (parseFloat(revCell.innerText.trim()) || 0) : 0;

  const calcVal = isChecked ? (currentRev > 0 ? Number((currentRev * 0.03).toFixed(1)) : 0) : 0;
  if (kafilCell) kafilCell.innerText = calcVal === 0 ? "" : calcVal;

  unsavedInlineChanges[keyComm] = {
    equipment_id: Number(eqId),
    year: y,
    month: Number(month),
    field: "kafil_comm",
    value: calcVal,
  };
}