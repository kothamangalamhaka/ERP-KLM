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
  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    document.getElementById("themeIcon").innerText = "light_mode";
  } else {
    document.body.classList.remove("dark-mode");
    document.getElementById("themeIcon").innerText = "dark_mode";
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
  if (isDark) {
    document.body.classList.remove("dark-mode");
    localStorage.setItem("erpThemeMaster", "light");
    document.getElementById("themeIcon").innerText = "dark_mode";
  } else {
    document.body.classList.add("dark-mode");
    localStorage.setItem("erpThemeMaster", "dark");
    document.getElementById("themeIcon").innerText = "light_mode";
  }
}
initSettings();

// ? DATE FORMATTER (100% TIMEZONE SAFE)
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

  // 1. If Already Formatted (e.g., 15-Sep-2025)
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/i.test(dateStr)) return dateStr;

  // 2. Direct from HTML <input type="date"> (Format: YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    let p = dateStr.split("-");
    let m = parseInt(p[1], 10) - 1;
    return `${p[2]}-${monthNames[m]}-${p[0]}`;
  }

  // 3. From Excel Paste or Other formats (DD-MM-YYYY, DD/MM/YYYY)
  let p = dateStr.split(/[\/\- \.]/);
  if (p.length === 3) {
    let d, m, y;

    if (p[0].length === 4) {
      // Format: YYYY/MM/DD
      y = p[0];
      m = p[1];
      d = p[2];
    } else {
      // Format: DD/MM/YYYY
      d = p[0];
      m = p[1];
      y = p[2];
    }

    d = String(d).padStart(2, "0");
    y = y.length === 2 ? "20" + y : y;

    let mInt;
    if (isNaN(m)) {
      // If month is string like 'Sep'
      mInt = monthNames.findIndex(
        (mon) => mon.toLowerCase() === m.toLowerCase().substring(0, 3),
      );
    } else {
      mInt = parseInt(m, 10) - 1;
    }

    if (mInt >= 0 && mInt <= 11) {
      return `${d}-${monthNames[mInt]}-${y}`;
    }
  }

  // Fallback
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
      // UTC noon aayi edukkunnu, timezone backlottu povan chance illa
      return new Date(Date.UTC(y, m, d, 12, 0, 0));
    }
  }
  return null;
}
const FIXED_COLUMNS = [
  "EQUIPMENT REACHED AT SITE",
  "WORK START",
  "LAST WORKING DAY",
  "RELEASE DATE",
  "REPLACED DATE",
  "OD WRK END",
  "OLD DRIVER NAME",
  "OD MOB",
  "DAYS WORKED",
];

let currentUser = JSON.parse(localStorage.getItem("erpUser"));
let token = localStorage.getItem("erpToken");
if (!token || !currentUser) window.location.replace("index.html");

// 🟢 BACK BUTTON FIX (BFCache Protection)
// Browser back button vazhiyo cache vazhiyo page vannal udan check cheyyum
window.addEventListener("pageshow", function (event) {
  if (event.persisted || !localStorage.getItem("erpToken")) {
    window.location.replace("index.html");
  }
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
      text: "You have been logged out due to 30 minutes of inactivity.",
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

function toggleMobileTools(event) {
  event.stopPropagation();
  document.querySelector(".dt-buttons").classList.toggle("show");
}

document.addEventListener("click", function (event) {
  const userMenu = document.getElementById("userDropdownMenu");
  if (userMenu && !event.target.closest(".user-dropdown-container"))
    userMenu.classList.remove("show");
  const toolsMenu = document.querySelector(".dt-buttons");
  if (
    toolsMenu &&
    window.innerWidth <= 768 &&
    !event.target.closest(".ribbon-left")
  )
    toolsMenu.classList.remove("show");
  $("#headerContextMenu").fadeOut(100);
  $("#driverContextMenu").fadeOut(100);
  if (
    !$(event.target).closest("#excelFilterMenu").length &&
    !$(event.target).hasClass("filter-icon")
  )
    $("#excelFilterMenu").hide();
});

let erpDataTable = null,
  cachedHeaders = [],
  cachedAlignments = [],
  cachedColTypes = [],
  cachedColWidths = [];
let globalNextSN = 1,
  saveQueue = [],
  isProcessingQueue = false,
  activeFilters = {},
  currentFilterColName = "";
let globalLockedCols = [],
  lastDataHash = "",
  undoStack = [],
  redoStack = [];
let contextColName = "",
  contextColIdx = -1,
  contextDriverDbId = null,
  contextDriverPlate = "",
  contextDriverName = "",
  contextDriverMob = "",
  contextDriverStart = "";

function updateUndoRedoUI() {
  $(".dt-undo-btn").prop("disabled", undoStack.length === 0);
  $(".dt-redo-btn").prop("disabled", redoStack.length === 0);
}

document.addEventListener("keydown", function (e) {
  let isInputActive = $(document.activeElement).is("input, textarea, select");
  if (e.ctrlKey && e.key.toLowerCase() === "z" && !isInputActive) {
    e.preventDefault();
    performUndo();
  }
  if (e.ctrlKey && e.key.toLowerCase() === "y" && !isInputActive) {
    e.preventDefault();
    performRedo();
  }
});

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
  $("#excelFilterMenu").hide();

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
    if (
      !data.success &&
      data.message &&
      (data.message.includes("Access Denied") ||
        data.message.toLowerCase().includes("invalid") ||
        data.message.toLowerCase().includes("expired"))
    )
      return performLogout(true);

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
  if (
    $(".edit-input").length === 0 &&
    saveQueue.length === 0 &&
    $(".modal-overlay:visible").length === 0 &&
    $("#excelFilterMenu").css("display") === "none"
  )
    fetchData(true);
}, 15000);
fetchData();

$.fn.dataTable.ext.search.push(
  function (settings, searchData, index, rowData, counter) {
    for (let colName in activeFilters) {
      let allowedValues = activeFilters[colName];
      if (!allowedValues || allowedValues.length === 0) continue;
      let cIdx = cachedHeaders.indexOf(colName);
      if (cIdx === -1) continue;
      let cellVal = String(searchData[cIdx] || "").trim();
      if (!allowedValues.includes(cellVal)) return false;
    }
    return true;
  },
);

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

// FIX: Driver Strict Date Validation and Release Handling
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

    if (oldStartObj && endObj < oldStartObj) {
      return showToast(
        "Error: End Date cannot be before the Start Date",
        "error",
      );
    }

    if (nName) {
      if (!nStartRaw)
        return showToast(
          "New Driver Start Date is required when assigning a new driver",
          "error",
        );
      if (newStartObj < endObj) {
        return showToast(
          "Error: New Driver Start Date cannot be before Old Driver End Date",
          "error",
        );
      }
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
    // Past Log Mode
    let pStartRaw = $("#drvPastStart").val();
    let pEndRaw = $("#drvPastEnd").val();
    if (!nName || !pStartRaw || !pEndRaw)
      return showToast("Name, Start Date, and End Date are required", "error");

    let pStartObj = new Date(pStartRaw);
    let pEndObj = new Date(pEndRaw);
    if (pEndObj < pStartObj) {
      return showToast(
        "Error: End Date cannot be before the Start Date",
        "error",
      );
    }

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

function openImportModal() {
  if (currentUser.role !== "Super Admin")
    return showToast("Super Admin Only.", "error");
  document.querySelector(".dt-buttons").classList.remove("show");
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

async function renameColumn(event, oldName) {
  event.stopPropagation();
  if (currentUser.role !== "Super Admin") return;
  const modal = $("#renameColModalOverlay"),
    input = $("#renameColInput"),
    typeSelect = $("#renameColType"),
    confirmBtn = $("#btnConfirmRename");
  input.val(oldName);
  let existType =
    cachedColTypes.find((c) => c.name === oldName)?.type || "varchar";
  typeSelect.val(existType);
  modal.css("display", "flex");
  input.focus();
  confirmBtn.off("click").on("click", async function () {
    const newName = input.val().trim(),
      newType = typeSelect.val();
    if (!newName) return showToast("Name cannot be empty", "error");
    const normOld = String(oldName).replace(/\s+/g, " ").trim().toUpperCase();
    if (FIXED_COLUMNS.includes(normOld))
      return showToast("Cannot rename a core system column.", "error");
    modal.hide();
    showToast("Updating column...", "info");
    try {
      const res = await fetch("/api/admin/rename-column", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          oldName: oldName,
          newName: newName,
          colType: newType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, "success");
        fetchData(true);
      } else showToast(data.message, "error");
    } catch (e) {
      showToast("Error updating column.", "error");
    }
  });
  input.off("keypress").on("keypress", function (e) {
    if (e.key === "Enter") confirmBtn.click();
  });
}

async function toggleColumnLock(event, colName, newState) {
  event.stopPropagation();
  if (currentUser.role !== "Super Admin") return;
  try {
    showToast(newState ? "Locking..." : "Unlocking...", "info");
    const res = await fetch("/api/admin/toggle-lock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ colName: colName, isLocked: newState }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Column ${newState ? "Locked" : "Unlocked"}`, "success");
      fetchData(true);
    } else showToast(data.message, "error");
  } catch (e) {
    showToast("Error updating lock.", "error");
  }
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

function attachContextMenus() {
  if (currentUser.role === "Super Admin") $(".admin-only-menu").show();
  else $(".admin-only-menu").hide();

  $("#erpTable thead")
    .off("contextmenu", "th")
    .on("contextmenu", "th", function (e) {
      e.preventDefault();
      contextColName = $(this).find(".col-title-text").text().trim();
      contextColIdx = erpDataTable.column(this).index();
      const normCol = String(contextColName)
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
      if (FIXED_COLUMNS.includes(normCol)) {
        $(".admin-only-menu").hide();
      } else {
        if (currentUser.role === "Super Admin") $(".admin-only-menu").show();
      }
      let colWraps = JSON.parse(localStorage.getItem("erpColWraps")) || {};
      let currentWrap = colWraps[contextColName] || "nowrap";
      $("#contextWrapText").text(
        currentWrap === "wrap" ? "Unwrap Text" : "Wrap Text",
      );
      $("#headerContextMenu")
        .css({ top: e.pageY + "px", left: e.pageX + "px" })
        .fadeIn(200);
    });

  $("#erpTable tbody")
    .off("contextmenu", "td")
    .on("contextmenu", "td", function (e) {
      let colName = $(this).data("colname");
      if (colName && colName.toUpperCase() === "DRIVER NAME") {
        e.preventDefault();
        let plateIdx = cachedHeaders.findIndex(
          (h) => h.trim().toLowerCase() === "plate number",
        );
        let startIdx = cachedHeaders.findIndex(
          (h) => h.trim().toLowerCase() === "work start",
        );
        contextDriverDbId = $(this).closest("tr").data("sheetrow");
        contextDriverPlate = $(this)
          .closest("tr")
          .find("td")
          .eq(plateIdx)
          .text();
        contextDriverName = $(this).text();
        contextDriverMob = $(this)
          .closest("tr")
          .find(
            `td[data-colname="${cachedHeaders.find((h) => h.toUpperCase() === "MOBILE")}"]`,
          )
          .text();
        contextDriverStart = $(this)
          .closest("tr")
          .find("td")
          .eq(startIdx)
          .text();
        $("#driverContextMenu")
          .css({ top: e.pageY + "px", left: e.pageX + "px" })
          .fadeIn(200);
      }
    });
}

async function handleMenuAction(action) {
  if (action === "add_left" || action === "add_right") {
    const pos = action === "add_left" ? "left" : "right";
    $("#relativeColTitle").text(
      `Add Column ${pos === "left" ? "Left" : "Right"} of "${contextColName}"`,
    );
    $("#relativeColPosition").val(pos);
    $("#relativeColInput").val("");
    $("#relativeColType").val("varchar");
    $("#relativeColModal").css("display", "flex");
    $("#relativeColInput").focus();
  } else if (action === "delete_column") {
    if (currentUser.role !== "Super Admin")
      return showToast("Super Admin only.", "error");
    $("#deleteColNameDisplay").text(contextColName);
    $("#deleteColPassword").val("");
    $("#deleteColModalOverlay").css("display", "flex");
    $("#deleteColPassword").focus();
  } else if (action.startsWith("align_")) {
    if (currentUser.role !== "Super Admin")
      return showToast("Super Admin only.", "error");
    const align = action.split("_")[1];
    showToast("Setting alignment...", "info");
    const res = await fetch("/api/admin/set-alignment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ colName: contextColName, alignment: align }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("Alignment updated!", "success");
      fetchData(true);
    }
  } else if (action === "toggle_col_wrap") {
    let colWraps = JSON.parse(localStorage.getItem("erpColWraps")) || {};
    let currentWrap = colWraps[contextColName] || "nowrap";
    let newWrap = currentWrap === "wrap" ? "nowrap" : "wrap";
    colWraps[contextColName] = newWrap;
    localStorage.setItem("erpColWraps", JSON.stringify(colWraps));
    showToast(
      newWrap === "wrap" ? "Column Wrapped" : "Column Unwrapped",
      "info",
    );
    if (erpDataTable) erpDataTable.rows().invalidate().draw(false);
  } else if (action === "sort_asc") {
    erpDataTable.order([contextColIdx, "asc"]).draw();
    showToast("Sorted A-Z", "info");
  } else if (action === "sort_desc") {
    erpDataTable.order([contextColIdx, "desc"]).draw();
    showToast("Sorted Z-A", "info");
  } else if (action === "hide_column") {
    erpDataTable.column(contextColIdx).visible(false);
    showToast("Column Hidden", "info");
  }
}

async function submitRelativeColumn() {
  const newName = $("#relativeColInput").val().trim(),
    pos = $("#relativeColPosition").val(),
    type = $("#relativeColType").val();
  if (!newName) return showToast("Name cannot be empty.", "error");
  $("#relativeColModal").hide();
  showToast("Creating column...", "info");
  try {
    const res = await fetch("/api/add-column-relative", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        colName: newName,
        relativeTo: contextColName,
        position: pos,
        colType: type,
      }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("Column added!", "success");
      fetchData(true);
    } else showToast(data.message, "error");
  } catch (e) {
    showToast("Failed to add column", "error");
  }
}

async function submitDeleteColumn() {
  const adminPass = $("#deleteColPassword").val();
  if (!adminPass) return showToast("Password is required.", "error");
  $("#deleteColModalOverlay").hide();
  Swal.fire({
    title: "Moving to Recycle Bin...",
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading(),
  });
  try {
    const res = await fetch("/api/admin/delete-column", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        colName: contextColName,
        adminPassword: adminPass,
      }),
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire("Moved!", "Column moved to Recycle Bin (30 Days).", "success");
      setTimeout(() => location.reload(), 1500);
    } else {
      Swal.fire("Error", data.message, "error");
    }
  } catch (e) {
    Swal.fire("Error", "Failed to delete column securely.", "error");
  }
}

function toggleTextWrap() {
  const table = $("#erpTable");
  if (table.hasClass("truncate-text")) {
    table.removeClass("truncate-text").addClass("wrap-text");
    localStorage.setItem("erpTextWrap", "wrap");
    showToast("Table Text Wrap Enabled", "info");
  } else {
    table.removeClass("wrap-text").addClass("truncate-text");
    localStorage.setItem("erpTextWrap", "truncate");
    showToast("Table Text Truncate Enabled", "info");
  }
  if (erpDataTable) erpDataTable.columns.adjust().draw(false);
}

function toggleHeaderWrap() {
  const table = $("#erpTable");
  if (table.hasClass("header-wrap")) {
    table.removeClass("header-wrap");
    localStorage.setItem("erpHeaderWrap", "nowrap");
    showToast("Header Wrap Disabled", "info");
  } else {
    table.addClass("header-wrap");
    localStorage.setItem("erpHeaderWrap", "wrap");
    showToast("Header Wrap Enabled", "info");
  }
  if (erpDataTable) erpDataTable.columns.adjust().draw(false);
}

function renderTable(response) {
  if ($(".edit-input").length > 0 || saveQueue.length > 0) return;
  let scrollWrapper = document.querySelector(".table-scroll-wrapper"),
    preserveScrollTop = scrollWrapper ? scrollWrapper.scrollTop : 0,
    preserveScrollLeft = scrollWrapper ? scrollWrapper.scrollLeft : 0;
  document.getElementById("loader").style.display = "none";
  if (response.success) updateSyncUI("live");
  const tableEl = document.getElementById("erpTable");
  tableEl.style.display = "table";

  if ($.fn.DataTable.isDataTable("#erpTable")) {
    $("#erpTable").DataTable().destroy();
    $("#erpTable").empty();
  }
  if (!response.success) {
    if (
      response.message &&
      (response.message.includes("Access Denied") ||
        response.message.toLowerCase().includes("invalid") ||
        response.message.toLowerCase().includes("expired"))
    )
      return performLogout();
    return showToast(response.message, "error");
  }

  let wrapPref = localStorage.getItem("erpTextWrap") || "truncate";
  if (wrapPref === "wrap")
    $(tableEl).addClass("wrap-text").removeClass("truncate-text");
  else $(tableEl).addClass("truncate-text").removeClass("wrap-text");

  let headerWrapPref = localStorage.getItem("erpHeaderWrap") || "nowrap";
  if (headerWrapPref === "wrap") $(tableEl).addClass("header-wrap");
  else $(tableEl).removeClass("header-wrap");

  cachedHeaders = response.headers;
  cachedAlignments = response.alignments || [];
  cachedColTypes = response.colTypes || [];
  cachedColWidths = response.colWidths || [];
  globalNextSN = response.nextSN || 1;
  globalLockedCols = response.lockedCols || [];

  let snCounter = 1;
  let plateIdx = cachedHeaders.findIndex((h) =>
      h.replace(/\s+/g, "").toUpperCase().includes("PLATENUMBER"),
    ),
    statusIdx = cachedHeaders.findIndex(
      (h) => h.replace(/\s+/g, "").toUpperCase() === "STATUS",
    ),
    mobIdx = cachedHeaders.findIndex(
      (h) => h.replace(/\s+/g, "").toUpperCase() === "EQUIPMENTREACHEDATSITE",
    ),
    lwdIdx = cachedHeaders.findIndex(
      (h) => h.replace(/\s+/g, "").toUpperCase() === "LASTWORKINGDAY",
    );
  let plateMap = {},
    conflictMap = {};

  response.rows.forEach((row) => {
    let sheetRow = row[row.length - 1],
      pRaw =
        plateIdx !== -1 && row[plateIdx]
          ? String(row[plateIdx])
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "")
          : "";
    if (pRaw) {
      if (!plateMap[pRaw]) plateMap[pRaw] = [];
      let mobVal =
        mobIdx !== -1 && row[mobIdx]
          ? parseDateStr(row[mobIdx])?.getTime()
          : null;
      let lwdVal =
        lwdIdx !== -1 && row[lwdIdx]
          ? parseDateStr(row[lwdIdx])?.getTime()
          : null;
      plateMap[pRaw].push({
        sheetRow: sheetRow,
        status:
          statusIdx !== -1 ? String(row[statusIdx]).trim().toLowerCase() : "",
        mobTime: mobVal,
        lwdTime: lwdVal,
      });
    }
  });

  Object.keys(plateMap).forEach((pRaw) => {
    let entries = plateMap[pRaw];
    if (entries.length > 1) {
      let runningRows = entries
        .filter((e) => e.status === "running")
        .map((e) => e.sheetRow);
      if (runningRows.length > 1)
        runningRows.forEach((r) => (conflictMap[r] = "conflict-running"));
      let validEntries = entries
        .filter((e) => e.mobTime !== null)
        .sort((a, b) => a.mobTime - b.mobTime);
      for (let k = 0; k < validEntries.length - 1; k++) {
        if (
          validEntries[k].lwdTime !== null &&
          validEntries[k + 1].mobTime < validEntries[k].lwdTime
        ) {
          conflictMap[validEntries[k].sheetRow] = "conflict-date";
          conflictMap[validEntries[k + 1].sheetRow] = "conflict-date";
        }
      }
    }
  });

  let theadHtml = "<thead><tr class='main-header'>";
  response.headers.forEach((h, i) => {
    let alignObj = cachedAlignments.find((a) => a.name === h),
      alignVal = alignObj ? alignObj.align : "left",
      colTypeObj = cachedColTypes.find((c) => c.name === h),
      cType = colTypeObj ? colTypeObj.type : "varchar",
      colHead = String(h).replace(/\s+/g, " ").trim().toUpperCase(),
      isCenter =
        [
          "PLATE NUMBER",
          "SITE",
          "IF SUB",
          "COMPANY",
          "CUSTOMER",
          "ASSET CODE",
          "VAT BILL OR NOT",
          "LAST WORKING DAY",
          "WORK START",
          "DAYS WORKED",
        ].includes(colHead) ||
        cType === "date" ||
        colHead.includes("DATE") ||
        colHead.includes("EXPIRE") ||
        colHead.includes("EQUIPMENT REACHED") ||
        alignVal === "center",
      isRight = alignVal === "right";
    let alignStyle = `justify-content: ${isCenter ? "center" : isRight ? "flex-end" : "space-between"};`,
      textAlign = isCenter
        ? "text-align: center;"
        : isRight
          ? "text-align: right;"
          : "text-align: left;";
    let isSN = colHead === "SN",
      thClass = isSN ? "sn-column" : "",
      iconsContainerHTML = "",
      renameFn = "";
    if (!isSN) {
      let isLocked = globalLockedCols.includes(h),
        lockClass = isLocked ? "lock-icon is-locked" : "lock-icon",
        lockStyle = isLocked ? "color:#dc2626;" : "color:#cbd5e1;",
        lockIconHTML = "";
      if (currentUser.role === "Super Admin") {
        lockIconHTML = `<span class="material-icons ${lockClass}" style="${lockStyle}" onclick="toggleColumnLock(event, '${h}', ${!isLocked})" title="${isLocked ? "Unlock Column" : "Lock Column"}">${isLocked ? "lock" : "lock_open"}</span>`;
      } else if (isLocked) {
        lockIconHTML = `<span class="material-icons ${lockClass}" style="${lockStyle} cursor:not-allowed;" title="Locked by Admin">lock</span>`;
      }
      let filterIconHTML = `<span class="material-icons filter-icon" onclick="openFilterMenu(event, '${h}', this)">filter_list</span>`;
      iconsContainerHTML = `<div class="header-icons">${lockIconHTML}${filterIconHTML}</div>`;
      renameFn =
        currentUser.role === "Super Admin" && !FIXED_COLUMNS.includes(colHead)
          ? `ondblclick="renameColumn(event, '${h}')"`
          : "";
    }
    theadHtml += `<th class="${thClass}" data-colidx="${i}" title="${isSN ? "" : "Right click for Column Options"}"><div class="header-content" style="${alignStyle}"><span class="col-title-text" style="${textAlign}" ${renameFn}>${h}</span>${iconsContainerHTML}</div></th>`;
  });
  theadHtml += "</tr></thead><tbody>";

  let tbodyHtml = "";
  response.rows.forEach((row) => {
    let dbId = row.pop(),
      cClass = conflictMap[dbId] || "";
    tbodyHtml += `<tr data-sheetrow="${dbId}" class="${cClass}">`;
    row.forEach((cell, index) => {
      let colName = response.headers[index],
        colTypeObj = cachedColTypes.find((c) => c.name === colName),
        cType = colTypeObj ? colTypeObj.type : "varchar",
        colHead = String(colName).replace(/\s+/g, " ").trim().toUpperCase(),
        alignObj = cachedAlignments.find((a) => a.name === colName),
        alignVal = alignObj ? alignObj.align : "left",
        isCenter =
          [
            "PLATE NUMBER",
            "SITE",
            "IF SUB",
            "COMPANY",
            "CUSTOMER",
            "ASSET CODE",
            "VAT BILL OR NOT",
            "LAST WORKING DAY",
            "WORK START",
            "DAYS WORKED",
          ].includes(colHead) ||
          cType === "date" ||
          colHead.includes("DATE") ||
          colHead.includes("EXPIRE") ||
          colHead.includes("EQUIPMENT REACHED") ||
          alignVal === "center",
        isRight = alignVal === "right",
        stylesArr = [];
      let isSN = colHead === "SN";
      if (isSN) {
        cell = snCounter++;
        stylesArr.push(
          "width: 40px",
          "min-width: 40px",
          "max-width: 40px",
          "text-align: center",
        );
      }
      if (!isSN && isCenter) stylesArr.push("text-align: center");
      else if (!isSN && isRight) stylesArr.push("text-align: right");

      let tdClass = isSN ? 'class="sn-column"' : "";
      let styleAttr =
        stylesArr.length > 0 ? `style="${stylesArr.join("; ")}"` : "";

      // FIX: Force line breaks to render in browser for array history
      if (typeof cell === "string" && cell.includes("\n")) {
        styleAttr = styleAttr.replace(
          'style="',
          'style="white-space: pre-line !important; ',
        );
        if (!styleAttr) styleAttr = 'style="white-space: pre-line !important;"';
      }

      tbodyHtml += `<td data-colname="${colName}" ${tdClass} ${styleAttr}>${cell}</td>`;
    });
    tbodyHtml += "</tr>";
  });
  tbodyHtml += "</tbody>";
  tableEl.innerHTML = theadHtml + tbodyHtml;

  erpDataTable = $("#erpTable").DataTable({
    deferRender: true,
    dom: '<"top-ribbon"<"ribbon-left"B> f <"right-controls"l i p>><"table-scroll-wrapper"t>',
    ordering: true,
    order: [],
    colReorder: { realtime: false },
    orderCellsTop: true,
    language: {
      search: "",
      searchPlaceholder: "Search records...",
      lengthMenu: "_MENU_ rows",
      info: "_START_ - _END_ of _TOTAL_",
      paginate: { previous: "Prev", next: "Next" },
    },
    lengthMenu: [
      [50, 100, 200, 500, 1000, 2500, 5000],
      ["50", "100", "200", "500", "1000", "2500", "5000"],
    ],
    pageLength: 50,
    autoWidth: false,
    stateSave: true,
    rowCallback: function (row, data) {
      let sIdx = cachedHeaders.findIndex(
          (h) => h.trim().toLowerCase() === "status",
        ),
        statusVal = "";
      if (sIdx !== -1) {
        statusVal = String(data[sIdx]).trim().toLowerCase();
        $(row).removeClass("status-released status-replaced status-mobilizing");
        if (statusVal === "released") $(row).addClass("status-released");
        else if (statusVal === "replaced") $(row).addClass("status-replaced");
        else if (statusVal === "mobilizing")
          $(row).addClass("status-mobilizing");
      }
      let today = new Date();
      today.setHours(0, 0, 0, 0);
      let colWraps = JSON.parse(localStorage.getItem("erpColWraps")) || {};

      cachedHeaders.forEach((h, idx) => {
        let $td = $("td", row).eq(idx),
          colHead = String(h).replace(/\s+/g, " ").trim().toUpperCase();
        if (colWraps[h] === "wrap") {
          $td[0].style.setProperty("white-space", "normal", "important");
          $td[0].style.setProperty("word-break", "break-word", "important");
        } else if (colWraps[h] === "nowrap") {
          $td[0].style.setProperty("white-space", "nowrap", "important");
          $td[0].style.setProperty("text-overflow", "ellipsis", "important");
          $td[0].style.setProperty("overflow", "hidden", "important");
        } else {
          $td.css({
            "white-space": "",
            "word-break": "",
            "text-overflow": "",
            overflow: "",
          });
        }

        // KEEP PRE-LINE FOR HISTORY NEWLINES OVERRIDING THE OTHERS
        if (typeof data[idx] === "string" && data[idx].includes("\n")) {
          $td[0].style.setProperty("white-space", "pre-line", "important");
        }

        if (
          colHead.includes("IQAMA EXPIRE") ||
          colHead.includes("LICENSE EXPIRE") ||
          colHead.includes("LICENCE EXPIRE") ||
          colHead.includes("EQ INSURAN") ||
          colHead.includes("FAHS MVPI")
        ) {
          $td.removeClass("expired-date expiring-date");
          if (statusVal === "running") {
            let dateStr = data[idx];
            if (dateStr && String(dateStr).trim() !== "") {
              let parsedDateStr = convertToInputDate(dateStr);
              if (parsedDateStr) {
                let expDate = new Date(`${parsedDateStr}T00:00:00`);
                if (!isNaN(expDate.getTime())) {
                  expDate.setHours(0, 0, 0, 0);
                  let diffDays = Math.ceil(
                    (expDate.getTime() - today.getTime()) /
                      (1000 * 60 * 60 * 24),
                  );
                  if (diffDays < 0) $td.addClass("expired-date");
                  else if (diffDays >= 0 && diffDays <= 30)
                    $td.addClass("expiring-date");
                }
              }
            }
          }
        }
      });
    },
    buttons: [
      {
        text: '<span class="material-icons" style="font-size:16px;">download</span> Export',
        className: "dt-button btn-outline",
        extend: "excelHtml5",
        title: "",
        exportOptions: {
          columns: ":visible",
          stripNewlines: false,
          format: {
            header: function (data, columnIdx, node) {
              return $(node).find(".col-title-text").length > 0
                ? $(node).find(".col-title-text").text().trim()
                : $(node).text().trim();
            },
          },
        },
        customize: function (xlsx) {
          var sheet = xlsx.xl.worksheets["sheet1.xml"];
          var styles = xlsx.xl["styles.xml"];

          // 1. Create a custom Date Format (dd-mmm-yyyy) in Excel's backend styles
          var numFmts = $("numFmts", styles);
          if (numFmts.length === 0) {
            $("styleSheet", styles).prepend(
              '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/></numFmts>',
            );
          } else {
            numFmts.attr("count", parseInt(numFmts.attr("count")) + 1);
            numFmts.append('<numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/>');
          }

          var cellXfs = $("cellXfs", styles);
          var xfCount = parseInt(cellXfs.attr("count"));
          cellXfs.attr("count", xfCount + 1);
          cellXfs.append(
            '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyFont="1" applyFill="1" applyBorder="1" xfId="0" applyNumberFormat="1"/>',
          );

          var dateStyleId = xfCount; // New style ID for our date format

          // 2. Apply Serial Number and the new Date Style to cells
          var dateRegex = /^\d{2}-[A-Za-z]{3}-\d{4}$/;
          var monthMap = {
            Jan: 0,
            Feb: 1,
            Mar: 2,
            Apr: 3,
            May: 4,
            Jun: 5,
            Jul: 6,
            Aug: 7,
            Sep: 8,
            Oct: 9,
            Nov: 10,
            Dec: 11,
          };

          $("row c", sheet).each(function () {
            var $cell = $(this);
            var $is = $cell.find("is t");

            if ($is.length) {
              var text = $is.text();

              if (text.indexOf("\n") > -1 || text.indexOf("\r") > -1) {
                $cell.attr("s", "55"); // Keep wrap text for Driver Logs
              }

              if (dateRegex.test(text)) {
                var parts = text.split("-");
                var dateObj = new Date(
                  Date.UTC(parts[2], monthMap[parts[1]], parts[0]),
                );
                var excelSerialDate =
                  25569.0 + dateObj.getTime() / (1000 * 60 * 60 * 24);

                $cell.attr("t", "n"); // Change type to Number
                $cell.attr("s", dateStyleId); // Apply our injected Date Style
                $cell.html("<v>" + excelSerialDate + "</v>"); // Set the serial value
              }
            }
          });
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">edit_note</span> Bulk Edit',
        className: "dt-button btn-outline bulk-edit-toggle-btn",
        action: function () {
          document.querySelector(".dt-buttons").classList.remove("show");
          toggleBulkEditMode();
        },
        init: function (api, node, config) {
          if (currentUser.role !== "Super Admin") $(node).hide();
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">upload_file</span> Import',
        className: "dt-button btn-outline",
        action: function () {
          openImportModal();
        },
        init: function (api, node, config) {
          if (currentUser.role !== "Super Admin") $(node).hide();
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">backup</span> Backup',
        className: "dt-button btn-outline",
        action: function () {
          document.querySelector(".dt-buttons").classList.remove("show");
          if (currentUser.role === "Viewer")
            return showToast("Access Denied.", "error");
          $("#tempBackupEmail").val("");
          $("#emailBackupModalOverlay").css("display", "flex");
          $("#tempBackupEmail").focus();
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">visibility</span> Columns',
        className: "dt-button btn-outline",
        action: () => {
          document.querySelector(".dt-buttons").classList.remove("show");
          openColVisModal();
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">wrap_text</span> Data Wrap',
        className: "dt-button btn-outline",
        action: function () {
          toggleTextWrap();
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">view_headline</span> Header Wrap',
        className: "dt-button btn-outline",
        action: function () {
          toggleHeaderWrap();
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">filter_alt_off</span> Clear Filters',
        className: "dt-button btn-outline",
        action: function () {
          document.querySelector(".dt-buttons").classList.remove("show");
          activeFilters = {};
          $(".filter-icon").removeClass("filter-active").text("filter_list");
          erpDataTable.draw();
          showToast("All Filters Cleared", "success");
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">restart_alt</span> Reset',
        className: "dt-button btn-outline",
        action: function () {
          document.querySelector(".dt-buttons").classList.remove("show");
          erpDataTable.colReorder.reset();
          erpDataTable.columns().visible(true);
          erpDataTable.order([]);
          activeFilters = {};
          $(".filter-icon").removeClass("filter-active").text("filter_list");
          erpDataTable.draw();
          localStorage.removeItem("erpColWidths");
          showToast("Reloading...", "info");
          setTimeout(() => location.reload(), 1000);
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">undo</span>',
        className: "dt-button btn-outline dt-undo-btn",
        action: function () {
          document.querySelector(".dt-buttons").classList.remove("show");
          performUndo();
        },
        init: function (api, node, config) {
          $(node).prop("disabled", true);
        },
      },
      {
        text: '<span class="material-icons" style="font-size:16px;">redo</span>',
        className: "dt-button btn-outline dt-redo-btn",
        action: function () {
          document.querySelector(".dt-buttons").classList.remove("show");
          performRedo();
        },
        init: function (api, node, config) {
          $(node).prop("disabled", true);
        },
      },
    ],
    initComplete: function () {
      $("#erpTable thead th").off("click.DT");
      if ($(".mobile-tools-btn").length === 0) {
        $(".ribbon-left").prepend(
          '<button class="mobile-tools-btn" onclick="toggleMobileTools(event)"><span class="material-icons" style="font-size:16px;">settings</span> Tools</button>',
        );
      }
      applyColumnResizing();
      attachContextMenus();
      for (let colName in activeFilters) {
        if (activeFilters[colName].length > 0) {
          let targetTh = $("#erpTable th").filter(function () {
            return $(this).find(".col-title-text").text().trim() === colName;
          });
          if (targetTh.length > 0)
            targetTh
              .find(".filter-icon")
              .addClass("filter-active")
              .text("filter_alt");
        }
      }
      let newScrollWrapper = document.querySelector(".table-scroll-wrapper");
      if (newScrollWrapper) {
        newScrollWrapper.style.scrollBehavior = "auto";
        newScrollWrapper.scrollTop = preserveScrollTop;
        newScrollWrapper.scrollLeft = preserveScrollLeft;
        setTimeout(
          () => (newScrollWrapper.style.scrollBehavior = "smooth"),
          50,
        );
      }
    },
  });

  erpDataTable
    .on("order.dt search.dt", function () {
      let i = 1;
      erpDataTable
        .cells(null, 0, { search: "applied", order: "applied" })
        .every(function (cell) {
          this.data(i++);
        });
    })
    .draw();
  attachEditListeners();
}

function toggleTree(iconEl) {
  let $icon = $(iconEl),
    $children = $icon.closest(".tree-node").children(".tree-children");
  if ($children.is(":visible")) {
    $children.slideUp(150);
    $icon.text("►");
    $icon.removeClass("text-blue-600");
  } else {
    $children.slideDown(150);
    $icon.text("▼");
    $icon.addClass("text-blue-600");
  }
}

function updateParentCheckboxes() {
  $(".month-cb").each(function () {
    let y = $(this).data("year"),
      m = $(this).data("month"),
      totalDays = $(`.day-cb[data-year="${y}"][data-month="${m}"]`).length,
      checkedDays = $(
        `.day-cb[data-year="${y}"][data-month="${m}"]:checked`,
      ).length;
    $(this).prop("checked", totalDays > 0 && totalDays === checkedDays);
  });
  $(".year-cb").each(function () {
    let y = $(this).data("year"),
      totalMonths = $(`.month-cb[data-year="${y}"]`).length,
      checkedMonths = $(`.month-cb[data-year="${y}"]:checked`).length;
    $(this).prop("checked", totalMonths > 0 && totalMonths === checkedMonths);
  });
  let visibleLeaves = $(".col-filter-cb:visible");
  if (visibleLeaves.length > 0) {
    let checkedLeaves = visibleLeaves.filter(":checked").length;
    $("#filterSelectAll").prop(
      "checked",
      visibleLeaves.length === checkedLeaves,
    );
  } else {
    $("#filterSelectAll").prop("checked", false);
  }
}

function openFilterMenu(event, colName, iconElement) {
  event.stopPropagation();
  currentFilterColName = colName;
  const menu = $("#excelFilterMenu"),
    listContainer = $("#filterChecklist");
  listContainer.empty();
  let colIdx = erpDataTable.column($(iconElement).closest("th")).index();
  let allOptions = new Set();
  erpDataTable.rows().every(function () {
    let rowData = this.data();
    let passesOtherFilters = true;
    for (let filterCol in activeFilters) {
      if (filterCol === colName) continue;
      let allowedValues = activeFilters[filterCol];
      if (!allowedValues || allowedValues.length === 0) continue;
      let fIdx = cachedHeaders.indexOf(filterCol);
      if (fIdx === -1) continue;
      let cellVal = String(rowData[fIdx] || "").trim();
      if (!allowedValues.includes(cellVal)) {
        passesOtherFilters = false;
        break;
      }
    }
    if (passesOtherFilters)
      allOptions.add(String(rowData[colIdx] || "").trim());
  });

  let allData = Array.from(allOptions).sort(),
    isDateCol = false;
  if (allData.length > 0) {
    let sample = allData.find((v) => v && v.trim() !== "");
    if (sample && /^\d{2}-[a-zA-Z]{3}-\d{4}$/.test(sample.trim()))
      isDateCol = true;
  }
  let previouslySelected = activeFilters[colName] || [],
    isAllSelected = previouslySelected.length === 0;
  $("#filterSelectAll").prop("checked", isAllSelected);
  $("#filterSelectAll")
    .off("change")
    .on("change", function () {
      let isChecked = $(this).is(":checked"),
        keyword = $("#filterSearchInput").val().toLowerCase();
      if (keyword === "") {
        $(".col-filter-cb").prop("checked", isChecked);
        $(".tree-cb").prop("checked", isChecked);
      } else {
        $(".col-filter-cb:visible").prop("checked", isChecked);
        $(".tree-cb:visible").prop("checked", isChecked);
      }
      updateParentCheckboxes();
    });

  if (isDateCol) {
    let dateTree = {},
      hasBlank = false,
      monthOrder = {
        Jan: 1,
        Feb: 2,
        Mar: 3,
        Apr: 4,
        May: 5,
        Jun: 6,
        Jul: 7,
        Aug: 8,
        Sep: 9,
        Oct: 10,
        Nov: 11,
        Dec: 12,
      };
    allData.forEach((val) => {
      if (!val || val.trim() === "") {
        hasBlank = true;
        return;
      }
      let p = convertToInputDate(val).split("-");
      if (p.length === 3) {
        let d = p[2],
          originalParts = val.split(/[\/\- \.]/),
          m = originalParts[1].substring(0, 3),
          y = p[0];
        if (!dateTree[y]) dateTree[y] = {};
        if (!dateTree[y][m]) dateTree[y][m] = [];
        if (!dateTree[y][m].includes(d)) dateTree[y][m].push(d);
      } else hasBlank = true;
    });

    if (hasBlank) {
      let isChecked = isAllSelected || previouslySelected.includes("");
      listContainer.append(
        `<div class="filter-item filter-row-item" style="padding-left:15px;"><input type="checkbox" value="" ${isChecked ? "checked" : ""} class="col-filter-cb leaf-cb"><label>(Blank)</label></div>`,
      );
    }
    Object.keys(dateTree)
      .sort((a, b) => b - a)
      .forEach((year) => {
        let yId = `flt_y_${year}`,
          yearHtml = `<div class="tree-node"><div class="filter-item tree-header" style="background:#f8fafc; border-top:1px solid #f1f5f9;"><span class="toggle-icon" onclick="toggleTree(this)">►</span><input type="checkbox" id="${yId}" class="tree-cb year-cb" data-year="${year}"><label for="${yId}" style="font-weight:700;">${year}</label></div><div class="tree-children" style="display:none; padding-left: 20px;">`;
        Object.keys(dateTree[year])
          .sort((a, b) => monthOrder[a] - monthOrder[b])
          .forEach((month) => {
            let mId = `flt_m_${year}_${month}`;
            yearHtml += `<div class="tree-node"><div class="filter-item tree-header"><span class="toggle-icon" onclick="toggleTree(this)">►</span><input type="checkbox" id="${mId}" class="tree-cb month-cb" data-year="${year}" data-month="${month}"><label for="${mId}" style="font-weight:600; color:#475569;">${month}</label></div><div class="tree-children" style="display:none; padding-left: 20px;">`;
            dateTree[year][month]
              .sort((a, b) => parseInt(a) - parseInt(b))
              .forEach((day) => {
                let dId = `flt_d_${year}_${month}_${day}`,
                  matchStr = `${day}-${month}-${year}`,
                  exactVal =
                    allData.find(
                      (v) =>
                        v &&
                        v.includes(day) &&
                        v.includes(month) &&
                        v.includes(year),
                    ) || matchStr,
                  isChecked =
                    isAllSelected || previouslySelected.includes(exactVal);
                yearHtml += `<div class="filter-item filter-row-item"><input type="checkbox" id="${dId}" value="${exactVal}" ${isChecked ? "checked" : ""} class="col-filter-cb leaf-cb day-cb" data-year="${year}" data-month="${month}"><label for="${dId}" style="color:#64748b;">${day}</label></div>`;
              });
            yearHtml += `</div></div>`;
          });
        yearHtml += `</div></div>`;
        listContainer.append(yearHtml);
      });
    updateParentCheckboxes();
    $(".year-cb").on("change", function () {
      let y = $(this).data("year"),
        isChecked = $(this).is(":checked");
      $(`.month-cb[data-year="${y}"], .day-cb[data-year="${y}"]`).prop(
        "checked",
        isChecked,
      );
      updateParentCheckboxes();
    });
    $(".month-cb").on("change", function () {
      let y = $(this).data("year"),
        m = $(this).data("month"),
        isChecked = $(this).is(":checked");
      $(`.day-cb[data-year="${y}"][data-month="${m}"]`).prop(
        "checked",
        isChecked,
      );
      updateParentCheckboxes();
    });
    $(".day-cb, .leaf-cb").on("change", updateParentCheckboxes);
  } else {
    allData.forEach((val) => {
      let displayVal = val.trim() === "" ? "(Blank)" : val,
        isChecked = isAllSelected || previouslySelected.includes(val),
        id = "flt_" + Math.random().toString(36).substr(2, 9);
      listContainer.append(
        `<div class="filter-item filter-row-item"><input type="checkbox" id="${id}" value="${val.replace(/"/g, "&quot;")}" ${isChecked ? "checked" : ""} class="col-filter-cb"><label for="${id}">${displayVal}</label></div>`,
      );
    });
    $(".col-filter-cb").on("change", updateParentCheckboxes);
  }

  $("#filterSearchInput")
    .off("keyup")
    .on("keyup", function () {
      let keyword = $(this).val().toLowerCase();
      if (keyword === "") {
        $(".tree-node, .filter-row-item").show();
      } else {
        if ($(".tree-node").length === 0) {
          $(".filter-row-item").each(function () {
            $(this).toggle($(this).text().toLowerCase().indexOf(keyword) > -1);
          });
        } else {
          $(".tree-node, .filter-row-item").hide();
          $(".filter-row-item, .tree-header").each(function () {
            if ($(this).text().toLowerCase().indexOf(keyword) > -1) {
              $(this).show();
              $(this).parents(".tree-node").show();
              $(this).parents(".tree-children").show();
              $(this)
                .parents(".tree-node")
                .find("> .tree-header .toggle-icon")
                .text("▼")
                .addClass("text-blue-600");
              if ($(this).hasClass("tree-header"))
                $(this)
                  .siblings(".tree-children")
                  .find(".filter-row-item, .tree-node")
                  .show();
            }
          });
        }
      }
      updateParentCheckboxes();
    });

  if (window.innerWidth <= 768) {
    menu
      .css({
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "90%",
        maxWidth: "350px",
        maxHeight: "80vh",
      })
      .show();
    if (!document.getElementById("mobileFilterOverlay")) {
      const overlay = document.createElement("div");
      overlay.id = "mobileFilterOverlay";
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "100vw";
      overlay.style.height = "100vh";
      overlay.style.background = "rgba(0,0,0,0.5)";
      overlay.style.zIndex = "9998";
      overlay.onclick = closeCustomFilter;
      document.body.appendChild(overlay);
    } else
      document.getElementById("mobileFilterOverlay").style.display = "block";
  } else {
    let offset = $(iconElement).offset(),
      leftPos = offset.left - 200;
    if (leftPos < 0) leftPos = 10;
    menu
      .css({
        top: offset.top + 25 + "px",
        left: leftPos + "px",
        transform: "none",
      })
      .show();
  }
  $("#filterSearchInput").val("").focus();
}

function closeCustomFilter() {
  $("#excelFilterMenu").hide();
  const overlay = document.getElementById("mobileFilterOverlay");
  if (overlay) overlay.style.display = "none";
}

function applyCustomFilter() {
  let selectedValues = [],
    totalVisible = $(".col-filter-cb").length,
    checkedCount = 0;
  $(".col-filter-cb").each(function () {
    if ($(this).is(":checked")) {
      selectedValues.push($(this).val());
      checkedCount++;
    }
  });
  let targetTh = $("#erpTable th").filter(function () {
    return (
      $(this).find(".col-title-text").text().trim() === currentFilterColName
    );
  });
  if (targetTh.length > 0) {
    const icon = targetTh.find(".filter-icon");
    if (checkedCount === totalVisible || checkedCount === 0) {
      activeFilters[currentFilterColName] = [];
      icon.removeClass("filter-active").text("filter_list");
    } else {
      activeFilters[currentFilterColName] = selectedValues;
      icon.addClass("filter-active").text("filter_alt");
    }
  }
  closeCustomFilter();
  erpDataTable.draw();
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

function toggleAllColumns(show) {
  $(".col-vis-cb").prop("checked", show);
  if (erpDataTable) {
    erpDataTable.columns().visible(show, false);
    erpDataTable.columns.adjust().draw(false);
  }
}

function openColVisModal() {
  document.getElementById("colVisList").innerHTML = "";
  erpDataTable.columns().every(function (index) {
    let title = cachedHeaders[index];
    if (!title) return;
    $("#colVisList").append(
      `<div class="col-vis-item"><input type="checkbox" class="col-vis-cb" id="col_${index}" ${this.visible() ? "checked" : ""} onchange="erpDataTable.column(${index}).visible(this.checked)" style="margin:0; width: 16px; height: 16px;"><label for="col_${index}" style="cursor:pointer; width:100%; font-size:13px; font-weight:600;">${title}</label></div>`,
    );
  });
  $("#colVisModalOverlay").css("display", "flex");
}

function openAddEntryModal() {
  document.getElementById("userDropdownMenu").classList.remove("show");
  if (currentUser.role === "Viewer")
    return showToast("Access Denied.", "error");
  $("#dynamicFormFields").empty();
  let listsHtml = "";
  const suggestionTargetCols = [
    "PLATE NO",
    "PLATE NUMBER",
    "TYPE OF VEHICLE",
    "VEHICLE TYPE",
    "SITE",
    "CUSTOMER",
    "OWNER",
    "FIELD COORDINATOR",
    "FIELD CO",
    "SITE COORDINATOR",
    "SITE CO",
  ];
  cachedHeaders.forEach((header, index) => {
    let colUpper = header.replace(/\s+/g, " ").trim().toUpperCase();
    if (suggestionTargetCols.includes(colUpper)) {
      let uniqueVals = new Set();
      if (erpDataTable) {
        erpDataTable
          .column(index)
          .data()
          .each((val) => {
            if (val && String(val).trim() !== "")
              uniqueVals.add(String(val).trim());
          });
      }
      let optionsHtml = Array.from(uniqueVals)
        .sort()
        .map((v) => `<option value="${String(v).replace(/"/g, "&quot;")}">`)
        .join("");
      listsHtml += `<datalist id="datalist_entry_${index}">${optionsHtml}</datalist>`;
    }
  });
  $("#dynamicFormFields").append(listsHtml);

  cachedHeaders.forEach((header, index) => {
    let colTypeObj = cachedColTypes.find((c) => c.name === header),
      cType = colTypeObj ? colTypeObj.type : "varchar",
      colUpper = header.replace(/\s+/g, " ").trim().toUpperCase();
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
        colUpper === "WORK START",
      isIntCol = cType === "int";
    let isSuggestionCol = suggestionTargetCols.includes(colUpper),
      listAttr = isSuggestionCol ? `list="datalist_entry_${index}"` : "";
    let inputHtml = `<input type="text" class="modal-input entry-input" data-colname="${header}" ${listAttr}>`;

    if (isDateCol) {
      inputHtml = `<input type="date" class="modal-input entry-input" data-colname="${header}">`;
    } else if (isIntCol) {
      inputHtml = `<input type="number" class="modal-input entry-input" data-colname="${header}">`;
    } else if (["REMARK", "REMARKS", "DRIVER LOG"].includes(colUpper)) {
      inputHtml = `<textarea class="modal-input entry-input" data-colname="${header}"></textarea>`;
    } else if (colUpper === "IF SUB") {
      inputHtml = `<select class="modal-input entry-input" data-colname="${header}"><option value="">(Blank)</option><option value="Sub">Sub</option></select>`;
    } else if (colUpper === "STATUS") {
      inputHtml = `<select class="modal-input entry-input" data-colname="${header}"><option value="">Select Status</option><option value="Running">Running</option><option value="Released">Released</option><option value="Replaced">Replaced</option><option value="Mobilizing">Mobilizing</option></select>`;
    } else if (colUpper === "COMPANY") {
      inputHtml = `<select class="modal-input entry-input" data-colname="${header}"><option value="">Select Company</option><option value="Haka">Haka</option><option value="Aljoda">Aljoda</option><option value="Masar Wheels">Masar Wheels</option><option value="We1">We1</option></select>`;
    } else if (colUpper === "VAT BILL OR NOT") {
      inputHtml = `<select class="modal-input entry-input" data-colname="${header}"><option value="">Select Option</option><option value="Yes">Yes</option><option value="No">No</option></select>`;
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
    let val = $(this).val().trim(),
      cName = String($(this).data("colname")).trim(),
      colTypeObj = cachedColTypes.find((c) => c.name === cName),
      cType = colTypeObj ? colTypeObj.type : "varchar",
      colUpper = cName.toUpperCase(),
      isDateCol =
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

async function sendCustomBackup() {
  let targetEmail = $("#tempBackupEmail").val().trim();
  if (!targetEmail) return showToast("Please enter an email address.", "error");
  $("#emailBackupModalOverlay").hide();
  showToast(`Generating Backup for ${targetEmail}...`, "info");
  try {
    const res = await fetch("/api/custom-backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetEmail: targetEmail }),
    });
    const data = await res.json();
    if (data.success) showToast(`Backup sent!`, "success");
    else showToast(data.message, "error");
  } catch (error) {
    showToast("Server connection failed.", "error");
  }
}

function applyColumnResizing() {
  const table = document.getElementById("erpTable"),
    cols = table.querySelectorAll(".main-header th");
  cols.forEach((col, index) => {
    let colName = col.querySelector(".col-title-text").innerText.trim();
    if (colName.toUpperCase() === "SN") return;
    let widthObj = cachedColWidths.find((w) => w.name === colName);
    let widthToApply = widthObj && widthObj.width ? widthObj.width : "100px";
    col.style.width = widthToApply;
    col.style.minWidth = widthToApply;
    col.style.maxWidth = widthToApply;
    const resizer = document.createElement("div");
    resizer.classList.add("col-resizer");
    col.appendChild(resizer);
    let startX,
      startWidth,
      isResizing = false;

    resizer.addEventListener("mousedown", function (e) {
      startX = e.clientX;
      startWidth = col.offsetWidth;
      isResizing = true;
      resizer.classList.add("resizing");
      document.addEventListener("mousemove", mouseMoveHandler);
      document.addEventListener("mouseup", mouseUpHandler);
      e.stopPropagation();
      e.preventDefault();
    });

    const mouseMoveHandler = function (e) {
      if (isResizing) {
        requestAnimationFrame(() => {
          const newWidth = Math.max(40, startWidth + (e.clientX - startX));
          col.style.width = `${newWidth}px`;
          col.style.minWidth = `${newWidth}px`;
          col.style.maxWidth = `${newWidth}px`;
        });
      }
    };
    const mouseUpHandler = function () {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove("resizing");
        document.removeEventListener("mousemove", mouseMoveHandler);
        document.removeEventListener("mouseup", mouseUpHandler);
        let finalWidth = col.style.width;
        fetch("/api/update-col-width", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ colName: colName, width: finalWidth }),
        }).catch((e) => console.error("Width save failed", e));
      }
    };
  });
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

function performUndo() {
  if (undoStack.length === 0) return;
  let action = undoStack.pop();
  redoStack.push(action);
  updateUndoRedoUI();
  applyHistoricalState(action.sheetRow, action.colName, action.oldVal);
  showToast("Undo applied", "info");
}
function performRedo() {
  if (redoStack.length === 0) return;
  let action = redoStack.pop();
  undoStack.push(action);
  updateUndoRedoUI();
  applyHistoricalState(action.sheetRow, action.colName, action.newVal);
  showToast("Redo applied", "info");
}

function applyHistoricalState(dbId, colName, value) {
  let rowIndex = erpDataTable.row(`[data-sheetrow="${dbId}"]`).index(),
    colIndex = cachedHeaders.indexOf(colName);
  if (rowIndex !== undefined && colIndex !== -1)
    erpDataTable.cell(rowIndex, colIndex).data(value).draw(false);
  let colUpper = String(colName).replace(/\s+/g, " ").trim().toUpperCase(),
    $row = $(`#erpTable tbody tr[data-sheetrow="${dbId}"]`);
  if (colUpper === "STATUS" && $row.length) {
    $row.removeClass("status-released status-replaced status-mobilizing");
    let sVal = value.trim().toLowerCase();
    if (sVal === "released") $row.addClass("status-released");
    else if (sVal === "replaced") $row.addClass("status-replaced");
    else if (sVal === "mobilizing") $row.addClass("status-mobilizing");
  }
  if ($row.length) {
    let $cell = $row.find(`td[data-colname="${colName}"]`);
    if ($cell.length) {
      $cell[0].scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      $cell.css("transition", "background-color 0.3s ease");
      $cell.css("background-color", "#fef08a");
      setTimeout(() => {
        $cell.css("background-color", "");
      }, 1500);
    }
  }
  saveQueue.push({ dbId: dbId, colName: colName, newValue: value });
  processQueue();
}

function attachEditListeners() {
  $("#erpTable tbody")
    .off("click", "td")
    .on("click", "td", function () {
      if ($(this).find(".edit-input").length > 0) return;
      const range = document.createRange(),
        sel = window.getSelection();
      range.selectNodeContents(this);
      sel.removeAllRanges();
      sel.addRange(range);
    });
  $("#erpTable tbody")
    .off("dblclick", "td")
    .on("dblclick", "td", function () {
      if ($(this).find(".edit-input").length > 0) return;
      if (currentUser.role === "Viewer")
        return showToast("Access Denied.", "error");

      let $cell = $(this),
        colName = $cell.data("colname"),
        colUpper = String(colName).replace(/\s+/g, " ").trim().toUpperCase();
      if (
        globalLockedCols.includes(colName) &&
        currentUser.role !== "Super Admin"
      )
        return showToast("Column is locked by Super Admin.", "error");
      if (colUpper === "SN")
        return showToast("Access Denied: SN is auto-generated.", "error");
      if (
        ["OD WRK END", "DAYS WORKED", "OLD DRIVER NAME", "OD MOB"].includes(
          colUpper,
        )
      )
        return showToast("Auto calculated column.", "warning");

      let oldVal = $cell.text(),
        sheetRow = $cell.closest("tr").data("sheetrow");
      let colTypeObj = cachedColTypes.find((c) => c.name === colName),
        cType = colTypeObj ? colTypeObj.type : "varchar";
      let inputHtml = "",
        isSelect = false,
        isDateCol =
          cType === "date" ||
          colUpper.includes("DATE") ||
          colUpper.includes("EXPIRE") ||
          colUpper.includes("EQUIPMENT REACHED") ||
          colUpper === "LAST WORKING DAY" ||
          colUpper === "WORK START",
        isIntCol = cType === "int";

      if (isDateCol) {
        inputHtml = `<input type="date" class="edit-input" value="${convertToInputDate(oldVal)}">`;
      } else if (isIntCol) {
        inputHtml = `<input type="number" class="edit-input" value="${oldVal.replace(/"/g, "&quot;")}">`;
      } else if (["REMARK", "REMARKS", "DRIVER LOG"].includes(colUpper)) {
        inputHtml = `<textarea class="edit-input">${oldVal}</textarea>`;
      } else if (colUpper === "STATUS") {
        let optsStatus = ["Running", "Released", "Replaced", "Mobilizing"],
          optionsStatusHtml = optsStatus
            .map(function (o) {
              return `<option value="${o}" ${oldVal.toLowerCase() === o.toLowerCase() ? "selected" : ""}>${o}</option>`;
            })
            .join("");
        inputHtml = `<select class="edit-input"><option value=""></option>${optionsStatusHtml}</select>`;
        isSelect = true;
      } else if (colUpper === "IF SUB") {
        let optsSub = ["Sub"],
          optionsSubHtml = optsSub
            .map(function (o) {
              return `<option value="${o}" ${oldVal === o ? "selected" : ""}>${o}</option>`;
            })
            .join("");
        inputHtml = `<select class="edit-input"><option value=""></option>${optionsSubHtml}</select>`;
        isSelect = true;
      } else if (colUpper === "COMPANY") {
        let optsComp = ["Haka", "Aljoda", "Masar Wheels", "We1"],
          optionsCompHtml = optsComp
            .map(function (o) {
              return `<option value="${o}" ${oldVal === o ? "selected" : ""}>${o}</option>`;
            })
            .join("");
        inputHtml = `<select class="edit-input"><option value=""></option>${optionsCompHtml}</select>`;
        isSelect = true;
      } else if (colUpper === "VAT BILL OR NOT") {
        let optsVat = ["Yes", "No"],
          optionsVatHtml = optsVat
            .map(function (o) {
              return `<option value="${o}" ${oldVal === o ? "selected" : ""}>${o}</option>`;
            })
            .join("");
        inputHtml = `<select class="edit-input"><option value=""></option>${optionsVatHtml}</select>`;
        isSelect = true;
      } else {
        inputHtml = `<input type="text" class="edit-input" value="${oldVal.replace(/"/g, "&quot;")}">`;
      }

      let $input = $(inputHtml);
      $cell.html($input);
      $input.focus();
      if (!isSelect && !isDateCol) {
        let v = $input.val();
        $input.val("");
        $input.val(v);
        if ($input.is("textarea"))
          $input.css("height", $input[0].scrollHeight + "px");
      }

      $input.on("keydown", function (e) {
        if (e.key === "Escape") {
          $cell.text(oldVal);
          erpDataTable.cell($cell[0]).data(oldVal);
          return;
        }
        if (e.key === "Enter" && e.altKey && $(this).is("textarea")) {
          e.preventDefault();
          let start = this.selectionStart,
            end = this.selectionEnd,
            val = $(this).val();
          $(this).val(val.substring(0, start) + "\n" + val.substring(end));
          this.selectionStart = this.selectionEnd = start + 1;
          $(this).css("height", "auto");
          $(this).css("height", this.scrollHeight + "px");
          return;
        }
        if (["Enter", "Tab", "ArrowUp", "ArrowDown"].includes(e.key)) {
          if (!isSelect || ["Enter", "Tab"].includes(e.key)) {
            if (e.key === "Enter") e.preventDefault();
            let direction = "";
            if (e.key === "Enter") direction = e.shiftKey ? "UP" : "DOWN";
            else if (e.key === "Tab") {
              direction = e.shiftKey ? "LEFT" : "RIGHT";
              e.preventDefault();
            } else if (e.key === "ArrowUp" && !isDateCol) direction = "UP";
            else if (e.key === "ArrowDown" && !isDateCol) direction = "DOWN";
            if (direction) {
              let $currentRow = $cell.closest("tr"),
                colIndex = $cell.index(),
                $nextCell = null;
              function getValidHorizontalCell($td, dir) {
                let $nxt = dir === "RIGHT" ? $td.next("td") : $td.prev("td");
                if ($nxt.length) {
                  if (
                    String($nxt.data("colname")).trim().toUpperCase() ===
                      "SN" ||
                    $nxt.css("display") === "none"
                  )
                    return getValidHorizontalCell($nxt, dir);
                  return $nxt;
                }
                return null;
              }
              if (direction === "DOWN")
                $nextCell = $currentRow.next("tr").find("td").eq(colIndex);
              else if (direction === "UP")
                $nextCell = $currentRow.prev("tr").find("td").eq(colIndex);
              else if (direction === "RIGHT")
                $nextCell = getValidHorizontalCell($cell, "RIGHT");
              else if (direction === "LEFT")
                $nextCell = getValidHorizontalCell($cell, "LEFT");
              $(this).blur();
              if ($nextCell && $nextCell.length)
                setTimeout(() => $nextCell.dblclick(), 50);
            }
          }
        }
      });
      $input.on("blur", function () {
        if ($cell.find(".edit-input").length === 0) return;
        let newVal = $(this).val();
        if (isDateCol && newVal) newVal = formatToDDMMMYYYY(newVal);
        else if (colUpper === "PLATE NUMBER")
          newVal = formatPlateNumber(newVal);
        $cell.text(newVal);
        erpDataTable.cell($cell[0]).data(newVal);
        if (newVal !== oldVal) {
          undoStack.push({
            sheetRow: sheetRow,
            colName: colName,
            oldVal: oldVal,
            newVal: newVal,
          });
          if (undoStack.length > 50) undoStack.shift();
          redoStack = [];
          updateUndoRedoUI();
          saveQueue.push({
            dbId: sheetRow,
            colName: colName,
            newValue: newVal,
          });
          processQueue();
        }
      });
    });
}

// ==========================================
// ? BULK EDIT EXCEL COPY-PASTE ENGINE
// ==========================================
let isBulkEditModeActive = false;

function toggleBulkEditMode() {
  isBulkEditModeActive = !isBulkEditModeActive;
  const btn = $(".bulk-edit-toggle-btn");

  if (isBulkEditModeActive) {
    $("#erpTable").addClass("bulk-edit-grid-active");
    btn.css({
      background: "var(--success)",
      color: "white",
      "border-color": "var(--success)",
    });
    showToast(
      "Bulk Edit Enabled! Click a starting cell and press Ctrl+V to paste from Excel.",
      "success",
    );
  } else {
    $("#erpTable").removeClass("bulk-edit-grid-active");
    btn.css({ background: "", color: "", "border-color": "" });
    showToast("Bulk Edit Disabled", "info");
  }
}

// Intercept Clipboard Paste Event on Table Cells
$(document).on(
  "paste",
  "#erpTable.bulk-edit-grid-active tbody td",
  function (e) {
    if (currentUser.role !== "Super Admin") return;
    e.preventDefault();

    // Get raw text from clipboard
    let clipboardData = (e.originalEvent || e).clipboardData.getData("text");
    if (!clipboardData) return;

    let rows = clipboardData.split(/\r?\n/);
    let $startTd = $(this);
    let $startTr = $startTd.closest("tr");
    let startColIdx = $startTd.index();

    let $currentTr = $startTr;
    let bulkEditsBatch = [];

    rows.forEach((rowText) => {
      if (!rowText.trim() && rows.length > 1) return; // Skip empty trailing lines
      let cols = rowText.split("\t");

      if (!$currentTr.length) return;
      let dbId = $currentTr.data("sheetrow");

      cols.forEach((cellText, cIdx) => {
        let targetColIdx = startColIdx + cIdx;
        let $targetTd = $currentTr.find("td").eq(targetColIdx);
        if (!$targetTd.length) return;

        let colName = $targetTd.data("colname");
        if (!colName) return;

        let colUpper = String(colName).toUpperCase();

        // Protect Auto-Generated & Calculated Columns
        if (
          colUpper === "SN" ||
          ["OD WRK END", "DAYS WORKED", "OLD DRIVER NAME", "OD MOB"].includes(
            colUpper,
          )
        )
          return;
        if (
          globalLockedCols.includes(colName) &&
          currentUser.role !== "Super Admin"
        )
          return;

        let newValue = cellText.trim();
        let oldValue = $targetTd.text().trim();

        // Strict Text Formatter (No Timezone Issues)
        let colTypeObj = cachedColTypes.find((c) => c.name === colName);
        let cType = colTypeObj ? colTypeObj.type : "varchar";
        let isDateCol =
          cType === "date" ||
          colUpper.includes("DATE") ||
          colUpper.includes("EXPIRE") ||
          colUpper.includes("EQUIPMENT REACHED") ||
          colUpper === "LAST WORKING DAY" ||
          colUpper === "WORK START";

        if (isDateCol && newValue) newValue = formatToDDMMMYYYY(newValue);
        else if (colUpper === "PLATE NUMBER")
          newValue = formatPlateNumber(newValue);

        if (oldValue !== newValue) {
          let rowIndex = erpDataTable.row($currentTr).index();
          let colIdxInDataTable = cachedHeaders.indexOf(colName);

          if (rowIndex !== undefined && colIdxInDataTable !== -1) {
            // Live UI Update
            $targetTd.text(newValue);
            erpDataTable.cell(rowIndex, colIdxInDataTable).data(newValue);

            // Highlight Animation
            $targetTd.css("transition", "background-color 0.3s");
            $targetTd.css("background-color", "#fef08a");
            setTimeout(() => $targetTd.css("background-color", ""), 1500);

            // Add to Batch Queue
            bulkEditsBatch.push({
              dbId: dbId,
              colName: colName,
              newValue: newValue,
            });

            // Add to Undo Stack
            undoStack.push({
              sheetRow: dbId,
              colName: colName,
              oldVal: oldValue,
              newVal: newValue,
            });
          }
        }
      });

      $currentTr = $currentTr.next("tr");
    });

    if (undoStack.length > 50) undoStack = undoStack.slice(-50);
    updateUndoRedoUI();

    if (bulkEditsBatch.length > 0) {
      erpDataTable.draw(false);

      // Save to database seamlessly
      saveQueue.push(...bulkEditsBatch);
      processQueue();

      showToast(
        `Pasted and queued ${bulkEditsBatch.length} updates! Syncing to database...`,
        "success",
      );
    } else {
      showToast("No valid changes detected in paste.", "info");
    }
  },
);
