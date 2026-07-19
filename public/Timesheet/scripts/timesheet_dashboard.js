let cachedDashboardData = null;
let activeFilters = { owner: [], type: [], site: [], plate: [] };
let currentFilterColInfo = { key: "", index: -1 };

// 🟢 NEW: Special Rules Cache
let specialRulesCache = [];

const dDate = new Date();
document.getElementById("selYear").value = dDate.getFullYear();
document.getElementById("batchToYear").value = dDate.getFullYear();
const months = [
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
document.getElementById("selMonth").value = months[dDate.getMonth()];
document.getElementById("batchToMonth").value = months[dDate.getMonth()];

let alertResolver;
function customAlert(title, msg) {
  return new Promise((resolve) => {
    alertResolver = resolve;
    let titleColor = "#0f2027";
    if (title === "Error") titleColor = "#ef4444";
    else if (title === "Success") titleColor = "#10b981";
    else if (title === "Warning") titleColor = "#f59e0b";

    document.getElementById("alertTitle").innerText = title;
    document.getElementById("alertTitle").style.color = titleColor;
    document.getElementById("alertMessage").innerText = msg;
    document.getElementById("customAlertModal").style.display = "flex";
  });
}

function resolveAlert() {
  document.getElementById("customAlertModal").style.display = "none";
  if (alertResolver) alertResolver();
}

function toggleFilter(e, id) {
  e.preventDefault();
  const el = document.getElementById(id);
  if (el) {
    el.style.display = el.style.display === "block" ? "none" : "block";
    if (el.style.display === "block") el.focus();
  }
}
function stopProp(e) {
  e.stopPropagation();
}

// 🟢 Fetch Special Rules API
async function ensureSpecialRules() {
  try {
    let token = localStorage.getItem("timesheetToken") || "";
    const srRes = await fetch("/timesheet/api/special-rules", {
      headers: { Authorization: "Bearer " + token },
    });
    if (srRes.ok) {
      const srData = await srRes.json();
      if (srData.success) specialRulesCache = srData.data;
    }
  } catch (err) {
    console.warn("Could not fetch special rules", err);
  }
}

// 🟢 Excel Checkbox Filters Logic
function openFilterMenu(event, key, colIndex) {
  event.stopPropagation();
  currentFilterColInfo = { key, index: colIndex };
  const menu = document.getElementById("excelFilterMenu");
  const listContainer = document.getElementById("filterChecklist");
  listContainer.innerHTML = "";

  const table = document.getElementById("dashboardTable");
  if (!table) return;

  let allOptions = new Set();
  const trs = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");

  for (let i = 0; i < trs.length; i++) {
    let row = trs[i];
    let tds = row.getElementsByTagName("td");
    if (tds.length < 7) continue;

    let passesOtherFilters = true;
    for (let filterKey in activeFilters) {
      if (filterKey === key) continue;
      let allowedValues = activeFilters[filterKey];
      if (allowedValues.length === 0) continue;

      let cIdx =
        filterKey === "owner"
          ? 1
          : filterKey === "type"
            ? 2
            : filterKey === "site"
              ? 5
              : 6;
      let cellVal = tds[cIdx].textContent.trim();

      if (!allowedValues.includes(cellVal)) {
        passesOtherFilters = false;
        break;
      }
    }

    if (passesOtherFilters) {
      allOptions.add(tds[colIndex].textContent.trim());
    }
  }

  let allData = Array.from(allOptions).sort();
  let previouslySelected = activeFilters[key] || [];
  let isAllSelected = previouslySelected.length === 0;

  document.getElementById("filterSelectAll").checked = isAllSelected;

  allData.forEach((val) => {
    let displayVal = val === "" ? "(Blank)" : val;
    let isChecked = isAllSelected || previouslySelected.includes(val);
    let id = "flt_" + Math.random().toString(36).substr(2, 9);
    listContainer.insertAdjacentHTML(
      "beforeend",
      `
            <div class="filter-item filter-row-item">
                <input type="checkbox" id="${id}" value="${val.replace(/"/g, "&quot;")}" ${isChecked ? "checked" : ""} class="col-filter-cb">
                <label for="${id}">${displayVal}</label>
            </div>
        `,
    );
  });

  let iconRect = event.target.getBoundingClientRect();
  menu.style.top = iconRect.bottom + window.scrollY + 5 + "px";
  menu.style.left = iconRect.left + window.scrollX - 180 + "px";
  menu.style.display = "block";

  document.getElementById("filterSearchInput").value = "";
  document.getElementById("filterSearchInput").focus();
}

document
  .getElementById("filterSelectAll")
  ?.addEventListener("change", function () {
    let isChecked = this.checked;
    document.querySelectorAll(".col-filter-cb").forEach((cb) => {
      if (cb.parentElement.style.display !== "none") cb.checked = isChecked;
    });
  });

document
  .getElementById("filterSearchInput")
  ?.addEventListener("keyup", function () {
    let keyword = this.value.toLowerCase();
    document.querySelectorAll(".filter-row-item").forEach((item) => {
      if (item.textContent.toLowerCase().includes(keyword))
        item.style.display = "";
      else item.style.display = "none";
    });
  });

function closeCustomFilter() {
  document.getElementById("excelFilterMenu").style.display = "none";
}

function applyCustomFilter() {
  let selectedValues = [];
  let totalVisible = 0;
  let checkedCount = 0;
  document.querySelectorAll(".col-filter-cb").forEach((cb) => {
    totalVisible++;
    if (cb.checked) {
      selectedValues.push(cb.value);
      checkedCount++;
    }
  });

  const key = currentFilterColInfo.key;
  const icon = document.querySelector(
    `th span.filter-icon[onclick*="'${key}'"]`,
  );

  if (checkedCount === totalVisible || checkedCount === 0) {
    activeFilters[key] = [];
    if (icon) {
      icon.classList.remove("filter-active");
      icon.innerText = "filter_list";
    }
  } else {
    activeFilters[key] = selectedValues;
    if (icon) {
      icon.classList.add("filter-active");
      icon.innerText = "filter_alt";
    }
  }

  closeCustomFilter();
  applyGridFilters();
}

document.addEventListener("click", function (e) {
  if (
    !e.target.closest(".excel-filter-menu") &&
    !e.target.classList.contains("filter-icon")
  ) {
    closeCustomFilter();
  }
});

function getDaysInMonth(monthStr, year) {
  return new Date(year, months.indexOf(monthStr) + 1, 0).getDate();
}

function getDayName(dayNum, monthStr, year) {
  const dateObj = new Date(`${monthStr} ${dayNum}, ${year}`);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dateObj.getDay()];
}

function parseLogDate(dStr, defaultDate) {
  if (!dStr) return defaultDate;
  let parts = dStr.split("T")[0].split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getGapStatus(d, sLogs, dLogs) {
  let sActive = false,
    sGap = false,
    isReplaced = false;
  let dActive = false,
    dGap = false;

  if (sLogs && sLogs.length > 0) {
    let ascSLogs = [...sLogs].sort(
      (a, b) =>
        parseLogDate(a.work_start_date, new Date("2000-01-01")) -
        parseLogDate(b.work_start_date, new Date("2000-01-01")),
    );
    for (let i = 0; i < ascSLogs.length; i++) {
      let st = parseLogDate(
        ascSLogs[i].work_start_date,
        new Date("2000-01-01"),
      );
      let ed = parseLogDate(ascSLogs[i].work_end_date, new Date("2099-01-01"));
      if (d >= st && d <= ed) {
        sActive = true;
        break;
      }
      if (d > ed) {
        if (ascSLogs[i].status === "Replaced") isReplaced = true;
      }
    }
    if (!sActive) {
      let firstStart = parseLogDate(
        ascSLogs[0].work_start_date,
        new Date("2000-01-01"),
      );
      let lastEnd = parseLogDate(
        ascSLogs[ascSLogs.length - 1].work_end_date,
        new Date("2099-01-01"),
      );
      if (d >= firstStart && d <= lastEnd) sGap = true;
    }
  } else {
    sActive = true;
  }

  if (!sActive) {
    if (isReplaced) return "R";
    return sGap ? "SC" : "AB";
  }

  if (dLogs && dLogs.length > 0) {
    let ascDLogs = [...dLogs].sort(
      (a, b) =>
        parseLogDate(a.work_start_date, new Date("2000-01-01")) -
        parseLogDate(b.work_start_date, new Date("2000-01-01")),
    );
    for (let i = 0; i < ascDLogs.length; i++) {
      let st = parseLogDate(
        ascDLogs[i].work_start_date,
        new Date("2000-01-01"),
      );
      let ed = parseLogDate(ascDLogs[i].work_end_date, new Date("2099-01-01"));
      if (d >= st && d <= ed) {
        dActive = true;
        break;
      }
    }
  } else {
    dActive = true;
  }

  if (!dActive) return "DC";
  return "ACTIVE";
}

function applyGridFilters(tableId = "dashboardTable") {
  const globalSearch = document
    .getElementById("globalSearch")
    .value.toUpperCase();
  const fDriver = document.getElementById("fDriver")
    ? document.getElementById("fDriver").value.toUpperCase()
    : "";

  const table = document.getElementById(tableId);
  if (!table) return;
  const trs = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");

  let visibleCount = 0;

  for (let i = 0; i < trs.length; i++) {
    let row = trs[i];
    let tds = row.getElementsByTagName("td");
    if (tds.length < 7) continue;

    let tOwner = tds[1].textContent.trim();
    let tType = tds[2].textContent.trim();
    let tDriver = tds[3].textContent.toUpperCase();
    let tSite = tds[5].textContent.trim();
    let tPlate = tds[6].textContent.trim();
    let rowText = row.textContent.toUpperCase();

    let matchesFilters = true;
    if (fDriver && !tDriver.includes(fDriver)) matchesFilters = false;

    if (activeFilters.owner.length > 0 && !activeFilters.owner.includes(tOwner))
      matchesFilters = false;
    if (activeFilters.type.length > 0 && !activeFilters.type.includes(tType))
      matchesFilters = false;
    if (activeFilters.site.length > 0 && !activeFilters.site.includes(tSite))
      matchesFilters = false;
    if (activeFilters.plate.length > 0 && !activeFilters.plate.includes(tPlate))
      matchesFilters = false;

    let matchesGlobal = globalSearch === "" || rowText.includes(globalSearch);

    if (matchesFilters && matchesGlobal) {
      row.style.display = "";
      visibleCount++;
    } else {
      row.style.display = "none";
    }
  }

  const countDisplay = document.getElementById("plateCountDisplay");
  const countNumber = document.getElementById("plateCountNumber");
  if (countDisplay && countNumber) {
    countDisplay.style.display = "flex";
    countNumber.innerText = visibleCount;
  }
}

function toggleEditMode() {
  if (!cachedDashboardData) return;
  const isEditMode = document.getElementById("editToggle").checked;
  const container = document.getElementById("tableContainer");
  container.innerHTML = getTableHTMLString(
    cachedDashboardData,
    document.getElementById("selMonth").value,
    document.getElementById("selYear").value,
    isEditMode,
  );
  setTimeout(adjustStickyHeaders, 50);
  applyGridFilters();
}

function recalculateRowOnEdit(cell) {
  const row = cell.parentElement;
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;
  const daysInMonth = getDaysInMonth(m, y);
  const site = row.cells[5].innerText.split("&")[0].trim().toUpperCase();

  let sumNormal = 0,
    sumOT = 0;

  for (let i = 1; i <= daysInMonth; i++) {
    let targetCell = row.cells[6 + i];
    let cellVal = targetCell.innerText.trim().toUpperCase();
    
    // 🟢 Auto-map on dashboard edit
    if (cellVal === "B") cellVal = "BD";
    else if (cellVal === "N") cellVal = "NW";
    else if (cellVal === "S") cellVal = "NS";
    else if (cellVal === "NR") cellVal = "NR";
    
    targetCell.innerText = cellVal;

    let dayName = getDayName(i, m, y);
    let formattedDate = new Date(y, months.indexOf(m), i)
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, " ");
    let specialRule = specialRulesCache.find(
      (r) =>
        r.is_active &&
        (r.sites.includes("ALL") || r.sites.includes(site)) &&
        r.dates.includes(formattedDate),
    );

    let isFullOT = dayName === "Fri" || i === 31;
    if (specialRule && specialRule.rule_type === "FULL_OT") isFullOT = true;

    let normalHr = 0,
      otHr = 0;
    let timeRaw = parseFloat(cellVal);

    targetCell.className = targetCell.className
      .replace(/code-[a-z]+|cell-fri/g, "")
      .trim();
    if (isFullOT) targetCell.classList.add("cell-fri");

    if (cellVal === "BD" || cellVal === "B") {
      targetCell.classList.add("code-b");
    } else if (cellVal === "H") {
      targetCell.classList.add("code-h");
    } else if (["ID", "NP"].includes(cellVal)) {
      targetCell.classList.add(cellVal === "ID" ? "code-id" : "code-np");
      if (isFullOT) {
        normalHr = 0;
        otHr = 10;
      } else {
        normalHr = 10;
        otHr = 0;
      }
    } else if (["NR", "NW", "NS"].includes(cellVal)) {
      targetCell.classList.add("code-nr");
    } else if (["AB"].includes(cellVal)) {
      targetCell.classList.add("code-ab");
    } else if (["R"].includes(cellVal)) {
      targetCell.classList.add("code-r");
    } else if (["DC"].includes(cellVal)) {
      targetCell.classList.add("code-dc");
    } else if (["SC"].includes(cellVal)) {
      targetCell.classList.add("code-sc");
    } else if (!isNaN(timeRaw) && timeRaw > 0) {
      if (isFullOT) {
        otHr = timeRaw;
      } else {
        if (timeRaw > 10) {
          normalHr = 10;
          otHr = timeRaw - 10;
        } else {
          normalHr = timeRaw;
        }
      }
    }

    sumNormal += normalHr;
    sumOT += otHr;
  }

  let totalHr = sumNormal + sumOT;
  const totalCols = 7 + daysInMonth + 5;

  row.cells[totalCols - 5].innerText = sumNormal > 0 ? sumNormal : "";
  row.cells[totalCols - 4].innerText = sumOT > 0 ? sumOT : "";
  row.cells[totalCols - 3].innerText = totalHr > 0 ? totalHr : "";
}

document
  .getElementById("tableContainer")
  .addEventListener("keydown", function (e) {
    if (!e.target.classList.contains("editable-cell")) return;
    const currentCell = e.target;
    const currentRow = currentCell.parentElement;
    const cellIndex = Array.from(currentRow.children).indexOf(currentCell);

    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(
        e.key,
      )
    ) {
      e.preventDefault();
      let targetCell = null;

      if (e.key === "ArrowRight") {
        targetCell = currentCell.nextElementSibling;
        while (targetCell && !targetCell.classList.contains("editable-cell")) {
          targetCell = targetCell.nextElementSibling;
        }
      } else if (e.key === "ArrowLeft") {
        targetCell = currentCell.previousElementSibling;
        while (targetCell && !targetCell.classList.contains("editable-cell")) {
          targetCell = targetCell.previousElementSibling;
        }
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        let nextRow = currentRow.nextElementSibling;
        if (nextRow) targetCell = nextRow.children[cellIndex];
        if (e.key === "Enter") currentCell.blur();
      } else if (e.key === "ArrowUp") {
        let prevRow = currentRow.previousElementSibling;
        if (prevRow) targetCell = prevRow.children[cellIndex];
      }

      if (targetCell && targetCell.classList.contains("editable-cell")) {
        targetCell.focus();
      }
    }
  });

function adjustStickyHeaders(tableId = "dashboardTable") {
  const thead = document.querySelector(`#${tableId} thead`);
  if (!thead) return;
  const rows = thead.querySelectorAll("tr");
  if (rows.length >= 3) {
    let h0 = rows[0].getBoundingClientRect().height;
    let h1 = rows[1].getBoundingClientRect().height;
    let ths1 = rows[1].querySelectorAll("th");
    ths1.forEach((th) => (th.style.top = h0 + "px"));
    let ths2 = rows[2].querySelectorAll("th");
    ths2.forEach((th) => (th.style.top = h0 + h1 + "px"));
  }
  initColumnResizer(tableId);
}
window.addEventListener("resize", () => adjustStickyHeaders("dashboardTable"));

async function fetchAndGenerateDashboard() {
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;

  const btn = document.getElementById("btnGen");
  const loader = document.getElementById("genLoader");
  const container = document.getElementById("tableContainer");

  const countDisplay = document.getElementById("plateCountDisplay");
  if (countDisplay) countDisplay.style.display = "none";

  btn.disabled = true;
  loader.style.display = "inline-block";
  container.innerHTML =
    '<div style="color: #64748b; margin-top: 50px; text-align:center;">Fetching and processing data...</div>';

  try {
    // 🟢 Fetch Special Rules Before Loading Table
    await ensureSpecialRules();

    activeFilters = { owner: [], type: [], site: [], plate: [] };
    document.getElementById("filterSearchInput").value = "";
    document.getElementById("globalSearch").value = "";

    const payload = { month: m, year: y, filterType: "All", filterValue: "" };
    const res = await fetch("/timesheet/api/public/view-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.message);
    if (data.vehicles.length === 0) {
      container.innerHTML =
        '<div style="color: #b91c1c; margin-top: 50px; text-align:center; font-weight:bold;">No records found.</div>';
      return;
    }

    cachedDashboardData = data;
    document.getElementById("editToggle").checked = false;

    container.innerHTML = getTableHTMLString(data, m, y, false);

    setTimeout(() => {
      adjustStickyHeaders("dashboardTable");
      applyGridFilters("dashboardTable");
    }, 50);
  } catch (error) {
    container.innerHTML = `<div style="color: #b91c1c; margin-top: 50px; text-align:center; font-weight:bold;">Error: ${error.message}</div>`;
  } finally {
    btn.disabled = false;
    loader.style.display = "none";
  }
}

function getTableHTMLString(
  data,
  m,
  y,
  isEditMode,
  tableId = "dashboardTable",
) {
  const daysInMonth = getDaysInMonth(m, y);

  const ownerFilterClass =
    activeFilters.owner.length > 0 ? "filter-active" : "";
  const ownerFilterIcon =
    activeFilters.owner.length > 0 ? "filter_alt" : "filter_list";
  const typeFilterClass = activeFilters.type.length > 0 ? "filter-active" : "";
  const typeFilterIcon =
    activeFilters.type.length > 0 ? "filter_alt" : "filter_list";
  const siteFilterClass = activeFilters.site.length > 0 ? "filter-active" : "";
  const siteFilterIcon =
    activeFilters.site.length > 0 ? "filter_alt" : "filter_list";
  const plateFilterClass =
    activeFilters.plate.length > 0 ? "filter-active" : "";
  const plateFilterIcon =
    activeFilters.plate.length > 0 ? "filter_alt" : "filter_list";

  let theadHTML = `
    <tr class="sub-title-row">
        <th colspan="7" style="text-align: center;">Haka Contracting - Monthly Time sheet - ${m} ${y}</th>
        <th colspan="${daysInMonth}" style="text-align: center;">Total No. of Hours Worked Daily</th>
        <th colspan="5"></th>
    </tr>
    <tr>
        <th rowspan="2" class="col-no"><div class="col-header-wrap" style="justify-content:center;">No</div></th>
        
        <th rowspan="2" class="resizable-th">
            <div class="col-header-wrap">
                Owner Name
                <span class="material-icons filter-icon ${ownerFilterClass}" onclick="openFilterMenu(event, 'owner', 1)">${ownerFilterIcon}</span>
            </div>
            <div class="resizer"></div>
        </th>
        
        <th rowspan="2" class="col-type">
            <div class="col-header-wrap">
                Vehicle Type
                <span class="material-icons filter-icon ${typeFilterClass}" onclick="openFilterMenu(event, 'type', 2)">${typeFilterIcon}</span>
            </div>
            <div class="resizer"></div>
        </th>
        
        <th rowspan="2" class="resizable-th" oncontextmenu="toggleFilter(event, 'fDriver')">
            <div class="col-header-wrap">Driver Name</div>
            <input type="text" id="fDriver" class="th-filter-input" placeholder="Search..." onkeyup="applyGridFilters('${tableId}')" onclick="stopProp(event)">
            <div class="resizer"></div>
        </th>
        
        <th rowspan="2" class="col-mobile"><div class="col-header-wrap">Mobile</div></th>
        
        <th rowspan="2" class="col-site">
            <div class="col-header-wrap">
                Site Name
                <span class="material-icons filter-icon ${siteFilterClass}" onclick="openFilterMenu(event, 'site', 5)">${siteFilterIcon}</span>
            </div>
            <div class="resizer"></div>
        </th>
        
        <th rowspan="2" class="col-plate">
            <div class="col-header-wrap">
                Plate No
                <span class="material-icons filter-icon ${plateFilterClass}" onclick="openFilterMenu(event, 'plate', 6)">${plateFilterIcon}</span>
            </div>
            <div class="resizer"></div>
        </th>
`;

  for (let i = 1; i <= daysInMonth; i++) {
    let dayName = getDayName(i, m, y);
    theadHTML += `<th class="col-day ${dayName === "Fri" ? "cell-fri" : ""}"><div class="day-header">${dayName}</div></th>`;
  }

  theadHTML += `
        <th rowspan="2"><div class="col-header-wrap" style="white-space:normal; justify-content:center; text-align:center;">Normal<br>Hours</div></th>
        <th rowspan="2"><div class="col-header-wrap" style="white-space:normal; justify-content:center; text-align:center;">OT<br>Hours</div></th>
        <th rowspan="2"><div class="col-header-wrap" style="white-space:normal; justify-content:center; text-align:center;">Total<br>Worked</div></th>
        <th rowspan="2"><div class="col-header-wrap" style="white-space:normal; justify-content:center; text-align:center;">Total<br>Dist</div></th>
        <th rowspan="2"><div class="col-header-wrap" style="white-space:normal; justify-content:center; text-align:center;">Mileage<br>(Km/L)</div></th>
    </tr>
    <tr>
`;
  for (let i = 1; i <= daysInMonth; i++) {
    let dayName = getDayName(i, m, y);
    theadHTML += `<th class="col-day date-header ${dayName === "Fri" ? "cell-fri" : ""}">${i}</th>`;
  }
  theadHTML += `</tr>`;

  let mIdx = months.indexOf(m);
  let monthStart = new Date(y, mIdx, 1);
  let monthEnd = new Date(y, mIdx + 1, 0);

  let processedVehicles = data.vehicles.map((v) => {
    const plate = v.plate_no;
    v.vRecords = data.records.filter((r) => r.plate_no === plate);
    v.dLogs = data.logs.drivers.filter((l) => l.plate_no === plate);
    v.sLogs = data.logs.sites.filter((l) => l.plate_no === plate);

    let activeDrivers = v.dLogs.filter((d) => {
      let st = parseLogDate(d.work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(d.work_end_date, new Date("2099-01-01"));
      return st <= monthEnd && ed >= monthStart;
    });

    let activeSites = v.sLogs.filter((s) => {
      let st = parseLogDate(s.work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(s.work_end_date, new Date("2099-01-01"));
      return st <= monthEnd && ed >= monthStart;
    });

    v.currDriver =
      activeDrivers.map((d) => d.driver_name).join(" & ") ||
      v.driver_name ||
      "";
    v.currMobile =
      activeDrivers.map((d) => d.driver_mobile).join(" & ") ||
      v.driver_mobile ||
      "";
    v.currSite =
      activeSites.map((s) => s.site_name).join(" & ") || v.site_name || "";

    return v;
  });

  processedVehicles.sort((a, b) => {
    let siteA = a.currSite.toUpperCase();
    let siteB = b.currSite.toUpperCase();

    if (siteA < siteB) return -1;
    if (siteA > siteB) return 1;

    let plateA = a.plate_no.toUpperCase();
    let plateB = b.plate_no.toUpperCase();

    if (plateA < plateB) return -1;
    if (plateA > plateB) return 1;

    return 0;
  });

  let tbodyHTML = "";

  processedVehicles.forEach((v, index) => {
    let trHTML = `
        <tr>
            <td class="col-no">${index + 1}</td>
            <td class="wrap-cell">${v.owner_name || ""}</td>
            <td>${v.vehicle_type || ""}</td>
            <td class="wrap-cell">${v.currDriver}</td>
            <td>${v.currMobile}</td>
            <td class="col-site">${v.currSite}</td>
            <td class="col-plate">${v.plate_no}</td>
    `;

    let sumNormal = 0,
      sumOT = 0,
      sumDist = 0,
      sumFuel = 0;
    let editProps = isEditMode
      ? 'contenteditable="true" class="editable-cell" onblur="recalculateRowOnEdit(this)"'
      : "";
    let siteStr = v.currSite.split("&")[0].trim().toUpperCase();

    for (let i = 1; i <= daysInMonth; i++) {
      const rec = v.vRecords.find((r) => parseInt(r.record_date) === i) || {};
      let dayName = getDayName(i, m, y);

      let checkDate = new Date(y, mIdx, i);
      let formattedDate = checkDate
        .toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
        .replace(/ /g, " ");
      let specialRule = specialRulesCache.find(
        (r) =>
          r.is_active &&
          (r.sites.includes("ALL") || r.sites.includes(siteStr)) &&
          r.dates.includes(formattedDate),
      );

      let isFullOT = dayName === "Fri" || i === 31;
      if (specialRule && specialRule.rule_type === "FULL_OT") isFullOT = true;

      let timeRaw = parseFloat(rec.calc_time) || 0;
      let bdStr = String(rec.bd || "").trim().toUpperCase();
      
      if (bdStr === "B") bdStr = "BD";
      else if (bdStr === "N") bdStr = "NW";
      else if (bdStr === "S") bdStr = "NS";

      let statusCode = getGapStatus(checkDate, v.sLogs, v.dLogs);
      let hasData =
        timeRaw > 0 || bdStr !== "" || rec.wrk_start || rec.hmr_start;

      // 🟢 Smart Auto-Fill Override
      if (!hasData && specialRule && specialRule.rule_type !== "FULL_OT") {
        bdStr = specialRule.rule_type;
        hasData = true;
      }

      let cellDisplay = "";
      let cellClass = isFullOT ? "cell-fri" : "";

      let normalHr = 0,
        otHr = 0;
      let dist = parseFloat(rec.calc_distance) || 0;
      let fuel = parseFloat(rec.fuel) || 0;

      if (hasData) {
        // 🟢 Allowed list updated for BD, NW, NS, NR
        if (["BD", "NW", "NS", "NR", "H", "ID", "NP", "AB", "DC", "SC", "R"].includes(bdStr)) cellDisplay = bdStr;
        else cellDisplay = timeRaw > 0 ? timeRaw : "";

        if (bdStr === "BD" || bdStr === "B") {
          cellClass += " code-b";
        } else if (bdStr === "H") {
          cellClass += " code-h";
        } else if (["NR", "NW", "NS"].includes(bdStr)) {
          cellClass += " code-nr";
        // 🟢 FIX 2: Added specific color classes for AB, DC, SC, R
        } else if (bdStr === "AB") {
          cellClass += " code-ab";
        } else if (bdStr === "DC") {
          cellClass += " code-dc";
        } else if (bdStr === "SC") {
          cellClass += " code-sc";
        } else if (bdStr === "R") {
          cellClass += " code-r";
        } else if (bdStr === "ID" || bdStr === "NP") {
          if (isFullOT) {
            normalHr = 0;
            otHr = 10;
          } else {
            normalHr = 10;
            otHr = 0;
          }
          cellClass += bdStr === "ID" ? " code-id" : " code-np";
        } else if (timeRaw > 0) {
          if (isFullOT) {
            otHr = timeRaw;
          } else {
            if (timeRaw > 10) {
              normalHr = 10;
              otHr = timeRaw - 10;
            } else {
              normalHr = timeRaw;
            }
          }
        }
      } else {
        // (Existing logic for gap status)
        if (statusCode !== "ACTIVE") {
          cellDisplay = statusCode;
          if (statusCode === "AB") cellClass += " code-ab";
          else if (statusCode === "R") cellClass += " code-r";
          else if (statusCode === "DC") cellClass += " code-dc";
          else if (statusCode === "SC") cellClass += " code-sc";
        }
      }

      sumNormal += normalHr;
      sumOT += otHr;
      sumDist += dist;
      sumFuel += fuel;
      let finalClass = cellClass.trim();
      if (isEditMode) finalClass += " editable-cell";

      trHTML += `<td class="${finalClass}" ${editProps}>${cellDisplay}</td>`;
    }

    let totalHr = sumNormal + sumOT;
    let mileage = sumFuel > 0 ? (sumDist / sumFuel).toFixed(2) : "0.00";

    trHTML += `
            <td class="col-summary bg-normal-hr">${sumNormal > 0 ? sumNormal : ""}</td>
            <td class="col-summary bg-ot-hr">${sumOT > 0 ? sumOT : ""}</td>
            <td class="col-summary bg-total-hr">${totalHr > 0 ? totalHr : ""}</td>
            <td class="col-summary bg-dist">${sumDist > 0 ? sumDist.toFixed(1) : ""}</td>
            <td class="col-summary bg-mileage">${mileage}</td>
        </tr>
    `;
    tbodyHTML += trHTML;
  });

  return `<table class="ts-table" id="${tableId}"><thead>${theadHTML}</thead><tbody>${tbodyHTML}</tbody></table>`;
}

function initColumnResizer(tableId) {
  const cols = document.querySelectorAll(`#${tableId} th`);
  let savedWidths = JSON.parse(localStorage.getItem("erpColWidths")) || {};
  cols.forEach((th, index) => {
    const resizer = th.querySelector(".resizer");
    if (!resizer) return;

    let colName = th.querySelector(".col-header-wrap").innerText.trim();
    if (savedWidths[colName]) {
      th.style.width = savedWidths[colName];
      th.style.minWidth = savedWidths[colName];
    }

    let x = 0;
    let w = 0;
    const mouseDownHandler = function (e) {
      x = e.clientX;
      w = th.getBoundingClientRect().width;
      document.addEventListener("mousemove", mouseMoveHandler);
      document.addEventListener("mouseup", mouseUpHandler);
      resizer.classList.add("resizing");
    };

    const mouseMoveHandler = function (e) {
      let dx = e.clientX - x;
      let newWidth = w + dx;
      if (newWidth < 50) newWidth = 50;
      th.style.width = `${newWidth}px`;
      th.style.minWidth = `${newWidth}px`;
    };

    const mouseUpHandler = function () {
      resizer.classList.remove("resizing");
      document.removeEventListener("mousemove", mouseMoveHandler);
      document.removeEventListener("mouseup", mouseUpHandler);
      savedWidths[colName] = th.style.width;
      localStorage.setItem("erpColWidths", JSON.stringify(savedWidths));
    };
    resizer.addEventListener("mousedown", mouseDownHandler);
  });
}

document.addEventListener("click", function (e) {
  if (!e.target.closest(".export-wrapper")) {
    document.getElementById("exportMenu").style.display = "none";
  }
});

function toggleExportMenu() {
  const menu = document.getElementById("exportMenu");
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

async function buildWorksheetFromTable(workbook, table, m, y) {
  const daysInMonth = getDaysInMonth(m, y);
  const totalCols = 7 + daysInMonth + 5;
  
  // 1. Create Sheet with 80% Zoom and Freeze First 3 Rows (and 7 Cols)
  const ws = workbook.addWorksheet(`${m} ${y}`, {
    views: [{ state: 'frozen', xSplit: 7, ySplit: 3, zoomScale: 80 }]
  });

  const trs = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");
  let visibleTrs = [];
  for (let i = 0; i < trs.length; i++) {
    if (trs[i].style.display !== "none") visibleTrs.push(trs[i]);
  }
  const totalRows = 3 + visibleTrs.length;

  // 2. Prepare Data Array FIRST
  let ws_data = [];
  for (let r = 0; r < totalRows; r++) {
    ws_data.push(new Array(totalCols).fill(" "));
  }

  ws_data[0][0] = `Haka Contracting - Monthly Time sheet - ${m} ${y}`;
  ws_data[0][7] = "Total No. of Hours Worked Daily";

  let headers1 = ["No", "Owner Name", "Vehicle Type", "Driver Name", "Mobile", "Site Name", "Plate No"];
  for (let i = 1; i <= daysInMonth; i++) headers1.push(getDayName(i, m, y));
  headers1.push("Normal Hours", "OT Hours", "Total Hours Worked", "Total Dist.", "Mileage (Km/L)");

  let headers2 = ["", "", "", "", "", "", ""];
  for (let i = 1; i <= daysInMonth; i++) headers2.push(i);
  headers2.push("", "", "", "", "");

  for (let c = 0; c < totalCols; c++) {
    if (headers1[c]) ws_data[1][c] = headers1[c];
    if (headers2[c]) ws_data[2][c] = headers2[c];
  }

  for (let i = 0; i < visibleTrs.length; i++) {
    let tds = visibleTrs[i].cells;
    for (let c = 0; c < totalCols; c++) {
      if (tds[c]) {
        let val = tds[c].innerText.trim();
        
        if (val === "") {
          ws_data[i + 3][c] = " ";
        } else if (!isNaN(val) && c !== 4) { 
          ws_data[i + 3][c] = Number(val); 
        } else {
          ws_data[i + 3][c] = val;
        }
      }
    }
  }

  // 3. Insert Data to Sheet BEFORE applying heights or filters
  ws_data.forEach(rowData => ws.addRow(rowData));

  // 4. Set AutoFilter on B3 to G(n)
  ws.autoFilter = `B3:G${totalRows}`;

  // 5. Set Row Heights (Now it will apply to existing rows)
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 45;
  ws.getRow(3).height = 20;
  for (let i = 0; i < visibleTrs.length; i++) {
    ws.getRow(i + 4).height = 26;
  }

  // 6. Set Column Widths
  const colWidths = [5, 25, 15, 25, 14, 20, 12];
  
  // You can change '6.0' to any width you prefer (e.g., 5.0, 7.5, 8.0)
  const dayColumnWidth = 5.0; 
  
  for (let i = 0; i < daysInMonth; i++) colWidths.push(dayColumnWidth);
  colWidths.push(10, 10, 12, 10, 12);
  
  colWidths.forEach((w, index) => {
    ws.getColumn(index + 1).width = w;
  });

  // 7. Merge Cells
  ws.mergeCells(1, 1, 1, 7);
  ws.mergeCells(1, 8, 1, 7 + daysInMonth);
  
  const merges23 = [1, 2, 3, 4, 5, 6, 7, totalCols - 4, totalCols - 3, totalCols - 2, totalCols - 1, totalCols];
  merges23.forEach(col => {
      ws.mergeCells(2, col, 3, col);
  });

  // 8. Apply Styling
  const solidBlackBorder = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } }
  };

  for (let R = 1; R <= totalRows; R++) {
    for (let C = 1; C <= totalCols; C++) {
      let cell = ws.getCell(R, C);
      let val = String(cell.value).trim();
      
      cell.border = solidBlackBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF000000' } };

      if (R === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
        cell.font = { name: 'Arial', size: 14, color: { argb: 'FFFFFFFF' }, bold: true };
      } else if (R === 2 || R === 3) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FFFFFFFF' }, bold: true };
        if (R === 2 && C >= 8 && C < 8 + daysInMonth) {
          cell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
        }
      } else {
        if (C === 2 || C === 4 || C === 6) cell.alignment.horizontal = 'left';

        if (C === totalCols - 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF78a664' } };
        else if (C === totalCols - 3) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9fc5e8' } };
        else if (C === totalCols - 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF45818e' } };
        else if (C === totalCols - 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFa4c2f4' } };
        else if (C === totalCols) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF75b4d8' } };
        else if (C >= 8 && C < 8 + daysInMonth) {
          if (val === 'BD' || val === 'B') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFef4444' } }; cell.font.color = { argb: 'FFFFFFFF' }; cell.font.bold = true; }
          else if (val === 'H') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf59e0b' } }; cell.font.color = { argb: 'FFFFFFFF' }; cell.font.bold = true; }
          else if (val === 'ID') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfde047' } }; cell.font.color = { argb: 'FF854d0e' }; cell.font.bold = true; }
          else if (val === 'NP') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF86efac' } }; cell.font.color = { argb: 'FF14532d' }; cell.font.bold = true; }
          else if (['NR', 'NW', 'NS'].includes(val)) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe9a4a4' } }; cell.font.color = { argb: 'FF000000' }; cell.font.bold = true; }
          else if (val === 'AB') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10b981' } }; cell.font.color = { argb: 'FFFFFFFF' }; cell.font.bold = true; }
          else if (val === 'DC') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0ea5e9' } }; cell.font.color = { argb: 'FFFFFFFF' }; cell.font.bold = true; }
          else if (val === 'SC') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8b5cf6' } }; cell.font.color = { argb: 'FFFFFFFF' }; cell.font.bold = true; }
          else if (val === 'R') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf97316' } }; cell.font.color = { argb: 'FFFFFFFF' }; cell.font.bold = true; }
          else if (getDayName(C - 7, m, y) === 'Fri') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } }; }
        }
      }
    }
  }
}

async function exportCurrentExcel() {
  const table = document.getElementById("dashboardTable");
  if (!table) {
    alert("Please fetch data first.");
    return;
  }

  const btn = document.getElementById("btnExport");
  const loader = document.getElementById("exportLoader");
  btn.disabled = true;
  loader.style.display = "inline-block";
  document.getElementById("exportMenu").style.display = "none";

  try {
    const m = document.getElementById("selMonth").value;
    const y = document.getElementById("selYear").value;
    
    const wb = new ExcelJS.Workbook();
    await buildWorksheetFromTable(wb, table, m, y);
    
    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Haka_Timesheet_${m}_${y}.xlsx`);
  } catch (err) {
    alert("Export failed: " + err.message);
  } finally {
    btn.disabled = false;
    loader.style.display = "none";
  }
}

function openBatchModal() {
  document.getElementById("exportMenu").style.display = "none";
  document.getElementById("batchModal").style.display = "flex";
}

function closeBatchModal() {
  document.getElementById("batchModal").style.display = "none";
}

async function startBatchExport() {
  const fM = document.getElementById("batchFromMonth").value;
  const fY = parseInt(document.getElementById("batchFromYear").value);
  const tM = document.getElementById("batchToMonth").value;
  const tY = parseInt(document.getElementById("batchToYear").value);

  let startDate = new Date(fY, months.indexOf(fM), 1);
  let endDate = new Date(tY, months.indexOf(tM), 1);

  if (startDate > endDate) {
    alert("From Date cannot be after To Date.");
    return;
  }

  const btn = document.getElementById("btnStartBatch");
  btn.disabled = true;
  btn.innerHTML = '<span class="loader" id="batchLoader" style="display:inline-block;"></span> Generating...';

  const wb = new ExcelJS.Workbook();
  let current = new Date(startDate);
  let hiddenDiv = document.createElement("div");
  hiddenDiv.style.display = "none";
  document.body.appendChild(hiddenDiv);

  try {
    await ensureSpecialRules();
    let hasData = false;

    while (current <= endDate) {
      let curM = months[current.getMonth()];
      let curY = current.getFullYear();

      btn.innerHTML = `<span class="loader" id="batchLoader" style="display:inline-block;"></span> Fetching ${curM}...`;

      const res = await fetch("/timesheet/api/public/view-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: curM,
          year: curY,
          filterType: "All",
          filterValue: "",
        }),
      });
      const data = await res.json();

      if (data.success && data.vehicles.length > 0) {
        hasData = true;
        hiddenDiv.innerHTML = getTableHTMLString(data, curM, curY, false, "hiddenExportTable");
        const table = hiddenDiv.querySelector("table");
        await buildWorksheetFromTable(wb, table, curM, curY);
      }
      current.setMonth(current.getMonth() + 1);
    }

    if (hasData) {
      const buffer = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `Haka_Timesheet_Batch_${fM}${fY}_to_${tM}${tY}.xlsx`);
      closeBatchModal();
    } else {
      alert("No records found in the selected date range.");
    }
  } catch (e) {
    alert("Error during batch export: " + e.message);
  } finally {
    document.body.removeChild(hiddenDiv);
    btn.disabled = false;
    btn.innerHTML = "Generate Excel Book";
  }
}