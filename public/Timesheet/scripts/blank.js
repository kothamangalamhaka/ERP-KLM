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
let globalPendingData = [];

// Filtering Variables
let activeFilters = {
  owner: [],
  driver: [],
  site: [],
  vehicleType: [],
  plate: [],
  pendingDates: [],
};
let currentFilterColInfo = { key: "", index: -1 };

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

function initDefaults() {
  const dDate = new Date();
  document.getElementById("selYear").value = dDate.getFullYear();
  document.getElementById("selMonth").value = months[dDate.getMonth()];
  setDefaultDate();
}

function setDefaultDate() {
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;
  const today = new Date();
  if (months[today.getMonth()] === m && today.getFullYear() == parseInt(y)) {
    document.getElementById("upToDate").value = today.getDate();
  } else {
    const lastDay = new Date(y, months.indexOf(m) + 1, 0).getDate();
    document.getElementById("upToDate").value = lastDay;
  }
}

function toggleSearch() {
  const input = document.getElementById("globalSearch");
  input.classList.toggle("active");
  if (input.classList.contains("active")) input.focus();
}

function toggleExportMenu() {
  const menu = document.getElementById("exportMenu");
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

document.addEventListener("click", function (e) {
  if (!e.target.closest(".export-wrapper")) {
    document.getElementById("exportMenu").style.display = "none";
  }
  // Close Custom Filter if clicked outside
  if (
    !e.target.closest(".excel-filter-menu") &&
    !e.target.classList.contains("filter-icon")
  ) {
    closeCustomFilter();
  }
});

// 🟢 EXCEL STYLE FILTER LOGIC
function openFilterMenu(event, key, colIndex) {
  event.stopPropagation();
  currentFilterColInfo = { key, index: colIndex };
  const menu = document.getElementById("excelFilterMenu");
  const listContainer = document.getElementById("filterChecklist");
  listContainer.innerHTML = "";

  const table = document.getElementById("pendingTable");
  if (!table) return;

  let allOptions = new Set();
  const trs = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");

  for (let i = 0; i < trs.length; i++) {
    let row = trs[i];
    let tds = row.getElementsByTagName("td");
    if (tds.length < 8) continue;

    let passesOtherFilters = true;
    for (let filterKey in activeFilters) {
      if (filterKey === key) continue; // ignore current col filter logic
      let allowedValues = activeFilters[filterKey];
      if (allowedValues.length === 0) continue;

      // Updated indices with SN at 0: owner=1, driver=3, site=5, vehicleType=6, plate=7, pending=8
      let cIdx =
        filterKey === "owner"
          ? 1
          : filterKey === "driver"
            ? 3
            : filterKey === "site"
              ? 5
              : filterKey === "vehicleType"
                ? 6
                : filterKey === "plate"
                  ? 7
                  : 8;
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
  menu.style.display = "flex";

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

function getDayName(dayNum, monthStr, year) {
  const dateObj = new Date(`${monthStr} ${dayNum}, ${year}`);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dateObj.getDay()];
}

function parseLogDate(dStr, defaultDate) {
  if (!dStr) return defaultDate;
  let parts = dStr.split("T")[0].split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function isVehicleActiveOnDate(d, sLogs, dLogs) {
  let sActive = false;
  if (!sLogs || sLogs.length === 0) {
    sActive = true;
  } else {
    for (let i = 0; i < sLogs.length; i++) {
      let st = parseLogDate(sLogs[i].work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(sLogs[i].work_end_date, new Date("2099-01-01"));
      if (d >= st && d <= ed) {
        sActive = true;
        break;
      }
    }
  }

  let dActive = false;
  if (!dLogs || dLogs.length === 0) {
    dActive = true;
  } else {
    for (let i = 0; i < dLogs.length; i++) {
      let st = parseLogDate(dLogs[i].work_start_date, new Date("2000-01-01"));
      let ed = parseLogDate(dLogs[i].work_end_date, new Date("2099-01-01"));
      if (d >= st && d <= ed) {
        dActive = true;
        break;
      }
    }
  }
  return sActive && dActive;
}

function applyGridFilters() {
  const globalSearch = document
    .getElementById("globalSearch")
    .value.toUpperCase();

  const table = document.getElementById("pendingTable");
  if (!table) return;
  const trs = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");

  for (let i = 0; i < trs.length; i++) {
    let row = trs[i];
    let tds = row.getElementsByTagName("td");
    if (tds.length < 8) continue;

    let tOwner = tds[1].textContent.trim();
    let tDriver = tds[3].textContent.trim();
    let tSite = tds[5].textContent.trim();
    let tVehicleType = tds[6].textContent.trim(); // Column 6
    let tPlate = tds[7].textContent.trim(); // Column 7
    let tPending = tds[8].textContent.trim();
    let rowText = row.textContent.toUpperCase();

    let matchesFilters = true;

    if (activeFilters.owner.length > 0 && !activeFilters.owner.includes(tOwner))
      matchesFilters = false;
    if (
      activeFilters.driver.length > 0 &&
      !activeFilters.driver.includes(tDriver)
    )
      matchesFilters = false;
    if (activeFilters.site.length > 0 && !activeFilters.site.includes(tSite))
      matchesFilters = false;
    if (
      activeFilters.vehicleType.length > 0 &&
      !activeFilters.vehicleType.includes(tVehicleType)
    )
      matchesFilters = false;
    if (activeFilters.plate.length > 0 && !activeFilters.plate.includes(tPlate))
      matchesFilters = false;
    if (
      activeFilters.pendingDates.length > 0 &&
      !activeFilters.pendingDates.includes(tPending)
    )
      matchesFilters = false;

    let matchesGlobal = globalSearch === "" || rowText.includes(globalSearch);

    if (matchesFilters && matchesGlobal) row.style.display = "";
    else row.style.display = "none";
  }

  // Call count updater after filtering
  updateRecordCount();
}

// 🟢 NEW FUNCTION: Updates Count & reassigns Serial Numbers dynamically
function updateRecordCount() {
  const table = document.getElementById("pendingTable");
  let count = 0;
  let snCounter = 1;
  if (table) {
    const trs = table
      .getElementsByTagName("tbody")[0]
      .getElementsByTagName("tr");
    for (let i = 0; i < trs.length; i++) {
      if (trs[i].style.display !== "none") {
        trs[i].cells[0].textContent = snCounter++; // Auto updates SN based on visible rows
        count++;
      }
    }
  }
  const countDisplay = document.getElementById("recordCountDisplay");
  if (countDisplay) countDisplay.innerText = `Count: ${count}`;
}

async function generatePendingReport() {
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;
  const upToDay = parseInt(document.getElementById("upToDate").value);

  if (!upToDay || upToDay < 1 || upToDay > 31) {
    await customAlert("Warning", "Please enter a valid target date (1-31).");
    return;
  }

  const btn = document.getElementById("btnGen");
  const loader = document.getElementById("genLoader");
  const container = document.getElementById("tableContainer");

  btn.disabled = true;
  loader.style.display = "inline-block";
  container.innerHTML =
    '<div style="color: #64748b; margin-top: 50px; text-align:center;">Analyzing blank cells...</div>';

  try {
    // Reset filters on new fetch
    activeFilters = {
      owner: [],
      driver: [],
      site: [],
      vehicleType: [],
      plate: [],
      pendingDates: [],
    };

    const payload = { month: m, year: y, filterType: "All", filterValue: "" };
    const res = await fetch("/timesheet/api/public/view-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    let pendingList = [];
    let mIdx = months.indexOf(m);
    let monthStart = new Date(y, mIdx, 1);
    let monthEnd = new Date(y, mIdx + 1, 0);

    data.vehicles.forEach((v) => {
      const plate = v.plate_no;
      const vRecords = data.records.filter((r) => r.plate_no === plate);
      const dLogs = data.logs.drivers.filter((l) => l.plate_no === plate);
      const sLogs = data.logs.sites.filter((l) => l.plate_no === plate);

      let activeDrivers = dLogs.filter((d) => {
        let st = parseLogDate(d.work_start_date, new Date("2000-01-01"));
        let ed = parseLogDate(d.work_end_date, new Date("2099-01-01"));
        return st <= monthEnd && ed >= monthStart;
      });

      let activeSites = sLogs.filter((s) => {
        let st = parseLogDate(s.work_start_date, new Date("2000-01-01"));
        let ed = parseLogDate(s.work_end_date, new Date("2099-01-01"));
        return st <= monthEnd && ed >= monthStart;
      });

      let currSite =
        activeSites.map((s) => s.site_name).join(" & ") || v.site_name || "N/A";
      let ownerName = v.owner_name || "N/A";
      let ownerMob = v.owner_mobile || "";
      let currDriver =
        activeDrivers.map((d) => d.driver_name).join(" & ") ||
        v.driver_name ||
        "N/A";
      let driverMob =
        activeDrivers.map((d) => d.driver_mobile).join(" & ") ||
        v.driver_mobile ||
        "";
      let vType = v.vehicle_type || "-";

      let blankDays = [];

      for (let i = 1; i <= upToDay; i++) {
        let dayName = getDayName(i, m, y);
        if (dayName === "Fri") continue;

        let checkDate = new Date(y, mIdx, i);

        if (isVehicleActiveOnDate(checkDate, sLogs, dLogs)) {
          const rec = vRecords.find((r) => parseInt(r.record_date) === i) || {};
          let timeRaw = parseFloat(rec.calc_time) || 0;
          let bdStr = String(rec.bd || "").trim();
          let wsStr = String(rec.wrk_start || "").trim();
          let hsStr = String(rec.hmr_start || "").trim();
          let remStr = String(rec.remark || "").trim();

          if (
            timeRaw === 0 &&
            bdStr === "" &&
            wsStr === "" &&
            hsStr === "" &&
            remStr === ""
          ) {
            blankDays.push(i);
          }
        }
      }

      if (blankDays.length > 0) {
        pendingList.push({
          owner: ownerName,
          ownerMob: ownerMob,
          driver: currDriver,
          driverMob: driverMob,
          site: currSite,
          vehicleType: vType,
          plate: plate,
          pendingDates: blankDays.join(", "),
        });
      }
    });

    globalPendingData = pendingList;

    if (pendingList.length === 0) {
      container.innerHTML =
        '<div style="color: #10b981; margin-top: 50px; text-align:center; font-weight:bold; font-size: 18px;">✅ All clear! No pending log sheets found up to the selected date.</div>';
      return;
    }

    pendingList.sort((a, b) => {
      let ownerA = a.owner || "";
      let ownerB = b.owner || "";
      let siteA = a.site || "";
      let siteB = b.site || "";
      let ownerCmp = ownerA.localeCompare(ownerB);
      if (ownerCmp !== 0) return ownerCmp;
      return siteA.localeCompare(siteB);
    });

    // Setup filter icons classes
    const ownerFilterClass =
      activeFilters.owner && activeFilters.owner.length > 0
        ? "filter-active"
        : "";
    const ownerFilterIcon =
      activeFilters.owner && activeFilters.owner.length > 0
        ? "filter_alt"
        : "filter_list";

    const driverFilterClass =
      activeFilters.driver && activeFilters.driver.length > 0
        ? "filter-active"
        : "";
    const driverFilterIcon =
      activeFilters.driver && activeFilters.driver.length > 0
        ? "filter_alt"
        : "filter_list";

    const siteFilterClass =
      activeFilters.site && activeFilters.site.length > 0
        ? "filter-active"
        : "";
    const siteFilterIcon =
      activeFilters.site && activeFilters.site.length > 0
        ? "filter_alt"
        : "filter_list";

    const vtFilterClass =
      activeFilters.vehicleType && activeFilters.vehicleType.length > 0
        ? "filter-active"
        : "";
    const vtFilterIcon =
      activeFilters.vehicleType && activeFilters.vehicleType.length > 0
        ? "filter_alt"
        : "filter_list";

    const plateFilterClass =
      activeFilters.plate && activeFilters.plate.length > 0
        ? "filter-active"
        : "";
    const plateFilterIcon =
      activeFilters.plate && activeFilters.plate.length > 0
        ? "filter_alt"
        : "filter_list";

    const pendingFilterClass =
      activeFilters.pendingDates && activeFilters.pendingDates.length > 0
        ? "filter-active"
        : "";
    const pendingFilterIcon =
      activeFilters.pendingDates && activeFilters.pendingDates.length > 0
        ? "filter_alt"
        : "filter_list";

    let tbodyHTML = "";
    pendingList.forEach((row) => {
      tbodyHTML += `
            <tr>
                <td class="sn-col"></td> <!-- SN Cell (Auto filled by script) -->
                <td class="wrap-cell">${row.owner}</td>
                <td class="col-hide-export">${row.ownerMob}</td>
                <td class="wrap-cell col-hide-export">${row.driver}</td>
                <td class="col-hide-export">${row.driverMob}</td>
                <td class="wrap-cell">${row.site}</td>
                <td>${row.vehicleType}</td>
                <td class="plate-col">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span>${row.plate}</span>
                        <span style="cursor:pointer; font-size:16px; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" onclick="openLogsheetViewer('${row.plate}')" title="View Logsheet">📁</span>
                    </div>
                </td>
                <td class="pending-dates">${row.pendingDates}</td>
            </tr>
        `;
    });

    container.innerHTML = `
        <table class="ts-table" id="pendingTable">
            <colgroup id="dbColGroup">
                <col style="width: 4%;"> <!-- SN Column Width -->
                <col style="width: 14%;">
                <col class="col-hide-export" style="width: 8%;">
                <col class="col-hide-export" style="width: 14%;">
                <col class="col-hide-export" style="width: 8%;">
                <col style="width: 10%;">
                <col style="width: 10%;">
                <col style="width: 10%;">
                <col style="width: 22%;">
            </colgroup>
            <thead>
                <tr>
                    <th>
                        <div class="col-header-wrap" style="justify-content:center;">SN</div>
                        <div class="resizer"></div>
                    </th>
                    <th>
                        <div class="col-header-wrap">
                            Owner Name
                            <span class="material-icons filter-icon ${ownerFilterClass}" onclick="openFilterMenu(event, 'owner', 1)">${ownerFilterIcon}</span>
                        </div>
                        <div class="resizer"></div>
                    </th>
                    <th class="col-hide-export">
                        <div class="col-header-wrap">Owner Mobile</div>
                        <div class="resizer"></div>
                    </th>
                    <th class="col-hide-export">
                        <div class="col-header-wrap">
                            Driver Name
                            <span class="material-icons filter-icon ${driverFilterClass}" onclick="openFilterMenu(event, 'driver', 3)">${driverFilterIcon}</span>
                        </div>
                        <div class="resizer"></div>
                    </th>
                    <th class="col-hide-export">
                        <div class="col-header-wrap">Driver Mobile</div>
                        <div class="resizer"></div>
                    </th>
                    <th>
                        <div class="col-header-wrap">
                            Site Name
                            <span class="material-icons filter-icon ${siteFilterClass}" onclick="openFilterMenu(event, 'site', 5)">${siteFilterIcon}</span>
                        </div>
                        <div class="resizer"></div>
                    </th>
                    <th>
                        <div class="col-header-wrap">
                            Vehicle Type
                            <span class="material-icons filter-icon ${vtFilterClass}" onclick="openFilterMenu(event, 'vehicleType', 6)">${vtFilterIcon}</span>
                        </div>
                        <div class="resizer"></div>
                    </th>
                    <th>
                        <div class="col-header-wrap">
                            Plate No
                            <span class="material-icons filter-icon ${plateFilterClass}" onclick="openFilterMenu(event, 'plate', 7)">${plateFilterIcon}</span>
                        </div>
                        <div class="resizer"></div>
                    </th>
                    <th>
                        <div class="col-header-wrap">
                            Pending Dates (${m} ${y})
                            <span class="material-icons filter-icon ${pendingFilterClass}" onclick="openFilterMenu(event, 'pendingDates', 8)">${pendingFilterIcon}</span>
                        </div>
                        <div class="resizer"></div>
                    </th>
                </tr>
            </thead>
            <tbody id="dbBody">${tbodyHTML}</tbody>
        </table>
    `;

    initColumnResizer();
    updateRecordCount(); // Initialize count and SN
  } catch (error) {
    container.innerHTML = `<div style="color: #dc3545; margin-top: 50px; text-align:center; font-weight:bold;">Error: ${error.message}</div>`;
  } finally {
    btn.disabled = false;
    loader.style.display = "none";
  }
}

// 🟢 Column Resizer logic
function initColumnResizer() {
  const cols = document.querySelectorAll("#pendingTable th");
  const colGroup = document
    .getElementById("dbColGroup")
    .querySelectorAll("col");

  cols.forEach((th, index) => {
    const resizer = th.querySelector(".resizer");
    if (!resizer) return;

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
      colGroup[index].style.width = `${newWidth}px`;
    };

    const mouseUpHandler = function () {
      resizer.classList.remove("resizing");
      document.removeEventListener("mousemove", mouseMoveHandler);
      document.removeEventListener("mouseup", mouseUpHandler);
    };

    resizer.addEventListener("mousedown", mouseDownHandler);
  });
}

// 🟢 WhatsApp Formatter Logic
function openWhatsAppModal() {
  document.getElementById("waModal").style.display = "flex";
  toggleWAFilter();
}

function closeWAModal() {
  document.getElementById("waModal").style.display = "none";
  document.getElementById("waSearchInput").value = "";
  document.getElementById("waBody").innerHTML =
    '<div style="text-align: center; color: #64748b; font-size: 12px; margin-top:10px;">Please fetch data and make a selection to view records.</div>';
  document.getElementById("waMultiSelectContainer").innerHTML = "";
}

function toggleWAFilter() {
  const type = document.getElementById("waFilterType").value;
  const container = document.getElementById("waMultiSelectContainer");
  const labelEl = document.getElementById("waFilterLabel");

  container.innerHTML = "";
  document.getElementById("waSearchInput").value = "";
  document.getElementById("waBody").innerHTML =
    '<div style="text-align: center; color: #64748b; font-size: 12px; margin-top:10px;">Please fetch data and make a selection to view records.</div>';

  if (globalPendingData.length === 0) return;

  let uniqueOptions = [];

  if (type === "Site Name") {
    labelEl.innerText = "Select Site Name(s)";
    uniqueOptions = [...new Set(globalPendingData.map((item) => item.site))]
      .filter(Boolean)
      .sort();
  } else {
    labelEl.innerText = "Select Owner Name(s)";
    uniqueOptions = [...new Set(globalPendingData.map((item) => item.owner))]
      .filter(Boolean)
      .sort();
  }

  let selectAllDiv = document.createElement("label");
  selectAllDiv.className = "wa-multi-box";
  selectAllDiv.style.borderBottom = "2px solid #cbd5e1";
  selectAllDiv.style.marginBottom = "5px";
  selectAllDiv.innerHTML = `<input type="checkbox" id="waSelectAll" onchange="toggleAllWACheckboxes(this)"> <span style="font-weight:700; color:#0f2027;">(Select All / All Options)</span>`;
  container.appendChild(selectAllDiv);

  uniqueOptions.forEach((opt) => {
    let el = document.createElement("label");
    el.className = "wa-multi-box data-box";
    el.innerHTML = `<input type="checkbox" class="wa-checkbox" value="${opt}" onchange="checkWASelectAll(); renderWATable()"> <span style="color: #333; font-weight: 500;">${opt}</span>`;
    container.appendChild(el);
  });
}

function filterWAMultiSelect() {
  const term = document.getElementById("waSearchInput").value.toLowerCase();
  const items = document.querySelectorAll("#waMultiSelectContainer .data-box");

  items.forEach((item) => {
    const text = item.innerText.toLowerCase();
    item.style.display = text.includes(term) ? "flex" : "none";
  });
}

function toggleAllWACheckboxes(source) {
  const checkboxes = document.querySelectorAll(".wa-checkbox");
  checkboxes.forEach((cb) => {
    if (cb.closest(".data-box").style.display !== "none") {
      cb.checked = source.checked;
    }
  });
  renderWATable();
  checkWASelectAll();
}

function checkWASelectAll() {
  const total = document.querySelectorAll(".wa-checkbox").length;
  const checked = document.querySelectorAll(".wa-checkbox:checked").length;
  document.getElementById("waSelectAll").checked =
    total > 0 && total === checked;
}

// 🟢 WA HTML View logic
function renderWATable() {
  const type = document.getElementById("waFilterType").value;
  const checkedBoxes = document.querySelectorAll(".wa-checkbox:checked");
  const selectedValues = Array.from(checkedBoxes).map((cb) => cb.value);
  const waBody = document.getElementById("waBody");

  if (selectedValues.length === 0) {
    waBody.innerHTML =
      '<div style="text-align: center; color: #64748b; font-size: 12px; margin-top:10px;">Please select at least one option to view records.</div>';
    return;
  }

  let isSiteMode = type === "Site Name";
  let filteredData = globalPendingData.filter((item) => {
    let val = isSiteMode ? item.site : item.owner;
    return selectedValues.includes(val);
  });

  if (filteredData.length === 0) {
    waBody.innerHTML =
      '<div style="text-align: center; color: #dc3545; font-size: 12px; margin-top:10px; font-weight:600;">No pending data for this selection.</div>';
    return;
  }

  let groupedData = {};

  filteredData.forEach((row) => {
    let mobileNo = isSiteMode
      ? row.driverMob || "No Mobile"
      : row.ownerMob || "No Mobile";
    let key = mobileNo.trim();

    if (!groupedData[key]) {
      groupedData[key] = [];
    }

    groupedData[key].push({
      plate: row.plate,
      type: row.vehicleType,
      dates: row.pendingDates,
    });
  });

  let html = `
    <table id="waHTMLTable" class="wa-table">
        <thead>
            <tr>
                <th>${isSiteMode ? "Driver Mobile" : "Owner Mobile"}</th>
                <th>Pending Info</th>
            </tr>
        </thead>
        <tbody>
    `;

  for (const [mobile, vehicles] of Object.entries(groupedData)) {
    let infoBlock = "";
    vehicles.forEach((v, index) => {
      let formattedDates = v.dates.split(", ").join("<br>");
      infoBlock += `<span style="font-weight:700; color:#0f2027;">[${v.type}] ${v.plate}</span><br><span style="color:#4b5563;">${formattedDates}</span>`;
      if (index < vehicles.length - 1) {
        infoBlock += `<br><br>`;
      }
    });

    html += `
        <tr>
            <td class="wa-mobile">${mobile}</td>
            <td class="wa-data">${infoBlock}</td>
        </tr>
        `;
  }

  html += `</tbody></table>`;
  waBody.innerHTML = html;
}

async function copyWAToClipboard() {
  const table = document.getElementById("waHTMLTable");
  if (!table) {
    await customAlert(
      "Warning",
      "No data to copy. Please make a selection first.",
    );
    return;
  }

  const range = document.createRange();
  range.selectNode(table);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    document.execCommand("copy");
    await customAlert(
      "Success",
      "Data copied to clipboard! You can now paste it into WhatsApp or Excel.",
    );
  } catch (err) {
    await customAlert("Error", "Failed to copy text.");
  }
  selection.removeAllRanges();
}

async function exportWAToExcel() {
  const type = document.getElementById("waFilterType").value;
  const checkedBoxes = document.querySelectorAll(".wa-checkbox:checked");
  const selectedValues = Array.from(checkedBoxes).map((cb) => cb.value);

  if (selectedValues.length === 0) {
    await customAlert("Warning", "No data to export.");
    return;
  }

  let isSiteMode = type === "Site Name";
  let filteredData = globalPendingData.filter((item) => {
    let val = isSiteMode ? item.site : item.owner;
    return selectedValues.includes(val);
  });

  if (filteredData.length === 0) return;

  let groupedData = {};
  filteredData.forEach((row) => {
    let mobileNo = isSiteMode
      ? row.driverMob || "No Mobile"
      : row.ownerMob || "No Mobile";
    let key = mobileNo.trim();

    if (!groupedData[key]) {
      groupedData[key] = {
        owner: row.owner,
        site: row.site,
        vehicles: [],
      };
    }
    groupedData[key].vehicles.push({
      plate: row.plate,
      type: row.vehicleType,
      dates: row.pendingDates,
    });
  });

  let aoa = [];
  if (isSiteMode) {
    aoa.push(["Driver Mobile", "Site Name", "Pending Info"]);
  } else {
    aoa.push(["Owner Name", "Owner Mobile", "Site Name", "Pending Info"]);
  }

  for (const [mobile, data] of Object.entries(groupedData)) {
    let infoBlock = "";
    data.vehicles.forEach((v, index) => {
      let formattedDates = v.dates.split(", ").join("\n");
      infoBlock += `${v.plate}\n${formattedDates}`;
      if (index < data.vehicles.length - 1) {
        infoBlock += `\n\n`;
      }
    });

    let mobileCell = { v: String(mobile), t: "s" };

    if (isSiteMode) {
      aoa.push([mobileCell, data.site, infoBlock]);
    } else {
      aoa.push([data.owner, mobileCell, data.site, infoBlock]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  if (isSiteMode) {
    ws["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 30 }];
  } else {
    ws["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 30 }, { wch: 30 }];
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "WhatsApp Data");
  XLSX.writeFile(wb, `Pending_Logs_WA.xlsx`);
}

function toggleLoad(show) {
  document.getElementById("exportLoader").style.display = show
    ? "inline-block"
    : "none";
  document.getElementById("btnExport").disabled = show;
  document.getElementById("exportMenu").style.display = "none";
}

function getFilteredDataForExport() {
  const table = document.getElementById("pendingTable");
  const trs = table.getElementsByTagName("tbody")[0].getElementsByTagName("tr");
  const data = [];
  for (let i = 0; i < trs.length; i++) {
    if (trs[i].style.display !== "none") {
      data.push({
        sn: trs[i].cells[0].innerText.trim(),
        owner: trs[i].cells[1].innerText.trim(),
        ownerMob: trs[i].cells[2].innerText.trim(),
        driver: trs[i].cells[3].innerText.trim(),
        driverMob: trs[i].cells[4].innerText.trim(),
        site: trs[i].cells[5].innerText.trim(),
        vehicleType: trs[i].cells[6].innerText.trim(),
        plate: trs[i].cells[7].innerText.trim(),
        pendingDates: trs[i].cells[8].innerText.trim(),
      });
    }
  }
  return data;
}

async function exportToExcel() {
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;

  const visibleData = getFilteredDataForExport();
  if (visibleData.length === 0) {
    await customAlert("Warning", "No visible data to export.");
    return;
  }

  const formatPendingInfo = (plate, datesStr) => {
    return `${plate}\n${datesStr.split(", ").join("\n")}`;
  };

  let exportGroups = {};

  visibleData.forEach((row) => {
    let dMob = row.driverMob || "No Mobile";
    let oName = row.owner || "Unknown";
    let oMob = row.ownerMob || "Unknown";
    let site = row.site || "Unknown";

    let key = dMob + "|||" + site + "|||" + oName + "|||" + oMob;

    if (!exportGroups[key]) {
      exportGroups[key] = { dMob, site, oName, oMob, info: [] };
    }
    exportGroups[key].info.push(formatPendingInfo(row.plate, row.pendingDates));
  });

  let sheetData = [
    [
      "Driver Mobile",
      "Pending Dates",
      "Site Name",
      "Owner Name",
      "Owner Mobile",
    ],
  ];

  for (let key in exportGroups) {
    let g = exportGroups[key];
    sheetData.push([
      { v: String(g.dMob), t: "s" },
      g.info.join("\n\n"),
      g.site,
      g.oName,
      { v: String(g.oMob), t: "s" },
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  ws["!cols"] = [
    { wch: 20 },
    { wch: 35 },
    { wch: 25 },
    { wch: 30 },
    { wch: 20 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pending Logs");

  XLSX.writeFile(wb, `Pending_Logs_${m}_${y}.xlsx`);
  document.getElementById("exportMenu").style.display = "none";
}

async function exportToPDF() {
  const data = getFilteredDataForExport();
  if (data.length === 0) {
    await customAlert("Warning", "No visible data to export.");
    return;
  }

  toggleLoad(true);
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;

  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.fontFamily = "Arial, sans-serif";

  let html = `
    <h2 style="text-align: center; color: #e67e22; margin-bottom: 20px; font-family: sans-serif;">Pending Logs - ${m} ${y}</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; font-family: sans-serif;">
        <thead>
            <tr>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: center; width: 5%;">SN</th>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 15%;">Owner Name</th>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 15%;">Driver Name</th>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 15%;">Site Name</th>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: center; width: 12%;">Vehicle Type</th>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: center; width: 10%;">Plate No</th>
                <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 28%;">Pending Dates</th>
            </tr>
        </thead>
        <tbody>
`;
  data.forEach((row) => {
    html += `
        <tr>
            <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${row.sn}</td>
            <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal;">${row.owner}</td>
            <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal;">${row.driver}</td>
            <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal;">${row.site}</td>
            <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal; text-align: center;">${row.vehicleType}</td>
            <td style="border: 1px solid #000; padding: 8px; white-space: nowrap; font-weight: bold; text-align: center;">${row.plate}</td>
            <td style="border: 1px solid #000; padding: 8px; color: #b91c1c; word-wrap: break-word; white-space: normal; line-height: 1.5;">${row.pendingDates}</td>
        </tr>
    `;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;

  const opt = {
    margin: 10,
    filename: `Pending_Logs_${m}_${y}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
    pagebreak: { mode: ["css", "legacy"], avoid: "tr" },
  };

  html2pdf()
    .set(opt)
    .from(container)
    .save()
    .then(() => toggleLoad(false));
}

async function createA4Images(groupName, dataSubset, m, y) {
  const ROWS_PER_PAGE = 35;
  let images = [];

  for (let i = 0; i < dataSubset.length; i += ROWS_PER_PAGE) {
    const chunk = dataSubset.slice(i, i + ROWS_PER_PAGE);
    const pageNum = Math.floor(i / ROWS_PER_PAGE) + 1;
    const totalPages = Math.ceil(dataSubset.length / ROWS_PER_PAGE);

    const container = document.createElement("div");
    container.style.width = "1123px";
    container.style.padding = "30px";
    container.style.backgroundColor = "#ffffff";
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.fontFamily = "Arial, sans-serif";

    let title =
      groupName === "All"
        ? `Pending Logs - ${m} ${y}`
        : `${groupName} - Pending Logs (${m} ${y})`;
    if (totalPages > 1) title += ` - Page ${pageNum}`;

    let html = `
        <h2 style="text-align: center; color: #e67e22; margin-bottom: 20px;">${title}</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed;">
            <thead>
                <tr>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: center; width: 5%;">SN</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 15%;">Owner Name</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 15%;">Driver Name</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 15%;">Site Name</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: center; width: 12%;">Vehicle Type</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: center; width: 10%;">Plate No</th>
                    <th style="border: 1px solid #000; padding: 10px; background-color: #e67e22; color: #fff; text-align: left; width: 28%;">Pending Dates</th>
                </tr>
            </thead>
            <tbody>
    `;
    chunk.forEach((row) => {
      html += `
            <tr>
                <td style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">${row.sn}</td>
                <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal;">${row.owner}</td>
                <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal;">${row.driver}</td>
                <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal;">${row.site}</td>
                <td style="border: 1px solid #000; padding: 8px; word-wrap: break-word; white-space: normal; text-align: center;">${row.vehicleType}</td>
                <td style="border: 1px solid #000; padding: 8px; white-space: nowrap; font-weight: bold; text-align: center;">${row.plate}</td>
                <td style="border: 1px solid #000; padding: 8px; color: #b91c1c; word-wrap: break-word; white-space: normal; line-height: 1.5;">${row.pendingDates}</td>
            </tr>
        `;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
    document.body.appendChild(container);

    const canvas = await html2canvas(container, { scale: 2, useCORS: true });
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));

    let fileName =
      groupName === "All"
        ? `Pending_Logs_Page_${pageNum}.png`
        : `${groupName}_Page_${pageNum}.png`;
    images.push({ name: fileName, blob: blob });

    document.body.removeChild(container);
  }
  return images;
}

async function exportToPNGZip(mode) {
  const data = getFilteredDataForExport();
  if (data.length === 0) {
    await customAlert("Warning", "No visible data to export.");
    return;
  }

  toggleLoad(true);
  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;

  try {
    let allImages = [];

    if (mode === "All") {
      allImages = await createA4Images("All", data, m, y);
    } else if (mode === "OwnerSite") {
      const groups = {};
      data.forEach((row) => {
        const siteFirstWord = row.site.split(" ")[0] || "Unknown";
        const key = `${row.owner}_${siteFirstWord}`.replace(
          /[^a-zA-Z0-9_]/g,
          "_",
        );
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      });
      for (const [gName, subset] of Object.entries(groups)) {
        let imgs = await createA4Images(gName, subset, m, y);
        allImages.push(...imgs);
      }
    } else if (mode === "Site") {
      const groups = {};
      data.forEach((row) => {
        const key = row.site.replace(/[^a-zA-Z0-9_ ]/g, "").trim() || "Unknown";
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      });
      for (const [gName, subset] of Object.entries(groups)) {
        let imgs = await createA4Images(gName, subset, m, y);
        allImages.push(...imgs);
      }
    }

    if (allImages.length === 1) {
      saveAs(allImages[0].blob, allImages[0].name);
    } else if (allImages.length > 1) {
      const zip = new JSZip();
      allImages.forEach((img) => zip.file(img.name, img.blob));
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `Pending_Logs_Images_${mode}_${m}_${y}.zip`);
    }
  } catch (e) {
    await customAlert("Error", "Error generating Images: " + e.message);
  } finally {
    toggleLoad(false);
  }
}

initDefaults();
