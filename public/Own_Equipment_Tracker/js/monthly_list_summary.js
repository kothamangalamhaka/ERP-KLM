const monthNames = [
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

let selectedYear = null;
let selectedMonth = null;
let currentExportType = "";

document.addEventListener("DOMContentLoaded", () => {
  if (!window.ownEquipmentSession.requirePage()) return;
  initFilters();
});

function initFilters() {
  const currentYear = new Date().getFullYear();
  const yearContainer = document.getElementById("yearButtonsContainer");
  yearContainer.innerHTML = "";

  const startYear = Math.max(currentYear, 2026);
  for (let y = startYear; y >= 2026; y--) {
    const btn = document.createElement("div");
    // 🟢 Added 'year-btn' class for dynamic 4-in-a-row to full-width styling
    btn.className = `filter-btn year-btn ${y === selectedYear ? "active" : ""}`;
    btn.innerText = y;
    btn.onclick = () => selectYear(y);
    yearContainer.appendChild(btn);
  }
  renderMonthButtons();
}

function selectYear(y) {
  if (selectedYear === y) {
    selectedYear = null; // Toggle Off
    selectedMonth = null;
  } else {
    selectedYear = y; // Toggle On
    selectedMonth = null; // Reset month
  }

  document
    .querySelectorAll("#yearButtonsContainer .filter-btn")
    .forEach((b) => {
      b.classList.remove("active");
      if (parseInt(b.innerText) === selectedYear) b.classList.add("active");
    });

  renderMonthButtons();
  updateTableVisibility();
}

function renderMonthButtons() {
  const monthSection = document.getElementById("monthSection");
  const container = document.getElementById("monthButtonsContainer");

  if (selectedYear === null) {
    monthSection.style.display = "none";
    container.innerHTML = "";
    return;
  }

  monthSection.style.display = "block";
  container.innerHTML = "";

  const allBtn = document.createElement("div");
  // 🟢 Added 'month-btn' class
  allBtn.className = `filter-btn month-btn ${selectedMonth === "ALL" ? "active" : ""}`;
  allBtn.innerText = "All Months";
  allBtn.onclick = () => selectMonth("ALL");
  container.appendChild(allBtn);

  monthNames.forEach((m, idx) => {
    const btn = document.createElement("div");
    const monthNum = idx + 1;
    // 🟢 Added 'month-btn' class
    btn.className = `filter-btn month-btn ${selectedMonth === monthNum ? "active" : ""}`;
    btn.innerText = m;
    btn.onclick = () => selectMonth(monthNum);
    container.appendChild(btn);
  });
}

function selectMonth(m) {
  if (selectedMonth === m) {
    selectedMonth = null; // Toggle Off
  } else {
    selectedMonth = m; // Toggle On
  }
  renderMonthButtons();
  updateTableVisibility();
}

function updateTableVisibility() {
  const container = document.getElementById("dataContainer");
  if (selectedYear === null) {
    container.innerHTML =
      "<p style='text-align:center; font-size: 16px; color: #7f8c8d; margin-top: 50px;'>👆 Please select a Year first to proceed.</p>";
    return;
  }
  if (selectedMonth === null) {
    container.innerHTML =
      "<p style='text-align:center; font-size: 16px; color: #7f8c8d; margin-top: 50px;'>👆 Please select a month to view the data.</p>";
    return;
  }
  loadMonthlyData();
}

let companyMappingData = {};
let activeSummaryFilters = {};
let currentFilterCol = null;
let currentSortCol = { col: null, dir: null };
let rawEquipmentsCache = [];
let rawLogsCache = [];

const colTitleMap = {
  plate_no: "Plate no",
  maint: "EQ Maintenance Cost",
  netSal: "Net Salary",
  rent: "Santook Rent",
  debt: "Debt",
  pwas: "PWAS",
  other: "Other",
  totOpExp: "Total Operational Expenses",
  opRev: "Operational revenue",
  netOpRev: "Net OP Revenue",
  kafil: "Kafil",
  owner: "Owner",
  inv: "Investor",
  pl: "Profit or Loss"
};

function getRowColValue(item, colKey) {
  if (colKey === "plate_no") {
    return item.plate_no ? String(item.plate_no).trim() : "__BLANK__";
  }
  const val = Number(item[colKey] || 0);
  return val === 0 ? "__BLANK__" : val.toFixed(2);
}

async function loadMonthlyData() {
  const container = document.getElementById("dataContainer");
  container.innerHTML = "<p style='text-align:center;'>Loading data...</p>";

  try {
    const res = await fetch(`/api/monthly-summary/data?year=${selectedYear}`);
    const data = await res.json();
    companyMappingData = data.companies || {};
    rawEquipmentsCache = data.equipments || [];
    rawLogsCache = data.logs || [];
    renderTables(rawEquipmentsCache, rawLogsCache, selectedYear, selectedMonth);
  } catch (err) {
    console.error(err);
    showToast("Error loading data", "error");
  }
}

function renderTables(equipments, logs, year, currentSelectedMonth) {
  rawEquipmentsCache = equipments;
  rawLogsCache = logs;
  const container = document.getElementById("dataContainer");
  container.innerHTML = "";

  let monthsToRender =
    currentSelectedMonth === "ALL"
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      : [parseInt(currentSelectedMonth)];

  const fInd = (k) => (activeSummaryFilters[k] !== undefined && activeSummaryFilters[k] !== null ? " 🔽" : "");

  monthsToRender.forEach((m) => {
    const monthLogs = logs.filter((l) => l.month === m);
    if (monthLogs.length === 0 && currentSelectedMonth === "ALL") return;

    const wrapperId = `month-wrapper-${m}`;
    let html = `
            <div class="month-container" id="${wrapperId}">
                <div class="month-header">
                    <div style="width:100px;"></div>
                    <h3 class="month-title">Monthly Income & Expenditure Statement :: ${monthNames[m - 1]} ${year}</h3>
                    <div class="export-icons">
                        <button class="export-btn" title="Export PDF" onclick="exportPDF(${m}, '${monthNames[m - 1]}', ${year})">📄</button>
                        <button class="export-btn" title="Copy as Image" onclick="copyImage('${wrapperId}')">📋</button>
                        <button class="export-btn" title="Export Excel" onclick="exportSingleExcel(${m}, ${year})">📊</button>
                    </div>
                </div>
                
                <table id="table-${m}">
                    <thead>
                        <tr>
                            <th colspan="2" class="th-main">EQ</th>
                            <th colspan="7" class="th-main">Expenditures</th>
                            <th colspan="2" class="th-main">Income</th>
                            <th colspan="3" class="th-main">Commissions</th>
                            <th class="th-main"></th>
                        </tr>
                        <tr>
                            <th>SN</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('plate_no', event)" title="Right-click to filter">Plate no${fInd('plate_no')}</th>
                            <th class="col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('maint', event)" title="Right-click to filter">EQ Maintenance Cost${fInd('maint')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('netSal', event)" title="Right-click to filter">Net Salary${fInd('netSal')}</th>
                            <th class="col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('rent', event)" title="Right-click to filter">Santook Rent${fInd('rent')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('debt', event)" title="Right-click to filter">Debt${fInd('debt')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('pwas', event)" title="Right-click to filter">PWAS${fInd('pwas')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('other', event)" title="Right-click to filter">Other${fInd('other')}</th>
                            <th class="bg-op-exp col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('totOpExp', event)" title="Right-click to filter">Total Operational Expenses${fInd('totOpExp')}</th>
                            <th class="bg-op-rev col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('opRev', event)" title="Right-click to filter">Operational revenue${fInd('opRev')}</th>
                            <th class="bg-net-op col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('netOpRev', event)" title="Right-click to filter">Net OP Revenue${fInd('netOpRev')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('kafil', event)" title="Right-click to filter">Kafil${fInd('kafil')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('owner', event)" title="Right-click to filter">Owner${fInd('owner')}</th>
                            <th class="eq-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('inv', event)" title="Right-click to filter">Investor${fInd('inv')}</th>
                            <th class="bg-pl pl-width col-filter-th" oncontextmenu="handleHeaderFilterContextMenu('pl', event)" title="Right-click to filter">Profit or Loss${fInd('pl')}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

    let totals = {
      maint: 0,
      netSal: 0,
      rent: 0,
      debt: 0,
      pwas: 0,
      other: 0,
      totOpExp: 0,
      opRev: 0,
      netOpRev: 0,
      kafil: 0,
      owner: 0,
      inv: 0,
      pl: 0,
    };

    let processedRows = [];

    equipments.forEach((eq) => {
      const log = monthLogs.find((x) => x.equipment_id === eq.id) || {};
      const maint = Number(log.maintenance_cost || 0),
        basic = Number(log.basic_salary || 0),
        ot = Number(log.overtime || 0),
        penalty = Number(log.penalty || 0);
      const netSal = basic + ot - penalty;
      const rent = Number(log.santook_rent || 0),
        debt = Number(log.debit || 0),
        pwas = Number(log.pwas || 0),
        other = Number(log.other_expense || 0);
      const opRev = Number(log.op_revenue || 0);
      const eqPlateClean = (eq.plate_no || "").trim().toUpperCase();
      const compObj =
        (companyMappingData[eqPlateClean] &&
          companyMappingData[eqPlateClean][m]) ||
        {};
      const compName =
        typeof compObj === "object"
          ? compObj.company || "Not Work"
          : compObj || "Not Work";

      let kafilPctVal = 0;
      if (log.kafil_pct !== null && log.kafil_pct !== undefined) {
        kafilPctVal = Number(log.kafil_pct);
      } else if (Number(log.kafil_comm || 0) > 0) {
        kafilPctVal = 0;
      } else {
        const isSingleNonWe1 =
          compName !== "Not Work" &&
          compName !== "We1" &&
          !compName.includes("&");
        kafilPctVal = isSingleNonWe1 ? 3 : 0;
      }

      let kafil = 0;
      if (kafilPctVal > 0 && opRev > 0) {
        kafil = Number(((opRev * kafilPctVal) / 100).toFixed(1));
      } else {
        kafil = Number(log.kafil_comm || 0);
      }

      const totOpExp = maint + netSal + rent + debt + pwas + other;
      const netOpRev = opRev - totOpExp;
      const owner = Number(log.owner_comm || 0),
        inv = Number(log.investor_comm || 0);
      const totComm = kafil + owner + inv;
      const pl = netOpRev - totComm;

      processedRows.push({
        eq_id: eq.id,
        plate_no: (eq.plate_no || "").trim(),
        maint, netSal, rent, debt, pwas, other,
        totOpExp, opRev, netOpRev, kafil, owner, inv, pl
      });
    });

    // 1. Column Filter Check
    const filteredRows = processedRows.filter((rowItem) => {
      for (const [colKey, selectedVals] of Object.entries(activeSummaryFilters)) {
        if (selectedVals === null || selectedVals === undefined) continue;
        const val = getRowColValue(rowItem, colKey);
        if (!selectedVals.includes(val)) return false;
      }
      return true;
    });

    // 2. Sorting
    if (currentSortCol.col) {
      filteredRows.sort((a, b) => {
        let valA = a[currentSortCol.col];
        let valB = b[currentSortCol.col];
        if (currentSortCol.col === "plate_no") {
          valA = (valA || "").toString().trim();
          valB = (valB || "").toString().trim();
          return currentSortCol.dir === "asc"
            ? valA.localeCompare(valB, undefined, { numeric: true })
            : valB.localeCompare(valA, undefined, { numeric: true });
        } else {
          valA = Number(valA || 0);
          valB = Number(valB || 0);
          return currentSortCol.dir === "asc" ? valA - valB : valB - valA;
        }
      });
    }

    filteredRows.forEach((r, idx) => {
      totals.maint += r.maint;
      totals.netSal += r.netSal;
      totals.rent += r.rent;
      totals.debt += r.debt;
      totals.pwas += r.pwas;
      totals.other += r.other;
      totals.totOpExp += r.totOpExp;
      totals.opRev += r.opRev;
      totals.netOpRev += r.netOpRev;
      totals.kafil += r.kafil;
      totals.owner += r.owner;
      totals.inv += r.inv;
      totals.pl += r.pl;

      html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td><b>${r.plate_no}</b></td>
                    <td>${fmt(r.maint)}</td>
                    <td>${fmt(r.netSal)}</td>
                    <td>${fmt(r.rent)}</td>
                    <td>${fmt(r.debt)}</td>
                    <td>${fmt(r.pwas)}</td>
                    <td>${fmt(r.other)}</td>
                    <td class="bg-op-exp">${fmt(r.totOpExp)}</td>
                    <td class="bg-op-rev">${fmt(r.opRev)}</td>
                    <td class="bg-net-op">${fmt(r.netOpRev)}</td>
                    <td>${fmt(r.kafil)}</td>
                    <td>${fmt(r.owner)}</td>
                    <td>${fmt(r.inv)}</td>
                    <td class="bg-pl pl-width" style="color: ${r.pl < 0 ? "red" : "black"};">${fmt(r.pl)}</td>
                </tr>
            `;
    });

    html += `
                    <tr style="font-weight: bold; background: #fafafa;">
                        <td colspan="2">TOTAL</td>
                        <td>${fmt(totals.maint)}</td>
                        <td>${fmt(totals.netSal)}</td>
                        <td>${fmt(totals.rent)}</td>
                        <td>${fmt(totals.debt)}</td>
                        <td>${fmt(totals.pwas)}</td>
                        <td>${fmt(totals.other)}</td>
                        <td class="bg-op-exp">${fmt(totals.totOpExp)}</td>
                        <td class="bg-op-rev">${fmt(totals.opRev)}</td>
                        <td class="bg-net-op">${fmt(totals.netOpRev)}</td>
                        <td>${fmt(totals.kafil)}</td>
                        <td>${fmt(totals.owner)}</td>
                        <td>${fmt(totals.inv)}</td>
                        <td class="bg-pl pl-width" style="color: ${totals.pl < 0 ? "red" : "black"};">${fmt(totals.pl)}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;
    container.innerHTML += html;
  });

  if (container.innerHTML === "") {
    container.innerHTML =
      "<p style='text-align:center;'>No operational data found for the selected period.</p>";
  }
}

/* ==========================================================
   🟢 EXCEL-STYLE COLUMN FILTER POPUP LOGIC
   ========================================================== */
function handleHeaderFilterContextMenu(colKey, e) {
  e.preventDefault();
  e.stopPropagation();
  openColumnFilterMenu(colKey, e.clientX, e.clientY);
}

function openColumnFilterMenu(colKey, x, y) {
  currentFilterCol = colKey;
  const menu = document.getElementById("columnFilterMenu");
  const list = document.getElementById("columnFilterList");
  const title = document.getElementById("columnFilterTitle");
  if (!menu || !list) return;

  title.innerText = `Filter: ${colTitleMap[colKey] || colKey}`;
  const searchInput = document.getElementById("columnFilterSearch");
  if (searchInput) searchInput.value = "";

  // Collect all values for this column across currently viewed month data
  const valueSet = new Set();
  let hasBlank = false;

  let activeMonths = selectedMonth === "ALL" || !selectedMonth
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    : [parseInt(selectedMonth)];

  activeMonths.forEach((m) => {
    const monthLogs = rawLogsCache.filter((l) => l.month === m);
    rawEquipmentsCache.forEach((eq) => {
      const log = monthLogs.find((x) => x.equipment_id === eq.id) || {};
      const maint = Number(log.maintenance_cost || 0);
      const basic = Number(log.basic_salary || 0);
      const ot = Number(log.overtime || 0);
      const penalty = Number(log.penalty || 0);
      const netSal = basic + ot - penalty;
      const rent = Number(log.santook_rent || 0);
      const debt = Number(log.debit || 0);
      const pwas = Number(log.pwas || 0);
      const other = Number(log.other_expense || 0);
      const opRev = Number(log.op_revenue || 0);
      const eqPlateClean = (eq.plate_no || "").trim().toUpperCase();
      const compObj = (companyMappingData[eqPlateClean] && companyMappingData[eqPlateClean][m]) || {};
      const compName = typeof compObj === "object" ? compObj.company || "Not Work" : compObj || "Not Work";
      let kafilPctVal = (log.kafil_pct !== null && log.kafil_pct !== undefined)
        ? Number(log.kafil_pct)
        : (Number(log.kafil_comm || 0) > 0 ? 0 : ((compName !== "Not Work" && compName !== "We1" && !compName.includes("&")) ? 3 : 0));
      let kafil = (kafilPctVal > 0 && opRev > 0) ? Number(((opRev * kafilPctVal) / 100).toFixed(1)) : Number(log.kafil_comm || 0);
      const totOpExp = maint + netSal + rent + debt + pwas + other;
      const netOpRev = opRev - totOpExp;
      const owner = Number(log.owner_comm || 0);
      const inv = Number(log.investor_comm || 0);
      const pl = netOpRev - (kafil + owner + inv);

      const rowItem = {
        plate_no: (eq.plate_no || "").trim(),
        maint, netSal, rent, debt, pwas, other,
        totOpExp, opRev, netOpRev, kafil, owner, inv, pl
      };

      const val = getRowColValue(rowItem, colKey);
      if (val === "__BLANK__") {
        hasBlank = true;
      } else {
        valueSet.add(val);
      }
    });
  });

  let sortedValues = [];
  if (colKey === "plate_no") {
    sortedValues = Array.from(valueSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } else {
    sortedValues = Array.from(valueSet).sort((a, b) => Number(a) - Number(b));
  }

  const selectedList = activeSummaryFilters[colKey] !== undefined ? activeSummaryFilters[colKey] : null;

  let html = `
    <li>
      <input type="checkbox" id="colFilterSelectAll" onchange="toggleSelectAllColumnItems(this)" checked />
      <label for="colFilterSelectAll"><b>(Select All)</b></label>
    </li>
  `;

  if (hasBlank) {
    const isChecked = selectedList === null || selectedList.includes("__BLANK__");
    html += `
      <li class="col-filter-item" data-text="(blanks)">
        <input type="checkbox" class="col-filter-chk" value="__BLANK__" id="col_chk_blank" ${isChecked ? "checked" : ""} onchange="onSingleColumnCheckChange()" />
        <label for="col_chk_blank">(Blanks)</label>
      </li>
    `;
  }

  sortedValues.forEach((val, i) => {
    const isChecked = selectedList === null || selectedList.includes(val);
    html += `
      <li class="col-filter-item" data-text="${String(val).toLowerCase()}">
        <input type="checkbox" class="col-filter-chk" value="${val}" id="col_chk_${i}" ${isChecked ? "checked" : ""} onchange="onSingleColumnCheckChange()" />
        <label for="col_chk_${i}">${val}</label>
      </li>
    `;
  });

  list.innerHTML = html;
  syncSelectAllColumnState();

  menu.style.display = "block";
  const menuW = 250;
  const menuH = 340;
  const posX = x + menuW > window.innerWidth ? window.innerWidth - menuW - 15 : x;
  const posY = y + menuH > window.innerHeight ? window.innerHeight - menuH - 15 : y;
  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

function closeColumnFilterMenu() {
  const menu = document.getElementById("columnFilterMenu");
  if (menu) menu.style.display = "none";
}

function toggleSelectAllColumnItems(master) {
  const visible = Array.from(document.querySelectorAll(".col-filter-item")).filter((li) => li.style.display !== "none");
  visible.forEach((li) => {
    const chk = li.querySelector(".col-filter-chk");
    if (chk) chk.checked = master.checked;
  });
}

function onSingleColumnCheckChange() {
  syncSelectAllColumnState();
}

function syncSelectAllColumnState() {
  const chks = Array.from(document.querySelectorAll(".col-filter-chk"));
  const master = document.getElementById("colFilterSelectAll");
  if (master) master.checked = chks.length > 0 && chks.every((c) => c.checked);
}

function searchColumnFilterItems() {
  const q = document.getElementById("columnFilterSearch").value.trim().toLowerCase();
  document.querySelectorAll(".col-filter-item").forEach((li) => {
    const txt = li.getAttribute("data-text") || "";
    li.style.display = txt.includes(q) ? "flex" : "none";
  });
}

function applyColumnFilter() {
  if (!currentFilterCol) return;
  const chks = Array.from(document.querySelectorAll(".col-filter-chk"));
  const checked = chks.filter((c) => c.checked).map((c) => c.value);

  if (checked.length === chks.length) {
    activeSummaryFilters[currentFilterCol] = null;
  } else {
    activeSummaryFilters[currentFilterCol] = checked;
  }

  closeColumnFilterMenu();
  renderTables(rawEquipmentsCache, rawLogsCache, selectedYear, selectedMonth);
}

function clearColumnFilter() {
  if (!currentFilterCol) return;
  activeSummaryFilters[currentFilterCol] = null;
  closeColumnFilterMenu();
  renderTables(rawEquipmentsCache, rawLogsCache, selectedYear, selectedMonth);
}

function sortCurrentColumn(dir) {
  if (!currentFilterCol) return;
  currentSortCol = { col: currentFilterCol, dir };
  closeColumnFilterMenu();
  renderTables(rawEquipmentsCache, rawLogsCache, selectedYear, selectedMonth);
}

window.addEventListener("click", () => closeColumnFilterMenu());

function fmt(val) {
  return Number(val) === 0 ? "" : Number(val).toFixed(2);
}

function openExportModal(type) {
  currentExportType = type;

  let monthOptions = "";
  monthNames.forEach((m, idx) => {
    monthOptions += `<option value="${idx + 1}">${m}</option>`;
  });

  let yearOptions = "";
  const currentYear = new Date().getFullYear();
  const startYear = Math.max(currentYear, 2026);
  for (let y = 2026; y <= startYear; y++) {
    yearOptions += `<option value="${y}">${y}</option>`;
  }

  document.getElementById("fromMonth").innerHTML = monthOptions;
  document.getElementById("toMonth").innerHTML = monthOptions;
  document.getElementById("fromYear").innerHTML = yearOptions;
  document.getElementById("toYear").innerHTML = yearOptions;

  const defaultYear = selectedYear || new Date().getFullYear();
  document.getElementById("fromYear").value = defaultYear;
  document.getElementById("toYear").value = defaultYear;

  if (selectedMonth !== "ALL" && selectedMonth !== null) {
    document.getElementById("fromMonth").value = selectedMonth;
    document.getElementById("toMonth").value = selectedMonth;
  } else {
    document.getElementById("fromMonth").value = 1;
    document.getElementById("toMonth").value = 12;
  }

  document.getElementById("exportModal").style.display = "flex";
}

function closeExportModal() {
  document.getElementById("exportModal").style.display = "none";
}

async function executeBatchExport() {
  const fromM = parseInt(document.getElementById("fromMonth").value);
  const fromY = parseInt(document.getElementById("fromYear").value);
  const toM = parseInt(document.getElementById("toMonth").value);
  const toY = parseInt(document.getElementById("toYear").value);

  if (fromY > toY || (fromY === toY && fromM > toM)) {
    showToast(
      "Invalid Date Range! 'From' date must be before 'To' date.",
      "error",
    );
    return;
  }

  closeExportModal();

  if (currentExportType === "excel") {
    window.location.href = `/py/monthly-summary/export-excel?from_y=${fromY}&from_m=${fromM}&to_y=${toY}&to_m=${toM}`;
    showToast("Generating Excel...", "success");
  } else {
    showToast("Generating Batch PDF, please wait...", "success");
    const prevYear = selectedYear;
    const prevMonth = selectedMonth;

    try {
      let periods = [];
      for (let y = fromY; y <= toY; y++) {
        let start = y === fromY ? fromM : 1;
        let end = y === toY ? toM : 12;
        for (let m = start; m <= end; m++) {
          periods.push({ year: y, month: m });
        }
      }

      const yearsToFetch = [...new Set(periods.map((p) => p.year))];
      let allData = {};
      for (let y of yearsToFetch) {
        const res = await fetch(`/api/monthly-summary/data?year=${y}`);
        allData[y] = await res.json();
      }

      for (let p of periods) {
        const data = allData[p.year];
        companyMappingData = data.companies || {};
        renderTables(data.equipments, data.logs, p.year, p.month);
        await new Promise((r) => setTimeout(r, 400));

        const element = document.getElementById(`month-wrapper-${p.month}`);
        if (element) {
          const exportIcons = element.querySelector(".export-icons");
          if (exportIcons) exportIcons.style.display = "none";

          const originalOverflow = element.style.overflowX;
          element.style.overflowX = "visible";

          const HTML_Width = element.scrollWidth;
          const HTML_Height = element.scrollHeight;

          const opt = {
            margin: 10,
            filename: `Income_Expenditure_${monthNames[p.month - 1]}_${p.year}.pdf`,
            image: { type: "jpeg", quality: 1.0 },
            html2canvas: { scale: 2, useCORS: true, windowWidth: HTML_Width },
            pagebreak: { mode: "avoid-all" },
            jsPDF: {
              unit: "px",
              format: [HTML_Width + 20, HTML_Height + 50],
              orientation: "landscape",
            },
          };

          await html2pdf().set(opt).from(element).save();
        }
      }

      selectedYear = prevYear;
      selectedMonth = prevMonth;
      renderMonthButtons();
      updateTableVisibility();
      showToast("Batch PDF Export Completed!", "success");
    } catch (e) {
      showToast("Error generating PDFs", "error");
      console.error(e);
    }
  }
}

function exportSingleExcel(month, year) {
  window.location.href = `/py/monthly-summary/export-excel?from_y=${year}&from_m=${month}&to_y=${year}&to_m=${month}`;
  showToast("Generating Excel...", "success");
}

function exportPDF(month, monthName, year) {
  const element = document.getElementById(`month-wrapper-${month}`);
  const exportIcons = element.querySelector(".export-icons");
  if (exportIcons) exportIcons.style.display = "none";

  const originalOverflow = element.style.overflowX;
  element.style.overflowX = "visible";

  const HTML_Width = element.scrollWidth;
  const HTML_Height = element.scrollHeight;

  const opt = {
    margin: 10,
    filename: `Income_Expenditure_${monthName}_${year}.pdf`,
    image: { type: "jpeg", quality: 1.0 },
    html2canvas: { scale: 2, useCORS: true, windowWidth: HTML_Width },
    pagebreak: { mode: "avoid-all" },
    jsPDF: {
      unit: "px",
      format: [HTML_Width + 20, HTML_Height + 50],
      orientation: "landscape",
    },
  };

  html2pdf()
    .set(opt)
    .from(element)
    .save()
    .then(() => {
      if (exportIcons) exportIcons.style.display = "flex";
      element.style.overflowX = originalOverflow;
      showToast("PDF Exported Successfully!", "success");
    });
}

function copyImage(wrapperId) {
  const element = document.getElementById(wrapperId);
  const exportIcons = element.querySelector(".export-icons");
  if (exportIcons) exportIcons.style.display = "none";

  const originalOverflow = element.style.overflowX;
  element.style.overflowX = "visible";

  html2canvas(element, { scale: 3, backgroundColor: "#ffffff" }).then(
    (canvas) => {
      if (exportIcons) exportIcons.style.display = "flex";
      element.style.overflowX = originalOverflow;

      canvas.toBlob((blob) => {
        try {
          const item = new ClipboardItem({ "image/png": blob });
          navigator.clipboard
            .write([item])
            .then(() => {
              showToast("Image copied to clipboard!", "success");
            })
            .catch(() => downloadImage(canvas, "Statement.png"));
        } catch (e) {
          downloadImage(canvas, "Statement.png");
        }
      }, "image/png");
    },
  );
}

function downloadImage(canvas, filename) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
  showToast("Image Downloaded!", "success");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === "success" ? "✅ " : "❌ "} ${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
