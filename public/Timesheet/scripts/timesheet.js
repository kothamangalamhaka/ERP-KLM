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
