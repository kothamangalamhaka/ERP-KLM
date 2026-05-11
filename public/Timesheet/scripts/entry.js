const token = localStorage.getItem("timesheetToken");
if (!token) window.location.href = "index.html";

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
  document.getElementById("userInfo").innerText = `${u.username} (${u.role})`;
}

let rulesCache = [];
let vehiclesCache = [];
let currentFocus = -1;
let isEditingInvoice = false;
let currentInvoices = []; // 🟢 ഗ്ലോബൽ ആയി ഇൻവോയ്‌സുകൾ സൂക്ഷിക്കാൻ

async function init() {
  const rRes = await fetch("/timesheet/api/rules", {
    headers: { Authorization: "Bearer " + token },
  });
  const rData = await rRes.json();
  if (rData.success) rulesCache = rData.data;

  const vRes = await fetch("/timesheet/api/vehicle-info", {
    headers: { Authorization: "Bearer " + token },
  });
  const vData = await vRes.json();
  if (vData.success) vehiclesCache = vData.data;
}

function searchPlate() {
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
  document.getElementById("replaceRow").style.display = "none";

  document.getElementById("invSiteSelect").innerHTML =
    '<option value="">Waiting for data...</option>';
  clearInvoiceForm();
  isEditingInvoice = false;
  currentInvoices = [];

  if (!val) {
    sug.style.display = "none";
    return;
  }

  const matches = vehiclesCache.filter(
    (v) =>
      (v.plate_no && v.plate_no.toUpperCase().includes(val)) ||
      (v.asset_code && v.asset_code.toUpperCase().includes(val)) ||
      (v.wrk_order_no && v.wrk_order_no.toUpperCase().includes(val)),
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
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (currentFocus > -1 && items[currentFocus]) {
      items[currentFocus].click();
      setTimeout(() => triggerFetch(), 100);
    } else {
      triggerFetch();
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
    const res = await fetch(
      `/timesheet/api/grid-data?month=${m}&year=${y}&plate=${p}`,
      { headers: { Authorization: "Bearer " + token } },
    );
    const data = await res.json();

    const logRes = await fetch(`/timesheet/api/vehicle-logs?plate=${p}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const logs = await logRes.json();

    let mIdx = months.indexOf(m);
    let monthStart = new Date(y, mIdx, 1);
    let monthEnd = new Date(y, mIdx + 1, 0);

    let dNameArr = [],
      dMobArr = [],
      siteArr = [];
    let activeSites = [];

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
        let sortedDrivers = [...logs.drivers].sort(
          (a, b) =>
            new Date(b.work_start_date || "2000-01-01") -
            new Date(a.work_start_date || "2000-01-01"),
        );
        activeDrivers = [sortedDrivers[0]];
      }

      if (activeDrivers.length > 0) {
        dNameArr = [...new Set(activeDrivers.map((d) => d.driver_name))].filter(
          Boolean,
        );
        dMobArr = [
          ...new Set(activeDrivers.map((d) => d.driver_mobile || "-")),
        ].filter(Boolean);
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
        let sortedSites = [...logs.sites].sort(
          (a, b) =>
            new Date(b.work_start_date || "2000-01-01") -
            new Date(a.work_start_date || "2000-01-01"),
        );
        activeSites = [sortedSites[0]];
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
    // സൈറ്റ് ലോഗിൽ ലേറ്റസ്റ്റ് എൻട്രി ഉണ്ടെങ്കിൽ അതിൽ നിന്ന് എടുക്കുക, ഇല്ലെങ്കിൽ മാസ്റ്റർ ഡിബിയിൽ നിന്ന് എടുക്കുക
    if (activeSites.length > 0) {
      let latestSiteLog = activeSites[0];

      // Field Co, Site Co എന്നിവ ലേറ്റസ്റ്റ് ലോഗിൽ നിന്ന് കാണിക്കുന്നു
      document.getElementById("dispFieldCo").innerText =
        latestSiteLog.field_co || (vObjMaster ? vObjMaster.field_co : "N/A");
      document.getElementById("dispSiteCo").innerText =
        latestSiteLog.site_co || (vObjMaster ? vObjMaster.site_co : "N/A");

      // ... ബാക്കി പഴയതുപോലെ (Asset, Work Order etc.)
    } else {
      // ആക്ടീവ് സൈറ്റ് ലോഗ് ഇല്ലെങ്കിൽ മാസ്റ്റർ ഡിബിയിൽ നിന്ന് കാണിക്കുന്നു
      document.getElementById("dispFieldCo").innerText = vObjMaster
        ? vObjMaster.field_co || "N/A"
        : "N/A";
      document.getElementById("dispSiteCo").innerText = vObjMaster
        ? vObjMaster.site_co || "N/A"
        : "N/A";
    }
    if (activeSites.length > 0) {
      activeSites.sort(
        (a, b) =>
          new Date(b.work_start_date || "2000-01-01") -
          new Date(a.work_start_date || "2000-01-01"),
      );
      let latestSiteLog = activeSites[0];
      let sStart = latestSiteLog.work_start_date
        ? latestSiteLog.work_start_date.split("T")[0]
        : "N/A";
      let sEnd = latestSiteLog.work_end_date
        ? latestSiteLog.work_end_date.split("T")[0]
        : "Running";

      document.getElementById("dispSiteStart").innerText = formatDateUI(sStart);
      document.getElementById("dispSiteEnd").innerText =
        sEnd === "Running" ? "Running" : formatDateUI(sEnd);

      // 🟢 Update Asset and Work Order from the Latest Site Log, fallback to Master DB
      document.getElementById("dispAsset").innerText =
        latestSiteLog.asset_code ||
        (vObjMaster ? vObjMaster.asset_code : null) ||
        "N/A";
      document.getElementById("dispWorkOrder").innerText =
        latestSiteLog.work_order_no ||
        (vObjMaster ? vObjMaster.wrk_order_no : null) ||
        "N/A";

      if (latestSiteLog.status === "Replaced" && latestSiteLog.replaced_by) {
        document.getElementById("replaceRow").style.display = "flex";
        document.getElementById("dispSiteReplace").innerText =
          latestSiteLog.replaced_by;
      } else {
        document.getElementById("replaceRow").style.display = "none";
      }
    } else {
      document.getElementById("dispSiteStart").innerText = "N/A";
      document.getElementById("dispSiteEnd").innerText = "N/A";
      document.getElementById("replaceRow").style.display = "none";

      // Fallback to Master DB if no active site logs
      document.getElementById("dispAsset").innerText = vObjMaster
        ? vObjMaster.asset_code || "N/A"
        : "N/A";
      document.getElementById("dispWorkOrder").innerText = vObjMaster
        ? vObjMaster.wrk_order_no || "N/A"
        : "N/A";
    }

    // 🟢 Fetch Array of Invoices and Populate Dropdown
    try {
      const monthStr = m + " " + y;
      const invRes = await fetch(
        `/payment/get-invoice?plate_no=${p}&month=${monthStr}`,
      );
      const invData = await invRes.json();

      currentInvoices = invData.success && invData.data ? invData.data : [];
    } catch (e) {
      console.error("Invoice Fetch Error:", e);
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
      loadInvoiceForSelectedSite(); // ആദ്യത്തെ സൈറ്റ് തനിയെ ലോഡ് ആകും
    } else {
      invSiteSelect.innerHTML = '<option value="">No Site Active</option>';
      clearInvoiceForm();
    }

    let existingData = [];
    if (data.success) existingData = data.data;

    setTimeout(() => {
      renderGrid(m, y, p, existingData);
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

// 🟢 ലോഡ് ചെയ്ത ഇൻവോയ്സ് ഡാറ്റ ഫിൽ ചെയ്യാൻ
function loadInvoiceForSelectedSite() {
  const selectedSite = document.getElementById("invSiteSelect").value;
  if (!selectedSite) {
    clearInvoiceForm();
    return;
  }

  // തിരഞ്ഞെടുത്ത സൈറ്റിലെ ഡാറ്റ ഉണ്ടോ എന്ന് നോക്കുന്നു
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

// 🟢 ബോക്സുകൾ ക്ലിയർ ചെയ്യാൻ
function clearInvoiceForm() {
  document.getElementById("invNo").value = "";
  document.getElementById("invBillNo").value = "";
  document.getElementById("invNr").value = "";
  document.getElementById("invOt").value = "";
  document.getElementById("invAmt").value = "";
  isEditingInvoice = false;
}

function renderGrid(month, year, plate, existingData) {
  const tbody = document.getElementById("gridBody");
  tbody.innerHTML = "";
  const days = getDaysInMonth(month, year);

  for (let i = 1; i <= days; i++) {
    const rowData =
      existingData.find((r) => parseInt(r.record_date) === i) || {};
    let dbDist = rowData.calc_distance;
    if (dbDist !== null && dbDist !== undefined && dbDist !== "")
      dbDist = parseFloat(dbDist).toFixed(1);
    else dbDist = "";

    let dayName = getDayName(i, month, year);
    let rowClass = dayName === "Fri" ? "row-friday" : "";

    let tr = document.createElement("tr");
    tr.className = rowClass;
    tr.innerHTML = `
                <td><input type="text" class="grid-readonly" value="${plate}" tabindex="-1" readonly></td>
                <td><input type="text" class="grid-readonly" value="${i}" tabindex="-1" readonly></td>
                <td><input type="text" class="grid-readonly" value="${dayName}" tabindex="-1" readonly style="color:#64748b;"></td>
                <td><input type="text" class="grid-input" data-col="wrk_start" data-row="${i}" value="${rowData.wrk_start || ""}"></td>
                <td><input type="text" class="grid-input" data-col="wrk_end" data-row="${i}" value="${rowData.wrk_end || ""}"></td>
                <td><input type="text" class="grid-input" data-col="hmr_start" data-row="${i}" value="${rowData.hmr_start || ""}"></td>
                <td><input type="text" class="grid-input" data-col="hmr_end" data-row="${i}" value="${rowData.hmr_end || ""}"></td>
                <td><input type="text" class="grid-input" data-col="fuel" data-row="${i}" value="${rowData.fuel || ""}"></td>
                <td><input type="text" class="grid-input" data-col="bd" data-row="${i}" value="${rowData.bd || ""}"></td>
                <td><input type="checkbox" class="grid-input" data-col="nl_checked" data-row="${i}" ${rowData.nl_checked ? "checked" : ""}></td>
                <td><input type="text" class="grid-readonly" id="dist_${i}" value="${dbDist}" tabindex="-1" readonly></td>
                <td><input type="text" class="grid-readonly" id="time_${i}" value="${rowData.calc_time || ""}" tabindex="-1" readonly></td>
                <td><textarea class="grid-input" data-col="remark" data-row="${i}">${rowData.remark || ""}</textarea></td>
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

    let hasLog = false;
    if (bd !== "") {
      if (!isNaN(parseFloat(bd))) {
        hasLog = true;
      } else {
        hasLog = false;
      }
    } else if (ws !== "" && we !== "") {
      hasLog = true;
    }

    if (hasLog) {
      logCount++;
    }

    let dayName = getDayName(i, monthStr, year);
    let isFullOT = dayName === "Fri" || i === 31;

    let normalHr = 0;
    let otHr = 0;

    if (bd === "ID" || bd === "NP") {
      if (isFullOT) {
        otHr = 10;
      } else {
        normalHr = 10;
      }
    } else if (bd === "B" || bd === "H") {
      // Zero hours
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
  const bd = document
    .querySelector(`.grid-input[data-row="${rowIdx}"][data-col="bd"]`)
    .value.trim()
    .toUpperCase();
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
    else if (["B", "H"].includes(bd)) finalTime = 0;
  } else if (ws && we) {
    let sHour = parseRailwayTime(ws);
    let eHour = parseRailwayTime(we);
    let diff = eHour - sHour;

    if (diff < 0) {
      diff += 24;
    }

    let endIsMorning = eHour >= 6 && eHour <= 12.5;

    if (nl || sHour >= 13 || endIsMorning) {
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
  } catch (e) {
    statusLabel.innerText = "Error";
    statusLabel.style.backgroundColor = "#dc3545";
  }
}

init();

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

// 🟢 Save Invoice Logic (with specific Site Name)
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

      // 🟢 Update local array so we don't have to re-fetch from database immediately
      let existingIdx = currentInvoices.findIndex(
        (i) => i.site_name === site_name,
      );
      if (existingIdx > -1) {
        currentInvoices[existingIdx] = payload;
      } else {
        currentInvoices.push(payload);
      }
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
