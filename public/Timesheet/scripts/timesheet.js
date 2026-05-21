document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("timesheetToken");
  const userStr = localStorage.getItem("timesheetUser");
  let userRole = "";

  if (!token || !userStr) {
    window.location.replace("index.html");
    return;
  }

  const user = JSON.parse(userStr);
  userRole = user.role;
  // PC വ്യൂവിന് വേണ്ടി പഴയതുപോലെ തന്നെ പേര് മാത്രം കൊടുക്കുന്നു
  document.getElementById("userInfo").innerText =
    `👤 ${user.username} (${userRole})`;

  const hour = new Date().getHours();
  let greeting = "Good evening";
  if (hour < 12) greeting = "Good morning";
  else if (hour < 18) greeting = "Good afternoon";
  document.getElementById("welcomeText").innerText =
    `${greeting}, ${user.username}!`;

  if (userRole === "Editor" || userRole === "Super Admin") {
    document.getElementById("cardEntry").style.display = "flex";
    document.getElementById("cardDB").style.display = "flex";
  }

  if (userRole === "Super Admin") {
    document.getElementById("cardExcelSync").style.display = "flex";
    document.getElementById("cardRules").style.display = "flex";
    document.getElementById("cardSpecialRules").style.display = "flex";
    document.getElementById("cardAdmin").style.display = "flex";

    fetchRules();
  }
});

function logout() {
  localStorage.removeItem("timesheetToken");
  localStorage.removeItem("timesheetUser");
  window.location.replace("index.html");
}

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

function openExcelModal() {
  document.getElementById("excelModal").style.display = "flex";
}
function openRulesModal() {
  document.getElementById("rulesModal").style.display = "flex";
}
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

async function fetchRules() {
  try {
    const token = localStorage.getItem("timesheetToken");
    const res = await fetch("/timesheet/api/rules", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    const tbody = document.getElementById("rulesBody");
    tbody.innerHTML = "";
    if (data.success) {
      data.data.forEach((r) => {
        tbody.innerHTML += `
                <tr>
                    <td><input type="text" id="site_${r.id}" value="${r.site_keyword}"></td>
                    <td><input type="number" step="0.1" id="def_${r.id}" value="${r.default_deduct}"></td>
                    <td><input type="number" step="0.1" id="u11_${r.id}" value="${r.deduct_under_11}"></td>
                    <td><input type="number" step="0.1" id="o12_${r.id}" value="${r.deduct_over_12}"></td>
                    <td><button class="btn-success" style="padding: 6px 12px; font-size: 12px;" onclick="updateRule(${r.id})">Save</button></td>
                </tr>
                `;
      });
    }
  } catch (err) {
    console.error("Error fetching rules:", err);
  }
}

async function updateRule(id) {
  try {
    const token = localStorage.getItem("timesheetToken");
    const payload = {
      id: id,
      site_keyword: document.getElementById(`site_${id}`).value.toUpperCase(),
      default_deduct: document.getElementById(`def_${id}`).value,
      deduct_under_11: document.getElementById(`u11_${id}`).value,
      deduct_over_12: document.getElementById(`o12_${id}`).value,
    };
    await fetch("/timesheet/api/update-rule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });
    customAlert("Success", "Rule Updated Successfully");
  } catch (e) {
    customAlert("Error", "Failed to update rule.");
  }
}

async function addRule() {
  try {
    const site = document.getElementById("new_site").value.trim().toUpperCase();
    if (!site) {
      customAlert("Warning", "Please enter a Site Keyword.");
      return;
    }

    const payload = {
      site_keyword: site,
      default_deduct: document.getElementById("new_def").value,
      deduct_under_11: document.getElementById("new_u11").value,
      deduct_over_12: document.getElementById("new_o12").value,
    };

    const token = localStorage.getItem("timesheetToken");
    const res = await fetch("/timesheet/api/add-rule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.success) {
      document.getElementById("new_site").value = "";
      document.getElementById("new_def").value = "1";
      document.getElementById("new_u11").value = "1";
      document.getElementById("new_o12").value = "1";
      fetchRules();
      customAlert("Success", "New rule added successfully!");
    } else {
      customAlert("Error", data.message);
    }
  } catch (e) {
    customAlert("Error", "Failed to add new rule.");
  }
}

function s2ab(s) {
  var buf = new ArrayBuffer(s.length);
  var view = new Uint8Array(buf);
  for (var i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
  return buf;
}

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

    function calcRowDistTime(row, site) {
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

      let nlRaw = String(row["NL"]).trim().toUpperCase();
      let nl = nlRaw === "TRUE" || nlRaw === "Y" || nlRaw === "1";

      if (bd) {
        let bdNum = parseFloat(bd);
        if (!isNaN(bdNum)) finalTime = bdNum;
        else if (["ID", "NP"].includes(bd)) finalTime = 10;
        else if (["B", "H"].includes(bd)) finalTime = 0;
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

        if (diff < 0) {
          diff += 24;
        }

        let cRound = (val) => {
          let h = Math.floor(val);
          let mm = Math.round((val - h) * 60);
          return mm >= 45 ? h + 1 : h;
        };

        if (nl || sHour >= 13 || (eHour >= 6 && eHour <= 12.5)) {
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

        let calcRes = calcRowDistTime(row, site);

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
        console.error("Bulk Import Network Error:", err);
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
// --- User Menu & Dark Mode Logic ---

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

// Check saved theme on page load (Added at the bottom)
(function initTheme() {
  const savedTheme = localStorage.getItem("timesheetTheme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
  }
})();
function openSpecialRulesModal() {
  document.getElementById("specialRulesModal").style.display = "flex";
  
  // Initialize Professional Calendar for Multiple Dates
  flatpickr("#sr_dates", {
      mode: "multiple",
      dateFormat: "d M Y",
      placeholder: "📅 Click to select dates..."
  });

  loadSitesForDropdown(); // Load sites from database
  fetchSpecialRules();
}

let globalSpecialRules = []; // To store data for editing

async function fetchSpecialRules() {
  try {
    const token = localStorage.getItem("timesheetToken");
    const res = await fetch("/timesheet/api/special-rules", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    const tbody = document.getElementById("specialRulesBody");
    tbody.innerHTML = "";
    
    if (data.success && data.data) {
      globalSpecialRules = data.data; // Store globally
      data.data.forEach((r) => {
        let sitesStr = Array.isArray(r.sites) ? r.sites.join(", ") : r.sites;
        let datesStr = Array.isArray(r.dates) ? r.dates.join(", ") : r.dates;
        let statusBadge = r.is_active ? '<span style="color:green;font-weight:bold;">Active</span>' : '<span style="color:gray;font-weight:bold;">Inactive</span>';
        
        tbody.innerHTML += `
          <tr>
            <td style="font-size:12px;">${sitesStr}</td>
            <td style="font-size:12px;">${datesStr}</td>
            <td style="font-weight:bold; color:#0ea5e9;">${r.rule_type}</td>
            <td style="font-size:12px;">${r.reason || "-"}</td>
            <td>${statusBadge}</td>
            <td style="display: flex; gap: 5px; justify-content: center;">
              <button class="btn-success" style="padding: 4px 8px; font-size: 11px; border:none; border-radius:4px; cursor:pointer;" onclick="editSpecialRule(${r.id})">Edit</button>
              <button class="btn-danger" style="padding: 4px 8px; font-size: 11px; border:none; border-radius:4px; cursor:pointer;" onclick="deleteSpecialRule(${r.id})">Delete</button>
            </td>
          </tr>
        `;
      });
    }
  } catch (err) {
    console.error("Error fetching special rules:", err);
  }
}

function editSpecialRule(id) {
  const rule = globalSpecialRules.find(r => r.id === id);
  if(!rule) return;

  document.getElementById("sr_id").value = rule.id;
  document.getElementById("sr_sites_display").value = rule.sites.join(", ");
  document.getElementById("sr_sites").value = rule.sites.join(",");
  document.getElementById("sr_type").value = rule.rule_type;
  document.getElementById("sr_reason").value = rule.reason || "";
  document.getElementById("sr_status").value = rule.is_active ? "true" : "false";

  // Set dates in Flatpickr calendar
  const dateInput = document.getElementById("sr_dates");
  if(dateInput._flatpickr) {
    dateInput._flatpickr.setDate(rule.dates);
  }

  // Update UI for editing mode
  document.getElementById("sr_submit_btn").innerText = "Update";
  document.getElementById("sr_submit_btn").style.backgroundColor = "#10b981"; // Green for update
  document.getElementById("sr_cancel_btn").style.display = "block";
}

function cancelEditSpecialRule() {
  document.getElementById("sr_id").value = "";
  document.getElementById("sr_sites_display").value = "";
  document.getElementById("sr_sites").value = "";
  document.getElementById("sr_type").value = "FULL_OT";
  document.getElementById("sr_reason").value = "";
  document.getElementById("sr_status").value = "true";
  
  const dateInput = document.getElementById("sr_dates");
  if(dateInput._flatpickr) dateInput._flatpickr.clear();

  document.getElementById("sr_submit_btn").innerText = "+ Add";
  document.getElementById("sr_submit_btn").style.backgroundColor = "#2563eb"; // Back to blue
  document.getElementById("sr_cancel_btn").style.display = "none";
}

async function saveSpecialRule() {
  const id = document.getElementById("sr_id").value; // Empty means Add, Value means Edit
  const sitesInput = document.getElementById("sr_sites").value.trim().toUpperCase();
  const datesInput = document.getElementById("sr_dates").value.trim();
  const ruleType = document.getElementById("sr_type").value;
  const reason = document.getElementById("sr_reason").value.trim();
  const isActive = document.getElementById("sr_status").value === "true";

  if (!sitesInput || !datesInput) {
    customAlert("Warning", "Sites and Dates are required.");
    return;
  }

  const sitesArr = sitesInput.split(",").map(s => s.trim()).filter(Boolean);
  const datesArr = datesInput.split(",").map(d => d.trim()).filter(Boolean);

  const payload = {
    id: id ? parseInt(id) : null,
    sites: sitesArr,
    dates: datesArr,
    rule_type: ruleType,
    reason: reason,
    is_active: isActive
  };

  const endpoint = id ? "/timesheet/api/update-special-rule" : "/timesheet/api/add-special-rule";

  try {
    const token = localStorage.getItem("timesheetToken");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      cancelEditSpecialRule(); // Clears form
      fetchSpecialRules();
      customAlert("Success", id ? "Rule Updated!" : "Special Rule Added!");
    } else {
      customAlert("Error", data.message);
    }
  } catch (e) {
    customAlert("Error", "Failed to save rule.");
  }
}

async function deleteSpecialRule(id) {
  const isConfirmed = await customConfirm("Delete Rule", "Are you sure you want to permanently delete this rule? This action cannot be undone.");
  
  if (!isConfirmed) return; // User clicked Cancel
  
  try {
    const token = localStorage.getItem("timesheetToken");
    await fetch("/timesheet/api/delete-special-rule", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ id: id }),
    });
    fetchSpecialRules();
  } catch (e) {
    customAlert("Error", "Failed to delete rule.");
  }
}


// ==========================================
// SITE DROPDOWN LOGIC FOR SPECIAL RULES
// ==========================================

async function loadSitesForDropdown() {
  try {
    const token = localStorage.getItem("timesheetToken");
    // 🟢 Fetching directly from Timesheet Rules (Much simpler and accurate!)
    const res = await fetch("/timesheet/api/rules", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await res.json();
    
    if (data.success) {
      // Get unique site names from the rules table (excluding 'DEFAULT')
      let sites = data.data
        .map(r => r.site_keyword)
        .filter(s => s && s !== 'DEFAULT')
        .sort();
        
      const drop = document.getElementById("sr_sites_dropdown");
      
      // Default ALL SITES Option
      drop.innerHTML = `
        <label style="display:flex; gap:8px; padding:10px; border-bottom:1px solid #eee; cursor:pointer; font-size:13px; font-weight:bold; color:#0ea5e9;">
          <input type="checkbox" value="ALL" id="sr_chk_all" onchange="updateSrSitesDisplay()" checked> ALL SITES
        </label>
      `;
      
      // Add Each Site Option from Rules
      sites.forEach(site => {
        drop.innerHTML += `
          <label style="display:flex; gap:8px; padding:10px; border-bottom:1px solid #eee; cursor:pointer; font-size:13px;">
            <input type="checkbox" class="sr_site_chk" value="${site}" onchange="updateSrSitesDisplay()"> ${site}
          </label>
        `;
      });
      updateSrSitesDisplay();
    }
  } catch (err) {
    console.error("Error loading sites for dropdown", err);
  }
}

function toggleSiteDropdown() {
  const drop = document.getElementById("sr_sites_dropdown");
  drop.style.display = drop.style.display === "block" ? "none" : "block";
}

function updateSrSitesDisplay() {
  const allChk = document.getElementById("sr_chk_all");
  const siteChks = document.querySelectorAll(".sr_site_chk");
  let selected = [];
  
  if (allChk && allChk.checked) {
    selected.push("ALL");
    // Uncheck other sites if ALL is checked
    siteChks.forEach(c => c.checked = false); 
  } else {
    siteChks.forEach(c => {
      if (c.checked) selected.push(c.value);
    });
  }

  // Show selected values in UI, save actual comma-separated values in hidden input
  document.getElementById("sr_sites_display").value = selected.length > 0 ? selected.join(", ") : "";
  document.getElementById("sr_sites").value = selected.join(",");
}

// Close the dropdown automatically when clicking outside of it
document.addEventListener("click", function (e) {
  if (!e.target.closest("#sr_sites_display") && !e.target.closest("#sr_sites_dropdown")) {
    const drop = document.getElementById("sr_sites_dropdown");
    if (drop) drop.style.display = "none";
  }
});

let confirmResolver;

function customConfirm(title, msg) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    document.getElementById("confirmTitle").innerText = title;
    document.getElementById("confirmMessage").innerText = msg;
    document.getElementById("customConfirmModal").style.display = "flex";
  });
}

function resolveConfirm(result) {
  document.getElementById("customConfirmModal").style.display = "none";
  if (confirmResolver) confirmResolver(result);
}