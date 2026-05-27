const token = localStorage.getItem("timesheetToken");
if (!token) {
  // User ippol ethu page-il aano ullathu, aa page-nte peru eduthu URL-il pass cheyyunnu
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

const userStr = localStorage.getItem("timesheetUser");
if (userStr) {
  const u = JSON.parse(userStr);
  // Updates only the text span, keeping the icon intact
  const uiEl = document.getElementById("userInfo");
  if (uiEl) uiEl.innerText = `${u.username} (${u.role})`;
}

let rulesCache = [];
let specialRulesCache = [];
let vehiclesCache = [];
let currentFocus = -1;
let isEditingInvoice = false;
let currentInvoices = [];
let loggedRowsTracker = new Set();

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
  const rData = await rRes.json();
  if (rData.success) rulesCache = rData.data;

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
}

function searchPlate() {
  document.getElementById("selPlate").addEventListener("focus", searchPlate);
  document.getElementById("selPlate").addEventListener("click", searchPlate);
  const val = document.getElementById("selPlate").value.toUpperCase();
  const sug = document.getElementById("plateSuggestions");
  sug.innerHTML = "";
  currentFocus = -1;

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

  if (!val) {
    let history = JSON.parse(
      localStorage.getItem("plateSearchHistory") || "[]",
    );
    if (history.length > 0) {
      sug.style.display = "block";

      // --- NEW: Set fixed height and scrollbar for history ---
      sug.style.maxHeight = "105px"; // 3 items visible
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

  // --- NEW: Reset height for regular search suggestions ---
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
    if (currentFocus > -1 && items[currentFocus]) {
      items[currentFocus].click();
    } else if (items.length > 0) {
      items[0].click();
    }

    if (e.key === "Enter") {
      setTimeout(() => triggerFetch(), 100);
    }
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
  for (let i = 0; i < items.length; i++) {
    items[i].classList.remove("suggestion-active");
  }
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

function getDaysInMonth(monthStr, year) {
  return new Date(year, months.indexOf(monthStr) + 1, 0).getDate();
}

function getDayName(dayNum, monthStr, year) {
  const dateObj = new Date(`${monthStr} ${dayNum}, ${year}`);
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return daysOfWeek[dateObj.getDay()];
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

  // 🟢 1. Clear the tracker for new fetch so fresh edits get logged
  loggedRowsTracker.clear();

  savePlateHistory(p);

  const m = document.getElementById("selMonth").value;
  const y = document.getElementById("selYear").value;
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
    const res = await fetch(
      `/timesheet/api/grid-data?month=${m}&year=${y}&plate=${p}&_t=${ts}`,
      {
        headers: {
          Authorization: "Bearer " + token,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cache: "no-store",
      },
    );
    const data = await res.json();

    const logRes = await fetch(
      `/timesheet/api/vehicle-logs?plate=${p}&_t=${ts}`,
      {
        headers: {
          Authorization: "Bearer " + token,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cache: "no-store",
      },
    );
    const logs = await logRes.json();

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

    let sStartVal = null;
    let sEndVal = null;

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

      // Determine End Date and Status (Released / Replaced)
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

      // Show Old Vehicle if data exists
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

      // Show New Vehicle (Replaced By) if data exists
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
      const monthStr = m + " " + y;
      const invRes = await fetch(
        `/payment/get-invoice?plate_no=${p}&month=${monthStr}&_t=${ts}`,
        {
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          cache: "no-store",
        },
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

    let existingData = [];
    if (data.success) existingData = data.data;

    setTimeout(() => {
      renderGrid(m, y, p, existingData, sStartVal, sEndVal, logs);
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

  let startDateObj = siteStart ? new Date(siteStart) : new Date(year, 0, 1);
  let endDateObj = siteEnd ? new Date(siteEnd) : new Date(year, 11, 31);
  startDateObj.setHours(0, 0, 0, 0);
  endDateObj.setHours(0, 0, 0, 0);

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

    let displayBd = cleanVal(rowData.bd);
    let ws = cleanVal(rowData.wrk_start);
    let we = cleanVal(rowData.wrk_end);
    let hmr = cleanVal(rowData.hmr_start);
    let rowRemark = cleanVal(rowData.remark);

    // 🟢 PROTOCOL: Clear restricted BD statuses if time is entered
    if (ws !== "" && we !== "") {
      if (["H", "AB", "DC", "SC", "R", "B"].includes(displayBd)) {
        displayBd = "";
      }
    }

    // 🟢 Smart Auto-Fill & Override Logic
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
    } else if (["B", "H", "AB", "DC", "SC", "R"].includes(bd)) {
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

    input.addEventListener("blur", function () {
      const row = this.getAttribute("data-row");
      const col = this.getAttribute("data-col");
      const val = this.type === "checkbox" ? this.checked : this.value;
      calculateRow(row);
      saveCellData(row, col, val);
      updateSummaryBox();
    });

    if (input.type === "checkbox") {
      input.addEventListener("change", function () {
        const row = this.getAttribute("data-row");
        const col = this.getAttribute("data-col");
        const val = this.checked;
        calculateRow(row);
        saveCellData(row, col, val);
        updateSummaryBox();
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

  // 🟢 PROTOCOL: Remove H, AB, DC, SC, R when Work Start & End are entered
  if (ws !== "" && we !== "") {
    if (["H", "AB", "DC", "SC", "R", "B"].includes(bd)) {
      bd = "";
      bdInput.value = ""; // Clear from UI
      saveCellData(rowIdx, "bd", ""); // Save empty value to DB
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
    else if (["ID", "NP"].includes(bd)) finalTime = 10;
    else if (["B", "H", "AB", "DC", "SC", "R"].includes(bd)) finalTime = 0;
  } else if (ws && we) {
    let sHour = parseRailwayTime(ws);
    let eHour = parseRailwayTime(we);
    let diff = eHour - sHour;
    if (diff < 0) diff += 24;
    let endIsMorning = eHour >= 6 && eHour <= 12.5;

    // Check FULL_OT Special Rule
    let monthStr = document.getElementById("selMonth").value;
    let year = document.getElementById("selYear").value;
    let formattedDateForOT = new Date(year, months.indexOf(monthStr), rowIdx)
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

    if (nl || sHour >= 13 || endIsMorning || !!otRule) {
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
async function saveCellData(rowIdx, colName, colValue) {
  const plate = document.getElementById("selPlate").value.trim().toUpperCase();
  if (!plate || !colName) return;
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
    await fetch("/timesheet/api/upsert-grid-cell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });

    clearTimeout(saveTimeout);
    statusLabel.innerText = "✓ Saved";
    statusLabel.className = "save-indicator status-saved";
    saveTimeout = setTimeout(() => {
      statusLabel.className = "save-indicator";
    }, 2000);

    // ==========================================
    // 🚀 SMART LOGGING SYSTEM (BUG FIXED) 🚀
    // ==========================================
    try {
      const user = JSON.parse(localStorage.getItem("timesheetUser"));

      // 🟢 Safe Date Formatting (No Timezone Shift)
      const mIdx = months.indexOf(payload.month) + 1;
      const padMonth = String(mIdx).padStart(2, "0");
      const padDay = String(rowIdx).padStart(2, "0");
      const formattedDate = `${payload.year}-${padMonth}-${padDay}`;

      // 🟢 Unique Key for Tracking
      const logKey = `${payload.plate_no}_${formattedDate}`;

      // Only log if this row hasn't been logged in this session
      if (!loggedRowsTracker.has(logKey)) {
        // Mark immediately so fast typing doesn't trigger multiple calls
        loggedRowsTracker.add(logKey);

        const logRes = await fetch("/api/entrylog/add", {
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

        if (logRes.ok) {
          console.log(`✅ Log saved successfully for: ${logKey}`);
        } else {
          console.error(`❌ Log failed for: ${logKey}`);
        }
      }
    } catch (logErr) {
      console.error("❌ Failed to log entry", logErr);
    }
    // ==========================================
  } catch (e) {
    statusLabel.innerText = "Error";
    statusLabel.style.backgroundColor = "#dc3545";
  }
}

function customAlert(message, title = "Notice") {
  return new Promise((resolve) => {
    document.getElementById("customAlertTitle").innerText = title;
    document.getElementById("customAlertMessage").innerText = message;
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
  const monthStr = document.getElementById("selMonth").value;
  const yearStr = document.getElementById("selYear").value;
  const month = monthStr + " " + yearStr;
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

init();

// Function to save plate search history
function savePlateHistory(plate) {
  if (!plate) return;
  // Get existing history from local storage, or empty array if none
  let history = JSON.parse(localStorage.getItem("plateSearchHistory") || "[]");

  // Remove the plate if it already exists (to prevent duplicates and move it to top)
  history = history.filter((p) => p !== plate);

  // Add the new plate to the beginning
  history.unshift(plate);

  // Keep only the last 30
  if (history.length > 30) history = history.slice(0, 30);

  // Save back to local storage
  localStorage.setItem("plateSearchHistory", JSON.stringify(history));
}

// ==========================================
// User Menu & Dark Mode Logic
// ==========================================
function toggleUserMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("userDropdownMenu");
  menu.style.display = menu.style.display === "flex" ? "none" : "flex";
}

// Close menu if clicked outside
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
  localStorage.removeItem("timesheetToken");
  localStorage.removeItem("timesheetUser");
  window.location.href = "index.html";
}

// Initialize Theme on Page Load
(function initTheme() {
  const savedTheme = localStorage.getItem("timesheetTheme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
  }
})();
