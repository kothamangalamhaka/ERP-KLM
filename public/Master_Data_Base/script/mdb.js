// ? FONT & THEME LOGIC
function changeFont(fontName) {
  document.body.style.fontFamily = fontName;
  localStorage.setItem("erpFont", fontName);
}

function toggleHighlights() {
  const isOff = document.body.classList.contains("no-highlights");
  if (isOff) {
    document.body.classList.remove("no-highlights");
    localStorage.setItem("erpHighlights", "on");
    showToast("Highlights Enabled", "info");
  } else {
    document.body.classList.add("no-highlights");
    localStorage.setItem("erpHighlights", "off");
    showToast("Highlights Disabled", "info");
  }
}

function initSettings() {
  const savedTheme = localStorage.getItem("erpThemeMaster");
  const gridDiv = document.getElementById("myGrid");

  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    document.getElementById("themeIcon").innerText = "light_mode";
    if (gridDiv) {
      gridDiv.classList.remove("ag-theme-alpine");
      gridDiv.classList.add("ag-theme-alpine-dark");
    }
  } else {
    document.body.classList.remove("dark-mode");
    document.getElementById("themeIcon").innerText = "dark_mode";
    if (gridDiv) {
      gridDiv.classList.remove("ag-theme-alpine-dark");
      gridDiv.classList.add("ag-theme-alpine");
    }
  }

  const savedFont = localStorage.getItem("erpFont");
  if (savedFont) {
    document.body.style.fontFamily = savedFont;
    if (document.getElementById("fontSelector"))
      document.getElementById("fontSelector").value = savedFont;
  }
  if (localStorage.getItem("erpHighlights") === "off") {
    document.body.classList.add("no-highlights");
  }
}

function toggleTheme() {
  const isDark = document.body.classList.contains("dark-mode");
  const gridDiv = document.getElementById("myGrid");

  if (isDark) {
    document.body.classList.remove("dark-mode");
    localStorage.setItem("erpThemeMaster", "light");
    document.getElementById("themeIcon").innerText = "dark_mode";
    if (gridDiv) {
      gridDiv.classList.remove("ag-theme-alpine-dark");
      gridDiv.classList.add("ag-theme-alpine");
    }
  } else {
    document.body.classList.add("dark-mode");
    localStorage.setItem("erpThemeMaster", "dark");
    document.getElementById("themeIcon").innerText = "light_mode";
    if (gridDiv) {
      gridDiv.classList.remove("ag-theme-alpine");
      gridDiv.classList.add("ag-theme-alpine-dark");
    }
  }
}

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

function formatToDDMMMYYYY(dateStr) {
  if (!dateStr) return "";
  dateStr = String(dateStr).trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/i.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    let p = dateStr.split("-");
    let m = parseInt(p[1], 10) - 1;
    return `${p[2]}-${monthNames[m]}-${p[0]}`;
  }
  let p = dateStr.split(/[\/\- \.]/);
  if (p.length === 3) {
    let d, m, y;
    if (p[0].length === 4) {
      y = p[0];
      m = p[1];
      d = p[2];
    } else {
      d = p[0];
      m = p[1];
      y = p[2];
    }
    d = String(d).padStart(2, "0");
    y = y.length === 2 ? "20" + y : y;
    let mInt = isNaN(m)
      ? monthNames.findIndex(
          (mon) => mon.toLowerCase() === m.toLowerCase().substring(0, 3),
        )
      : parseInt(m, 10) - 1;
    if (mInt >= 0 && mInt <= 11) return `${d}-${monthNames[mInt]}-${y}`;
  }
  return dateStr;
}

function convertToInputDate(val) {
  if (!val) return "";
  let p = String(val)
    .trim()
    .split(/[\/\- \.]/);
  if (p.length === 3) {
    let dy = p[0].padStart(2, "0");
    let moStr = p[1].substring(0, 3);
    let moMap = {
      Jan: "01",
      Feb: "02",
      Mar: "03",
      Apr: "04",
      May: "05",
      Jun: "06",
      Jul: "07",
      Aug: "08",
      Sep: "09",
      Oct: "10",
      Nov: "11",
      Dec: "12",
    };
    let mo = moMap[moStr] || String(p[1]).padStart(2, "0");
    let yr = p[2].length === 2 ? "20" + p[2] : p[2];
    return `${yr}-${mo}-${dy}`;
  }
  return "";
}

function parseDateStr(dStr) {
  if (!dStr) return null;
  const p = String(dStr)
    .trim()
    .split(/[\/\- \.]/);
  const mNames = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  if (p.length === 3) {
    let d = parseInt(p[0]),
      m = mNames.indexOf(p[1].toUpperCase().substring(0, 3)),
      y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
    if (!isNaN(d) && m !== -1 && !isNaN(y)) {
      return new Date(Date.UTC(y, m, d, 12, 0, 0));
    }
  }
  return null;
}

let currentUser = JSON.parse(localStorage.getItem("erpUser"));
let token = localStorage.getItem("erpToken");
if (!token || !currentUser) window.location.replace("index.html");

window.addEventListener("pageshow", function (event) {
  if (event.persisted || !localStorage.getItem("erpToken"))
    window.location.replace("index.html");
});

document.getElementById("userInfoDisplay").innerText = currentUser
  ? currentUser.username
  : "";
if (currentUser.role === "Super Admin")
  document.getElementById("btnAlerts").style.display = "inline-flex";

function buildUserMenu() {
  const menu = document.getElementById("userDropdownMenu");
  if (currentUser.role === "Super Admin") {
    menu.insertAdjacentHTML(
      "beforeend",
      `<a href="./admin/index.html" class="user-dropdown-item"><span class="material-icons" style="font-size:16px; color:var(--primary);">admin_panel_settings</span> Admin Console</a><a href="./log/index.html" class="user-dropdown-item"><span class="material-icons" style="font-size:16px; color:#14b8a6;">history</span> View Logs</a><a href="./recycle_bin.html" class="user-dropdown-item"><span class="material-icons" style="font-size:16px; color:var(--danger);">delete_sweep</span> Recycle Bin</a><div class="user-dropdown-divider"></div>`,
    );
  }
  menu.insertAdjacentHTML(
    "beforeend",
    `<button class="user-dropdown-item danger" onclick="performLogout()"><span class="material-icons" style="font-size:16px;">logout</span> Logout</button>`,
  );
}
buildUserMenu();

function performLogout(isAuto = false) {
  if (isAuto) {
    Swal.fire({
      title: "Session Expired",
      text: "You have been logged out due to inactivity.",
      icon: "warning",
      confirmButtonText: "Login Again",
    }).then(() => clearSession());
  } else clearSession();
}

function clearSession() {
  localStorage.removeItem("erpUser");
  localStorage.removeItem("erpToken");
  window.location.href = "index.html";
}

let inactivityTimeout;
function resetInactivityTimer() {
  clearTimeout(inactivityTimeout);
  inactivityTimeout = setTimeout(() => performLogout(true), 30 * 60 * 1000);
}
["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((evt) =>
  document.addEventListener(evt, resetInactivityTimer, true),
);
resetInactivityTimer();

// ==========================================
// ? ACTIVE USERS HEARTBEAT
// ==========================================
let activeUsersList = [];

async function sendHeartbeat() {
  try {
    const res = await fetch("/api/active-users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById("activeUserCount").innerText = data.count;
      activeUsersList = data.users;
    }
    fetch("/api/heartbeat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {}
}

function showActiveUsers(e) {
  e.stopPropagation();
  let userListHtml = activeUsersList
    .map(
      (u) =>
        `<div style="padding: 5px; border-bottom: 1px solid #eee; text-align: left;">🟢 ${u}</div>`,
    )
    .join("");
  Swal.fire({
    title: "Active Users",
    html: `<div style="max-height: 200px; overflow-y: auto;">${userListHtml}</div>`,
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 5000,
  });
}

setInterval(sendHeartbeat, 15000);
sendHeartbeat();

window.addEventListener("beforeunload", function (e) {
  if (saveQueue.length > 0) {
    const confirmationMessage =
      "You have unsaved changes. Are you sure you want to leave? Data may be lost.";
    e.returnValue = confirmationMessage;
    return confirmationMessage;
  }
});

function toggleUserMenu(event) {
  event.stopPropagation();
  document.getElementById("userDropdownMenu").classList.toggle("show");
}

document.addEventListener("click", function (event) {
  const userMenu = document.getElementById("userDropdownMenu");
  if (userMenu && !event.target.closest(".user-dropdown-container"))
    userMenu.classList.remove("show");
  $("#headerContextMenu").fadeOut(100);
  $("#driverContextMenu").fadeOut(100);
});

let cachedHeaders = [],
  cachedAlignments = [],
  cachedColTypes = [],
  cachedColWidths = [];
let globalNextSN = 1,
  saveQueue = [],
  isProcessingQueue = false;
let globalLockedCols = [],
  lastDataHash = "";
let contextColName = "",
  contextDriverDbId = null,
  contextDriverPlate = "",
  contextDriverName = "",
  contextDriverMob = "",
  contextDriverStart = "";

function showToast(msg, color) {
  const t = document.getElementById("toastMsg");
  t.innerText = msg;
  t.style.background =
    color === "error" ? "#ef4444" : color === "info" ? "#0ea5e9" : "#10b981";
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 3000);
}

function updateSyncUI(state) {
  const el = document.getElementById("syncStatus");
  if (state === "saving") {
    el.style.color = "#d97706";
    el.style.background = "#fffbeb";
    el.style.borderColor = "#fde68a";
    el.innerHTML = `<span class="material-icons" style="font-size: 14px; animation: spin 2s linear infinite;">sync</span> Saving (${saveQueue.length})`;
  } else if (state === "live") {
    el.style.color = "#059669";
    el.style.background = "#ecfdf5";
    el.style.borderColor = "#a7f3d0";
    el.innerHTML = `<span class="material-icons" style="font-size: 14px;">cloud_done</span> Up to date`;
  } else if (state === "error") {
    el.style.color = "#dc2626";
    el.style.background = "#fef2f2";
    el.style.borderColor = "#fecaca";
    el.innerHTML = `<span class="material-icons" style="font-size: 14px;">error</span> Sync Error`;
  }
}

function formatPlateNumber(val) {
  if (!val) return "";
  let p = val.toString().toUpperCase().trim(),
    raw = p.replace(/\s+/g, ""),
    jMatch = raw.match(/^J(\d+)$/);
  if (jMatch) return "J" + jMatch[1];
  let normalMatch = raw.match(/^(\d+)([A-Z]+)$/);
  if (normalMatch) return normalMatch[1] + " " + normalMatch[2];
  return p.replace(/\s+/g, " ");
}

async function fetchData(isSilent = false) {
  if (!isSilent) document.getElementById("loader").style.display = "flex";

  try {
    const res = await fetch("/api/get-master-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401 || res.status === 403) return performLogout(true);
    const data = await res.json();
    if (!data.success) return performLogout(true);

    let currentHash =
      JSON.stringify(data.rows) +
      JSON.stringify(data.lockedCols) +
      JSON.stringify(data.alignments) +
      JSON.stringify(data.colTypes) +
      JSON.stringify(data.colWidths);
    if (isSilent && currentHash === lastDataHash) return updateSyncUI("live");
    lastDataHash = currentHash;
    renderTable(data);
  } catch (e) {
    console.error("Fetch Data Error:", e);
    showToast("Connection failed", "error");
  }
}

setInterval(() => {
  if (saveQueue.length === 0 && $(".modal-overlay:visible").length === 0)
    fetchData(true);
}, 15000);
fetchData();

// ==========================================
// ? NEW AG GRID ENGINE (Super Fast)
// ==========================================
let gridOptions = null;
let agGridApi = null;

function renderTable(response) {
  if (saveQueue.length > 0) return;

  document.getElementById("loader").style.display = "none";
  const gridDiv = document.getElementById("myGrid");
  if (gridDiv) gridDiv.style.display = "block";

  if (!response.success) return showToast(response.message, "error");
  updateSyncUI("live");

  cachedHeaders = response.headers;
  globalNextSN = response.nextSN || 1;
  globalLockedCols = response.lockedCols || [];
  cachedColTypes = response.colTypes || [];
  cachedColWidths = response.colWidths || [];

  let columnDefs = response.headers.map((h, i) => {
    let colTypeObj = response.colTypes.find((c) => c.name === h);
    let cType = colTypeObj ? colTypeObj.type : "varchar";
    let isLocked = globalLockedCols.includes(h);
    let widthObj = response.colWidths.find((w) => w.name === h);

    let isSN = h.toUpperCase() === "SN";
    let isDateCol =
      cType === "date" ||
      h.toUpperCase().includes("DATE") ||
      h.toUpperCase().includes("EXPIRE") ||
      h.toUpperCase().includes("EQUIPMENT REACHED") ||
      h.toUpperCase() === "LAST WORKING DAY" ||
      h.toUpperCase() === "WORK START";

    let filterParams = { excelMode: "windows" };

    // Excel പോലെ Date ഫിൽറ്റർ Year > Month > Date ആയി വരാൻ
    if (isDateCol) {
      filterParams = {
        excelMode: "windows",
        treeList: true,
        treeListPathGetter: function (val) {
          if (!val) return [null];
          let parts = String(val).split("-");
          // Format 01-Aug-2024 ആണെങ്കിൽ
          if (parts.length === 3) {
            return [parts[2], parts[1], parts[0]]; // Year > Month > Day
          }
          return [val];
        },
      };
    }

    return {
      field: isSN ? undefined : h,
      headerName: h,
      valueGetter: isSN ? "node.rowIndex + 1" : undefined, // SN എപ്പോഴും 1, 2, 3 ആയി വരാൻ
      width: isSN
        ? 60
        : widthObj
          ? parseInt(widthObj.width.replace("px", ""))
          : 150,
      editable:
        currentUser.role !== "Viewer" &&
        (!isLocked || currentUser.role === "Super Admin") &&
        !isSN,
      sortable: true,
      filter: "agSetColumnFilter", // Excel പോലെയുള്ള Checkbox ഫിൽറ്റർ
      filterParams: filterParams,
      resizable: true,
      cellEditor: isDateCol ? "agDateStringCellEditor" : "agTextCellEditor",
      ...(h.toUpperCase() === "STATUS" && {
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["Running", "Released", "Replaced", "Mobilizing"],
        },
      }),
    };
  });

  let rowData = response.rows.map((row) => {
    let obj = { dbId: row[row.length - 1] };
    response.headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });

  if (agGridApi) {
    agGridApi.setGridOption("rowData", rowData);
    return;
  }

  gridOptions = {
    columnDefs: columnDefs,
    rowData: rowData,
    rowSelection: "multiple",
    undoRedoCellEditing: true,
    undoRedoCellEditingLimit: 50,

    // 👇 പുതിയ ഡിഫോൾട്ട് കോളം സെറ്റിങ്സ്
    defaultColDef: {
      resizable: true,
      sortable: true,
      filter: true,
      minWidth: 120, // എല്ലാ കോളങ്ങൾക്കും കുറഞ്ഞത് ഒരു സ്പേസ് കൊടുക്കുന്നു
      tooltipValueGetter: (params) => params.value, // ഹോവർ ചെയ്യുമ്പോൾ മുഴുവൻ ടെക്സ്റ്റ് കാണാൻ
    },

    // 👇 ഡാറ്റ ലോഡ് ചെയ്തു കഴിയുമ്പോൾ കോളങ്ങൾ ഉള്ളിലെ ടെക്സ്റ്റിനനുസരിച്ച് വികസിക്കാൻ
    onFirstDataRendered: function (params) {
      const allColumnIds = [];
      params.api.getColumns().forEach((column) => {
        allColumnIds.push(column.getId());
      });
      params.api.autoSizeColumns(allColumnIds, false);
    },

    onCellValueChanged: function (params) {
      if (params.oldValue === params.newValue) return;
      let dbId = params.data.dbId;
      let colName = params.colDef.field;
      let newVal = params.newValue;

      if (isBulkEditModeActive) {
        let existingIdx = window.bulkPendingUpdates.findIndex(
          (u) => u.dbId === dbId && u.colName === colName,
        );
        if (existingIdx >= 0)
          window.bulkPendingUpdates[existingIdx].newValue = newVal;
        else
          window.bulkPendingUpdates.push({
            dbId: dbId,
            colName: colName,
            newValue: newVal,
          });
      } else {
        saveQueue.push({ dbId: dbId, colName: colName, newValue: newVal });
        processQueue();
      }
    },

    getRowClass: function (params) {
      if (!params.data) return "";
      let status = String(params.data["STATUS"] || "").toLowerCase();
      if (status === "released") return "status-released";
      if (status === "replaced") return "status-replaced";
      if (status === "mobilizing") return "status-mobilizing";
      return "";
    },

    onCellContextMenu: function (params) {
      if (params.colDef.field.toUpperCase() === "DRIVER NAME" && params.data) {
        contextDriverDbId = params.data.dbId;
        contextDriverPlate =
          params.data["PLATE NUMBER"] || params.data["PLATE NO"] || "";
        contextDriverName = params.value || "";
        contextDriverMob = params.data["MOBILE"] || "";
        contextDriverStart = params.data["WORK START"] || "";

        let e = params.event;
        e.preventDefault();
        $("#driverContextMenu")
          .css({ top: e.pageY + "px", left: e.pageX + "px" })
          .fadeIn(200);
      }
    },
  };

  agGridApi = agGrid.createGrid(gridDiv, gridOptions);
}

function performUndo() {
  if (agGridApi) agGridApi.undoCellEditing();
}
function performRedo() {
  if (agGridApi) agGridApi.redoCellEditing();
}

function openColVisModal() {
  document.getElementById("colVisList").innerHTML = "";
  if (!agGridApi) return;
  let cols = agGridApi.getColumns();
  cols.forEach((col) => {
    let title = col.getColDef().headerName;
    let isVisible = col.isVisible();
    let colId = col.getColId();
    $("#colVisList").append(
      `<div class="col-vis-item"><input type="checkbox" class="col-vis-cb" id="col_${colId}" ${isVisible ? "checked" : ""} onchange="agGridApi.setColumnsVisible(['${colId}'], this.checked)" style="margin:0; width: 16px; height: 16px;"><label for="col_${colId}" style="cursor:pointer; width:100%; font-size:13px; font-weight:600;">${title}</label></div>`,
    );
  });
  $("#colVisModalOverlay").css("display", "flex");
}

function toggleAllColumns(show) {
  $(".col-vis-cb").prop("checked", show);
  if (agGridApi) {
    let cols = agGridApi.getColumns().map((c) => c.getColId());
    agGridApi.setColumnsVisible(cols, show);
  }
}

async function processQueue() {
  if (isProcessingQueue || saveQueue.length === 0) {
    if (saveQueue.length === 0) updateSyncUI("live");
    return;
  }
  isProcessingQueue = true;
  updateSyncUI("saving");
  let currentBatch = [...saveQueue];
  saveQueue = [];
  try {
    const res = await fetch("/api/update-cells-batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ edits: currentBatch }),
    });
    const data = await res.json();
    isProcessingQueue = false;
    if (data.success) {
      if (saveQueue.length > 0) processQueue();
      else updateSyncUI("live");
    } else {
      updateSyncUI("error");
      Swal.fire({ icon: "error", title: "Save Failed", text: data.message });
      saveQueue = [...currentBatch, ...saveQueue];
    }
  } catch (e) {
    isProcessingQueue = false;
    updateSyncUI("error");
    saveQueue = [...currentBatch, ...saveQueue];
    setTimeout(() => processQueue(), 3000);
  }
}

// ==========================================
// EXISTING MODALS AND FORMS (Driver, Entry, Import)
// ==========================================
let currentDriverModalMode = "handover";
function setDriverMode(mode) {
  currentDriverModalMode = mode;
  if (mode === "handover") {
    $("#tabHandover").css({
      background: "white",
      color: "#0f172a",
      "box-shadow": "0 1px 3px rgba(0,0,0,0.1)",
    });
    $("#tabPastLog").css({
      background: "transparent",
      color: "#64748b",
      "box-shadow": "none",
    });
    $("#formHandoverMode, #handoverStartDateBlock").show();
    $("#formPastMode, #pastLogDates").hide();
    $("#btnSaveDriverAction")
      .text("Save & Change Driver")
      .removeClass("btn-primary")
      .addClass("btn-success");
  } else {
    $("#tabPastLog").css({
      background: "white",
      color: "#0f172a",
      "box-shadow": "0 1px 3px rgba(0,0,0,0.1)",
    });
    $("#tabHandover").css({
      background: "transparent",
      color: "#64748b",
      "box-shadow": "none",
    });
    $("#formHandoverMode, #handoverStartDateBlock").hide();
    $("#formPastMode, #pastLogDates").show();
    $("#btnSaveDriverAction")
      .text("Add to History")
      .removeClass("btn-success")
      .addClass("btn-primary");
  }
}

function reuseDriverDetails(name, mobile) {
  $("#drvUpdateNewName").val(name);
  $("#drvUpdateNewMob").val(mobile);
  showToast("Details copied!", "info");
}

function handleDriverAction(action) {
  if (action === "update") {
    if (currentUser.role === "Viewer")
      return showToast("Super Admin / Admin Only", "error");
    setDriverMode("handover");
    $("#drvUpdatePlateDisplay").text("Plate: " + contextDriverPlate);
    $("#drvUpdateCurrentName").text(contextDriverName || "N/A");
    $("#drvUpdateCurrentMob").text(contextDriverMob || "N/A");
    $("#drvUpdateOldStart").val(convertToInputDate(contextDriverStart));
    $("#drvUpdateEnd").val("");
    $("#drvUpdateNewName").val("");
    $("#drvUpdateNewMob").val("");
    $("#drvUpdateNewStart").val("");
    $("#drvPastStart").val("");
    $("#drvPastEnd").val("");
    fetchDriverLogsForSidePanel(contextDriverDbId);
    $("#driverUpdateModalOverlay").css("display", "flex");
  } else if (action === "view_log") {
    $("#drvLogPlateDisplay").text("Plate: " + contextDriverPlate);
    $("#driverLogTableBody").html(
      '<tr><td colspan="6" style="text-align:center;">Loading logs...</td></tr>',
    );
    $("#driverLogModalOverlay").css("display", "flex");
    fetchDriverLogsForModal(contextDriverDbId);
  }
}

async function fetchDriverLogsForModal(dbId) {
  try {
    const res = await fetch("/api/get-driver-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dbId: dbId }),
    });
    const data = await res.json();
    if (data.success) {
      let html = "";
      data.logs.forEach((l) => {
        let actionStr = l.id === "current" ? "Current" : l.updated_by;
        html += `<tr><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.driver_name || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.mobile || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.work_start || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.work_end || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${actionStr}</td><td style="padding:8px; border-bottom:1px solid var(--border-color); text-align:center;">-</td></tr>`;
      });
      if (data.logs.length === 0)
        html =
          '<tr><td colspan="6" style="text-align:center;">No history found.</td></tr>';
      $("#driverLogTableBody").html(html);
    }
  } catch (e) {
    $("#driverLogTableBody").html(
      '<tr><td colspan="6" style="text-align:center; color:red;">Failed to load.</td></tr>',
    );
  }
}

async function fetchDriverLogsForSidePanel(dbId) {
  $("#sidePanelDriverLogs").html(
    '<tr><td colspan="5" style="text-align:center; padding: 20px;">Loading history...</td></tr>',
  );
  try {
    const res = await fetch("/api/get-driver-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dbId: dbId }),
    });
    const data = await res.json();
    if (data.success) {
      let html = "";
      data.logs.forEach((l) => {
        let isCurrent = l.id === "current";
        let rowStyle = isCurrent
          ? "background:rgba(14, 165, 233, 0.05);"
          : "transition-colors hover:bg-slate-50";
        let badge = isCurrent
          ? '<span style="background:#0ea5e9; color:white; padding:2px 4px; border-radius:4px; font-size:9px; margin-left:5px;">CURRENT</span>'
          : "";
        let reuseBtn = `<i class="material-icons" style="font-size:16px; cursor:pointer; color:#10b981;" onclick="reuseDriverDetails('${(l.driver_name || "").replace(/'/g, "\\'")}', '${l.mobile || ""}')" title="Copy Details to Form">content_copy</i>`;
        let editBtn = "",
          deleteBtn = "";
        if (currentUser.role !== "Viewer") {
          editBtn = `<i class="material-icons" style="font-size:16px; cursor:pointer; color:var(--primary);" onclick="openEditLogModal('${l.id}', '${(l.driver_name || "").replace(/'/g, "\\'")}', '${l.mobile || ""}', '${l.work_start || ""}', '${l.work_end || ""}')" title="Edit Log">edit</i>`;
          if (!isCurrent)
            deleteBtn = `<i class="material-icons" style="font-size:16px; cursor:pointer; color:var(--danger);" onclick="deleteDriverLog('${l.id}')" title="Delete Log">delete</i>`;
        }
        let actionButtons = `<div style="display:flex; justify-content:center; gap:10px;">${reuseBtn}${editBtn}${deleteBtn}</div>`;
        html += `<tr style="${rowStyle}"><td style="padding:8px; border-bottom:1px solid var(--border-color); font-weight:600;">${l.driver_name || "-"}${badge}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.mobile || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.work_start || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color);">${l.work_end || "-"}</td><td style="padding:8px; border-bottom:1px solid var(--border-color); text-align:center;">${actionButtons}</td></tr>`;
      });
      if (data.logs.length === 0)
        html =
          '<tr><td colspan="5" style="text-align:center; padding: 20px;">No history found.</td></tr>';
      $("#sidePanelDriverLogs").html(html);
    }
  } catch (e) {
    $("#sidePanelDriverLogs").html(
      '<tr><td colspan="5" style="text-align:center; color:red; padding: 20px;">Failed to load.</td></tr>',
    );
  }
}

function openEditLogModal(id, name, mob, start, end) {
  $("#editLogId").val(id);
  $("#editLogName").val(name);
  $("#editLogMob").val(mob);
  if (start === "IDK") $("#editLogStart").val("");
  else $("#editLogStart").val(convertToInputDate(start));
  if (id === "current") $("#editLogEnd").val("").prop("disabled", true);
  else $("#editLogEnd").val(convertToInputDate(end)).prop("disabled", false);
  $("#editLogModalOverlay").css("display", "flex");
}

async function submitEditLog() {
  let id = $("#editLogId").val(),
    name = $("#editLogName").val().trim(),
    mob = $("#editLogMob").val().trim(),
    startRaw = $("#editLogStart").val(),
    end = $("#editLogEnd").val();
  if (!name) return showToast("Name is required", "error");
  if (id !== "current" && !end)
    return showToast("End Date required for past logs", "error");
  let start = startRaw ? formatToDDMMMYYYY(startRaw) : "IDK";
  $("#editLogModalOverlay").hide();
  showToast("Updating log...", "info");

  try {
    if (id === "current") {
      let dNameCol =
        cachedHeaders.find((h) => h.toUpperCase() === "DRIVER NAME") ||
        "Driver Name";
      let mobCol =
        cachedHeaders.find((h) => h.toUpperCase() === "MOBILE") || "Mobile";
      let wsCol =
        cachedHeaders.find((h) => h.toUpperCase() === "WORK START") ||
        "Work Start";
      let edits = [
        { dbId: contextDriverDbId, colName: dNameCol, newValue: name },
        { dbId: contextDriverDbId, colName: mobCol, newValue: mob },
        { dbId: contextDriverDbId, colName: wsCol, newValue: start },
      ];
      const res = await fetch("/api/update-cells-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ edits: edits }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Current driver updated!", "success");
        fetchData(true);
        fetchDriverLogsForSidePanel(contextDriverDbId);
        contextDriverName = name;
        contextDriverMob = mob;
        contextDriverStart = start;
        $("#drvUpdateCurrentName").text(name);
        $("#drvUpdateCurrentMob").text(mob);
        $("#drvUpdateOldStart").val(convertToInputDate(start));
      } else showToast(data.message, "error");
    } else {
      const res = await fetch("/api/edit-driver-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dbId: contextDriverDbId,
          logId: id,
          driverName: name,
          mobile: mob,
          workStart: start,
          workEnd: formatToDDMMMYYYY(end),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, "success");
        fetchData(true);
        fetchDriverLogsForSidePanel(contextDriverDbId);
      } else showToast(data.message, "error");
    }
  } catch (e) {
    showToast("Error updating log", "error");
  }
}

function deleteDriverLog(id) {
  Swal.fire({
    title: "Delete this log?",
    text: "You won't be able to revert this!",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "var(--danger)",
    cancelButtonColor: "#64748b",
    confirmButtonText: "Yes, delete it!",
    didOpen: () => {
      document.querySelector(".swal2-container").style.zIndex = "99999";
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      try {
        const res = await fetch("/api/delete-driver-log", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ dbId: contextDriverDbId, logId: id }),
        });
        const data = await res.json();
        if (data.success) {
          showToast("Log deleted!", "success");
          fetchData(true);
          fetchDriverLogsForSidePanel(contextDriverDbId);
        } else showToast(data.message, "error");
      } catch (e) {
        showToast("Failed to delete log", "error");
      }
    }
  });
}

async function submitDriverUpdate() {
  let nName = $("#drvUpdateNewName").val().trim();
  let nMob = $("#drvUpdateNewMob").val().trim();

  if (currentDriverModalMode === "handover") {
    let oldStartRaw = $("#drvUpdateOldStart").val();
    let oldStart = oldStartRaw ? formatToDDMMMYYYY(oldStartRaw) : "IDK";
    let endRaw = $("#drvUpdateEnd").val();
    let nStartRaw = $("#drvUpdateNewStart").val();
    if (!endRaw)
      return showToast("Current Driver End Date is required", "error");
    let oldStartObj = oldStartRaw ? new Date(oldStartRaw) : null;
    let endObj = new Date(endRaw);
    let newStartObj = nStartRaw ? new Date(nStartRaw) : null;
    if (oldStartObj && endObj < oldStartObj)
      return showToast(
        "Error: End Date cannot be before the Start Date",
        "error",
      );
    if (nName) {
      if (!nStartRaw)
        return showToast(
          "New Driver Start Date is required when assigning a new driver",
          "error",
        );
      if (newStartObj < endObj)
        return showToast(
          "Error: New Driver Start Date cannot be before Old Driver End Date",
          "error",
        );
    }
    let end = formatToDDMMMYYYY(endRaw);
    let finalNewStart = nStartRaw ? formatToDDMMMYYYY(nStartRaw) : "";
    showToast("Updating Driver Log...", "info");
    try {
      const res = await fetch("/api/update-driver", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dbId: contextDriverDbId,
          plate_number: contextDriverPlate,
          currentDriver: contextDriverName,
          currentMob: contextDriverMob,
          oldWorkStart: oldStart,
          workEnd: end,
          newDriver: nName,
          newMob: nMob,
          newWorkStart: finalNewStart,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(nName ? "Driver updated!" : "Vehicle Released!", "success");
        fetchData(true);
        fetchDriverLogsForSidePanel(contextDriverDbId);
        $("#drvUpdateEnd").val("");
        $("#drvUpdateNewName").val("");
        $("#drvUpdateNewMob").val("");
        $("#drvUpdateNewStart").val("");
      } else showToast(data.message, "error");
    } catch (e) {
      showToast("Failed to update driver", "error");
    }
  } else {
    let pStartRaw = $("#drvPastStart").val();
    let pEndRaw = $("#drvPastEnd").val();
    if (!nName || !pStartRaw || !pEndRaw)
      return showToast("Name, Start Date, and End Date are required", "error");
    let pStartObj = new Date(pStartRaw);
    let pEndObj = new Date(pEndRaw);
    if (pEndObj < pStartObj)
      return showToast(
        "Error: End Date cannot be before the Start Date",
        "error",
      );
    showToast("Adding to history...", "info");
    try {
      const res = await fetch("/api/add-past-driver-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dbId: contextDriverDbId,
          driverName: nName,
          mobile: nMob,
          workStart: formatToDDMMMYYYY(pStartRaw),
          workEnd: formatToDDMMMYYYY(pEndRaw),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Added to history!", "success");
        fetchData(true);
        fetchDriverLogsForSidePanel(contextDriverDbId);
        $("#drvPastStart").val("");
        $("#drvPastEnd").val("");
      } else showToast(data.message, "error");
    } catch (e) {
      showToast("Failed to add past log", "error");
    }
  }
}

function openAddEntryModal() {
  document.getElementById("userDropdownMenu").classList.remove("show");
  if (currentUser.role === "Viewer")
    return showToast("Access Denied.", "error");
  $("#dynamicFormFields").empty();

  cachedHeaders.forEach((header, index) => {
    let colTypeObj = cachedColTypes.find((c) => c.name === header);
    let cType = colTypeObj ? colTypeObj.type : "varchar";
    let colUpper = header.replace(/\s+/g, " ").trim().toUpperCase();
    const excludedCols = [
      "DAYS WORKED",
      "PAY FROM",
      "MUBARAK REMARK",
      "OFFICE REMARK",
    ];
    if (excludedCols.includes(colUpper)) return;

    let isDateCol =
      cType === "date" ||
      colUpper.includes("DATE") ||
      colUpper.includes("EXPIRE") ||
      colUpper.includes("EQUIPMENT REACHED") ||
      colUpper === "LAST WORKING DAY" ||
      colUpper === "WORK START";
    let isIntCol = cType === "int";
    let inputHtml = `<input type="text" class="modal-input entry-input" data-colname="${header}">`;

    if (isDateCol) {
      inputHtml = `<input type="date" class="modal-input entry-input" data-colname="${header}">`;
    } else if (isIntCol) {
      inputHtml = `<input type="number" class="modal-input entry-input" data-colname="${header}">`;
    } else if (["REMARK", "REMARKS", "DRIVER LOG"].includes(colUpper)) {
      inputHtml = `<textarea class="modal-input entry-input" data-colname="${header}"></textarea>`;
    } else if (colUpper === "STATUS") {
      inputHtml = `<select class="modal-input entry-input" data-colname="${header}"><option value="">Select Status</option><option value="Running">Running</option><option value="Released">Released</option><option value="Replaced">Replaced</option><option value="Mobilizing">Mobilizing</option></select>`;
    } else if (colUpper === "SN") {
      inputHtml = `<input type="text" class="modal-input entry-input" data-colname="${header}" value="${globalNextSN}" readonly style="background-color:#f8fafc; cursor:not-allowed;">`;
    } else if (
      colUpper === "SITE" &&
      currentUser.role !== "Admin" &&
      currentUser.role !== "Super Admin"
    ) {
      inputHtml = `<input type="text" class="modal-input entry-input" data-colname="${header}" value="${currentUser.site}" readonly style="background-color:#f8fafc; cursor:not-allowed;">`;
    }

    $("#dynamicFormFields").append(
      `<div class="form-group"><label class="form-label" style="display:block; margin-bottom:5px; font-weight:600; color:#334155; font-size:12px;">${header}</label>${inputHtml}</div>`,
    );
  });
  $("#entryModalOverlay").css("display", "flex");
}

async function submitNewEntry() {
  let rowDataObj = {};
  $(".entry-input").each(function () {
    let val = $(this).val().trim();
    let cName = String($(this).data("colname")).trim();
    let colTypeObj = cachedColTypes.find((c) => c.name === cName);
    let cType = colTypeObj ? colTypeObj.type : "varchar";
    let colUpper = cName.toUpperCase();
    let isDateCol =
      cType === "date" ||
      colUpper.includes("DATE") ||
      colUpper.includes("EXPIRE") ||
      colUpper.includes("EQUIPMENT REACHED") ||
      colUpper === "LAST WORKING DAY" ||
      colUpper === "WORK START";
    if (isDateCol && val) val = formatToDDMMMYYYY(val);
    rowDataObj[$(this).data("colname")] = val;
  });
  $("#entryModalOverlay").hide();
  updateSyncUI("saving");
  const res = await fetch("/api/add-row", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ rowDataObj: rowDataObj }),
  });
  const data = await res.json();
  if (data.success) {
    showToast("Added!", "success");
    fetchData(true);
  } else {
    updateSyncUI("error");
    showToast(data.message, "error");
  }
}

function openAddColumnModal() {
  document.getElementById("userDropdownMenu").classList.remove("show");
  if (currentUser.role === "Viewer")
    return showToast("Access Denied.", "error");
  $("#newColName").val("");
  $("#newColType").val("varchar");
  $("#colModalOverlay").css("display", "flex");
  $("#newColName").focus();
}

async function submitNewColumn() {
  let colName = $("#newColName").val().trim(),
    colType = $("#newColType").val();
  if (colName === "") return showToast("Name cannot be empty.", "error");
  $("#colModalOverlay").hide();
  showToast("Adding...", "info");
  const res = await fetch("/api/add-column", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ colName: colName, colType: colType }),
  });
  const data = await res.json();
  if (data.success) {
    showToast("Added!", "success");
    fetchData(true);
  } else showToast(data.message, "error");
}

function openImportModal() {
  if (currentUser.role !== "Super Admin")
    return showToast("Super Admin Only.", "error");
  $("#importExcelFile").val("");
  $("#importModalOverlay").css("display", "flex");
}

function updateImportUI() {
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const warningText = document.getElementById("importWarningText");
  const submitBtn = document.getElementById("btnImportSubmit");
  if (mode === "rewrite") {
    warningText.style.color = "var(--danger)";
    warningText.innerText =
      "WARNING: This will rewrite the entire database! A backup will be mailed to you automatically before wiping.";
    submitBtn.className = "btn btn-warning";
    submitBtn.innerText = "Import & Rewrite";
  } else {
    warningText.style.color = "var(--primary)";
    warningText.innerText =
      "Info: This will safely add new records below the existing data.";
    submitBtn.className = "btn btn-primary";
    submitBtn.innerText = "Import & Append";
  }
}

function processBulkImport() {
  const fileInput = document.getElementById("importExcelFile");
  if (!fileInput.files.length)
    return showToast("Please select a file.", "error");
  const importMode = document.querySelector(
    'input[name="importMode"]:checked',
  ).value;
  const file = fileInput.files[0],
    reader = new FileReader();
  $("#btnImportSubmit").prop("disabled", true).text("Processing...");
  reader.onload = async function (e) {
    const base64Data = e.target.result;
    try {
      showToast("Validating & Processing...", "info");
      const res = await fetch("/api/admin/import-excel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileBase64: base64Data,
          importMode: importMode,
        }),
      });
      const data = await res.json();
      updateImportUI();
      $("#btnImportSubmit").prop("disabled", false);
      if (data.success) {
        showToast(data.message, "success");
        $("#importModalOverlay").hide();
        setTimeout(() => location.reload(), 1500);
      } else {
        showToast(data.message, "error");
      }
    } catch (error) {
      updateImportUI();
      $("#btnImportSubmit").prop("disabled", false);
      showToast("Failed to upload.", "error");
    }
  };
  reader.readAsDataURL(file);
}

async function triggerTelegramAlerts() {
  document.getElementById("userDropdownMenu").classList.remove("show");
  try {
    showToast("Sending alerts to Telegram...", "info");
    const res = await fetch("/api/admin/trigger-alerts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await res.json();
    if (data.success) showToast(data.message, "success");
    else showToast(data.message, "error");
  } catch (e) {
    showToast("Failed to send alerts.", "error");
  }
}

// ==========================================
// ? EXCEL EXPORT (USING SHEETJS)
// ==========================================
function exportToExcel() {
  if (!agGridApi) return;
  showToast("Generating Excel File...", "info");

  let rowData = [];
  let cols = agGridApi.getAllDisplayedColumns();
  let headers = cols.map((c) => c.getColDef().headerName);
  rowData.push(headers);

  agGridApi.forEachNodeAfterFilterAndSort((node) => {
    let row = [];
    cols.forEach((c) => row.push(node.data[c.getColId()]));
    rowData.push(row);
  });

  let ws = XLSX.utils.aoa_to_sheet(rowData);
  let wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "MasterData");
  XLSX.writeFile(wb, "ERP_MasterData.xlsx");
}

// ==========================================
// ? EXCEL PASTE ENGINE (AG GRID)
// ==========================================
$(document).on("paste", function (e) {
  if (!isBulkEditModeActive || currentUser.role === "Viewer" || !agGridApi)
    return;

  let clipboardData = (e.originalEvent || e).clipboardData.getData("text");
  if (!clipboardData || !clipboardData.includes("\t")) return;

  e.preventDefault();

  let focusedCell = agGridApi.getFocusedCell();
  if (!focusedCell) return showToast("Select a cell to paste", "warning");

  let rows = clipboardData.split(/\r?\n/);
  if (rows[rows.length - 1] === "") rows.pop();

  let startRowIdx = focusedCell.rowIndex;
  let columns = agGridApi.getColumns();
  let startColIdx = columns.findIndex(
    (c) => c.getColId() === focusedCell.column.getColId(),
  );
  let totalRows = agGridApi.getDisplayedRowCount();

  let newRows = [];

  rows.forEach((rowText, i) => {
    let cells = rowText.split("\t");
    let currentRowIdx = startRowIdx + i;
    let isNewRow = currentRowIdx >= totalRows;

    if (isNewRow) {
      let rowData = {};
      columns.forEach((c) => (rowData[c.getColId()] = ""));
      cells.forEach((cellText, j) => {
        let targetColIdx = startColIdx + j;
        if (targetColIdx < columns.length) {
          let colId = columns[targetColIdx].getColId();
          if (colId.toUpperCase() !== "SN") rowData[colId] = cellText.trim();
        }
      });
      rowData.dbId = "temp_" + Date.now() + "_" + i;
      newRows.push(rowData);
      window.bulkPendingInserts.push(rowData);
      totalRows++;
    } else {
      let rowNode = agGridApi.getDisplayedRowAtIndex(currentRowIdx);
      cells.forEach((cellText, j) => {
        let targetColIdx = startColIdx + j;
        if (targetColIdx < columns.length) {
          let colId = columns[targetColIdx].getColId();
          if (colId.toUpperCase() !== "SN") {
            rowNode.setDataValue(colId, cellText.trim());
          }
        }
      });
    }
  });

  if (newRows.length > 0) {
    agGridApi.applyTransaction({ add: newRows });
  }
  showToast(`Pasted ${rows.length} rows successfully!`, "success");
});

// ==========================================
// ? HIGH-PERFORMANCE BULK EDIT & EXCEL PASTE ENGINE (AG GRID)
// ==========================================
let isBulkEditModeActive = false;
window.bulkPendingUpdates = [];
window.bulkPendingInserts = [];

function toggleBulkEditMode() {
  isBulkEditModeActive = !isBulkEditModeActive;
  const btn = $(".bulk-edit-toggle-btn");

  if (isBulkEditModeActive) {
    $("#myGrid").addClass("bulk-edit-grid-active");
    btn.css({
      background: "var(--success)",
      color: "white",
      "border-color": "var(--success)",
    });
    $("#bulkEditControls").css("display", "flex");
    $(".desktop-action-btn").hide();
    showToast(
      "Bulk Edit ON: Background save paused. Paste Excel data and click 'Save All Changes'.",
      "info",
    );
  } else {
    cancelBulkEdits();
  }
}

function cancelBulkEdits() {
  isBulkEditModeActive = false;
  window.bulkPendingUpdates = [];
  window.bulkPendingInserts = [];
  $("#myGrid").removeClass("bulk-edit-grid-active");
  $(".bulk-edit-toggle-btn").css({
    background: "",
    color: "",
    "border-color": "",
  });
  $("#bulkEditControls").hide();
  $(".desktop-action-btn").show();
  fetchData(true); // Reset table to original state
  showToast("Bulk Edit Cancelled", "info");
}

async function saveBulkEdits() {
  if (
    window.bulkPendingUpdates.length === 0 &&
    window.bulkPendingInserts.length === 0
  ) {
    return showToast("No changes detected to save.", "info");
  }

  $("#bulkEditControls button").prop("disabled", true);
  showToast("Saving bulk changes to database... Please wait.", "info");
  updateSyncUI("saving");

  try {
    const res = await fetch("/api/bulk-save-mixed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        updates: window.bulkPendingUpdates,
        inserts: window.bulkPendingInserts,
      }),
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message || "Successfully saved all changes!", "success");
      isBulkEditModeActive = false;
      window.bulkPendingUpdates = [];
      window.bulkPendingInserts = [];
      $("#myGrid").removeClass("bulk-edit-grid-active");
      $(".bulk-edit-toggle-btn").css({
        background: "",
        color: "",
        "border-color": "",
      });
      $("#bulkEditControls").hide();
      $(".desktop-action-btn").show();
      setTimeout(() => fetchData(true), 500);
    } else {
      updateSyncUI("error");
      Swal.fire("Save Error", data.message, "error");
    }
  } catch (e) {
    updateSyncUI("error");
    Swal.fire("Connection Error", "Failed to reach the server.", "error");
  } finally {
    $("#bulkEditControls button").prop("disabled", false);
  }
}

// Custom Paste Logic for AG Grid
$(document).on("paste", function (e) {
  if (!isBulkEditModeActive || currentUser.role === "Viewer" || !agGridApi)
    return;

  let clipboardData = (e.originalEvent || e).clipboardData.getData("text");
  if (!clipboardData || !clipboardData.includes("\t")) return; // Only process tab-separated data (Excel)

  e.preventDefault();

  let focusedCell = agGridApi.getFocusedCell();
  if (!focusedCell) return showToast("Select a cell to paste", "warning");

  let rows = clipboardData.split(/\r?\n/);
  if (rows[rows.length - 1] === "") rows.pop();

  let startRowIdx = focusedCell.rowIndex;
  let columns = agGridApi.getAllDisplayedColumns();
  let startColIdx = columns.findIndex(
    (c) => c.getColId() === focusedCell.column.getColId(),
  );
  let totalRows = agGridApi.getDisplayedRowCount();

  let newRows = [];

  rows.forEach((rowText, i) => {
    let cells = rowText.split("\t");
    let currentRowIdx = startRowIdx + i;
    let isNewRow = currentRowIdx >= totalRows;

    if (isNewRow) {
      let rowData = {};
      columns.forEach((c) => (rowData[c.getColId()] = ""));

      let snCol = columns.find((c) => c.getColId().toUpperCase() === "SN");
      if (snCol) rowData[snCol.getColId()] = globalNextSN++;

      cells.forEach((cellText, j) => {
        let targetColIdx = startColIdx + j;
        if (targetColIdx < columns.length) {
          let colId = columns[targetColIdx].getColId();
          if (colId.toUpperCase() !== "SN") rowData[colId] = cellText.trim();
        }
      });
      rowData.dbId = "temp_" + Date.now() + "_" + i;
      newRows.push(rowData);
      window.bulkPendingInserts.push(rowData);
      totalRows++;
    } else {
      let rowNode = agGridApi.getDisplayedRowAtIndex(currentRowIdx);
      if (!rowNode) return;
      let dbId = rowNode.data.dbId;

      cells.forEach((cellText, j) => {
        let targetColIdx = startColIdx + j;
        if (targetColIdx < columns.length) {
          let colId = columns[targetColIdx].getColId();
          if (colId.toUpperCase() !== "SN") {
            let newVal = cellText.trim();
            let oldVal = String(rowNode.data[colId] || "").trim();

            if (newVal !== oldVal) {
              rowNode.setDataValue(colId, newVal); // Update cell in UI

              let existingIdx = window.bulkPendingUpdates.findIndex(
                (u) => u.dbId === dbId && u.colName === colId,
              );
              if (existingIdx >= 0)
                window.bulkPendingUpdates[existingIdx].newValue = newVal;
              else
                window.bulkPendingUpdates.push({
                  dbId: dbId,
                  colName: colId,
                  newValue: newVal,
                });
            }
          }
        }
      });
    }
  });

  if (newRows.length > 0) {
    agGridApi.applyTransaction({ add: newRows });
  }
  showToast(`Pasted ${rows.length} rows successfully!`, "success");
});

// Initialize settings on page load so dark theme applies to the grid automatically
document.addEventListener("DOMContentLoaded", function () {
  initSettings();
});
