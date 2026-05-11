const token = localStorage.getItem("timesheetToken");
if (!token) window.location.href = "index.html";

let userRole = "";
const userStr = localStorage.getItem("timesheetUser");
if (userStr) {
  const u = JSON.parse(userStr);
  userRole = u.role;
  document.getElementById("userInfo").innerText = `${u.username} (${u.role})`;
  if (userRole === "Super Admin" || userRole === "Editor")
    document.getElementById("adminTools").style.display = "flex";
}

// XSS Protection Helper
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(
    /[&<>'"]/g,
    (tag) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[tag] || tag,
  );
}

let dynamicCols = [];
let tableData = [];
let activeFilters = {};
let hiddenColumns = JSON.parse(localStorage.getItem("dbHiddenCols")) || [];
let customColOrder = [];

// 🟢 Status columns removed from default map, Field CO & Site CO added
const colLabels = {
  vehicle_type: "Vehicle Type",
  site_rate: "Rate",
  plate_no: "Plate No (Key)",
  site_start_date: "Site Start Date",
  site_name: "Site Name",
  site_end_date: "Site End Date",
  site_old_veh: "Old Vehicle No",
  site_new_veh: "New Vehicle No",
  driver_name: "Driver Name",
  driver_end_date: "Last Day",
  vat: "VAT (Yes/No)",
  field_co: "Field CO",
  site_co: "Site CO",
};

let alertResolver, promptResolver, confirmResolver;
function customAlert(title, msg) {
  return new Promise((res) => {
    alertResolver = res;
    document.getElementById("alertTitle").innerText = title;
    document.getElementById("alertMessage").innerText = msg;
    document.getElementById("alertTitle").style.color =
      title === "Error"
        ? "#dc3545"
        : title === "Warning"
          ? "#f59e0b"
          : "#0f2027";
    document.getElementById("customAlertModal").style.display = "flex";
  });
}
function resolveAlert() {
  document.getElementById("customAlertModal").style.display = "none";
  if (alertResolver) alertResolver();
}
function customPrompt(title, msg) {
  return new Promise((res) => {
    promptResolver = res;
    document.getElementById("promptTitle").innerText = title;
    document.getElementById("promptMessage").innerText = msg;
    document.getElementById("promptInput").value = "";
    document.getElementById("customPromptModal").style.display = "flex";
    setTimeout(() => document.getElementById("promptInput").focus(), 100);
  });
}
function resolvePrompt(val) {
  document.getElementById("customPromptModal").style.display = "none";
  if (promptResolver) promptResolver(val);
}
function customConfirm(msg) {
  return new Promise((res) => {
    confirmResolver = res;
    document.getElementById("confirmMessage").innerText = msg;
    document.getElementById("customConfirmModal").style.display = "flex";
  });
}
function resolveConfirm(val) {
  document.getElementById("customConfirmModal").style.display = "none";
  if (confirmResolver) confirmResolver(val);
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

function toggleUserMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("userDropdownMenu");
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

function executeLogout() {
  localStorage.removeItem("timesheetToken");
  window.location.reload();
}

// 🟢 Fetch & Open Audit Logs
async function openAuditLogModal() {
  document.getElementById("userDropdownMenu").style.display = "none";
  document.getElementById("auditLogModal").style.display = "flex";
  document.getElementById("auditLogBody").innerHTML =
    '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

  try {
    const res = await safeFetch("/timesheet/api/audit-logs", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.success) {
      let html = "";
      res.logs.forEach((l) => {
        let d = new Date(l.timestamp).toLocaleString();
        html += `<tr>
                            <td>${d}</td>
                            <td style="font-weight:600; color:#0d6efd;">${escapeHTML(l.user_info)}</td>
                            <td><span class="status-badge" style="background:#e2e8f0; color:#333;">${escapeHTML(l.action_type)}</span></td>
                            <td>${escapeHTML(l.details)}</td>
                         </tr>`;
      });
      document.getElementById("auditLogBody").innerHTML =
        html ||
        '<tr><td colspan="4" style="text-align:center;">No logs found.</td></tr>';
    } else {
      document.getElementById("auditLogBody").innerHTML =
        `<tr><td colspan="4" style="text-align:center; color:red;">${res.message}</td></tr>`;
    }
  } catch (e) {
    document.getElementById("auditLogBody").innerHTML =
      `<tr><td colspan="4" style="text-align:center; color:red;">Failed to fetch logs.</td></tr>`;
  }
}

document.addEventListener("click", function (e) {
  if (
    !e.target.closest("#headerContextMenu") &&
    !e.target.closest("#filterPopup") &&
    !e.target.closest("th")
  ) {
    document.getElementById("headerContextMenu").style.display = "none";
    document.getElementById("filterPopup").style.display = "none";
  }
  if (
    !e.target.closest("#rowContextMenu") &&
    !e.target.closest(".primary-col")
  ) {
    document.getElementById("rowContextMenu").style.display = "none";
  }
  if (
    !e.target.closest(".user-profile-container") &&
    !e.target.closest("#auditLogModal")
  ) {
    document.getElementById("userDropdownMenu").style.display = "none";
  }
});

// Arrow Key Navigation
document.addEventListener("keydown", function (e) {
  const target = e.target;
  if (!target.closest("#dbBody")) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
    let dx = 0,
      dy = 0;
    if (e.key === "ArrowUp") dy = -1;
    else if (e.key === "ArrowDown") dy = 1;
    else if (e.key === "ArrowLeft") dx = -1;
    else if (e.key === "ArrowRight") dx = 1;
    else return;

    if (dy !== 0) {
      e.preventDefault();
    } else if (dx !== 0) {
      if (
        target.tagName === "INPUT" &&
        (target.type === "text" || target.type === "number")
      ) {
        if (dx === -1 && target.selectionStart > 0) return;
        if (dx === 1 && target.selectionEnd < target.value.length) return;
      }
    }
    const currentTd = target.closest("td");
    if (!currentTd) return;
    const currentTr = currentTd.closest("tr");
    const allTrs = Array.from(document.querySelectorAll("#dbBody tr")).filter(
      (tr) => tr.style.display !== "none",
    );
    const currentTrIndex = allTrs.indexOf(currentTr);
    const allTds = Array.from(currentTr.children);
    const currentTdIndex = allTds.indexOf(currentTd);

    let nextTrIndex = currentTrIndex + dy;
    let nextTdIndex = currentTdIndex + dx;

    if (
      nextTrIndex >= 0 &&
      nextTrIndex < allTrs.length &&
      nextTdIndex >= 0 &&
      nextTdIndex < allTds.length
    ) {
      let nextTd = allTrs[nextTrIndex].children[nextTdIndex];
      let nextInput = nextTd.querySelector(
        "input:not([readonly]), select, textarea:not([readonly])",
      );
      while (!nextInput && dx !== 0) {
        nextTdIndex += dx;
        if (nextTdIndex < 0 || nextTdIndex >= allTds.length) break;
        nextTd = allTrs[nextTrIndex].children[nextTdIndex];
        nextInput = nextTd.querySelector(
          "input:not([readonly]), select, textarea:not([readonly])",
        );
      }
      if (nextInput) {
        e.preventDefault();
        nextInput.focus();
        if (
          nextInput.tagName === "INPUT" &&
          (nextInput.type === "text" || nextInput.type === "number")
        )
          nextInput.select();
      }
    }
  }
});

let activeHeaderCol = "";
let activeRowPlate = "";

function openHeaderMenu(e, col) {
  e.preventDefault();
  activeHeaderCol = col;
  document.getElementById("filterPopup").style.display = "none";
  const menu = document.getElementById("headerContextMenu");
  menu.style.display = "flex";
  menu.style.left = e.pageX + "px";
  menu.style.top = e.pageY + "px";

  const unDeletable = [
    "plate_no",
    "site_start_date",
    "site_end_date",
    "driver_end_date",
    "site_rate",
    "site_old_veh",
    "site_new_veh",
    "field_co",
    "site_co",
  ];
  if (userRole !== "Super Admin" || unDeletable.includes(col)) {
    document.getElementById("hcm-delete").style.display = "none";
    document.getElementById("hcm-add-r").style.display = "none";
    document.getElementById("hcm-add-l").style.display = "none";
    if (col === "plate_no" && userRole === "Super Admin")
      document.getElementById("hcm-add-r").style.display = "block";
  } else {
    document.getElementById("hcm-delete").style.display = "block";
    document.getElementById("hcm-add-r").style.display = "block";
    document.getElementById("hcm-add-l").style.display = "block";
  }
}

function openRowMenu(e, plate) {
  e.preventDefault();
  activeRowPlate = plate;
  const menu = document.getElementById("rowContextMenu");
  menu.style.display = "flex";
  menu.style.left = e.pageX + "px";
  menu.style.top = e.pageY + "px";
  document.getElementById("rcm-delete").style.display =
    userRole === "Super Admin" || userRole === "Editor" ? "block" : "none";
}

function syncColumnOrder() {
  let defaultCols = [
    "site_rate",
    "plate_no",
    "site_start_date",
    "site_name",
    "site_end_date",
    "site_old_veh",
    "site_new_veh",
    "field_co",
    "site_co",
    "driver_name",
    "driver_end_date",
  ];
  if (dynamicCols.includes("vehicle_type")) defaultCols.unshift("vehicle_type");
  if (dynamicCols.includes("vat")) defaultCols.push("vat");

  dynamicCols.forEach((c) => {
    if (
      ![
        "vehicle_type",
        "site_name",
        "driver_name",
        "rate",
        "vat",
        "field_co",
        "site_co",
      ].includes(c)
    ) {
      defaultCols.push(c);
    }
  });

  let savedOrder = JSON.parse(localStorage.getItem("dbColOrderPref")) || [];
  savedOrder = savedOrder.filter((c) => defaultCols.includes(c));
  defaultCols.forEach((c) => {
    if (!savedOrder.includes(c)) savedOrder.push(c);
  });

  customColOrder = savedOrder;
  localStorage.setItem("dbColOrderPref", JSON.stringify(customColOrder));
}

function hideCurrentColumn() {
  if (activeHeaderCol === "plate_no")
    return customAlert("Warning", "Cannot hide the Plate No column.");
  if (!hiddenColumns.includes(activeHeaderCol)) {
    hiddenColumns.push(activeHeaderCol);
    saveAndApplyHidden();
  }
  document.getElementById("headerContextMenu").style.display = "none";
}
function saveAndApplyHidden() {
  localStorage.setItem("dbHiddenCols", JSON.stringify(hiddenColumns));
  renderTable();
}

function openColumnAlter() {
  const list = document.getElementById("columnChecklist");
  list.innerHTML = "";
  customColOrder.forEach((colId) => {
    const isChecked = !hiddenColumns.includes(colId);
    const randId = "alter_" + colId;
    const labelText =
      colLabels[colId] || colId.replace(/_/g, " ").toUpperCase();
    list.insertAdjacentHTML(
      "beforeend",
      `
            <div class="column-item" draggable="true" data-id="${colId}">
                <span class="drag-handle" title="Drag to reorder">☰</span>
                <input type="checkbox" id="${randId}" value="${colId}" ${isChecked ? "checked" : ""} onchange="toggleSingleCol('${colId}', this.checked)">
                <label for="${randId}" style="flex:1;">${escapeHTML(labelText)}</label>
            </div>
        `,
    );
  });
  document.getElementById("columnAlterModal").style.display = "flex";
  setupDragAndDrop();
}

function toggleSingleCol(colId, isVisible) {
  if (isVisible) hiddenColumns = hiddenColumns.filter((c) => c !== colId);
  else {
    if (colId === "plate_no") {
      document.getElementById("alter_plate_no").checked = true;
      return customAlert("Warning", "Cannot hide Plate No.");
    }
    if (!hiddenColumns.includes(colId)) hiddenColumns.push(colId);
  }
  saveAndApplyHidden();
}

function bulkToggleColumns(showAll) {
  if (showAll) hiddenColumns = [];
  else {
    const checkboxes = document.querySelectorAll("#columnChecklist input");
    hiddenColumns = Array.from(checkboxes)
      .map((cb) => cb.value)
      .filter((v) => v !== "plate_no");
  }
  saveAndApplyHidden();
  openColumnAlter();
}

function setupDragAndDrop() {
  const list = document.getElementById("columnChecklist");
  let draggedItem = null;
  list.addEventListener("dragstart", (e) => {
    if (e.target.classList.contains("column-item")) {
      draggedItem = e.target;
      setTimeout(() => draggedItem.classList.add("dragging"), 0);
    }
  });
  list.addEventListener("dragend", (e) => {
    if (draggedItem) {
      draggedItem.classList.remove("dragging");
      draggedItem = null;
      saveColumnOrderFromUI();
    }
  });
  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(list, e.clientY);
    const currentObj = document.querySelector(".dragging");
    if (currentObj) {
      if (afterElement == null) list.appendChild(currentObj);
      else list.insertBefore(currentObj, afterElement);
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".column-item:not(.dragging)"),
  ];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset)
        return { offset: offset, element: child };
      else return closest;
    },
    { offset: Number.NEGATIVE_INFINITY },
  ).element;
}

function saveColumnOrderFromUI() {
  const items = document.querySelectorAll("#columnChecklist .column-item");
  let newOrder = [];
  items.forEach((item) => {
    newOrder.push(item.getAttribute("data-id"));
  });
  localStorage.setItem("dbColOrderPref", JSON.stringify(newOrder));
  customColOrder = newOrder;
  renderTable();
}

function openAdvancedFilter(e) {
  e.stopPropagation();
  document.getElementById("headerContextMenu").style.display = "none";
  const popup = document.getElementById("filterPopup");
  popup.style.display = "flex";
  let left = e.pageX;
  let top = e.pageY;
  if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
  popup.style.left = left + "px";
  popup.style.top = top + "px";
  document.getElementById("filterSearchInput").value = "";

  const uniqueValues = new Set();
  tableData.forEach((row) => {
    let passesOtherFilters = true;
    for (const colName in activeFilters) {
      if (colName === activeHeaderCol) continue;
      const selectedVals = activeFilters[colName];
      let cellVal = row[colName] ? String(row[colName]).trim() : "";
      if (cellVal === "") cellVal = "(Blanks)";
      if (!selectedVals.includes(cellVal)) {
        passesOtherFilters = false;
        break;
      }
    }
    if (passesOtherFilters) {
      let val = row[activeHeaderCol];
      if (val === null || val === undefined || String(val).trim() === "")
        uniqueValues.add("(Blanks)");
      else uniqueValues.add(String(val).trim());
    }
  });

  const sortedValues = Array.from(uniqueValues).sort((a, b) => {
    if (a === "(Blanks)") return -1;
    if (b === "(Blanks)") return 1;
    return a.localeCompare(b);
  });
  const listContainer = document.getElementById("filterList");
  listContainer.innerHTML = "";
  let isAllSelected =
    !activeFilters[activeHeaderCol] ||
    activeFilters[activeHeaderCol].length === sortedValues.length;

  listContainer.innerHTML += `<div class="filter-item" style="font-weight:bold; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;"><input type="checkbox" id="filterSelectAll" onchange="toggleAllFilters(this)" ${isAllSelected ? "checked" : ""}><label for="filterSelectAll" style="font-size: 13px;">(Select All Visible)</label></div>`;
  sortedValues.forEach((val) => {
    let isChecked =
      isAllSelected ||
      (activeFilters[activeHeaderCol] &&
        activeFilters[activeHeaderCol].includes(val));
    let safeVal = escapeHTML(val);
    let randId = "flt_" + Math.random().toString(36).substr(2, 9);
    listContainer.innerHTML += `<div class="filter-item data-item"><input type="checkbox" id="${randId}" class="filter-checkbox" value="${safeVal}" ${isChecked ? "checked" : ""} onchange="checkSelectAll()"><label for="${randId}" title="${safeVal}">${safeVal}</label></div>`;
  });
}

function searchFilterList() {
  const term = document.getElementById("filterSearchInput").value.toLowerCase();
  const items = document.querySelectorAll("#filterList .data-item");
  items.forEach((item) => {
    const label = item.querySelector("label").innerText.toLowerCase();
    item.style.display = label.includes(term) ? "flex" : "none";
  });
}

function toggleAllFilters(source) {
  const checkboxes = document.querySelectorAll("#filterList .filter-checkbox");
  checkboxes.forEach((cb) => {
    if (cb.parentElement.style.display !== "none") cb.checked = source.checked;
  });
}
function checkSelectAll() {
  const total = document.querySelectorAll(
    '#filterList .filter-checkbox:not([style*="display: none"])',
  ).length;
  const checked = document.querySelectorAll(
    "#filterList .filter-checkbox:checked",
  ).length;
  document.getElementById("filterSelectAll").checked =
    total === checked && total > 0;
}
function applyAdvancedFilter() {
  const checkboxes = document.querySelectorAll("#filterList .filter-checkbox");
  const selectedValues = [];
  let allSelected = true;
  checkboxes.forEach((cb) => {
    if (cb.checked) selectedValues.push(cb.value);
    else allSelected = false;
  });
  if (allSelected) delete activeFilters[activeHeaderCol];
  else activeFilters[activeHeaderCol] = selectedValues;
  document.getElementById("filterPopup").style.display = "none";
  renderTable();
}
function clearFilter() {
  delete activeFilters[activeHeaderCol];
  document.getElementById("filterPopup").style.display = "none";
  renderTable();
}

function applyGridFilters() {
  const globalSearch = document
    .getElementById("searchInput")
    .value.toUpperCase();
  const trs = document.getElementById("dbBody").getElementsByTagName("tr");
  if (trs.length === 1 && trs[0].cells.length === 1) return;

  tableData.forEach((row, index) => {
    let showRow = true;
    for (const colName in activeFilters) {
      const selectedVals = activeFilters[colName];
      if (selectedVals.length === 0) continue;
      let cellVal = row[colName] ? String(row[colName]).trim() : "";
      if (cellVal === "") cellVal = "(Blanks)";
      if (!selectedVals.includes(cellVal)) {
        showRow = false;
        break;
      }
    }
    if (showRow && globalSearch !== "") {
      let rowText = Object.values(row)
        .map((v) => (v ? String(v).toUpperCase() : ""))
        .join(" ");
      if (!rowText.includes(globalSearch)) {
        showRow = false;
      }
    }
    if (trs[index]) {
      trs[index].style.display = showRow ? "" : "none";
    }
  });
}

async function addColumnRelative(position) {
  const colName = await customPrompt(
    `Add Column ${position.toUpperCase()}`,
    "Enter new column name:",
  );
  if (!colName) return;
  const cleanCol = colName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const data = await safeFetch("/timesheet/api/db/add-column", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ col_name: colName }),
  });
  if (data.success) {
    dynamicCols.push(cleanCol);
    const relativeIdx = customColOrder.indexOf(activeHeaderCol);
    if (relativeIdx !== -1) {
      if (position === "left") customColOrder.splice(relativeIdx, 0, cleanCol);
      else customColOrder.splice(relativeIdx + 1, 0, cleanCol);
    } else customColOrder.push(cleanCol);
    localStorage.setItem("dbColOrderPref", JSON.stringify(customColOrder));
    initDB();
  } else {
    customAlert("Error", data.message);
  }
}

function headerDelete() {
  manageColumn(activeHeaderCol);
}
function rowDelete() {
  deleteRow(activeRowPlate);
}

async function rowAbout() {
  const plate = activeRowPlate;
  document.getElementById("abtPlateNo").innerText = plate;
  let vObj = tableData.find((x) => x.plate_no === plate);
  let infoHtml = "";
  if (vObj) {
    dynamicCols.forEach((k) => {
      if (vObj[k] && vObj[k] !== "null") {
        let dK = k.replace(/_/g, " ").toUpperCase();
        infoHtml += `<div style="display:flex; border-bottom: 1px solid #f1f5f9; padding: 5px 0;"><span style="color:#64748b; font-weight:600; width:130px; flex-shrink:0;">${escapeHTML(dK)}</span><span style="color:#0f2027; font-weight:600; flex:1; word-break: break-word;">: &nbsp;${escapeHTML(vObj[k])}</span></div>`;
      }
    });
  }
  document.getElementById("abtDetails").innerHTML =
    infoHtml || '<div style="color:#888;">No details available.</div>';
  document.getElementById("abtDriverLogs").innerHTML =
    "<tr><td>Loading...</td></tr>";
  document.getElementById("abtSiteLogs").innerHTML =
    "<tr><td>Loading...</td></tr>";
  document.getElementById("aboutModal").style.display = "flex";

  const res = await safeFetch(`/timesheet/api/vehicle-logs?plate=${plate}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (res.success) {
    let dlHtml = "";
    res.drivers.forEach((d) => {
      let badge =
        d.status === "Running"
          ? '<span class="status-badge bg-run">RUN</span>'
          : '<span class="status-badge bg-rel">REL</span>';
      let start = d.work_start_date ? d.work_start_date.split("T")[0] : "-";
      let end = d.work_end_date ? d.work_end_date.split("T")[0] : "-";
      dlHtml += `<tr><td><b>${escapeHTML(d.driver_name)}</b><br><span style="font-size:10px;">${escapeHTML(d.driver_mobile || "")}</span></td><td>${start}</td><td>${end}</td><td>${badge}</td></tr>`;
    });
    document.getElementById("abtDriverLogs").innerHTML =
      res.drivers.length > 0
        ? dlHtml
        : '<tr><td colspan="4" style="color:#888;">No logs found.</td></tr>';

    let slHtml = "";
    res.sites.forEach((s) => {
      let badge =
        s.status === "Running"
          ? '<span class="status-badge bg-run">RUN</span>'
          : s.status === "Replaced"
            ? '<span class="status-badge bg-rep">REP</span>'
            : '<span class="status-badge bg-rel">REL</span>';
      let start = s.work_start_date ? s.work_start_date.split("T")[0] : "-";
      let end = s.work_end_date ? s.work_end_date.split("T")[0] : "-";
      slHtml += `<tr><td><b>${escapeHTML(s.site_name)}</b><br><span style="font-size:10px; color:#000;">Rate: ${escapeHTML(s.rate || "-")}</span></td><td>${start}</td><td>${end}</td><td>${badge}</td></tr>`;
    });
    document.getElementById("abtSiteLogs").innerHTML =
      res.sites.length > 0
        ? slHtml
        : '<tr><td colspan="4" style="color:#888;">No logs found.</td></tr>';
  }
}

async function safeFetch(url, options) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.message);
  }
}

async function initDB() {
  try {
    document.getElementById("errorBanner").style.display = "none";
    const colData = await safeFetch("/timesheet/api/db/columns", {
      headers: { Authorization: "Bearer " + token },
    });
    if (colData.success) {
      dynamicCols = colData.columns;
      syncColumnOrder();
    }

    const [dataJson, logData] = await Promise.all([
      safeFetch("/timesheet/api/db/data", {
        headers: { Authorization: "Bearer " + token },
      }),
      safeFetch("/timesheet/api/all-logs", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);

    if (dataJson.success) {
      let drivers = logData.success ? logData.drivers : [];
      let sites = logData.success ? logData.sites : [];

      tableData = dataJson.data.map((row) => {
        let dLog = drivers.find((d) => d.plate_no === row.plate_no);
        row.current_driver_status = dLog ? dLog.status : "N/A";
        row.latest_driver_log_id = dLog ? dLog.id : null;
        row.driver_start_date =
          dLog && dLog.start_date !== "-" ? dLog.start_date : "";
        row.driver_end_date =
          dLog && dLog.end_date !== "-" ? dLog.end_date : "";

        let sLog = sites.find((s) => s.plate_no === row.plate_no);
        row.current_site_status = sLog ? sLog.status : "N/A";
        row.latest_site_log_id = sLog ? sLog.id : null;
        row.site_start_date =
          sLog && sLog.start_date !== "-" ? sLog.start_date : "";
        row.site_end_date = sLog && sLog.end_date !== "-" ? sLog.end_date : "";

        row.site_rate = sLog && sLog.rate ? sLog.rate : "";
        row.site_old_veh =
          sLog && sLog.old_vehicle_no ? sLog.old_vehicle_no : "";
        row.site_new_veh =
          sLog && sLog.new_vehicle_no ? sLog.new_vehicle_no : "";
        row.field_co =
          sLog && sLog.field_co ? sLog.field_co : row.field_co || "";
        row.site_co = sLog && sLog.site_co ? sLog.site_co : row.site_co || "";

        return row;
      });

      tableData.sort((a, b) => {
        let siteA = (a.site_name || "").toUpperCase();
        let siteB = (b.site_name || "").toUpperCase();
        if (siteA < siteB) return -1;
        if (siteA > siteB) return 1;
        let plateA = (a.plate_no || "").toUpperCase();
        let plateB = (b.plate_no || "").toUpperCase();
        if (plateA < plateB) return -1;
        if (plateA > plateB) return 1;
        return 0;
      });
      renderTable();
    }
  } catch (err) {
    document.getElementById("errorBanner").style.display = "block";
    document.getElementById("errorBanner").innerText =
      "Notice: Database sync failed or refreshing.";
  }
}

async function fastUpdateLog(plate_no, type, field, value, logId) {
  if (!logId) {
    customAlert(
      "Warning",
      "No active log found to update! Please open the log (📝) and create one first.",
    );
    initDB();
    return;
  }
  showStatus("Updating...", "saving");
  try {
    const res = await safeFetch("/timesheet/api/fast-update-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ type, id: logId, plate_no, field, value }),
    });
    if (res.success) {
      showStatus("✓ Saved", "saved");
      initDB();
    } else {
      customAlert("Error", res.message);
      showStatus("Error", "error");
    }
  } catch (e) {
    customAlert("Error", "Network failed");
    showStatus("Error", "error");
  }
}

function renderTable() {
  const thead = document.getElementById("dbHead");
  const tbody = document.getElementById("dbBody");
  const colgroup = document.getElementById("dbColGroup");
  let colgroupHtml = `<col style="width: 50px;">`;
  let headHtml = `<tr><th><div class="col-header" style="justify-content:center; padding-right:10px;"><span>SL</span></div></th>`;

  const addCol = (colId, label, colorStyle = "") => {
    if (hiddenColumns.includes(colId)) return;
    let w = localStorage.getItem(`dbWidth_${colId}`) || "140px";
    colgroupHtml += `<col style="width: ${w};">`;
    let filterIcon = activeFilters[colId]
      ? " <span style='color:#ffc107; font-size:14px;'>⚡</span>"
      : "";
    headHtml += `<th data-col="${colId}" oncontextmenu="openHeaderMenu(event, '${colId}')"><div class="col-header" style="${colorStyle}"><span>${label}${filterIcon}</span></div><div class="resizer"></div></th>`;
  };

  customColOrder.forEach((colId) => {
    if (colId === "vehicle_type") addCol(colId, "VEHICLE TYPE");
    else if (colId === "site_rate")
      addCol(colId, "RATE", "justify-content:center; color:#ffffff;");
    else if (colId === "plate_no") addCol(colId, "PLATE NO (Key)");
    else if (colId === "site_start_date")
      addCol(colId, "SITE START", "justify-content:center; color:#ffffff;");
    else if (colId === "site_name") addCol(colId, "SITE NAME");
    else if (colId === "site_end_date")
      addCol(colId, "SITE END", "justify-content:center; color:#ffffff;");
    else if (colId === "site_old_veh")
      addCol(colId, "OLD", "justify-content:center; color:#f59e0b;");
    else if (colId === "site_new_veh")
      addCol(colId, "NEW", "justify-content:center; color:#3b82f6;");
    else if (colId === "driver_name") addCol(colId, "DRIVER NAME");
    else if (colId === "driver_end_date")
      addCol(colId, "LAST DAY", "justify-content:center; color:#ffffff;");
    else if (colId === "vat")
      addCol(colId, "VAT", "justify-content:center; color:#ffffff;");
    else if (colId === "field_co")
      addCol(colId, "FIELD CO", "justify-content:center; color:#c4b5fd;");
    else if (colId === "site_co")
      addCol(colId, "SITE CO", "justify-content:center; color:#c4b5fd;");
    else addCol(colId, colId.replace(/_/g, " ").toUpperCase());
  });
  headHtml += `</tr>`;
  colgroup.innerHTML = colgroupHtml;
  thead.innerHTML = headHtml;
  tbody.innerHTML = "";
  if (tableData.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="30" style="padding: 20px; text-align:center;">No vehicles found.</td></tr>';
    return;
  }

  tableData.forEach((row, index) => {
    let tr = document.createElement("tr");
    let rowHtml = `<td><div style="text-align:center; font-weight:bold; color:#64748b;">${index + 1}</div></td>`;
    const vDStyle =
      "border:none; padding:4px 8px; font-family:Inter; font-size:12px; width:100%; text-align:center; box-sizing:border-box; background:transparent; color:#333; cursor:pointer;";
    const vTStyle =
      "border:none; padding:5px 10px; font-family:Inter; font-size:13px; width:100%; text-align:center; box-sizing:border-box; background:transparent; color:#333;";

    const addCell = (colId, htmlContent) => {
      if (hiddenColumns.includes(colId)) return;
      rowHtml += `<td>${htmlContent}</td>`;
    };

    customColOrder.forEach((colId) => {
      if (colId === "vehicle_type") {
        addCell(
          colId,
          `<input type="text" style="${vTStyle}" data-plate="${row.plate_no}" data-col="vehicle_type" value="${escapeHTML(row.vehicle_type)}" onblur="updateCell(this)">`,
        );
      } else if (colId === "site_rate") {
        addCell(
          colId,
          `<input type="number" step="0.01" style="${vTStyle} font-weight:bold; color:#000000;" value="${row.site_rate === "null" || !row.site_rate ? "" : escapeHTML(row.site_rate)}" onchange="fastUpdateLog('${row.plate_no}', 'site', 'rate', this.value, ${row.latest_site_log_id})">`,
        );
      } else if (colId === "plate_no") {
        addCell(
          colId,
          `<input type="text" class="primary-col" style="${vTStyle}" value="${escapeHTML(row.plate_no)}" oncontextmenu="openRowMenu(event, '${row.plate_no}')" readonly>`,
        );
      } else if (colId === "site_start_date") {
        let sStartType = row.site_start_date ? "date" : "text";
        addCell(
          colId,
          `<input type="${sStartType}" style="${vDStyle}" value="${escapeHTML(row.site_start_date)}" onfocus="this.type='date'" onblur="if(!this.value) this.type='text'" onchange="fastUpdateLog('${row.plate_no}', 'site', 'start', this.value, ${row.latest_site_log_id})">`,
        );
      } else if (colId === "site_name") {
        addCell(
          colId,
          `<div class="cell-log-wrapper"><input type="text" value="${escapeHTML(row.site_name)}" readonly><div class="cell-log-btn" onclick="openSiteLog(event, '${row.plate_no}')">📝</div></div>`,
        );
      } else if (colId === "site_end_date") {
        if (!row.site_end_date || row.site_end_date === "") {
          addCell(
            colId,
            `<div style="text-align:center; width:100%; padding-top:4px;"><span class="inline-badge" onclick="this.parentElement.innerHTML='<input type=\\'date\\' style=\\'${vDStyle}\\' onblur=\\'fastUpdateLog(&quot;${row.plate_no}&quot;, &quot;site&quot;, &quot;end&quot;, this.value, ${row.latest_site_log_id})\\'>';">RUNNING</span></div>`,
          );
        } else {
          let badgeClass =
            row.current_site_status === "Replaced" ? "bg-rep" : "";
          addCell(
            colId,
            `<div class="date-with-tooltip"><input type="date" style="${vDStyle}" value="${escapeHTML(row.site_end_date)}" onchange="fastUpdateLog('${row.plate_no}', 'site', 'end', this.value, ${row.latest_site_log_id})"><span class="tooltip-text ${badgeClass}">${escapeHTML(row.current_site_status).toUpperCase()}</span></div>`,
          );
        }
      } else if (colId === "driver_name") {
        addCell(
          colId,
          `<div class="cell-log-wrapper"><input type="text" value="${escapeHTML(row.driver_name)}" readonly><div class="cell-log-btn" onclick="openDriverLog(event, '${row.plate_no}')">📝</div></div>`,
        );
      } else if (colId === "driver_end_date") {
        if (!row.driver_end_date || row.driver_end_date === "") {
          addCell(
            colId,
            `<div style="text-align:center; width:100%; padding-top:4px;"><span class="inline-badge" onclick="this.parentElement.innerHTML='<input type=\\'date\\' style=\\'${vDStyle}\\' onblur=\\'fastUpdateLog(&quot;${row.plate_no}&quot;, &quot;driver&quot;, &quot;end&quot;, this.value, ${row.latest_driver_log_id})\\'>';">RUNNING</span></div>`,
          );
        } else {
          addCell(
            colId,
            `<div class="date-with-tooltip"><input type="date" style="${vDStyle}" value="${escapeHTML(row.driver_end_date)}" onchange="fastUpdateLog('${row.plate_no}', 'driver', 'end', this.value, ${row.latest_driver_log_id})"><span class="tooltip-text">${escapeHTML(row.current_driver_status).toUpperCase()}</span></div>`,
          );
        }
      } else if (colId === "site_old_veh") {
        addCell(
          colId,
          `<input type="text" style="${vTStyle} text-transform:uppercase;" value="${row.site_old_veh === "null" || !row.site_old_veh ? "" : escapeHTML(row.site_old_veh)}" onchange="fastUpdateLog('${row.plate_no}', 'site', 'old_veh', this.value, ${row.latest_site_log_id})">`,
        );
      } else if (colId === "site_new_veh") {
        addCell(
          colId,
          `<input type="text" style="${vTStyle} text-transform:uppercase;" value="${row.site_new_veh === "null" || !row.site_new_veh ? "" : escapeHTML(row.site_new_veh)}" onchange="fastUpdateLog('${row.plate_no}', 'site', 'new_veh', this.value, ${row.latest_site_log_id})">`,
        );
      } else if (colId === "field_co") {
        addCell(
          colId,
          `<input type="text" style="${vTStyle} text-transform:capitalize;" value="${row.field_co === "null" || !row.field_co ? "" : escapeHTML(row.field_co)}" onchange="fastUpdateLog('${row.plate_no}', 'site', 'field_co', toTitleCase(this.value), ${row.latest_site_log_id})">`,
        );
      } else if (colId === "site_co") {
        addCell(
          colId,
          `<input type="text" style="${vTStyle} text-transform:capitalize;" value="${row.site_co === "null" || !row.site_co ? "" : escapeHTML(row.site_co)}" onchange="fastUpdateLog('${row.plate_no}', 'site', 'site_co', toTitleCase(this.value), ${row.latest_site_log_id})">`,
        );
      } else if (colId === "vat") {
        let isVatYes =
          String(row.vat || "")
            .trim()
            .toLowerCase() === "yes" ||
          String(row.vat || "")
            .trim()
            .toLowerCase() === "true" ||
          String(row.vat || "").trim() === "15";
        addCell(
          colId,
          `<select data-plate="${row.plate_no}" data-col="vat" onchange="updateCell(this)" style="${vTStyle} cursor:pointer; color:#0d6efd; font-weight:bold;"><option value="No" ${!isVatYes ? "selected" : ""}>No</option><option value="Yes" ${isVatYes ? "selected" : ""}>Yes</option></select>`,
        );
      } else {
        let val = escapeHTML(row[colId] || "");
        if (
          colId.toLowerCase().includes("invoice_info") ||
          colId.toLowerCase() === "invoice info"
        )
          addCell(
            colId,
            `<textarea data-plate="${row.plate_no}" data-col="${colId}" onblur="updateCell(this)" placeholder="..."> ${val} </textarea>`,
          );
        else
          addCell(
            colId,
            `<input type="text" style="${vTStyle}" data-plate="${row.plate_no}" data-col="${colId}" value="${val}" onblur="updateCell(this)">`,
          );
      }
    });
    tr.innerHTML = rowHtml;
    tbody.appendChild(tr);
  });
  initColumnResizer();
  applyGridFilters();
}

function initColumnResizer() {
  const cols = document.querySelectorAll("th");
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
      w = parseInt(window.getComputedStyle(colGroup[index]).width, 10);
      document.addEventListener("mousemove", mouseMoveHandler);
      document.addEventListener("mouseup", mouseUpHandler);
      resizer.classList.add("resizing");
    };
    const mouseMoveHandler = function (e) {
      let dx = e.clientX - x;
      let newWidth = Math.max(50, Math.min(500, w + dx));
      colGroup[index].style.width = `${newWidth}px`;
    };
    const mouseUpHandler = function () {
      resizer.classList.remove("resizing");
      document.removeEventListener("mousemove", mouseMoveHandler);
      document.removeEventListener("mouseup", mouseUpHandler);
      let colName = th.getAttribute("data-col");
      if (colName)
        localStorage.setItem(`dbWidth_${colName}`, colGroup[index].style.width);
    };
    resizer.addEventListener("mousedown", mouseDownHandler);
  });
}

function showStatus(msg, type) {
  const s = document.getElementById("saveStatus");
  s.innerText = msg;
  s.className = `save-indicator status-${type}`;
  if (type === "saved" || type === "error")
    setTimeout(() => {
      s.className = "save-indicator";
    }, 3000);
}

async function updateCell(inputEl) {
  const plate = inputEl.getAttribute("data-plate");
  const col = inputEl.getAttribute("data-col");
  const val = inputEl.value;
  showStatus("Saving...", "saving");
  try {
    const data = await safeFetch("/timesheet/api/db/update-cell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ plate_no: plate, col_name: col, value: val }),
    });
    if (data.success) {
      let r = tableData.find((x) => x.plate_no === plate);
      if (r) r[col] = val;
      showStatus("✓ Saved", "saved");
    } else {
      showStatus("Error", "error");
    }
  } catch (e) {
    showStatus("Error", "error");
  }
}

function deleteRow(plate) {
  customConfirm(`⚠️ WARNING: Permanently delete vehicle ${plate} ?`).then(
    async (sure) => {
      if (!sure) return;
      const data = await safeFetch("/timesheet/api/db/delete-row", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ plate_no: plate }),
      });
      if (data.success) initDB();
    },
  );
}
function manageColumn(colName) {
  customConfirm(
    `Do you want to permanently DELETE column "${colName.toUpperCase()}"? This action cannot be undone.`,
  ).then(async (res) => {
    if (res) {
      const data = await safeFetch("/timesheet/api/db/delete-column", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ col_name: colName }),
      });
      if (data.success) {
        dynamicCols = dynamicCols.filter((c) => c !== colName);
        localStorage.setItem("dbColumnOrder", JSON.stringify(dynamicCols));
        initDB();
      }
    }
  });
}

function openAddVehicleModal() {
  const form = document.getElementById("addVehicleForm");
  form.style.display = "grid";
  form.style.gridTemplateColumns = "repeat(3, 1fr)";
  form.style.gap = "15px";
  form.style.width = "100%";
  let html = `<div class="form-group"><label style="color:#0f2027;">Plate No (Required)</label><input type="text" id="new_plate_no" class="modal-input uppercase-input" style="border-color: #0d6efd; font-weight:bold;"></div>`;
  let hasDriver = dynamicCols.includes("driver_name");
  let hasSite = dynamicCols.includes("site_name");

  if (hasSite) {
    html += `<div style="border: 1px dashed #cbd5e1; padding: 12px; border-radius: 6px; grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; background: #f8fafc;">
                    <div class="form-group"><label style="color:#000000;">Site Name</label><input type="text" id="new_site_name" class="modal-input"></div>
                    <div class="form-group"><label style="color:#000000;">Rate</label><input type="number" step="0.01" id="new_site_rate" class="modal-input"></div>
                    <div class="form-group"><label style="color:#000000;">Site Start Date</label><input type="date" id="new_site_start" class="modal-input"></div>
                 </div>`;
  }
  if (hasDriver) {
    html += `<div style="border: 1px dashed #cbd5e1; padding: 12px; border-radius: 6px; grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; background: #f8fafc;">
                    <div class="form-group"><label style="color:#2563eb;">Driver Name</label><input type="text" id="new_driver_name" class="modal-input"></div>
                    <div class="form-group"><label style="color:#2563eb;">Driver Mobile</label><input type="text" id="new_driver_mobile" class="modal-input"></div>
                    <div class="form-group"><label style="color:#2563eb;">Driver Start Date</label><input type="date" id="new_driver_start" class="modal-input"></div>
                 </div>`;
  }

  dynamicCols.forEach((col) => {
    let safeColName = col.toLowerCase();
    if (
      [
        "driver_name",
        "driver_mobile",
        "site_name",
        "site_rate",
        "rate",
      ].includes(safeColName)
    )
      return;
    let dCol = col.replace(/_/g, " ").toUpperCase();
    if (safeColName.includes("invoice_info") || safeColName === "invoice info")
      html += `<div class="form-group" style="grid-column: 1 / -1;"><label>${escapeHTML(dCol)}</label><textarea id="new_${col}" class="modal-input" style="height: 60px;"></textarea></div>`;
    else
      html += `<div class="form-group"><label>${escapeHTML(dCol)}</label><input type="text" id="new_${col}" class="modal-input"></div>`;
  });

  form.innerHTML = html;
  document.getElementById("addVehicleModal").style.display = "flex";
  setTimeout(() => document.getElementById("new_plate_no").focus(), 100);
}

async function submitNewVehicle() {
  const plate = document
    .getElementById("new_plate_no")
    .value.trim()
    .toUpperCase();
  if (!plate) return customAlert("Warning", "Plate No is required!");
  const btn = document.getElementById("saveNewVehicleBtn");
  btn.disabled = true;
  btn.innerText = "Saving Vehicle...";

  try {
    const addRes = await safeFetch("/timesheet/api/db/add-row", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ plate_no: plate }),
    });
    if (!addRes.success)
      throw new Error(addRes.message || "Failed to create vehicle row.");

    for (let col of dynamicCols) {
      if (
        [
          "driver_name",
          "driver_mobile",
          "site_name",
          "site_rate",
          "rate",
        ].includes(col.toLowerCase())
      )
        continue;
      let el = document.getElementById(`new_${col}`);
      if (el && el.value.trim() !== "") {
        await safeFetch("/timesheet/api/db/update-cell", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            plate_no: plate,
            col_name: col,
            value: el.value.trim(),
          }),
        });
      }
    }

    if (dynamicCols.includes("site_name")) {
      let sName = document.getElementById("new_site_name").value.trim();
      let sRate = document.getElementById("new_site_rate").value.trim();
      let sStart = document.getElementById("new_site_start").value;
      let fCo = document.getElementById("new_field_co")
        ? document.getElementById("new_field_co").value
        : null;
      let sCo = document.getElementById("new_site_co")
        ? document.getElementById("new_site_co").value
        : null;

      if (sName) {
        await safeFetch("/timesheet/api/update-site-log", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            plate_no: plate,
            site_name: sName,
            work_start_date: sStart || null,
            work_end_date: null,
            status: "Running",
            rate: sRate || null,
            old_vehicle_no: null,
            new_vehicle_no: null,
            field_co: fCo,
            site_co: sCo,
          }),
        });
        await safeFetch("/timesheet/api/db/update-cell", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            plate_no: plate,
            col_name: "site_name",
            value: sName,
          }),
        });
      }
    }

    if (dynamicCols.includes("driver_name")) {
      let dName = document.getElementById("new_driver_name").value.trim();
      let dMobEl = document.getElementById("new_driver_mobile");
      let dMob = dMobEl ? dMobEl.value.trim() : "";
      let dStart = document.getElementById("new_driver_start").value;
      if (dName || dMob) {
        await safeFetch("/timesheet/api/update-driver-log", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            plate_no: plate,
            driver_name: dName,
            driver_mobile: dMob,
            work_start_date: dStart || null,
            work_end_date: null,
          }),
        });
        await safeFetch("/timesheet/api/db/update-cell", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            plate_no: plate,
            col_name: "driver_name",
            value: dName,
          }),
        });
        if (dynamicCols.includes("driver_mobile"))
          await safeFetch("/timesheet/api/db/update-cell", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              plate_no: plate,
              col_name: "driver_mobile",
              value: dMob,
            }),
          });
      }
    }
    closeModal("addVehicleModal");
    customAlert("Success", "Vehicle and initial logs created successfully!");
    initDB();
  } catch (e) {
    customAlert("Error", e.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Save Vehicle";
  }
}

function toggleDlEnd() {
  document.getElementById("dlEndGroup").style.display =
    document.getElementById("dlStatus").value === "Released" ? "block" : "none";
}
function toggleSlEnd() {
  const val = document.getElementById("slStatus").value;
  document.getElementById("slEndGroup").style.display =
    val === "Released" || val === "Replaced" ? "block" : "none";
  document.getElementById("slReplaceGroup").style.display =
    val === "Replaced" ? "block" : "none";
}
function closeLogModals() {
  document.getElementById("driverLogModal").style.display = "none";
  document.getElementById("siteLogModal").style.display = "none";
}

function clearDriverForm() {
  document.getElementById("dlId").value = "";
  document.getElementById("dlName").value = "";
  document.getElementById("dlMob").value = "";
  document.getElementById("dlStart").value = "";
  document.getElementById("dlEnd").value = "";
  document.getElementById("dlSaveBtn").innerText = "Save New Log";
  document.getElementById("dlSaveBtn").className = "btn btn-success";
  document.getElementById("dlName").focus();
}
function clearSiteForm() {
  document.getElementById("slId").value = "";
  document.getElementById("slName").value = "";
  document.getElementById("slRate").value = "";
  document.getElementById("slFieldCo").value = "";
  document.getElementById("slSiteCo").value = "";
  document.getElementById("slOldVehicle").value = "";
  document.getElementById("slNewVehicle").value = "";
  document.getElementById("slAsset").value = "";
  document.getElementById("slWorkOrder").value = "";
  document.getElementById("slStart").value = "";
  document.getElementById("slEnd").value = "";
  document.getElementById("slStatus").value = "Running";
  document.getElementById("slSaveBtn").innerText = "Save New Log";
  document.getElementById("slSaveBtn").className = "btn btn-success";
  toggleSlEnd();
  document.getElementById("slName").focus();
}

async function openDriverLog(e, plate) {
  if (!plate) return;
  document.getElementById("dlPlate").innerText = plate;
  clearDriverForm();
  document.getElementById("driverLogModal").style.display = "flex";
  await fetchLogs(plate, "driver");
}
async function openSiteLog(e, plate) {
  if (!plate) return;
  document.getElementById("slPlate").innerText = plate;
  clearSiteForm();
  document.getElementById("siteLogModal").style.display = "flex";
  await fetchLogs(plate, "site");
}

async function fetchLogs(plate, type) {
  const res = await safeFetch(`/timesheet/api/vehicle-logs?plate=${plate}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (res.success) {
    if (type === "driver") {
      let dlHtml =
        '<tr><th style="min-width: 120px;">Driver Name</th><th>Mobile No</th><th>Start Date</th><th>End Date</th><th>Status</th><th style="width: 30px;"></th></tr>';
      res.drivers.forEach((d) => {
        let badge =
          d.status === "Running"
            ? '<span class="status-badge bg-run">RUN</span>'
            : '<span class="status-badge bg-rel">REL</span>';
        let start = d.work_start_date ? d.work_start_date.split("T")[0] : "-";
        let end = d.work_end_date ? d.work_end_date.split("T")[0] : "-";
        let delBtnHtml =
          userRole === "Super Admin" || userRole === "Editor"
            ? `<button class="btn-delete-icon" onclick="deleteLogEntry(event, 'driver', ${d.id}, '${plate}')" title="Delete Log">🗑️</button>`
            : "";
        dlHtml += `<tr style="cursor:pointer;" onclick="editDriverLog(${d.id}, '${escapeHTML(d.driver_name)}', '${escapeHTML(d.driver_mobile)}', '${start}', '${end}', '${d.status}')">
                <td><span style="font-weight:600; color:#0d6efd;">${escapeHTML(d.driver_name)}</span><br><span style="font-size:10px; color:#888;">Tap to edit ✎</span></td>
                <td><span style="font-weight:bold; color:#475569;">${escapeHTML(d.driver_mobile || "-")}</span></td><td>${start}</td><td>${end}</td><td>${badge}</td>
                <td class="action-cell" onclick="event.stopPropagation()">${delBtnHtml}</td></tr>`;
      });
      document.getElementById("dlHistory").innerHTML =
        res.drivers.length > 0
          ? dlHtml
          : '<tr><td colspan="6" style="color:#888;">No driver logs found.</td></tr>';

      let masterRow = tableData.find((x) => x.plate_no === plate);
      let activeD = res.drivers.find((d) => d.status === "Running");
      if (activeD)
        editDriverLog(
          activeD.id,
          activeD.driver_name,
          activeD.driver_mobile,
          activeD.work_start_date ? activeD.work_start_date.split("T")[0] : "",
          activeD.work_end_date ? activeD.work_end_date.split("T")[0] : "",
          activeD.status,
        );
      else if (masterRow && masterRow.driver_name) {
        document.getElementById("dlName").value = masterRow.driver_name;
        document.getElementById("dlMob").value = masterRow.driver_mobile || "";
      }
    }
    if (type === "site") {
      let slHtml =
        '<tr><th style="min-width: 120px;">Site Name</th><th>Rate</th><th>WO No</th><th>Start</th><th>End</th><th>Status</th><th style="width: 30px;"></th></tr>';
      res.sites.forEach((s) => {
        let badge =
          s.status === "Running"
            ? '<span class="status-badge bg-run">RUN</span>'
            : s.status === "Replaced"
              ? '<span class="status-badge bg-rep">REP</span>'
              : '<span class="status-badge bg-rel">REL</span>';
        let start = s.work_start_date ? s.work_start_date.split("T")[0] : "-";
        let end = s.work_end_date ? s.work_end_date.split("T")[0] : "-";
        let delBtnHtml =
          userRole === "Super Admin" || userRole === "Editor"
            ? `<button class="btn-delete-icon" onclick="deleteLogEntry(event, 'site', ${s.id}, '${plate}')" title="Delete Log">🗑️</button>`
            : "";
        slHtml += `<tr style="cursor:pointer;" onclick="editSiteLog(${s.id}, '${escapeHTML(s.site_name)}', '${start}', '${end}', '${s.status}', '${escapeHTML(s.old_vehicle_no)}', '${escapeHTML(s.new_vehicle_no)}', '${escapeHTML(s.asset_code)}', '${escapeHTML(s.work_order_no)}', '${escapeHTML(s.rate)}', '${escapeHTML(s.field_co)}', '${escapeHTML(s.site_co)}')">
                <td><span style="font-weight:600; color:#0d6efd;">${escapeHTML(s.site_name)}</span><br><span style="font-size:10px; color:#888;">Tap to edit ✎</span></td>
                <td><span style="font-weight:bold; color:#000000;">${escapeHTML(s.rate || "-")}</span></td>
                <td><span style="font-weight:bold; color:#475569;">${escapeHTML(s.work_order_no || "-")}</span></td><td>${start}</td><td>${end}</td><td>${badge}</td>
                <td class="action-cell" onclick="event.stopPropagation()">${delBtnHtml}</td></tr>`;
      });
      document.getElementById("slHistory").innerHTML =
        res.sites.length > 0
          ? slHtml
          : '<tr><td colspan="7" style="color:#888;">No site logs found.</td></tr>';

      let masterRow = tableData.find((x) => x.plate_no === plate);
      let activeS = res.sites.find((s) => s.status === "Running");
      if (activeS)
        editSiteLog(
          activeS.id,
          activeS.site_name,
          activeS.work_start_date ? activeS.work_start_date.split("T")[0] : "",
          activeS.work_end_date ? activeS.work_end_date.split("T")[0] : "",
          activeS.status,
          activeS.old_vehicle_no,
          activeS.new_vehicle_no,
          activeS.asset_code,
          activeS.work_order_no,
          activeS.rate,
          activeS.field_co,
          activeS.site_co,
        );
      else if (masterRow && masterRow.site_name) {
        document.getElementById("slName").value = masterRow.site_name;
      }
    }
  }
}

async function deleteLogEntry(event, type, id, plate) {
  event.stopPropagation();
  const isSure = await customConfirm(
    "Are you sure you want to delete this log entry? This action cannot be undone.",
  );
  if (!isSure) return;
  try {
    const res = await safeFetch("/timesheet/api/delete-log-entry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ type: type, id: id }),
    });
    if (res.success) {
      customAlert("Success", "Log entry deleted.");
      await initDB();
      if (type === "driver") {
        clearDriverForm();
        await fetchLogs(plate, "driver");
      } else {
        clearSiteForm();
        await fetchLogs(plate, "site");
      }
    } else {
      customAlert("Error", res.message);
    }
  } catch (e) {
    customAlert("Error", "Failed to delete log.");
  }
}

function editDriverLog(id, name, mob, start, end, status) {
  document.getElementById("dlId").value = id;
  document.getElementById("dlName").value = name;
  document.getElementById("dlMob").value =
    mob !== "null" && mob !== "undefined" ? mob : "";
  document.getElementById("dlStart").value = start !== "-" ? start : "";
  document.getElementById("dlEnd").value = end !== "-" ? end : "";
  document.getElementById("dlSaveBtn").innerText = "Update Log";
  document.getElementById("dlSaveBtn").className = "btn btn-primary";
}

async function saveDriverLog() {
  const payload = {
    id: document.getElementById("dlId").value,
    plate_no: document.getElementById("dlPlate").innerText,
    driver_name: document.getElementById("dlName").value,
    driver_mobile: document.getElementById("dlMob").value,
    work_start_date: document.getElementById("dlStart").value,
    work_end_date: document.getElementById("dlEnd").value,
  };
  await safeFetch("/timesheet/api/update-driver-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });
  let r = tableData.find((x) => x.plate_no === payload.plate_no);
  if (r) {
    r.driver_name = payload.driver_name;
    r.driver_mobile = payload.driver_mobile;
    r.current_driver_status = payload.work_end_date ? "Released" : "Running";
    renderTable();
  }
  fetchLogs(payload.plate_no, "driver");
  clearDriverForm();
}

function editSiteLog(
  id,
  name,
  start,
  end,
  status,
  oldVehicle,
  newVehicle,
  assetCode,
  workOrder,
  rate,
  fieldCo,
  siteCo,
) {
  document.getElementById("slId").value = id;
  document.getElementById("slName").value = name;
  document.getElementById("slRate").value = rate && rate !== "null" ? rate : "";
  document.getElementById("slFieldCo").value =
    fieldCo && fieldCo !== "null" ? fieldCo : "";
  document.getElementById("slSiteCo").value =
    siteCo && siteCo !== "null" ? siteCo : "";
  document.getElementById("slAsset").value =
    assetCode && assetCode !== "null" ? assetCode : "";
  document.getElementById("slWorkOrder").value =
    workOrder && workOrder !== "null" ? workOrder : "";
  document.getElementById("slStart").value = start !== "-" ? start : "";
  document.getElementById("slEnd").value = end !== "-" ? end : "";
  document.getElementById("slStatus").value = status;
  document.getElementById("slOldVehicle").value =
    oldVehicle && oldVehicle !== "null" ? oldVehicle : "";
  document.getElementById("slNewVehicle").value =
    newVehicle && newVehicle !== "null" ? newVehicle : "";
  toggleSlEnd();
  document.getElementById("slSaveBtn").innerText = "Update Log";
  document.getElementById("slSaveBtn").className = "btn btn-primary";
}

function toTitleCase(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function saveSiteLog() {
  const payload = {
    id: document.getElementById("slId").value,
    plate_no: document.getElementById("slPlate").innerText,
    site_name: document.getElementById("slName").value,
    rate: document.getElementById("slRate").value,
    field_co: toTitleCase(document.getElementById("slFieldCo").value),
    site_co: toTitleCase(document.getElementById("slSiteCo").value),
    asset_code: document.getElementById("slAsset").value,
    work_order_no: document.getElementById("slWorkOrder").value,
    work_start_date: document.getElementById("slStart").value,
    work_end_date: document.getElementById("slEnd").value,
    status: document.getElementById("slStatus").value,
    old_vehicle_no: document.getElementById("slOldVehicle").value.toUpperCase(),
    new_vehicle_no: document.getElementById("slNewVehicle").value.toUpperCase(),
  };
  await safeFetch("/timesheet/api/update-site-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(payload),
  });
  let r = tableData.find((x) => x.plate_no === payload.plate_no);
  if (r) {
    r.site_name = payload.site_name;
    r.asset_code = payload.asset_code;
    r.wrk_order_no = payload.work_order_no;
    r.current_site_status = payload.status;
    if (payload.status === "Running") {
      r.site_rate = payload.rate;
      r.field_co = payload.field_co;
      r.site_co = payload.site_co;
    }
    renderTable();
  }
  fetchLogs(payload.plate_no, "site");
  clearSiteForm();
}

function s2ab(s) {
  var buf = new ArrayBuffer(s.length);
  var view = new Uint8Array(buf);
  for (var i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
  return buf;
}

async function exportExcel() {
  var wb = XLSX.utils.book_new();
  let ws_data = [];
  let headers = ["Sl No"];
  customColOrder.forEach((colId) => {
    if (hiddenColumns.includes(colId)) return;
    headers.push(colLabels[colId] || colId.replace(/_/g, " ").toUpperCase());
  });
  ws_data.push(headers);
  tableData.forEach((row, idx) => {
    let rowData = [idx + 1];
    customColOrder.forEach((colId) => {
      if (hiddenColumns.includes(colId)) return;
      if (colId === "vat") {
        let v = String(row.vat || "")
          .trim()
          .toLowerCase();
        rowData.push(v === "yes" || v === "true" || v === "15" ? "Yes" : "No");
      } else {
        rowData.push(row[colId] || "");
      }
    });
    ws_data.push(rowData);
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(ws_data),
    "Master DB",
  );

  const logRes = await safeFetch("/timesheet/api/all-logs", {
    headers: { Authorization: "Bearer " + token },
  });
  if (logRes.success) {
    let dData = [
      ["Plate No", "Driver Name", "Mobile", "Start Date", "End Date", "Status"],
    ];
    logRes.drivers.forEach((d) =>
      dData.push([
        d.plate_no,
        d.driver_name,
        d.driver_mobile,
        d.start_date,
        d.end_date,
        d.status,
      ]),
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(dData),
      "Driver Logs",
    );

    let sData = [
      [
        "Plate No",
        "Site Name",
        "Rate",
        "Field CO",
        "Site CO",
        "Start Date",
        "End Date",
        "Status",
        "Old Vehicle No",
        "New Vehicle No",
        "Asset Code",
        "Work Order No",
      ],
    ];
    logRes.sites.forEach((s) =>
      sData.push([
        s.plate_no,
        s.site_name,
        s.rate || "",
        s.field_co || "",
        s.site_co || "",
        s.start_date,
        s.end_date,
        s.status,
        s.old_vehicle_no || "",
        s.new_vehicle_no || "",
        s.asset_code || "",
        s.work_order_no || "",
      ]),
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sData),
      "Site Logs",
    );
  }

  var wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
  let blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
  let url = window.URL.createObjectURL(blob);
  let a = document.createElement("a");
  document.body.appendChild(a);
  a.href = url;
  a.download = `Master_Vehicles_DB_Logs.xlsx`;
  a.click();
  document.body.removeChild(a);
}

async function importExcel() {
  const file = document.getElementById("excelFile").files[0];
  if (!file) return customAlert("Warning", "Please select an Excel file.");
  customConfirm(
    "⚠️ WARNING: This will SYNC your Master DB AND Logs with the Excel file. Any data not in this file will be deleted. Do you want to proceed?",
  ).then((sure) => {
    if (!sure) return;
    showStatus("Uploading...", "saving");
    const reader = new FileReader();
    reader.onload = async function (e) {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      let masterSheetName = workbook.SheetNames.includes("Master DB")
        ? "Master DB"
        : workbook.SheetNames[0];
      const masterRecords = XLSX.utils.sheet_to_json(
        workbook.Sheets[masterSheetName],
        { raw: false },
      );
      let payload = { records: masterRecords };
      if (workbook.SheetNames.includes("Driver Logs"))
        payload.driverLogs = XLSX.utils.sheet_to_json(
          workbook.Sheets["Driver Logs"],
          { raw: false, defval: "" },
        );
      if (workbook.SheetNames.includes("Site Logs"))
        payload.siteLogs = XLSX.utils.sheet_to_json(
          workbook.Sheets["Site Logs"],
          { raw: false, defval: "" },
        );
      try {
        const resData = await safeFetch("/timesheet/api/db/bulk-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(payload),
        });
        if (resData.success) {
          showStatus("✓ Success", "saved");
          document.getElementById("excelFile").value = "";
          initDB();
        } else {
          customAlert("Error", "Import Failed: " + resData.message);
          showStatus("Error", "error");
        }
      } catch (err) {
        customAlert("Error", "Network Error: " + err.message);
        showStatus("Error", "error");
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

initDB();
