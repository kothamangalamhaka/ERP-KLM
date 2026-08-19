const token = localStorage.getItem("timesheetToken");
const userStr = localStorage.getItem("timesheetUser");

// 🟢 ടോക്കണോ യൂസർ ഡാറ്റയോ ഇല്ലെങ്കിൽ നിർബന്ധമായും ലോഗൗട്ട് ആക്കും
if (!token || !userStr) {
  localStorage.removeItem("timesheetToken");
  localStorage.removeItem("timesheetUser");
  const currentPage = encodeURIComponent(
    window.location.pathname.split("/").pop() + window.location.search,
  );
  window.location.href = "index.html?redirect=" + currentPage;
}

const dDate = new Date();
document.getElementById("selYear").value = dDate.getFullYear();
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

if (userStr) {
  const u = JSON.parse(userStr);
  const uiEl = document.getElementById("userInfo");
  if (uiEl) uiEl.innerText = `${u.username} (${u.role})`;
}

let rulesCache = [];
let specialRulesCache = [];
let breakRulesCache = []; 
let vehiclesCache = [];
let currentFocus = -1;

let systemLockData = { month: null, year: null }; 
let isEditingInvoice = false;
let currentInvoices = [];
let loggedRowsTracker = new Set();
let currentLockedRecord = null; // 🟢 ഏത് വണ്ടിയാണ് ലോക്ക് ചെയ്തത് എന്ന് ട്രാക്ക് ചെയ്യാൻ

function releaseLock() {
  if (currentLockedRecord) {
    const lockToken = localStorage.getItem("timesheetToken");
    if (lockToken) {
      const payload = JSON.stringify(currentLockedRecord);
      fetch('/timesheet/api/record-lock/release', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + lockToken
        },
        body: payload,
        keepalive: true 
      }).catch(e => console.error("Lock release error:", e));
    }
    currentLockedRecord = null;
  }
}

// 🟢 NEW: Month അല്ലെങ്കിൽ Year മാറ്റുമ്പോൾ പഴയ ലോക്ക് റിലീസ് ആവാൻ
document.getElementById("selMonth").addEventListener("change", releaseLock);
document.getElementById("selYear").addEventListener("change", releaseLock);

// 🟢 NEW: വിൻഡോ പൂർണ്ണമായും ക്ലോസ് ചെയ്യുമ്പോൾ ഉറപ്പായും റിലീസ് ആവാൻ
window.addEventListener("unload", function () {
  releaseLock();
});

async function init() {
  const ts = new Date().getTime();

  const rRes = await fetch(`/timesheet/api/rules?_t=${ts}`, {
    headers: {
      Authorization: "Bearer " + token,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
  
  if (rRes.status === 401 || rRes.status === 403) {
    logout();
    return;
  }
  
  let rData;
  try {
    rData = await rRes.json();
  } catch (e) {
    // നെറ്റ് സ്ലോ ആണെങ്കിൽ ലോഗൗട്ട് ചെയ്യില്ല
    return;
  }

  // 🟢 401/403 (ശരിക്കുമുള്ള ടോക്കൺ എക്സ്പയറി) ആണെങ്കിൽ മാത്രം ലോഗൗട്ട് ആകും
  if (rRes.status === 401 || rRes.status === 403) {
    logout();
    return;
  }

  if (rData && rData.success) rulesCache = rData.data;

  const srRes = await fetch(`/timesheet/api/special-rules?_t=${ts}`, {
    headers: {
      Authorization: "Bearer " + token,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
  const srData = await srRes.json();
  if (srData.success) specialRulesCache = srData.data;

  // 🟢 NEW: Fetch Break Rules
  const brRes = await fetch(`/timesheet/api/break-rules?_t=${ts}`, {
    headers: {
      Authorization: "Bearer " + token,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
  const brData = await brRes.json();
  if (brData.success) breakRulesCache = brData.data;

  const vRes = await fetch(`/timesheet/api/vehicle-info?_t=${ts}`, {
    headers: {
      Authorization: "Bearer " + token,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
  const vData = await vRes.json();
  if (vData.success) vehiclesCache = vData.data;

  // 🟢 NEW: Fetch Lock Status
  const lRes = await fetch(`/api/lock/status?_t=${ts}`, { headers: { Authorization: "Bearer " + token }});
  const lData = await lRes.json().catch(()=>({}));
  if(lData.success && lData.data) {
      systemLockData = { month: lData.data.lock_month, year: lData.data.lock_year };
  }
}

function searchPlate() {
  document.getElementById("selPlate").addEventListener("focus", searchPlate);
  document.getElementById("selPlate").addEventListener("click", searchPlate);
  const val = document.getElementById("selPlate").value.toUpperCase();
  const sug = document.getElementById("plateSuggestions");
  sug.innerHTML = ""; 
  currentFocus = -1;

  // പുതിയ വരി (Clear previous count on new search)
  if(document.getElementById("actualLogsheetCount")) {
      document.getElementById("actualLogsheetCount").innerHTML = "";
  }

  document.getElementById("dispDName").innerText = "N/A";
  document.getElementById("dispDMob").innerText = "N/A";
  document.getElementById("dispOName").innerText = "N/A";
  document.getElementById("dispOMob").innerText = "N/A";
  document.getElementById("dispSite").innerText = "N/A";
  document.getElementById("dispVType").innerText = "N/A";
  document.getElementById("dispFieldCo").innerText = "N/A";
  document.getElementById("dispSiteCo").innerText = "N/A";
  document.getElementById("dispAsset").innerText = "N/A";
  document.getElementById("dispWorkOrder").innerText = "N/A";
  document.getElementById("dispSiteStart").innerText = "N/A";
  document.getElementById("dispSiteEnd").innerText = "N/A";
  if (document.getElementById("oldVehRow"))
    document.getElementById("oldVehRow").style.display = "none";
  if (document.getElementById("newVehRow"))
    document.getElementById("newVehRow").style.display = "none";

  document.getElementById("invSiteSelect").innerHTML =
    '<option value="">Waiting for data...</option>';
  clearInvoiceForm();
  isEditingInvoice = false;
  currentInvoices = [];

  
  releaseLock();

  if (!val) {
    let history = JSON.parse(
      localStorage.getItem("plateSearchHistory") || "[]",
    );
    if (history.length > 0) {
      sug.style.display = "block";
      sug.style.maxHeight = "105px";
      sug.style.overflowY = "auto";
      history.forEach((hPlate) => {
        let div = document.createElement("div");
        div.innerHTML = `<b>${hPlate}</b>`;
        let masterObj = vehiclesCache.find(
          (v) => v.plate_no.toUpperCase() === hPlate,
        ) || { plate_no: hPlate };
        div.onclick = () => selectPlate(masterObj);
        sug.appendChild(div);
      });
    } else {
      sug.style.display = "none";
    }
    return;
  }

  sug.style.maxHeight = "250px";
  sug.style.overflowY = "auto";

  const matches = vehiclesCache.filter(
    (v) =>
      (v.plate_no && v.plate_no.toUpperCase().includes(val)) ||
      (v.asset_code && v.asset_code.toUpperCase().includes(val)) ||
      (v.wrk_order_no && v.wrk_order_no.toUpperCase().includes(val)) ||
      (v.driver_name && v.driver_name.toUpperCase().includes(val)),
  );

  if (matches.length > 0) {
    sug.style.display = "block";
    matches.forEach((m) => {
      let div = document.createElement("div");
      let displayText = m.plate_no;
      if (m.asset_code && m.asset_code.toUpperCase().includes(val))
        displayText += ` (${m.asset_code})`;
      else if (m.wrk_order_no && m.wrk_order_no.toUpperCase().includes(val))
        displayText += ` [${m.wrk_order_no}]`;
      else if (m.driver_name && m.driver_name.toUpperCase().includes(val))
        displayText += ` - ${m.driver_name}`;
      div.innerText = displayText;
      div.onclick = () => selectPlate(m);
      sug.appendChild(div);
    });
  } else {
    sug.style.display = "none";
  }
}

function selectPlate(vObj) {
  document.getElementById("selPlate").value = vObj.plate_no.toUpperCase();
  document.getElementById("plateSuggestions").style.display = "none";
}

document.getElementById("selPlate").addEventListener("keydown", function (e) {
  let sug = document.getElementById("plateSuggestions");
  if (sug.style.display === "none") {
    if (e.key === "Enter") {
      e.preventDefault();
      triggerFetch();
    }
    return;
  }
  let items = sug.getElementsByTagName("div");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    currentFocus++;
    addActive(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    currentFocus--;
    addActive(items);
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    if (currentFocus > -1 && items[currentFocus]) items[currentFocus].click();
    else if (items.length > 0) items[0].click();
    if (e.key === "Enter") setTimeout(() => triggerFetch(), 100);
  }
});

function addActive(items) {
  if (!items) return false;
  removeActive(items);
  if (currentFocus >= items.length) currentFocus = 0;
  if (currentFocus < 0) currentFocus = items.length - 1;
  items[currentFocus].classList.add("suggestion-active");
  items[currentFocus].scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function removeActive(items) {
  for (let i = 0; i < items.length; i++)
    items[i].classList.remove("suggestion-active");
}

function parseLogDate(dStr, defaultDate) {
  if (!dStr) return defaultDate;
  let parts = dStr.split("T")[0].split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getGapStatus(d, sLogs, dLogs) {
  let sActive = false,
    sGap = false,
    isReplaced = false,
    isBeforeStart = false,
    isAfterEnd = false;
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
        else isReplaced = false; 
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
      else if (d < firstStart) isBeforeStart = true;
      else if (d > lastEnd) isAfterEnd = true;
    }
  } else {
    sActive = true;
  }

  if (!sActive) {
    if (isReplaced) return "R";
    if (sGap) return "SC";
    if (isBeforeStart) return "WS";  
    if (isAfterEnd) return "Re";
    return "AB";
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

function getDaysInMonth(monthStr, year) {
  return new Date(year, months.indexOf(monthStr) + 1, 0).getDate();
}
function getDayName(dayNum, monthStr, year) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(`${monthStr} ${dayNum}, ${year}`).getDay()
  ];
}
function formatDateUI(dStr) {
  if (!dStr || dStr === "N/A") return "N/A";
  let p = dStr.split("-");
  return `${p[2]}-${p[1]}-${p[0]}`;
}

async function triggerFetch() {
  const p = document.getElementById("selPlate").value.trim().toUpperCase();
  document.getElementById("selPlate").value = p;
  document.getElementById("plateSuggestions").style.display = "none";

  if (!p) {
    await customAlert("Please enter a Plate No.", "Missing Information");
    return;
  }
  loggedRowsTracker.clear();
  savePlateHistory(p);

  const inlineLogsheet = document.getElementById("inlineLogsheet");
  if (inlineLogsheet && inlineLogsheet.style.display !== "none")
    openLogsheetViewer(p);

  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;

  // 🟢 NEW FIX: വേറെ മാസമാണ് സെലക്ട് ചെയ്തതെങ്കിൽ പഴയ ലോക്ക് റിലീസ് ചെയ്യുക
  if (currentLockedRecord && (currentLockedRecord.plate !== p || currentLockedRecord.month !== m || currentLockedRecord.year !== y)) {
    releaseLock();
  }

  const tbody = document.getElementById("gridBody");
  const btn = document.getElementById("fetchBtn");
  const loader = document.getElementById("fetchLoader");
  const text = document.getElementById("fetchText");

  btn.disabled = true;
  text.innerText = "Wait...";
  loader.style.display = "block";
  tbody.innerHTML =
    '<tr class="loading-row"><td colspan="13">Fetching database records...</td></tr>';

  try {
    const ts = new Date().getTime();
    const headers = {
      Authorization: "Bearer " + token,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    let lockRes, lockData;
    try {
      lockRes = await fetch('/timesheet/api/record-lock/request', {
        method: 'POST',
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ plate: p, month: m, year: y })
      });
      lockData = await lockRes.json();
    } catch (e) {
      await customAlert("Network connection lost. Please check your internet and try again.", "Connection Error");
      throw e; 
    }

    if (lockRes.status === 401 || lockRes.status === 403) {
      await customAlert("Session expired or invalid. Please login again.", "Session Timeout");
      logout();
      return;
    }

    if (!lockData.success) {
      let lockedUser = lockData.lockedBy ? lockData.lockedBy.toUpperCase() : "ANOTHER USER";
      await customAlert(`This record is currently being edited by [ ${lockedUser} ]. Please try again later to prevent overwriting.`, "Record Locked 🔒");
      tbody.innerHTML = `<tr class="loading-row"><td colspan="13" style="color:#ef4444; font-weight:bold;">Record is locked by ${lockedUser}. Cannot fetch data.</td></tr>`;
      btn.disabled = false;
      text.innerText = "Fetch Data";
      loader.style.display = "none";
      return;
    }

    // 🟢 ലോക്ക് കിട്ടിയ ഉടൻ തന്നെ സേവ് ചെയ്യുക
    currentLockedRecord = { plate: p, month: m, year: y };

    const res = await fetch(
      `/timesheet/api/grid-data?month=${m}&year=${y}&plate=${p}&_t=${ts}`,
      { headers, cache: "no-store" },
    );

    if (res.status === 401 || res.status === 403) {
      releaseLock(); // 🟢 NEW
      await customAlert("Session expired. Please login again.", "Session Timeout");
      logout();
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      releaseLock(); // 🟢 NEW
      await customAlert("Session expired or invalid response. Please login again.", "Session Timeout");
      logout();
      return;
    }

    if (data.success === false) {
      releaseLock(); // 🟢 NEW
      await customAlert(data.message || "Failed to fetch data.", "Database Error");
      throw new Error(data.message);
    }
    
    const logRes = await fetch(
      `/timesheet/api/vehicle-logs?plate=${p}&_t=${ts}`,
      { headers, cache: "no-store" },
    );

    if (logRes.status === 401 || logRes.status === 403) {
      await customAlert("Session expired. Please login again.", "Session Timeout");
      logout();
      return;
    }
    
    let logs;
    try {
      logs = await logRes.json();
    } catch (e) {
      await customAlert("Session expired. Please login again.", "Session Timeout");
      logout();
      return;
    }

    let mIdx = months.indexOf(m);
    let monthStart = new Date(y, mIdx, 1);
    let monthEnd = new Date(y, mIdx + 1, 0);

    let dNameArr = [],
      dMobArr = [],
      siteArr = [],
      activeSites = [];

    if (logs.success) {
      let activeDrivers = logs.drivers.filter((d) => {
        let st = d.work_start_date
          ? new Date(d.work_start_date)
          : new Date("2000-01-01");
        let ed = d.work_end_date
          ? new Date(d.work_end_date)
          : new Date("2099-01-01");
        return st <= monthEnd && ed >= monthStart;
      });
      if (
        activeDrivers.length === 0 &&
        logs.drivers &&
        logs.drivers.length > 0
      ) {
        activeDrivers = [
          [...logs.drivers].sort(
            (a, b) =>
              new Date(b.work_start_date || "2000-01-01") -
              new Date(a.work_start_date || "2000-01-01"),
          )[0],
        ];
      }
      if (activeDrivers.length > 0) {
        dNameArr = [...new Set(activeDrivers.map((d) => d.driver_name))].filter(
          (val) =>
            val && String(val).trim() !== "" && String(val).trim() !== "-",
        );
        dMobArr = [
          ...new Set(activeDrivers.map((d) => d.driver_mobile)),
        ].filter(
          (val) =>
            val && String(val).trim() !== "" && String(val).trim() !== "-",
        );
      }

      activeSites = logs.sites.filter((s) => {
        let st = s.work_start_date
          ? new Date(s.work_start_date)
          : new Date("2000-01-01");
        let ed = s.work_end_date
          ? new Date(s.work_end_date)
          : new Date("2099-01-01");
        return st <= monthEnd && ed >= monthStart;
      });
      if (activeSites.length === 0 && logs.sites && logs.sites.length > 0) {
        activeSites = [
          [...logs.sites].sort(
            (a, b) =>
              new Date(b.work_start_date || "2000-01-01") -
              new Date(a.work_start_date || "2000-01-01"),
          )[0],
        ];
      }
      if (activeSites.length > 0) {
        siteArr = [...new Set(activeSites.map((s) => s.site_name))].filter(
          Boolean,
        );
      }
    }

    let vObjMaster = vehiclesCache.find((v) => v.plate_no.toUpperCase() === p);
    if (dNameArr.length === 0 && vObjMaster && vObjMaster.driver_name)
      dNameArr.push(vObjMaster.driver_name);
    if (dMobArr.length === 0 && vObjMaster && vObjMaster.driver_mobile)
      dMobArr.push(vObjMaster.driver_mobile);
    if (siteArr.length === 0 && vObjMaster && vObjMaster.site_name)
      siteArr.push(vObjMaster.site_name);

    document.getElementById("dispDName").innerText =
      dNameArr.length > 0 ? dNameArr.join(" & ") : "N/A";
    document.getElementById("dispDMob").innerText =
      dMobArr.length > 0 ? dMobArr.join(" & ") : "N/A";
    document.getElementById("dispSite").innerText =
      siteArr.length > 0 ? siteArr.join(" & ") : "N/A";
    document.getElementById("dispOName").innerText = vObjMaster
      ? vObjMaster.owner_name || "N/A"
      : "N/A";
    document.getElementById("dispOMob").innerText = vObjMaster
      ? vObjMaster.owner_mobile || "N/A"
      : "N/A";
    document.getElementById("dispVType").innerText = vObjMaster
      ? vObjMaster.vehicle_type || "N/A"
      : "N/A";

    let sStartVal = null,
      sEndVal = null;
    if (activeSites.length > 0) {
      activeSites.sort(
        (a, b) =>
          new Date(b.work_start_date || "2000-01-01") -
          new Date(a.work_start_date || "2000-01-01"),
      );
      let latestSiteLog = activeSites[0];
      sStartVal = latestSiteLog.work_start_date
        ? latestSiteLog.work_start_date.split("T")[0]
        : null;
      sEndVal = latestSiteLog.work_end_date
        ? latestSiteLog.work_end_date.split("T")[0]
        : null;

      document.getElementById("dispFieldCo").innerText =
        latestSiteLog.field_co || (vObjMaster ? vObjMaster.field_co : "N/A");
      document.getElementById("dispSiteCo").innerText =
        latestSiteLog.site_co || (vObjMaster ? vObjMaster.site_co : "N/A");
      document.getElementById("dispSiteStart").innerText = formatDateUI(
        sStartVal || "N/A",
      );

      if (sEndVal) {
        let endStatusText = latestSiteLog.new_vehicle_no
          ? " (Replaced)"
          : " (Released)";
        document.getElementById("dispSiteEnd").innerText =
          formatDateUI(sEndVal) + endStatusText;
      } else {
        document.getElementById("dispSiteEnd").innerText = "Running";
      }

      document.getElementById("dispAsset").innerText =
        latestSiteLog.asset_code ||
        (vObjMaster ? vObjMaster.asset_code : null) ||
        "N/A";
      document.getElementById("dispWorkOrder").innerText =
        latestSiteLog.work_order_no ||
        (vObjMaster ? vObjMaster.wrk_order_no : null) ||
        "N/A";

      if (
        latestSiteLog.old_vehicle_no &&
        latestSiteLog.old_vehicle_no.trim() !== ""
      ) {
        if (document.getElementById("oldVehRow")) {
          document.getElementById("oldVehRow").style.display = "flex";
          document.getElementById("dispOldVeh").innerText =
            latestSiteLog.old_vehicle_no;
        }
      } else {
        if (document.getElementById("oldVehRow"))
          document.getElementById("oldVehRow").style.display = "none";
      }

      if (
        latestSiteLog.new_vehicle_no &&
        latestSiteLog.new_vehicle_no.trim() !== ""
      ) {
        if (document.getElementById("newVehRow")) {
          document.getElementById("newVehRow").style.display = "flex";
          document.getElementById("dispNewVeh").innerText =
            latestSiteLog.new_vehicle_no;
        }
      } else {
        if (document.getElementById("newVehRow"))
          document.getElementById("newVehRow").style.display = "none";
      }
    } else {
      document.getElementById("dispSiteStart").innerText = "N/A";
      document.getElementById("dispSiteEnd").innerText = "N/A";
      if (document.getElementById("oldVehRow"))
        document.getElementById("oldVehRow").style.display = "none";
      if (document.getElementById("newVehRow"))
        document.getElementById("newVehRow").style.display = "none";
      document.getElementById("dispFieldCo").innerText = vObjMaster
        ? vObjMaster.field_co || "N/A"
        : "N/A";
      document.getElementById("dispSiteCo").innerText = vObjMaster
        ? vObjMaster.site_co || "N/A"
        : "N/A";
      document.getElementById("dispAsset").innerText = vObjMaster
        ? vObjMaster.asset_code || "N/A"
        : "N/A";
      document.getElementById("dispWorkOrder").innerText = vObjMaster
        ? vObjMaster.wrk_order_no || "N/A"
        : "N/A";
    }

    try {
      const invRes = await fetch(
        `/payment/get-invoice?plate_no=${p}&month=${m + " " + y}&_t=${ts}`,
        { headers, cache: "no-store" },
      );
      const invData = await invRes.json();
      currentInvoices = invData.success && invData.data ? invData.data : [];
    } catch (e) {
      currentInvoices = [];
    }

    const invSiteSelect = document.getElementById("invSiteSelect");
    invSiteSelect.innerHTML = "";
    if (siteArr.length > 0) {
      siteArr.forEach((siteName) => {
        let opt = document.createElement("option");
        opt.value = siteName;
        opt.text = siteName;
        invSiteSelect.appendChild(opt);
      });
      loadInvoiceForSelectedSite();
    } else {
      invSiteSelect.innerHTML = '<option value="">No Site Active</option>';
      clearInvoiceForm();
    }

    fetch("/timesheet/api/logsheets/list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ month: m, year: y, plate_no: p }),
    })
    .then(res => res.json())
    .then(lsData => {
      const actualLsSpan = document.getElementById("actualLogsheetCount");
      if (actualLsSpan) {
        if (lsData.success && lsData.files && lsData.files.length > 0) {
          let validCount = 0;
          let zeroCount = 0;
          
          // 0B ഫയലുകളെ വേർതിരിച്ച് എണ്ണുന്നു
          lsData.files.forEach(f => {
            if (f.size === 0) zeroCount++;
            else validCount++;
          });
          
          // പച്ച നിറത്തിൽ സ്ക്വയർ ബ്രാക്കറ്റ്
          let htmlStr = `<span style="font-weight: 700;">[ ${validCount} ]</span>`;
          
          // 0B ഫയൽ ഉണ്ടെങ്കിൽ മാത്രം ചുവന്ന നിറത്തിൽ പുറത്തു കാണിക്കുക 
          if (zeroCount > 0) {
            htmlStr += `<span style="color: #ef4444; font-weight: 700; margin-left: 6px; font-size: 13px;" title="${zeroCount} Empty (0B) files">${zeroCount}</span>`;
          }
          
          actualLsSpan.innerHTML = htmlStr;
        } else {
          actualLsSpan.innerHTML = "";
        }
      }
    })
    .catch(e => console.log("Error fetching logsheet count:", e));
    
    let existingData = data.success ? data.data : [];
    setTimeout(() => {
      renderGrid(m, y, p, existingData, sStartVal, sEndVal, logs);
      
      // 🟢 NEW: Apply Lock verification after render
      applyLockStatus(m, y);

      btn.disabled = false;
      text.innerText = "Fetch Data";
      loader.style.display = "none";
    }, 300);
  } catch (error) {
    tbody.innerHTML =
      '<tr class="loading-row"><td colspan="13" style="color:red;">Error fetching data. Check connection.</td></tr>';
    btn.disabled = false;
    text.innerText = "Fetch Data";
    loader.style.display = "none";
    
    // 🟢 2 മണിക്കൂർ കഴിഞ്ഞ് നെറ്റ് ലാഗ് കാരണം ഫെച്ച് ഫെയിൽ ആയാൽ ഗ്രിഡിലെ എഴുത്തിന് പുറമെ വലിയൊരു പോപ്പ്-അപ്പ് കൂടി കാണിക്കും (യൂസറുടെ ശ്രദ്ധയിൽ പെടാൻ).
    await customAlert("Network connection lost or server is unreachable. Please check your internet and try again.", "Connection Error");
  }
}

function loadInvoiceForSelectedSite() {
  const selectedSite = document.getElementById("invSiteSelect").value;
  if (!selectedSite) {
    clearInvoiceForm();
    return;
  }
  const inv = currentInvoices.find((i) => i.site_name === selectedSite);
  if (inv) {
    isEditingInvoice = true;
    document.getElementById("invNo").value = inv.invoice_no || "";
    document.getElementById("invBillNo").value = inv.bill_no || "";
    document.getElementById("invNr").value = inv.bill_nr || "";
    document.getElementById("invOt").value = inv.bill_ot || "";
    document.getElementById("invAmt").value = inv.invoice_amount || "";
  } else {
    isEditingInvoice = false;
    clearInvoiceForm();
  }
}

function clearInvoiceForm() {
  document.getElementById("invNo").value = "";
  document.getElementById("invBillNo").value = "";
  document.getElementById("invNr").value = "";
  document.getElementById("invOt").value = "";
  document.getElementById("invAmt").value = "";
  isEditingInvoice = false;
}

function renderGrid(
  month,
  year,
  plate,
  existingData,
  siteStart,
  siteEnd,
  logs = { drivers: [], sites: [] },
) {
  const tbody = document.getElementById("gridBody");
  tbody.innerHTML = "";
  const siteLogs = logs.sites || [];
  const driverLogs = logs.drivers || [];
  const days = getDaysInMonth(month, year);
  const mIdx = months.indexOf(month);

  const cleanVal = (val) =>
    val === null || val === "null" || val === undefined ? "" : val;

  for (let i = 1; i <= days; i++) {
    const rowData =
      existingData.find((r) => parseInt(r.record_date) === i) || {};
    let dbDist = cleanVal(rowData.calc_distance);
    if (dbDist !== "") dbDist = parseFloat(dbDist).toFixed(1);

    let dayName = getDayName(i, month, year);
    let rowClass = dayName === "Fri" ? "row-friday" : "";
    let currentDateObj = new Date(year, mIdx, i);
    currentDateObj.setHours(0, 0, 0, 0);
    let currentSiteStr = document
      .getElementById("dispSite")
      .innerText.split("&")[0]
      .trim()
      .toUpperCase();
    let formattedDate = currentDateObj
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, " ");

    let specialRule = specialRulesCache.find(
      (r) =>
        r.is_active &&
        (r.sites.includes("ALL") || r.sites.includes(currentSiteStr)) &&
        r.dates.includes(formattedDate),
    );

    let displayBd = cleanVal(rowData.bd).toUpperCase();
    if (displayBd === "B") displayBd = "BD";
    else if (displayBd === "N") displayBd = "NW";
    else if (displayBd === "S") displayBd = "NS";

    let ws = cleanVal(rowData.wrk_start);
    let we = cleanVal(rowData.wrk_end);
    let hmr = cleanVal(rowData.hmr_start);
    let rowRemark = cleanVal(rowData.remark);

    if (ws !== "" && we !== "") {
      if (isNaN(parseFloat(displayBd))) {
        displayBd = "";
      }
    }

    let statusCode = getGapStatus(currentDateObj, siteLogs, driverLogs);
    let hasData = displayBd !== "" || ws !== "" || hmr !== "";

    if (!hasData) {
      if (specialRule && specialRule.rule_type !== "FULL_OT") {
        displayBd = specialRule.rule_type;
        rowRemark = specialRule.reason || "";
      } else if (statusCode !== "ACTIVE") {
        displayBd = statusCode;
      }
    }

    let tr = document.createElement("tr");
    tr.className = rowClass;
    tr.innerHTML = `
      <td><input type="text" class="grid-readonly" value="${plate}" tabindex="-1" readonly></td>
      <td><input type="text" class="grid-readonly" value="${i}" tabindex="-1" readonly></td>
      <td><input type="text" class="grid-readonly" value="${dayName}" tabindex="-1" readonly style="color:#64748b;"></td>
      <td><input type="text" class="grid-input" data-col="wrk_start" data-row="${i}" value="${ws}"></td>
      <td><input type="text" class="grid-input" data-col="wrk_end" data-row="${i}" value="${cleanVal(rowData.wrk_end)}"></td>
      <td><input type="text" class="grid-input" data-col="hmr_start" data-row="${i}" value="${cleanVal(rowData.hmr_start)}"></td>
      <td><input type="text" class="grid-input" data-col="hmr_end" data-row="${i}" value="${cleanVal(rowData.hmr_end)}"></td>
      <td><input type="text" class="grid-input" data-col="fuel" data-row="${i}" value="${cleanVal(rowData.fuel)}"></td>
      <td><input type="text" class="grid-input" data-col="bd" data-row="${i}" value="${displayBd}"></td>
      <td><input type="checkbox" class="grid-input" data-col="nl_checked" data-row="${i}" ${rowData.nl_checked ? "checked" : ""}></td>
      <td><input type="text" class="grid-readonly" id="dist_${i}" value="${dbDist}" tabindex="-1" readonly></td>
      <td><input type="text" class="grid-readonly" id="time_${i}" value="${cleanVal(rowData.calc_time)}" tabindex="-1" readonly></td>
      <td><textarea class="grid-input" data-col="remark" data-row="${i}">${rowRemark}</textarea></td>
      <td><input type="text" class="grid-readonly" id="mod_${i}" value="${cleanVal(rowData.modified_by)}" tabindex="-1" readonly style="font-size: 11px; color: #64748b; background: transparent; text-transform: capitalize;"></td>
    `;
    tbody.appendChild(tr);
  }
  attachGridEvents();
  updateSummaryBox();
}

function updateSummaryBox() {
  let tNormal = 0,
    tOT = 0,
    tTime = 0,
    tDist = 0,
    tFuel = 0,
    logCount = 0;
  const monthStr = document.getElementById("selMonth").value;
  const year = document.getElementById("selYear").value;
  const days = getDaysInMonth(monthStr, year);

  for (let i = 1; i <= days; i++) {
    let tm = parseFloat(document.getElementById(`time_${i}`)?.value) || 0;
    let dt = parseFloat(document.getElementById(`dist_${i}`)?.value) || 0;
    let fl =
      parseFloat(
        document.querySelector(`.grid-input[data-row="${i}"][data-col="fuel"]`)
          ?.value,
      ) || 0;
    let bd =
      document
        .querySelector(`.grid-input[data-row="${i}"][data-col="bd"]`)
        ?.value.trim()
        .toUpperCase() || "";
    let ws =
      document
        .querySelector(`.grid-input[data-row="${i}"][data-col="wrk_start"]`)
        ?.value.trim() || "";
    let we =
      document
        .querySelector(`.grid-input[data-row="${i}"][data-col="wrk_end"]`)
        ?.value.trim() || "";

    let hasLog =
      (bd !== "" && !isNaN(parseFloat(bd))) || (ws !== "" && we !== "");
    if (hasLog) logCount++;

    let dayName = getDayName(i, monthStr, year);
    let siteForSum = document
      .getElementById("dispSite")
      .innerText.split("&")[0]
      .trim()
      .toUpperCase();
    let formattedDateForSum = new Date(year, months.indexOf(monthStr), i)
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, " ");

    let sumOtRule = specialRulesCache.find(
      (r) =>
        r.is_active &&
        r.rule_type === "FULL_OT" &&
        (r.sites.includes("ALL") || r.sites.includes(siteForSum)) &&
        r.dates.includes(formattedDateForSum),
    );
    let isFullOT = dayName === "Fri" || i === 31 || !!sumOtRule;
    let normalHr = 0,
      otHr = 0;

    if (bd === "ID" || bd === "NP") {
      if (isFullOT) otHr = 10;
      else normalHr = 10;
    } else if (["BD", "NW", "NS", "NR", "H", "AB", "DC", "SC", "R", "WS", "RE", "FRI", "Fri"].includes(bd)) {
    } else if (tm > 0) {
      if (isFullOT) {
        otHr = tm;
      } else {
        if (tm > 10) {
          normalHr = 10;
          otHr = tm - 10;
        } else {
          normalHr = tm;
        }
      }
    }
    tNormal += normalHr;
    tOT += otHr;
    tDist += dt;
    tFuel += fl;
  }
  tTime = tNormal + tOT;
  document.getElementById("logSheetCount").innerText =
    logCount > 0 ? `( ${logCount} )` : "";
  document.getElementById("sumNormal").innerText = tNormal > 0 ? tNormal : "0";
  document.getElementById("sumOT").innerText = tOT > 0 ? tOT : "0";
  document.getElementById("sumTime").innerText = tTime > 0 ? tTime : "0";
  document.getElementById("sumDist").innerText = tDist.toFixed(1);
  document.getElementById("sumFuel").innerText = tFuel.toFixed(1);

  let mileage = "0.00";
  if (tFuel > 0) mileage = (tDist / tFuel).toFixed(2);
  document.getElementById("sumMileage").innerText = mileage;
}

function attachGridEvents() {
  const inputs = document.querySelectorAll(".grid-input");
  inputs.forEach((input) => {
    if (input.tagName !== "TEXTAREA") {
      input.addEventListener("keydown", function (e) {
        const row = parseInt(this.getAttribute("data-row"));
        const col = this.getAttribute("data-col");
        let nextEl = null;
        if (e.key === "ArrowDown")
          nextEl = document.querySelector(
            `.grid-input[data-row="${row + 1}"][data-col="${col}"]`,
          );
        else if (e.key === "ArrowUp")
          nextEl = document.querySelector(
            `.grid-input[data-row="${row - 1}"][data-col="${col}"]`,
          );
        else if (
          e.key === "ArrowRight" &&
          this.selectionStart === this.value.length
        ) {
          e.preventDefault();
          let td = this.closest("td").nextElementSibling;
          while (td && !td.querySelector(".grid-input"))
            td = td.nextElementSibling;
          if (td) nextEl = td.querySelector(".grid-input");
        } else if (e.key === "ArrowLeft" && this.selectionStart === 0) {
          e.preventDefault();
          let td = this.closest("td").previousElementSibling;
          while (td && !td.querySelector(".grid-input"))
            td = td.previousElementSibling;
          if (td) nextEl = td.querySelector(".grid-input");
        }
        if (nextEl) nextEl.focus();
      });
    }

    // 🟢 പുതിയ മാറ്റം: ഫോക്കസ് ചെയ്യുമ്പോൾ നിലവിലുള്ള വാല്യൂ സേവ് ചെയ്തു വെക്കുന്നു
    input.addEventListener("focus", function () {
      this.dataset.oldVal = this.type === "checkbox" ? this.checked : this.value;
    });

    input.addEventListener("blur", function () {
      const row = this.getAttribute("data-row");
      const col = this.getAttribute("data-col");
      let currentVal = this.type === "checkbox" ? this.checked : this.value;
      
      if (String(this.dataset.oldVal) !== String(currentVal)) {
        calculateRow(row); 
        const finalVal = this.type === "checkbox" ? this.checked : this.value; 
        saveCellData(row, col, finalVal);
        updateSummaryBox();
        this.dataset.oldVal = finalVal; 
      }
    });

    if (input.type === "checkbox") {
      input.addEventListener("change", function () {
        const row = this.getAttribute("data-row");
        const col = this.getAttribute("data-col");
        let currentVal = this.checked;
        
        if (String(this.dataset.oldVal) !== String(currentVal)) {
          calculateRow(row);
          const finalVal = this.checked;
          saveCellData(row, col, finalVal);
          updateSummaryBox();
          this.dataset.oldVal = finalVal;
        }
      });
    }
  });
}

function parseRailwayTime(val) {
  if (!val) return 0;
  let [hStr, mStr] = String(val).split(".");
  let h = parseInt(hStr) || 0;
  let m = 0;
  if (mStr) {
    mStr = mStr.length === 1 ? mStr + "0" : mStr.substring(0, 2);
    m = parseInt(mStr);
  }
  return h + m / 60;
}

function customRound(val) {
  let h = Math.floor(val);
  let m = Math.round((val - h) * 60);
  return m >= 45 ? h + 1 : h;
}

function calculateRow(rowIdx) {
  const hs = parseFloat(
    document.querySelector(
      `.grid-input[data-row="${rowIdx}"][data-col="hmr_start"]`,
    ).value,
  );
  const he = parseFloat(
    document.querySelector(
      `.grid-input[data-row="${rowIdx}"][data-col="hmr_end"]`,
    ).value,
  );
  let dist = "";
  if (!isNaN(hs) && !isNaN(he)) dist = (he - hs).toFixed(1);
  document.getElementById(`dist_${rowIdx}`).value = dist;

  const ws = document.querySelector(
    `.grid-input[data-row="${rowIdx}"][data-col="wrk_start"]`,
  ).value;
  const we = document.querySelector(
    `.grid-input[data-row="${rowIdx}"][data-col="wrk_end"]`,
  ).value;
  let bdInput = document.querySelector(
    `.grid-input[data-row="${rowIdx}"][data-col="bd"]`,
  );
  let bd = bdInput.value.trim().toUpperCase();

  // 🟢 Auto-map Shorthands to Professional Codes
  if (bd === "B") bd = "BD";
  else if (bd === "N") bd = "NW";
  else if (bd === "S") bd = "NS";
  else if (bd === "NR") bd = "NR";
  else if (bd === "F") bd = "Fri";
  
  bdInput.value = bd; // Update the UI instantly
  let bdCheck = bd.toUpperCase();

  if (ws !== "" && we !== "") {
    if (isNaN(parseFloat(bdCheck)) && bdCheck !== "") {
      bd = "";
      bdInput.value = "";
      saveCellData(rowIdx, "bd", "");
    }
  }

  const nl = document.querySelector(
    `.grid-input[data-row="${rowIdx}"][data-col="nl_checked"]`,
  ).checked;
  const site = document
    .getElementById("dispSite")
    .innerText.split("&")[0]
    .trim()
    .toUpperCase();

  let finalTime = "";
  if (bd) {
    let bdNum = parseFloat(bd);
    if (!isNaN(bdNum)) finalTime = bdNum;
    else if (["ID", "NP"].includes(bdCheck)) finalTime = 10;
      else if (["BD", "NW", "NS", "NR", "H", "AB", "DC", "SC", "R", "WS", "RE", "FRI"].includes(bdCheck))
        finalTime = 0;
    } else if (ws && we) {
    let sHour = parseRailwayTime(ws);
    let eHour = parseRailwayTime(we);
    let diff = eHour - sHour;
    if (diff < 0) diff += 24;

    let endIsMorning = eHour >= 6 && eHour <= 12.5;
    let isNightShift = sHour >= 15 || endIsMorning;

    let monthStr = document.getElementById("selMonth").value;
    let year = document.getElementById("selYear").value;
    let currentDate = new Date(year, months.indexOf(monthStr), rowIdx);

    let formattedDateForOT = currentDate
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, " ");

    let otRule = specialRulesCache.find(
      (r) =>
        r.is_active &&
        r.rule_type === "FULL_OT" &&
        (r.sites.includes("ALL") || r.sites.includes(site)) &&
        r.dates.includes(formattedDateForOT),
    );

    let breakOverlap = 0;
    let activeBreakRule = breakRulesCache.find((r) => {
      if (!r.is_active) return false;
      let sitesArray = [];
      try {
        sitesArray =
          typeof r.sites === "string" ? JSON.parse(r.sites) : r.sites;
      } catch (e) {
        sitesArray = [];
      }

      let siteMatch =
        sitesArray.includes("ALL") ||
        sitesArray.some((keyword) => site.includes(keyword));

      if (!siteMatch) return false;
      let ruleStart = new Date(r.start_date);
      ruleStart.setHours(0, 0, 0, 0);
      let ruleEnd = new Date(r.end_date);
      ruleEnd.setHours(23, 59, 59, 999);
      return currentDate >= ruleStart && currentDate <= ruleEnd;
    });

    if (activeBreakRule && !isNightShift) {
      let bStart = parseRailwayTime(activeBreakRule.break_start);
      let bEnd = parseRailwayTime(activeBreakRule.break_end);
      let overlapStart = Math.max(sHour, bStart);
      let overlapEnd = Math.min(eHour, bEnd);
      if (overlapStart < overlapEnd) breakOverlap = overlapEnd - overlapStart;
    }

    if (nl || !!otRule) {
      finalTime = customRound(diff);
    } else if (activeBreakRule && !isNightShift) {
      finalTime = customRound(diff - breakOverlap);
    } else if (isNightShift) {
      finalTime = customRound(diff);
    } else {
      let rule =
        rulesCache.find((r) => site.includes(r.site_keyword)) ||
        rulesCache.find((r) => r.site_keyword === "DEFAULT");
      let deduction = rule ? rule.default_deduct : 1;
      if (rule && diff <= 11) deduction = rule.deduct_under_11;
      else if (rule && diff >= 12) deduction = rule.deduct_over_12;
      finalTime = customRound(diff - deduction);
    }
  }
  document.getElementById(`time_${rowIdx}`).value = finalTime;
}

let saveTimeout;
let pendingSaves = 0; 


window.addEventListener("beforeunload", function (e) {
  if (pendingSaves > 0) {
    e.preventDefault();
    e.returnValue = "Data is still saving. Are you sure you want to leave?";
    return e.returnValue;
  }
});


window.addEventListener("pagehide", function () {
  releaseLock();
});

async function saveCellData(rowIdx, colName, colValue) {
  const plate = document.getElementById("selPlate").value.trim().toUpperCase();
  if (!plate || !colName) return;
  
  pendingSaves++; 
  const statusLabel = document.getElementById("saveStatus");
  statusLabel.innerText = "Saving...";
  statusLabel.className = "save-indicator status-saving";

  const calc_distance = document.getElementById(`dist_${rowIdx}`).value || null;
  const calc_time = document.getElementById(`time_${rowIdx}`).value || null;

  const payload = {
    month: document.getElementById("selMonth").value,
    year: document.getElementById("selYear").value,
    plate_no: plate,
    record_date: rowIdx,
    col_name: colName,
    col_value: colValue,
    calc_distance: calc_distance,
    calc_time: calc_time,
  };

  try {
    const response = await fetch("/timesheet/api/upsert-grid-cell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401 || response.status === 403) {
      await customAlert("Session expired. Please login again.", "Session Timeout");
      logout();
      return;
    }

    const data = await response.json().catch(() => ({}));
    
    // 🟢 യഥാർത്ഥ ടോക്കൺ പ്രശ്നമാണെങ്കിൽ (401/403) മാത്രം ലോഗൗട്ട് ആക്കും. നെറ്റ് കട്ട് ആയാൽ ലോഗൗട്ട് ആകില്ല!
    if (response.status === 401 || response.status === 403) {
      await customAlert("Session expired or invalid. Please login again.", "Session Timeout");
      logout();
      return;
    }

    // 🟢 ഡാറ്റ സേവ് ആയില്ലെങ്കിൽ നേരിട്ട് Catch ബ്ലോക്കിലേക്ക് പോയി പോപ്പ്-അപ്പ് വരും (ഡാറ്റ നഷ്ടപ്പെടില്ല)
    if (!response.ok || data.success === false) {
      throw new Error(data.message || "Server connection lag. Data not saved.");
    }

    // Update Modified By column locally right after saving
    try {
      const user = JSON.parse(localStorage.getItem("timesheetUser"));
      if (user && user.username) {
        const modInput = document.getElementById(`mod_${rowIdx}`);
        if (modInput) modInput.value = user.username;
      }
    } catch (e) {}

    clearTimeout(saveTimeout);
    statusLabel.innerText = "✓ Saved";
    statusLabel.className = "save-indicator status-saved";
    saveTimeout = setTimeout(() => {
      statusLabel.className = "save-indicator";
    }, 2000);

    try {
      const user = JSON.parse(localStorage.getItem("timesheetUser"));
      const mIdx = months.indexOf(payload.month) + 1;
      const padMonth = String(mIdx).padStart(2, "0");
      const padDay = String(rowIdx).padStart(2, "0");
      const formattedDate = `${payload.year}-${padMonth}-${padDay}`;
      const logKey = `${payload.plate_no}_${formattedDate}`;

      if (!loggedRowsTracker.has(logKey)) {
        loggedRowsTracker.add(logKey);
        await fetch("/api/entrylog/add", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("timesheetToken")}`,
          },
          body: JSON.stringify({
            username: user ? user.username : "Unknown",
            plate_number: payload.plate_no,
            entry_date: formattedDate,
            action: "UPDATE",
          }),
        });
      }
    } catch (logErr) {}
  } catch (e) {
    console.error("Save Error:", e);
    statusLabel.innerText = "Error";
    statusLabel.style.backgroundColor = "#dc3545";
    customAlert("Failed to save. Reason: " + (e.message || "Unknown Error"), "Database Error");
  } finally {
    pendingSaves = Math.max(0, pendingSaves - 1); 
  }
}

function customAlert(message, title = "Notice") {
  return new Promise((resolve) => {
    document.getElementById("customAlertTitle").innerText = title;
    document.getElementById("customAlertMessage").innerText = message;
    
    // 🟢 ഡാറ്റാബേസ് എറർ ആണെങ്കിൽ മാത്രം പോപ്പ്-അപ്പിൽ ലോഗൗട്ട് ബട്ടൺ കാണിക്കുക
    const logoutBtn = document.getElementById("alertLogoutBtn");
    if (logoutBtn) {
      if (title === "Database Error" || title === "Connection Error") {
        logoutBtn.style.display = "inline-block";
      } else {
        logoutBtn.style.display = "none";
      }
    }
    
    document.getElementById("customAlertModal").style.display = "flex";
    window.closeCustomAlert = function () {
      document.getElementById("customAlertModal").style.display = "none";
      resolve();
    };
  });
}

function customPrompt(message, isPassword = false, title = "Input Required") {
  return new Promise((resolve) => {
    document.getElementById("customPromptTitle").innerText = title;
    document.getElementById("customPromptMessage").innerText = message;
    const inputEl = document.getElementById("customPromptInput");
    inputEl.type = isPassword ? "password" : "text";
    inputEl.value = "";
    document.getElementById("customPromptModal").style.display = "flex";
    inputEl.focus();
    window.submitCustomPrompt = function () {
      const val = inputEl.value;
      document.getElementById("customPromptModal").style.display = "none";
      resolve(val);
    };
    window.closeCustomPrompt = function () {
      document.getElementById("customPromptModal").style.display = "none";
      resolve(null);
    };
  });
}

async function saveInvoiceData() {
  const plate_no = document
    .getElementById("selPlate")
    .value.trim()
    .toUpperCase();
  if (!plate_no) {
    await customAlert("Please fetch a Plate Number first.", "Action Required");
    return;
  }
  const site_name = document.getElementById("invSiteSelect").value;
  if (!site_name) {
    await customAlert("Please select a Site before saving.", "Action Required");
    return;
  }
  const month =
    document.getElementById("selMonth").value +
    " " +
    document.getElementById("selYear").value;
  const invoice_no = document.getElementById("invNo").value.trim();
  const bill_no = document.getElementById("invBillNo").value.trim();
  const bill_nr = document.getElementById("invNr").value.trim();
  const bill_ot = document.getElementById("invOt").value.trim();
  const invoice_amount = document.getElementById("invAmt").value.trim();

  if (!invoice_no || !bill_nr) {
    await customAlert(
      "Invoice Number and Bill N.Hr are mandatory!",
      "Validation Error",
    );
    return;
  }

  let edit_reason = "";
  if (isEditingInvoice) {
    let code = await customPrompt(
      "Enter Secret Code to edit existing record:",
      true,
      "Security Check",
    );
    if (code !== "imissu") {
      await customAlert(
        "Incorrect Secret Code. Editing cancelled.",
        "Access Denied",
      );
      return;
    }
    edit_reason = await customPrompt(
      "Please enter the reason for editing:",
      false,
      "Edit Reason",
    );
    if (!edit_reason || edit_reason.trim() === "") {
      await customAlert("Edit reason is required!", "Validation Error");
      return;
    }
  }

  const payload = {
    plate_no,
    month,
    site_name,
    invoice_no,
    bill_no,
    bill_nr,
    bill_ot,
    invoice_amount,
    edit_reason,
  };
  try {
    const res = await fetch("/payment/save-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      await customAlert(data.message, "Success");
      isEditingInvoice = true;
      let existingIdx = currentInvoices.findIndex(
        (i) => i.site_name === site_name,
      );
      if (existingIdx > -1) currentInvoices[existingIdx] = payload;
      else currentInvoices.push(payload);
    } else {
      await customAlert("Error: " + data.message, "Error");
    }
  } catch (e) {
    await customAlert(
      "Failed to save data. Check connection.",
      "Network Error",
    );
  }
}

function savePlateHistory(plate) {
  if (!plate) return;
  let history = JSON.parse(localStorage.getItem("plateSearchHistory") || "[]");
  history = history.filter((p) => p !== plate);
  history.unshift(plate);
  if (history.length > 30) history = history.slice(0, 30);
  localStorage.setItem("plateSearchHistory", JSON.stringify(history));
}

function toggleUserMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("userDropdownMenu");
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}
document.addEventListener("click", function (e) {
  if (!e.target.closest(".user-profile-container")) {
    const menu = document.getElementById("userDropdownMenu");
    if (menu) menu.style.display = "none";
  }
});
function toggleDarkMode() {
  const isDark = document.body.classList.toggle("dark-mode");
  localStorage.setItem("timesheetTheme", isDark ? "dark" : "light");
  document.getElementById("userDropdownMenu").style.display = "none";
}
function logout() {
  releaseLock(); 
  localStorage.removeItem("timesheetToken");
  localStorage.removeItem("timesheetUser");
  
  const currentPage = encodeURIComponent(
    window.location.pathname.split("/").pop() + window.location.search
  );
  
  // 🟢 NEW: Lock release ഫെച്ച് കംപ്ലീറ്റ് ആകാൻ 300ms സമയം കൊടുക്കുന്നു
  setTimeout(() => {
    window.location.href = "index.html?redirect=" + currentPage;
  }, 300);
}

(function initTheme() {
  const savedTheme = localStorage.getItem("timesheetTheme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
  }
})();

async function exportExcel() {
  const token = localStorage.getItem("timesheetToken");
  const m = document.getElementById("bulkMonth").value;
  const y = document.getElementById("bulkYear").value;
  try {
    const res = await fetch(`/timesheet/api/grid-data?month=${m}&year=${y}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    let ws_data = [
      [
        "Plate No",
        "Date",
        "Wrk Start",
        "Wrk end",
        "HMR Start",
        "HMR End",
        "Fuel",
        "BD",
        "Remark",
        "NL",
        "Distance",
        "Time",
      ],
    ];
    if (data.success && data.data && data.data.length > 0) {
      data.data.forEach((row) => {
        ws_data.push([
          row.plate_no,
          row.record_date,
          row.wrk_start || "",
          row.wrk_end || "",
          row.hmr_start || "",
          row.hmr_end || "",
          row.fuel || "",
          row.bd || "",
          row.remark || "",
          row.nl_checked ? "TRUE" : "FALSE",
          row.calc_distance || "",
          row.calc_time || "",
        ]);
      });
    } else {
      ws_data.push([
        "EXAMPLE-123",
        "1",
        "6.00",
        "18.00",
        "1000",
        "1150",
        "150",
        "",
        "Sample Entry",
        "FALSE",
        "",
        "",
      ]);
      await customAlert(
        "Notice",
        "No data found for this month. Exporting blank template.",
      );
    }
    var ws = XLSX.utils.aoa_to_sheet(ws_data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
    var wbout = XLSX.write(wb, { bookType: "xlsx", type: "binary" });
    let blob = new Blob([s2ab(wbout)], { type: "application/octet-stream" });
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement("a");
    document.body.appendChild(a);
    a.href = url;
    a.download = `Timesheet_DailyData_${m}_${y}.xlsx`;
    a.click();
    document.body.removeChild(a);
  } catch (error) {
    customAlert("Error", "Failed to export data. Check server connection.");
  }
}

function s2ab(s) {
  var buf = new ArrayBuffer(s.length);
  var view = new Uint8Array(buf);
  for (var i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
  return buf;
}

async function importExcel() {
  const file = document.getElementById("excelFile").files[0];
  if (!file) {
    customAlert("Warning", "Please select an Excel file first.");
    return;
  }
  const m = document.getElementById("bulkMonth").value;
  const y = document.getElementById("bulkYear").value;
  const sts = document.getElementById("importStatus");
  sts.innerText = "Parsing Excel... Please wait.";
  sts.style.color = "#ffc107";
  sts.style.backgroundColor = "#fff3cd";
  sts.style.border = "1px solid #ffe69c";

  const token = localStorage.getItem("timesheetToken");
  let rules = [];
  let spRules = [];
  let bkRules = [];
  try {
    const rRes = await fetch("/timesheet/api/rules", {
      headers: { Authorization: "Bearer " + token },
    });
    const rData = await rRes.json();
    if (rData.success) rules = rData.data;

    let vInfo = [];
    const vRes = await fetch("/timesheet/api/vehicle-info", {
      headers: { Authorization: "Bearer " + token },
    });
    const vData = await vRes.json();
    if (vData.success) vInfo = vData.data;

    // 🟢 FETCHING CACHES LOCALLY IN IMPORT FOR ACCURACY
    const srRes = await fetch("/timesheet/api/special-rules", {
      headers: { Authorization: "Bearer " + token },
    });
    const srData = await srRes.json();
    if (srData.success) spRules = srData.data;

    const brRes = await fetch("/timesheet/api/break-rules", {
      headers: { Authorization: "Bearer " + token },
    });
    const brData = await brRes.json();
    if (brData.success) bkRules = brData.data;

    function calcRowDistTime(row, site, recordDate) {
      let hs = parseFloat(row["HMR Start"]);
      let he = parseFloat(row["HMR End"]);
      let dist = null;
      if (!isNaN(hs) && !isNaN(he)) dist = (he - hs).toFixed(2);
      let finalTime = null;
      let ws = String(row["Wrk Start"] || "").trim();
      let we = String(row["Wrk end"] || "").trim();
      let bd = String(row["BD"] || "")
        .trim()
        .toUpperCase();
      
      // 🟢 Excel Import Auto-map
      if (bd === "B") bd = "BD";
      else if (bd === "N") bd = "NW";
      else if (bd === "S") bd = "NS";
      else if (bd === "NR") bd = "NR";
      else if (bd === "F") bd = "FRI";

      let nlRaw = String(row["NL"]).trim().toUpperCase();
      let nl = nlRaw === "TRUE" || nlRaw === "Y" || nlRaw === "1";

      if (ws && we && isNaN(parseFloat(bd))) {
        bd = "";
      }

      if (bd) {
        let bdNum = parseFloat(bd);
        if (!isNaN(bdNum)) finalTime = bdNum;
        else if (["ID", "NP"].includes(bd)) finalTime = 10;
        else if (["BD", "NW", "NS", "NR", "H", "FRI"].includes(bd)) finalTime = 0;
      } else if (ws && we) {
        let parseRT = (val) => {
          let [hStr, mStr] = String(val).split(".");
          let h = parseInt(hStr) || 0;
          let m = 0;
          if (mStr) {
            mStr = mStr.length === 1 ? mStr + "0" : mStr.substring(0, 2);
            m = parseInt(mStr);
          }
          return h + m / 60;
        };
        let sHour = parseRT(ws);
        let eHour = parseRT(we);
        let diff = eHour - sHour;
        if (diff < 0) diff += 24;
        let cRound = (val) => {
          let h = Math.floor(val);
          let mm = Math.round((val - h) * 60);
          return mm >= 45 ? h + 1 : h;
        };

        let endIsMorning = eHour >= 6 && eHour <= 12.5;
        let isNightShift = sHour >= 15 || endIsMorning;
        let currentDate = new Date(y, months.indexOf(m), parseInt(recordDate));
        let formattedDateForOT = currentDate
          .toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
          .replace(/ /g, " ");

        let otRule = spRules.find(
          (r) =>
            r.is_active &&
            r.rule_type === "FULL_OT" &&
            (r.sites.includes("ALL") || r.sites.includes(site)) &&
            r.dates.includes(formattedDateForOT),
        );

        let breakOverlap = 0;
        let activeBreakRule = bkRules.find((r) => {
          if (!r.is_active) return false;
          let sitesArray = [];
          try {
            sitesArray =
              typeof r.sites === "string" ? JSON.parse(r.sites) : r.sites;
          } catch (e) {
            sitesArray = [];
          }

          // 🟢 FIXED: Partial Keyword Match
          let siteMatch =
            sitesArray.includes("ALL") ||
            sitesArray.some((keyword) => site.includes(keyword));

          if (!siteMatch) return false;
          let ruleStart = new Date(r.start_date);
          ruleStart.setHours(0, 0, 0, 0);
          let ruleEnd = new Date(r.end_date);
          ruleEnd.setHours(23, 59, 59, 999);
          return currentDate >= ruleStart && currentDate <= ruleEnd;
        });

        if (activeBreakRule && !isNightShift) {
          let bStart = parseRT(activeBreakRule.break_start);
          let bEnd = parseRT(activeBreakRule.break_end);
          let overlapStart = Math.max(sHour, bStart);
          let overlapEnd = Math.min(eHour, bEnd);
          if (overlapStart < overlapEnd)
            breakOverlap = overlapEnd - overlapStart;
        }

        if (nl || !!otRule) {
          finalTime = cRound(diff);
        } else if (activeBreakRule && !isNightShift) {
          finalTime = cRound(diff - breakOverlap);
        } else if (isNightShift) {
          finalTime = cRound(diff);
        } else {
          let rule =
            rules.find((r) => site.includes(r.site_keyword)) ||
            rules.find((r) => r.site_keyword === "DEFAULT");
          let ded = rule ? rule.default_deduct : 1;
          if (rule && diff <= 11) ded = rule.deduct_under_11;
          else if (rule && diff >= 12) ded = rule.deduct_over_12;
          finalTime = cRound(diff - ded);
        }
      }
      return { dist, finalTime };
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
        defval: "",
        raw: false,
      });
      let processedRecords = [];
      jsonData.forEach((row) => {
        let pNo = String(row["Plate No"]).trim();
        let rDateRaw = String(row["Date"]).trim();
        let rDate = parseInt(rDateRaw);
        if (
          !pNo ||
          isNaN(rDate) ||
          rDate < 1 ||
          rDate > 31 ||
          pNo.includes("EXAMPLE")
        )
          return;
        let vehicle = vInfo.find((v) => v.plate_no === pNo);
        let site = vehicle ? (vehicle.site_name || "").toUpperCase() : "";
        let calcRes = calcRowDistTime(row, site, rDate);
        let nlRaw = String(row["NL"]).trim().toUpperCase();
        let isNlChecked = nlRaw === "TRUE" || nlRaw === "Y" || nlRaw === "1";
        processedRecords.push({
          month: m,
          year: y,
          plate_no: pNo,
          record_date: rDate.toString(),
          wrk_start: String(row["Wrk Start"]).trim() || null,
          wrk_end: String(row["Wrk end"]).trim() || null,
          hmr_start: String(row["HMR Start"]).trim() || null,
          hmr_end: String(row["HMR End"]).trim() || null,
          fuel: String(row["Fuel"]).trim() || null,
          bd: String(row["BD"]).trim() || null,
          remark: String(row["Remark"]).trim() || "",
          nl_checked: isNlChecked,
          calc_distance: calcRes.dist,
          calc_time: calcRes.finalTime,
        });
      });

      if (processedRecords.length === 0) {
        sts.innerText = "No valid data found in Excel.";
        sts.style.color = "#842029";
        sts.style.backgroundColor = "#f8d7da";
        return;
      }
      sts.innerText = `Saving ${processedRecords.length} exact records...`;
      try {
        const sendRes = await fetch("/timesheet/api/bulk-import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ records: processedRecords }),
        });
        const resData = await sendRes.json();
        if (sendRes.ok && resData.success) {
          sts.innerText = "✓ Import Successful! Zero Errors.";
          sts.style.color = "#0f5132";
          sts.style.backgroundColor = "#d1e7dd";
          document.getElementById("excelFile").value = "";
        } else {
          sts.innerText = "Error: " + (resData.message || "Upload Failed");
          sts.style.color = "#842029";
          sts.style.backgroundColor = "#f8d7da";
        }
      } catch (err) {
        sts.innerText = "Network Error: Check Server connection.";
        sts.style.color = "#842029";
        sts.style.backgroundColor = "#f8d7da";
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    sts.innerText = "Error initializing process. Try again.";
    sts.style.color = "#842029";
    sts.style.backgroundColor = "#f8d7da";
  }
}

init();

// ==========================================
// 🔒 LOCK PERIOD CHECKER
// ==========================================
function applyLockStatus(selectedMonthStr, selectedYearStr) {
    if (!systemLockData.month || !systemLockData.year) return; // Not locked

    const sYear = parseInt(selectedYearStr);
    const sMonthIdx = months.indexOf(selectedMonthStr);
    const lockYear = parseInt(systemLockData.year);
    const lockMonthIdx = months.indexOf(systemLockData.month);

    // Calculate absolute months for comparison (Year * 12 + MonthIndex)
    const selectedAbsolute = (sYear * 12) + sMonthIdx;
    const lockAbsolute = (lockYear * 12) + lockMonthIdx;

    if (selectedAbsolute <= lockAbsolute) {
        // IT IS LOCKED! Disable grid.
        document.querySelectorAll(".grid-input").forEach(el => {
            el.disabled = true;
            el.style.backgroundColor = "transparent"; // 🟢 Changed to transparent
            el.style.cursor = "not-allowed";
            el.style.color = "Black";
            el.style.opacity = "0.9"; 
        });
        
        // Disable Invoice Edit buttons if needed
        const invBtn = document.querySelector(".btn-inv-save");
        if(invBtn) {
            invBtn.disabled = true;
            invBtn.style.opacity = "0.5";
            invBtn.innerText = "🔒 Locked Period";
        }
        
        customAlert(`The period up to ${systemLockData.month} ${systemLockData.year} is locked. You cannot edit this data.`, "Period Locked");
    }
}
