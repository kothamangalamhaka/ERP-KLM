const monthNames = [
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

let selectedYear = null; // 🟢 Initially null (No year selected)
let selectedMonth = null; // Initially null
let currentExportType = "";

document.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem("eq_user")) {
    window.location.replace("index.html");
  }
  initFilters();
});

function initFilters() {
  const currentYear = new Date().getFullYear();
  const yearContainer = document.getElementById("yearButtonsContainer");
  yearContainer.innerHTML = "";

  const startYear = Math.max(currentYear, 2026);
  for (let y = startYear; y >= 2026; y--) {
    const btn = document.createElement("div");
    btn.className = `filter-btn`;
    btn.innerText = y;
    btn.onclick = () => selectYear(y);
    yearContainer.appendChild(btn);
  }
  renderMonthButtons(); // Will hide month section initially
}

// 🟢 NEW: Year Selection Logic
function selectYear(y) {
  if (selectedYear === y) {
    selectedYear = null; // Toggle Off if same year clicked
    selectedMonth = null;
  } else {
    selectedYear = y; // Set new year
    selectedMonth = null; // Reset month when year changes
  }

  // Update Year Button UI
  document
    .querySelectorAll("#yearButtonsContainer .filter-btn")
    .forEach((b) => {
      b.classList.remove("active");
      if (parseInt(b.innerText) === selectedYear) b.classList.add("active");
    });

  renderMonthButtons();
  updateTableVisibility();
}

function renderMonthButtons() {
  const monthSection = document.getElementById("monthSection");
  const container = document.getElementById("monthButtonsContainer");

  if (selectedYear === null) {
    monthSection.style.display = "none";
    container.innerHTML = "";
    return;
  }

  monthSection.style.display = "block";
  container.innerHTML = "";

  const allBtn = document.createElement("div");
  allBtn.className = `filter-btn ${selectedMonth === "ALL" ? "active" : ""}`;
  allBtn.innerText = "All Months";
  allBtn.onclick = () => selectMonth("ALL");
  container.appendChild(allBtn);

  monthNames.forEach((m, idx) => {
    const btn = document.createElement("div");
    const monthNum = idx + 1;
    btn.className = `filter-btn ${selectedMonth === monthNum ? "active" : ""}`;
    btn.innerText = m;
    btn.onclick = () => selectMonth(monthNum);
    container.appendChild(btn);
  });
}

// 🟢 NEW: Month Selection Logic
function selectMonth(m) {
  if (selectedMonth === m) {
    selectedMonth = null; // Toggle Off if same month clicked
  } else {
    selectedMonth = m; // Toggle On
  }
  renderMonthButtons();
  updateTableVisibility();
}

function updateTableVisibility() {
  const container = document.getElementById("dataContainer");
  if (selectedYear === null) {
    container.innerHTML =
      "<p style='text-align:center; font-size: 16px; color: #7f8c8d; margin-top: 50px;'>👆 Please select a Year first to proceed.</p>";
    return;
  }
  if (selectedMonth === null) {
    container.innerHTML =
      "<p style='text-align:center; font-size: 16px; color: #7f8c8d; margin-top: 50px;'>👆 Please select a month to view the data.</p>";
    return;
  }
  loadMonthlyData();
}

async function loadMonthlyData() {
  const container = document.getElementById("dataContainer");
  container.innerHTML = "<p style='text-align:center;'>Loading data...</p>";

  try {
    const res = await fetch(`/api/monthly-summary/data?year=${selectedYear}`);
    const data = await res.json();
    renderTables(data.equipments, data.logs, selectedYear, selectedMonth);
  } catch (err) {
    console.error(err);
    showToast("Error loading data", "error");
  }
}

function renderTables(equipments, logs, year, currentSelectedMonth) {
  const container = document.getElementById("dataContainer");
  container.innerHTML = "";

  let monthsToRender =
    currentSelectedMonth === "ALL"
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      : [parseInt(currentSelectedMonth)];

  monthsToRender.forEach((m) => {
    const monthLogs = logs.filter((l) => l.month === m);
    if (monthLogs.length === 0 && currentSelectedMonth === "ALL") return;

    const wrapperId = `month-wrapper-${m}`;
    let html = `
            <div class="month-container" id="${wrapperId}">
                <div class="month-header">
                    <div style="width:100px;"></div>
                    <h3 class="month-title">Monthly Income & Expenditure Statement :: ${monthNames[m - 1]} ${year}</h3>
                    <div class="export-icons">
                        <button class="export-btn" title="Export PDF" onclick="exportPDF(${m}, '${monthNames[m - 1]}', ${year})">📄</button>
                        <button class="export-btn" title="Copy as Image" onclick="copyImage('${wrapperId}')">📋</button>
                        <button class="export-btn" title="Export Excel" onclick="exportSingleExcel(${m}, ${year})">📊</button>
                    </div>
                </div>
                
                <table id="table-${m}">
                    <thead>
                        <tr>
                            <th colspan="2" class="th-main">EQ</th>
                            <th colspan="7" class="th-main">Expenditures</th>
                            <th colspan="2" class="th-main">Income</th>
                            <th colspan="3" class="th-main">Commissions</th>
                            <th class="th-main"></th>
                        </tr>
                        <tr>
                            <th>SN</th>
                            <th class="eq-width">Plate no</th>
                            <th>EQ Maintenance Cost</th>
                            <th class="eq-width">Net Salary</th>
                            <th>Santook Rent</th>
                            <th class="eq-width">Debt</th>
                            <th class="eq-width">PWAS</th>
                            <th class="eq-width">Other</th>
                            <th class="bg-op-exp">Total Operational Expenses</th>
                            <th class="bg-op-rev">Operational revenue</th>
                            <th class="bg-net-op">Net OP Revenue</th>
                            <th class="eq-width">Kafil</th>
                            <th class="eq-width">Owner</th>
                            <th class="eq-width">Investor</th>
                            <!-- 🟢 ADDED .pl-width here -->
                            <th class="bg-pl pl-width">Profit or Loss</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

    let totals = {
      maint: 0,
      netSal: 0,
      rent: 0,
      debt: 0,
      pwas: 0,
      other: 0,
      totOpExp: 0,
      opRev: 0,
      netOpRev: 0,
      kafil: 0,
      owner: 0,
      inv: 0,
      pl: 0,
    };

    equipments.forEach((eq, idx) => {
      const log = monthLogs.find((x) => x.equipment_id === eq.id) || {};
      const maint = Number(log.maintenance_cost || 0),
        basic = Number(log.basic_salary || 0),
        ot = Number(log.overtime || 0),
        penalty = Number(log.penalty || 0);
      const netSal = basic + ot - penalty;
      const rent = Number(log.santook_rent || 0),
        debt = Number(log.debit || 0),
        pwas = Number(log.pwas || 0),
        other = Number(log.other_expense || 0);
      const opRev = Number(log.op_revenue || 0);
      const totOpExp = maint + netSal + rent + debt + pwas + other;
      const netOpRev = opRev - totOpExp;
      const kafil = opRev * (Number(log.kafil_comm || 0) / 100),
        owner = Number(log.owner_comm || 0),
        inv = Number(log.investor_comm || 0);
      const totComm = kafil + owner + inv;
      const pl = netOpRev - totComm;

      totals.maint += maint;
      totals.netSal += netSal;
      totals.rent += rent;
      totals.debt += debt;
      totals.pwas += pwas;
      totals.other += other;
      totals.totOpExp += totOpExp;
      totals.opRev += opRev;
      totals.netOpRev += netOpRev;
      totals.kafil += kafil;
      totals.owner += owner;
      totals.inv += inv;
      totals.pl += pl;

      html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td><b>${eq.plate_no}</b></td>
                    <td>${fmt(maint)}</td>
                    <td>${fmt(netSal)}</td>
                    <td>${fmt(rent)}</td>
                    <td>${fmt(debt)}</td>
                    <td>${fmt(pwas)}</td>
                    <td>${fmt(other)}</td>
                    <td class="bg-op-exp">${fmt(totOpExp)}</td>
                    <td class="bg-op-rev">${fmt(opRev)}</td>
                    <td class="bg-net-op">${fmt(netOpRev)}</td>
                    <td>${fmt(kafil)}</td>
                    <td>${fmt(owner)}</td>
                    <td>${fmt(inv)}</td>
                    <td class="bg-pl pl-width" style="color: ${pl < 0 ? "red" : "black"};">${fmt(pl)}</td>
                </tr>
            `;
    });

    html += `
                    <tr style="font-weight: bold; background: #fafafa;">
                        <td colspan="2">TOTAL</td>
                        <td>${fmt(totals.maint)}</td>
                        <td>${fmt(totals.netSal)}</td>
                        <td>${fmt(totals.rent)}</td>
                        <td>${fmt(totals.debt)}</td>
                        <td>${fmt(totals.pwas)}</td>
                        <td>${fmt(totals.other)}</td>
                        <td class="bg-op-exp">${fmt(totals.totOpExp)}</td>
                        <td class="bg-op-rev">${fmt(totals.opRev)}</td>
                        <td class="bg-net-op">${fmt(totals.netOpRev)}</td>
                        <td>${fmt(totals.kafil)}</td>
                        <td>${fmt(totals.owner)}</td>
                        <td>${fmt(totals.inv)}</td>
                        <td class="bg-pl pl-width" style="color: ${totals.pl < 0 ? "red" : "black"};">${fmt(totals.pl)}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;
    container.innerHTML += html;
  });

  if (container.innerHTML === "") {
    container.innerHTML =
      "<p style='text-align:center;'>No operational data found for the selected period.</p>";
  }
}

function fmt(val) {
  return Number(val) === 0 ? "" : Number(val).toFixed(2);
}

// 🟢 EXPORT MODAL LOGIC
function openExportModal(type) {
  currentExportType = type;

  let monthOptions = "";
  monthNames.forEach((m, idx) => {
    monthOptions += `<option value="${idx + 1}">${m}</option>`;
  });

  let yearOptions = "";
  const currentYear = new Date().getFullYear();
  const startYear = Math.max(currentYear, 2026);
  for (let y = 2026; y <= startYear; y++) {
    yearOptions += `<option value="${y}">${y}</option>`;
  }

  document.getElementById("fromMonth").innerHTML = monthOptions;
  document.getElementById("toMonth").innerHTML = monthOptions;
  document.getElementById("fromYear").innerHTML = yearOptions;
  document.getElementById("toYear").innerHTML = yearOptions;

  // Use current year if selectedYear is null
  const defaultYear = selectedYear || new Date().getFullYear();
  document.getElementById("fromYear").value = defaultYear;
  document.getElementById("toYear").value = defaultYear;

  if (selectedMonth !== "ALL" && selectedMonth !== null) {
    document.getElementById("fromMonth").value = selectedMonth;
    document.getElementById("toMonth").value = selectedMonth;
  } else {
    document.getElementById("fromMonth").value = 1;
    document.getElementById("toMonth").value = 12;
  }

  document.getElementById("exportModal").style.display = "flex";
}

function closeExportModal() {
  document.getElementById("exportModal").style.display = "none";
}

async function executeBatchExport() {
  const fromM = parseInt(document.getElementById("fromMonth").value);
  const fromY = parseInt(document.getElementById("fromYear").value);
  const toM = parseInt(document.getElementById("toMonth").value);
  const toY = parseInt(document.getElementById("toYear").value);

  if (fromY > toY || (fromY === toY && fromM > toM)) {
    showToast(
      "Invalid Date Range! 'From' date must be before 'To' date.",
      "error",
    );
    return;
  }

  closeExportModal();

  if (currentExportType === "excel") {
    window.location.href = `/py/monthly-summary/export-excel?from_y=${fromY}&from_m=${fromM}&to_y=${toY}&to_m=${toM}`;
    showToast("Generating Excel...", "success");
  } else {
    showToast("Generating Batch PDF, please wait...", "success");
    const prevYear = selectedYear;
    const prevMonth = selectedMonth;

    try {
      let periods = [];
      for (let y = fromY; y <= toY; y++) {
        let start = y === fromY ? fromM : 1;
        let end = y === toY ? toM : 12;
        for (let m = start; m <= end; m++) {
          periods.push({ year: y, month: m });
        }
      }

      const yearsToFetch = [...new Set(periods.map((p) => p.year))];
      let allData = {};
      for (let y of yearsToFetch) {
        const res = await fetch(`/api/monthly-summary/data?year=${y}`);
        allData[y] = await res.json();
      }

      for (let p of periods) {
        const data = allData[p.year];
        renderTables(data.equipments, data.logs, p.year, p.month);
        await new Promise((r) => setTimeout(r, 400));

        const element = document.getElementById(`month-wrapper-${p.month}`);
        if (element) {
          const exportIcons = element.querySelector(".export-icons");
          if (exportIcons) exportIcons.style.display = "none";

          const originalOverflow = element.style.overflowX;
          element.style.overflowX = "visible";

          const HTML_Width = element.scrollWidth;
          const HTML_Height = element.scrollHeight;

          const opt = {
            margin: 10,
            filename: `Income_Expenditure_${monthNames[p.month - 1]}_${p.year}.pdf`,
            image: { type: "jpeg", quality: 1.0 },
            html2canvas: { scale: 2, useCORS: true, windowWidth: HTML_Width },
            pagebreak: { mode: "avoid-all" },
            jsPDF: {
              unit: "px",
              format: [HTML_Width + 20, HTML_Height + 50],
              orientation: "landscape",
            },
          };

          await html2pdf().set(opt).from(element).save();
        }
      }

      selectedYear = prevYear;
      selectedMonth = prevMonth;
      renderMonthButtons();
      updateTableVisibility();
      showToast("Batch PDF Export Completed!", "success");
    } catch (e) {
      showToast("Error generating PDFs", "error");
      console.error(e);
    }
  }
}

function exportSingleExcel(month, year) {
  window.location.href = `/py/monthly-summary/export-excel?from_y=${year}&from_m=${month}&to_y=${year}&to_m=${month}`;
  showToast("Generating Excel...", "success");
}

function exportPDF(month, monthName, year) {
  const element = document.getElementById(`month-wrapper-${month}`);
  const exportIcons = element.querySelector(".export-icons");
  if (exportIcons) exportIcons.style.display = "none";

  const originalOverflow = element.style.overflowX;
  element.style.overflowX = "visible";

  const HTML_Width = element.scrollWidth;
  const HTML_Height = element.scrollHeight;

  const opt = {
    margin: 10,
    filename: `Income_Expenditure_${monthName}_${year}.pdf`,
    image: { type: "jpeg", quality: 1.0 },
    html2canvas: { scale: 2, useCORS: true, windowWidth: HTML_Width },
    pagebreak: { mode: "avoid-all" },
    jsPDF: {
      unit: "px",
      format: [HTML_Width + 20, HTML_Height + 50],
      orientation: "landscape",
    },
  };

  html2pdf()
    .set(opt)
    .from(element)
    .save()
    .then(() => {
      if (exportIcons) exportIcons.style.display = "flex";
      element.style.overflowX = originalOverflow;
      showToast("PDF Exported Successfully!", "success");
    });
}

function copyImage(wrapperId) {
  const element = document.getElementById(wrapperId);
  const exportIcons = element.querySelector(".export-icons");
  if (exportIcons) exportIcons.style.display = "none";

  const originalOverflow = element.style.overflowX;
  element.style.overflowX = "visible";

  html2canvas(element, { scale: 3, backgroundColor: "#ffffff" }).then(
    (canvas) => {
      if (exportIcons) exportIcons.style.display = "flex";
      element.style.overflowX = originalOverflow;

      canvas.toBlob((blob) => {
        try {
          const item = new ClipboardItem({ "image/png": blob });
          navigator.clipboard
            .write([item])
            .then(() => {
              showToast("Image copied to clipboard!", "success");
            })
            .catch(() => downloadImage(canvas, "Statement.png"));
        } catch (e) {
          downloadImage(canvas, "Statement.png");
        }
      }, "image/png");
    },
  );
}

function downloadImage(canvas, filename) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
  showToast("Image Downloaded!", "success");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === "success" ? "✅ " : "❌ "} ${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
