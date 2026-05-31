let allData = [];
let activeFilters = {};
let currentFilterCol = "";

// Pagination variables
let currentPage = 1;
let pageSize = 50;
let filteredDataCache = [];

document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (token) {
    document.getElementById("loader").style.display = "block";
    try {
      const res = await fetch("/billing/verify-session", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadApp();
      } else {
        executeLogout();
      }
    } catch (err) {
      executeLogout();
    }
  } else {
    document.getElementById("loginUserId").focus();
  }
});

async function executeLogin() {
  const username = document.getElementById("loginUserId").value;
  const password = document.getElementById("loginPass").value;
  if (!username || !password) return alert("Enter credentials");
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem("token", data.token);
      loadApp();
    } else {
      alert(data.message || "Invalid Credentials!");
    }
  } catch (err) {
    alert("Server Error");
  }
}

function executeLogout() {
  localStorage.removeItem("token");
  window.location.reload();
}

function loadApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("mainAppContainer").style.display = "block";
  fetchDashboardData();
}

function fetchDashboardData() {
  const token = localStorage.getItem("token");
  fetch("/billing/dashboard-data", {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((res) => {
      if (!res.ok) throw new Error("Unauthorized");
      return res.json();
    })
    .then((data) => {
      document.getElementById("loader").style.display = "none";
      if (data.success) {
        allData = data.data;
        applyAllFiltersAndRender();
        attachHeaderListeners();
      }
    })
    .catch((err) => {
      document.getElementById("loader").innerText =
        "Session Expired. Please Login.";
      setTimeout(executeLogout, 2000);
    });
}

function parseAdjustment(descStr) {
  if (!descStr || descStr === "-") return [];
  try {
    let parsed = JSON.parse(descStr);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    return [{ date: "", desc: descStr, amt: 0 }];
  }
}

function applyAllFiltersAndRender() {
  filteredDataCache = allData.filter((row) => {
    for (let col in activeFilters) {
      if (activeFilters[col].length > 0) {
        let cellValue = String(row[col] || "-");

        if (col === "adj_date") {
          let adjs = parseAdjustment(row.adjustment_desc);
          let dates = adjs.map((a) => a.date || "-");
          if (!activeFilters[col].some((val) => dates.includes(val))) {
            return false;
          }
        } else if (!activeFilters[col].includes(cellValue)) {
          return false;
        }
      }
    }
    return true;
  });

  if (currentPage > Math.ceil(filteredDataCache.length / pageSize)) {
    currentPage = 1;
  }

  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById("dashboardBody");
  tbody.innerHTML = "";
  document.getElementById("dashboardTable").style.display = "table";

  let startIndex = (currentPage - 1) * pageSize;
  let endIndex = startIndex + pageSize;
  let paginatedData = filteredDataCache.slice(startIndex, endIndex);

  paginatedData.forEach((row) => {
    let tr = document.createElement("tr");

    let adjs = parseAdjustment(row.adjustment_desc);

    let dateHtml = "-";
    let descHtml = "-";
    let amtHtml = "-";

    // 🟢 If multiple lines, separate them with a thin dashed line for readability
    if (adjs.length > 0) {
      let separator =
        "<br><hr style='border:0; border-top:1px dashed #ccc; margin:4px 0;'>";
      dateHtml = adjs.map((a) => a.date || "-").join(separator);
      descHtml = adjs.map((a) => a.desc || "-").join(separator);
      amtHtml = adjs
        .map((a) =>
          parseFloat(a.amt || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
          }),
        )
        .join(separator);
    } else if (row.adjustment_desc && row.adjustment_desc !== "-") {
      descHtml = row.adjustment_desc;
      amtHtml = parseFloat(row.adjusted_amount || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
      });
    }

    tr.innerHTML = `
            <td style="color:#1a4d80;">${row.billing_month || "-"}</td>
            <td style="font-weight:bold; color:#d62828;">${row.site_name || "-"}</td>
            <td style="font-weight:normal;">${row.owner || "-"}</td>
            <td>${row.plate_no || "-"}</td>
            <td>${row.nhr || 0}</td>
            <td>${row.othr || 0}</td>
            <td class="money">${parseFloat(row.rent || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td class="money">${parseFloat(row.vat_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            
            <td style="font-size:11px; white-space:nowrap; vertical-align: top;">${dateHtml}</td>
            <td style="font-size:11px; vertical-align: top;">${descHtml}</td>
            <td class="money" style="vertical-align: top;">${amtHtml}</td>
            
            <td class="money grand-total" style="vertical-align: middle;">${parseFloat(row.after_adjustment || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
        `;
    tbody.appendChild(tr);
  });
}

function changePageSize() {
  pageSize = parseInt(document.getElementById("pageSizeSelect").value);
  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderPagination() {
  const totalPages = Math.ceil(filteredDataCache.length / pageSize);
  const pagContainer = document.getElementById("paginationButtons");
  pagContainer.innerHTML = "";

  if (totalPages <= 1) return;

  let btnPrev = document.createElement("button");
  btnPrev.innerText = "◄";
  btnPrev.style.cssText =
    "padding:3px 8px; cursor:pointer; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px;";
  btnPrev.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
      renderPagination();
    }
  };
  pagContainer.appendChild(btnPrev);

  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);

  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  for (let i = startPage; i <= endPage; i++) {
    let btn = document.createElement("button");
    btn.innerText = i;
    btn.style.cssText = `padding:3px 8px; cursor:pointer; border:1px solid #cbd5e1; border-radius:4px; ${i === currentPage ? "background:#1a4d80; color:white;" : "background:white; color:#333;"}`;
    btn.onclick = () => {
      currentPage = i;
      renderTable();
      renderPagination();
    };
    pagContainer.appendChild(btn);
  }

  let btnNext = document.createElement("button");
  btnNext.innerText = "►";
  btnNext.style.cssText =
    "padding:3px 8px; cursor:pointer; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px;";
  btnNext.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
      renderPagination();
    }
  };
  pagContainer.appendChild(btnNext);
}

function attachHeaderListeners() {
  document.querySelectorAll("th[data-col]").forEach((th) => {
    th.onclick = (e) => {
      const col = th.getAttribute("data-col");
      openFilterMenu(e, col);
    };
  });
}

function openFilterMenu(e, col) {
  e.stopPropagation();
  currentFilterCol = col;
  const menu = document.getElementById("filterMenu");
  const optionsContainer = document.getElementById("filterOptions");
  document.getElementById("filterSearch").value = "";

  const visibleOptionsData = allData.filter((row) => {
    for (let c in activeFilters) {
      if (c === col) continue;

      if (activeFilters[c].length > 0) {
        if (c === "adj_date") {
          let adjs = parseAdjustment(row.adjustment_desc);
          let dates = adjs.map((a) => a.date || "-");
          if (!activeFilters[c].some((val) => dates.includes(val)))
            return false;
        } else if (!activeFilters[c].includes(String(row[c] || "-"))) {
          return false;
        }
      }
    }
    return true;
  });

  let uniqueValues = [];

  if (col === "adj_date") {
    let allDates = [];
    visibleOptionsData.forEach((row) => {
      let adjs = parseAdjustment(row.adjustment_desc);
      if (adjs.length === 0) allDates.push("-");
      else adjs.forEach((a) => allDates.push(a.date || "-"));
    });
    uniqueValues = [...new Set(allDates)].sort();
  } else if (col === "adjustment_desc" || col === "adjusted_amount") {
    uniqueValues = [
      ...new Set(visibleOptionsData.map((row) => String(row[col] || "-"))),
    ].sort();
  } else {
    uniqueValues = [
      ...new Set(visibleOptionsData.map((row) => String(row[col] || "-"))),
    ].sort();
  }

  optionsContainer.innerHTML = "";
  uniqueValues.forEach((val) => {
    const isChecked = activeFilters[col] && activeFilters[col].includes(val);
    optionsContainer.innerHTML += `
            <label class="filter-item">
                <input type="checkbox" value="${val}" ${isChecked ? "checked" : ""}>
                <span>${val}</span>
            </label>
        `;
  });

  menu.style.display = "block";

  let leftPos = e.pageX;
  if (leftPos + 250 > window.innerWidth) {
    leftPos = window.innerWidth - 270;
  }

  menu.style.top = e.pageY + 10 + "px";
  menu.style.left = leftPos + "px";
}

function filterCheckboxes() {
  const search = document.getElementById("filterSearch").value.toLowerCase();
  document.querySelectorAll(".filter-item").forEach((item) => {
    const text = item.innerText.toLowerCase();
    item.style.display = text.includes(search) ? "flex" : "none";
  });
}

function applyFilters() {
  const selected = Array.from(
    document.querySelectorAll("#filterOptions input:checked"),
  ).map((cb) => cb.value);
  activeFilters[currentFilterCol] = selected;

  const th = document.querySelector(
    `th[data-col="${currentFilterCol}"] .filter-icon`,
  );
  if (selected.length > 0) th.style.color = "#2563eb";
  else th.style.color = "#cbd5e1";

  document.getElementById("filterMenu").style.display = "none";
  applyAllFiltersAndRender();
}

function clearFilters() {
  activeFilters[currentFilterCol] = [];
  const th = document.querySelector(
    `th[data-col="${currentFilterCol}"] .filter-icon`,
  );
  if (th) th.style.color = "#cbd5e1";
  document.getElementById("filterMenu").style.display = "none";
  applyAllFiltersAndRender();
}

window.onclick = () =>
  (document.getElementById("filterMenu").style.display = "none");
document.getElementById("filterMenu").onclick = (e) => e.stopPropagation();

// 🟢 EXPORT TO EXCEL: Includes 3 separate columns & '\n' for multiple lines
async function exportToExcelFrontend() {
  const btn = document.querySelector(".btn-excel");
  const originalText = btn.innerHTML;
  btn.innerHTML = "⏳ Downloading...";
  btn.disabled = true;

  try {
    if (filteredDataCache.length === 0) {
      alert("No data available to export.");
      return;
    }

    const exportData = [];

    filteredDataCache.forEach((row) => {
      let adjs = parseAdjustment(row.adjustment_desc);
      let dateStr = "-";
      let descStr = "-";
      let amtStr = "-";

      if (adjs.length > 0) {
        dateStr = adjs.map((a) => a.date || "-").join("\n"); // \n makes it multi-line in Excel
        descStr = adjs.map((a) => a.desc || "-").join("\n");
        amtStr = adjs.map((a) => parseFloat(a.amt || 0).toFixed(2)).join("\n");
      } else if (row.adjustment_desc && row.adjustment_desc !== "-") {
        descStr = row.adjustment_desc;
        amtStr = parseFloat(row.adjusted_amount || 0).toFixed(2);
      }

      exportData.push({
        Month: row.billing_month || "-",
        "Site Name": row.site_name || "-",
        Owner: row.owner || "-",
        "Plate No": row.plate_no || "-",
        "N.Hr": row.nhr || 0,
        "OT Hr": row.othr || 0,
        "Total Rent": parseFloat(row.rent || 0),
        "Total VAT": parseFloat(row.vat_amount || 0),
        "Adj Date": dateStr,
        "Adjustment Desc": descStr,
        "Adj Amount": amtStr,
        "After Adjustment": parseFloat(row.after_adjustment || 0),
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Make Excel columns wider to fit the text
    if (!worksheet["!cols"]) worksheet["!cols"] = [];
    worksheet["!cols"][8] = { width: 12 }; // Adj Date
    worksheet["!cols"][9] = { width: 25 }; // Adj Desc
    worksheet["!cols"][10] = { width: 12 }; // Adj Amt

    const workbook = XLSX.utils.book_new();

    let sheetName = "Filtered_Bills";
    if (
      activeFilters["billing_month"] &&
      activeFilters["billing_month"].length === 1
    ) {
      sheetName = activeFilters["billing_month"][0].substring(0, 31);
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    let fileName = `Billing_${sheetName.replace(/ /g, "_")}_Export.xlsx`;

    XLSX.writeFile(workbook, fileName);
  } catch (error) {
    console.error(error);
    alert("Export Failed!");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
