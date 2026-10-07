let securityCode = localStorage.getItem("debitNoteSecurityCode") || "";
let records = [];
let groupedOwners = {};
let selectedOwnerKey = null;
let ownerActiveFilters = {};
let activeOwnerCol = null;

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

function formatDateDisplay(dStr) {
  if (!dStr) return "";
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  return `${day}-${monthNames[d.getMonth()]}-${d.getFullYear()}`;
}

function showStatus(msg, type = "saved") {
  const badge = document.getElementById("syncStatus");
  if (badge) {
    badge.innerText = msg;
    badge.className = `status-badge ${type}`;
    if (type === "saved") {
      setTimeout(() => {
        badge.className = "status-badge";
        badge.innerText = "✓ Ready";
      }, 2500);
    }
  }

  const toast = document.getElementById("toast");
  if (toast) {
    toast.innerText = msg;
    toast.className = "bottom-toast show";
    setTimeout(() => {
      toast.className = "bottom-toast";
    }, 2500);
  }
}

async function verifyAccessCode() {
  const code = document.getElementById("securityCodeInput").value.trim();
  if (!code) return;
  try {
    const res = await fetch("/debit-notes/api/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.success) {
      securityCode = code;
      localStorage.setItem("debitNoteSecurityCode", code);
      document.getElementById("securityModal").style.display = "none";
      loadDashboardData();
    } else {
      showStatus("Invalid Security Code", "error");
    }
  } catch (err) {
    showStatus("Verification failed", "error");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (securityCode) {
    document.getElementById("securityModal").style.display = "none";
    loadDashboardData();
  }
});

async function loadDashboardData() {
  showStatus("Loading data...", "saving");
  try {
    const res = await fetch("/debit-notes/api/records", {
      headers: { "x-security-code": securityCode },
    }).then((r) => r.json());

    if (!res.success) {
      if (res.message === "Security Code Verification Failed") {
        document.getElementById("securityModal").style.display = "flex";
        return;
      }
      throw new Error(res.message);
    }

    records = res.data || [];
    calculateKPIs();
    groupDataByOwner();
    renderOwnersList();
    showStatus("✓ Loaded", "saved");
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
}

function formatCombinedSite(site, company, customer) {
  const parts = [site, company, customer]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : "";
}

function calculateKPIs() {
  let totalAmt = 0;
  let paidAmt = 0;
  let pendingAmt = 0;
  let paidCount = 0;
  let pendingCount = 0;

  records.forEach((r) => {
    const tot = parseFloat(r.total_amount) || parseFloat(r.amount) || 0;
    totalAmt += tot;

    const isPaid = String(r.status || "").trim().toLowerCase() === "paid";
    if (isPaid) {
      paidAmt += tot;
      paidCount++;
    } else {
      pendingAmt += tot;
      pendingCount++;
    }
  });

  document.getElementById("kpiTotalAmount").innerText = `SAR ${totalAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("kpiTotalCount").innerText = `${records.length} Records`;

  document.getElementById("kpiPaidAmount").innerText = `SAR ${paidAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("kpiPaidCount").innerText = `${paidCount} Records`;

  document.getElementById("kpiPendingAmount").innerText = `SAR ${pendingAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("kpiPendingCount").innerText = `${pendingCount} Records`;
}

function groupDataByOwner() {
  groupedOwners = {};

  records.forEach((r) => {
    const rawOwner = (r.owner_name || "").trim();
    const owner = rawOwner === "" ? "Unassigned" : rawOwner;

    if (!groupedOwners[owner]) {
      groupedOwners[owner] = {
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        items: [],
      };
    }

    const tot = parseFloat(r.total_amount) || parseFloat(r.amount) || 0;
    groupedOwners[owner].totalAmount += tot;

    const isPaid = String(r.status || "").trim().toLowerCase() === "paid";
    if (isPaid) {
      groupedOwners[owner].paidAmount += tot;
    } else {
      groupedOwners[owner].pendingAmount += tot;
    }

    groupedOwners[owner].items.push(r);
  });
}

function renderOwnersList(filterText = "") {
  const container = document.getElementById("ownerListContainer");
  container.innerHTML = "";

  const q = filterText.toLowerCase();
  const owners = Object.keys(groupedOwners).sort();
  let count = 0;

  owners.forEach((owner) => {
    if (q && !owner.toLowerCase().includes(q)) return;
    count++;

    const div = document.createElement("div");
    div.className = `owner-item ${selectedOwnerKey === owner ? "active" : ""}`;
    div.onclick = () => selectOwner(owner);

    const amt = groupedOwners[owner].totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    div.innerHTML = `
      <span class="owner-item-name">${escapeHTML(owner)}</span>
      <span class="owner-item-amt">SAR ${amt}</span>
    `;
    container.appendChild(div);
  });

  document.getElementById("ownerCountBadge").innerText = count;
}

function filterOwnersList() {
  const q = document.getElementById("ownerSearchInput").value;
  renderOwnersList(q);
}

function selectOwner(owner) {
  selectedOwnerKey = owner;
  ownerActiveFilters = {};
  const searchInput = document.getElementById("ownerTableSearchInput");
  if (searchInput) searchInput.value = "";

  renderOwnersList(document.getElementById("ownerSearchInput").value);

  const ownerData = groupedOwners[owner];
  if (!ownerData) return;

  document.getElementById("selectedOwnerName").innerText = owner;
  document.getElementById("detailActionBtns").style.display = "flex";
  document.getElementById("ownerBottomSummaryBar").style.display = "flex";

  renderOwnerTableRows();
}

function getOwnerRowValue(item, col) {
  if (col === "total_amount") {
    return (parseFloat(item.total_amount) || parseFloat(item.amount) || 0).toFixed(2);
  }
  if (col === "site_name") {
    return formatCombinedSite(item.site, item.company, item.customer);
  }
  if (col === "status") {
    const isPaid = String(item.status || "").trim().toLowerCase() === "paid";
    return isPaid ? "Paid" : "Pending";
  }
  if (col === "received_date") {
    return formatDateDisplay(item.received_date);
  }
  return String(item[col] || "").trim();
}

function renderOwnerTableRows() {
  const ownerData = groupedOwners[selectedOwnerKey];
  if (!ownerData) return;

  const tbody = document.getElementById("ownerTableBody");
  tbody.innerHTML = "";

  const q = (document.getElementById("ownerTableSearchInput")?.value || "").trim().toUpperCase();

  let visibleCount = 0;
  let ownerTotal = 0;
  let ownerPaid = 0;
  let ownerPending = 0;

  ownerData.items.forEach((item) => {
    let visible = true;

    for (let col in ownerActiveFilters) {
      const val = getOwnerRowValue(item, col) || "(Blanks)";
      if (!ownerActiveFilters[col].includes(val)) {
        visible = false;
        break;
      }
    }

    if (visible && q) {
      const rowText = [
        item.month_year,
        formatDateDisplay(item.received_date),
        item.plate_no,
        item.particulars,
        item.driver_name,
        (parseFloat(item.total_amount) || parseFloat(item.amount) || 0).toFixed(2),
        formatCombinedSite(item.site, item.company, item.customer),
        item.remark,
        String(item.status || "").trim().toLowerCase() === "paid" ? "Paid" : "Pending"
      ].join(" ").toUpperCase();

      if (!rowText.includes(q)) visible = false;
    }

    if (!visible) return;

    visibleCount++;
    const tot = parseFloat(item.total_amount) || parseFloat(item.amount) || 0;
    ownerTotal += tot;

    const isPaid = String(item.status || "").trim().toLowerCase() === "paid";
    if (isPaid) {
      ownerPaid += tot;
    } else {
      ownerPending += tot;
    }

    const statusText = isPaid ? "Paid" : "Pending";
    const statusClass = isPaid ? "paid" : "pending";
    const combinedSite = formatCombinedSite(item.site, item.company, item.customer);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="text-align: center; font-weight: 600; color: #64748b;">${visibleCount}</td>
      <td style="font-weight: 600; color: #0284c7;">${escapeHTML(item.month_year || "")}</td>
      <td>${escapeHTML(formatDateDisplay(item.received_date))}</td>
      <td style="text-align: center; font-weight: 700;">${escapeHTML(item.plate_no || "")}</td>
      <td>${escapeHTML(item.particulars || "")}</td>
      <td>${escapeHTML(item.driver_name || "")}</td>
      <td style="text-align: right; font-weight: 700; color: #0f172a;">${tot.toFixed(2)}</td>
      <td>${escapeHTML(combinedSite)}</td>
      <td>${escapeHTML(item.remark || "")}</td>
      <td style="text-align: center;"><span class="status-pill ${statusClass}">${statusText}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (visibleCount === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 25px;">No records match your filter/search.</td></tr>`;
  }

  document.getElementById("selectedOwnerSummary").innerText = `${visibleCount} of ${ownerData.items.length} records`;
  document.getElementById("btmTotalAmt").innerText = `SAR ${ownerTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("btmPaidAmt").innerText = `SAR ${ownerPaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("btmPendingAmt").innerText = `SAR ${ownerPending.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function applyOwnerTableFilters() {
  renderOwnerTableRows();
}

function openOwnerHeaderFilter(e, col) {
  e.stopPropagation();
  activeOwnerCol = col;
  const ownerData = groupedOwners[selectedOwnerKey];
  if (!ownerData) return;

  const popup = document.getElementById("ownerFilterPopup");
  popup.style.display = "flex";
  popup.style.left = Math.min(e.pageX, window.innerWidth - 260) + "px";
  popup.style.top = e.pageY + 10 + "px";

  document.getElementById("ownerFilterSearchInput").value = "";
  document.getElementById("ownerFilterTitle").innerText = "Filter: " + col.replace("_", " ").toUpperCase();

  const unique = new Set();
  ownerData.items.forEach((item) => {
    let val = getOwnerRowValue(item, col);
    if (!val) val = "(Blanks)";
    unique.add(val);
  });

  const sorted = Array.from(unique).sort();
  const listEl = document.getElementById("ownerFilterList");
  listEl.innerHTML = "";

  sorted.forEach((v) => {
    const isChecked = !ownerActiveFilters[col] || ownerActiveFilters[col].includes(v);
    listEl.innerHTML += `
      <div class="filter-item">
        <input type="checkbox" value="${escapeHTML(v)}" ${isChecked ? "checked" : ""} class="owner-col-cb">
        <label>${escapeHTML(v)}</label>
      </div>
    `;
  });
}

function searchOwnerFilterList() {
  const q = document.getElementById("ownerFilterSearchInput").value.toLowerCase();
  document.querySelectorAll("#ownerFilterList .filter-item").forEach((item) => {
    const lbl = item.querySelector("label").innerText.toLowerCase();
    item.style.display = lbl.includes(q) ? "flex" : "none";
  });
}

function applyOwnerColumnFilter() {
  const checked = Array.from(document.querySelectorAll(".owner-col-cb:checked")).map((cb) => cb.value);
  ownerActiveFilters[activeOwnerCol] = checked;
  document.getElementById("ownerFilterPopup").style.display = "none";
  renderOwnerTableRows();
}

function clearOwnerColumnFilter() {
  delete ownerActiveFilters[activeOwnerCol];
  document.getElementById("ownerFilterPopup").style.display = "none";
  renderOwnerTableRows();
}

function sortOwnerColumn(direction) {
  const ownerData = groupedOwners[selectedOwnerKey];
  if (!ownerData) return;

  ownerData.items.sort((a, b) => {
    let va = getOwnerRowValue(a, activeOwnerCol);
    let vb = getOwnerRowValue(b, activeOwnerCol);

    if (activeOwnerCol === "total_amount") {
      return direction === "asc" ? parseFloat(va) - parseFloat(vb) : parseFloat(vb) - parseFloat(va);
    }
    return direction === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  document.getElementById("ownerFilterPopup").style.display = "none";
  renderOwnerTableRows();
}

document.addEventListener("click", (e) => {
  const popup = document.getElementById("ownerFilterPopup");
  if (popup && !popup.contains(e.target)) {
    popup.style.display = "none";
  }
});

async function copyTableAsImage() {
  const container = document.getElementById("captureContainer");
  if (!container || !selectedOwnerKey) return;

  showStatus("Generating image...", "saving");
  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
    });

    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        showStatus("✓ Table copied to clipboard as image!", "saved");
      } catch (err) {
        // Fallback: download if clipboard permission denied
        const link = document.createElement("a");
        link.download = `${selectedOwnerKey.replace(/[^a-zA-Z0-9]/g, "_")}_table.png`;
        link.href = canvas.toDataURL();
        link.click();
        showStatus("✓ Image downloaded", "saved");
      }
    });
  } catch (e) {
    showStatus("Failed to copy image: " + e.message, "error");
  }
}

function exportSelectedOwnerExcel() {
  if (!selectedOwnerKey || !groupedOwners[selectedOwnerKey]) return;

  const ownerData = groupedOwners[selectedOwnerKey];
  const wb = XLSX.utils.book_new();

  const headers = [
    "SN",
    "Month",
    "Received Date",
    "Plate No",
    "Particulars",
    "Driver Name",
    "Total Amount",
    "Site Name",
    "Remark",
    "Status",
  ];
  const rows = [headers];

  ownerData.items.forEach((item, idx) => {
    const isPaid = String(item.status || "").trim().toLowerCase() === "paid";
    const tot = parseFloat(item.total_amount) || parseFloat(item.amount) || 0;
    const combinedSite = formatCombinedSite(item.site, item.company, item.customer);

    rows.push([
      idx + 1,
      item.month_year || "",
      formatDateDisplay(item.received_date),
      item.plate_no || "",
      item.particulars || "",
      item.driver_name || "",
      tot,
      combinedSite,
      item.remark || "",
      isPaid ? "Paid" : "Pending",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!autofilter"] = { ref: ws["!ref"] };
  const safeTitle = selectedOwnerKey.substring(0, 31).replace(/[:\\\/\?\*\[\]]/g, "_");
  XLSX.utils.book_append_sheet(wb, ws, safeTitle);
  XLSX.writeFile(wb, `${safeTitle}_Debit_Notes.xlsx`);
}

function exportAllOwnersExcel() {
  if (Object.keys(groupedOwners).length === 0) {
    showStatus("No data to export", "error");
    return;
  }

  showStatus("Exporting All Owners...", "saving");
  const wb = XLSX.utils.book_new();
  const headers = [
    "SN",
    "Month",
    "Received Date",
    "Plate No",
    "Particulars",
    "Driver Name",
    "Total Amount",
    "Site Name",
    "Remark",
    "Status",
  ];

  const ownerKeys = Object.keys(groupedOwners).sort();
  ownerKeys.forEach((owner) => {
    const ownerData = groupedOwners[owner];
    const rows = [headers];

    ownerData.items.forEach((item, idx) => {
      const isPaid = String(item.status || "").trim().toLowerCase() === "paid";
      const tot = parseFloat(item.total_amount) || parseFloat(item.amount) || 0;
      const combinedSite = formatCombinedSite(item.site, item.company, item.customer);

      rows.push([
        idx + 1,
        item.month_year || "",
        formatDateDisplay(item.received_date),
        item.plate_no || "",
        item.particulars || "",
        item.driver_name || "",
        tot,
        combinedSite,
        item.remark || "",
        isPaid ? "Paid" : "Pending",
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!autofilter"] = { ref: ws["!ref"] };

    // Excel sheet name limit 31 characters & no special characters
    let sheetName = owner.substring(0, 31).replace(/[:\\\/\?\*\[\]]/g, "_") || "Sheet";
    if (wb.SheetNames.includes(sheetName)) {
      sheetName = sheetName.substring(0, 28) + "_" + Math.floor(Math.random() * 100);
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `Debit_Notes_All_Owners_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showStatus("✓ All Owners Exported", "saved");
}