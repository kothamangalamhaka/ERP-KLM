const authToken = localStorage.getItem("erpToken");
const authUser = JSON.parse(localStorage.getItem("erpUser") || "null");

if (!authToken || !authUser) {
  window.location.replace("index.html");
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted || !localStorage.getItem("erpToken")) {
    window.location.replace("index.html");
  }
});

let allRecords = [];
let allCompanies = [];
let selectedCompany = "";
let selectedVat = "YES";
let splitBySections = false;
let isVatSplitView = false;
let searchTerm = "";
let toastTimer = null;

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDateMs(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // DD-MMM-YYYY (e.g., 09-Apr-2025)
  const mmmMatch = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/);
  if (mmmMatch) {
    const day = parseInt(mmmMatch[1], 10);
    const mon = MONTH_MAP[mmmMatch[2].toLowerCase()];
    const yr = parseInt(mmmMatch[3], 10);
    if (mon !== undefined) return new Date(yr, mon, day).getTime();
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return new Date(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10),
    ).getTime();
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    return new Date(
      parseInt(dmyMatch[3], 10),
      parseInt(dmyMatch[2], 10) - 1,
      parseInt(dmyMatch[1], 10),
    ).getTime();
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : parsed;
}

function splitSiteItemsIntoSections(siteObj) {
  if (!splitBySections || siteObj.items.length <= 1) {
    return [{ ...siteObj, sectionLabel: "" }];
  }

  const dated = [];
  const undated = [];
  siteObj.items.forEach((item) => {
    const startMs = parseDateMs(item.workStart);
    const endMs = item.lastWorking ? parseDateMs(item.lastWorking) : Infinity;
    if (startMs === null) {
      undated.push(item);
    } else {
      dated.push({
        ...item,
        startMs,
        endMs: endMs === null ? Infinity : endMs,
      });
    }
  });

  if (dated.length === 0) {
    return [{ ...siteObj, sectionLabel: "" }];
  }

  dated.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.endMs - b.endMs;
  });

  const sections = [];
  let currentItems = [dated[0]];
  let currentMaxEnd = dated[0].endMs;

  for (let i = 1; i < dated.length; i++) {
    const item = dated[i];
    // If all previous equipment released before this item started, start a new section
    if (currentMaxEnd !== Infinity && item.startMs > currentMaxEnd) {
      sections.push(currentItems);
      currentItems = [item];
      currentMaxEnd = item.endMs;
    } else {
      currentItems.push(item);
      if (item.endMs > currentMaxEnd) {
        currentMaxEnd = item.endMs;
      }
    }
  }
  sections.push(currentItems);

  if (undated.length > 0) {
    sections[sections.length - 1].push(...undated);
  }

  if (sections.length === 1) {
    return [{ ...siteObj, items: sections[0], sectionLabel: "" }];
  }

  return sections.map((secItems, idx) => ({
    site: siteObj.site,
    siteIsBlank: siteObj.siteIsBlank,
    items: secItems,
    sectionNum: idx + 1,
  }));
}

const FIELD_KEYS = {
  company: ["COMPANY"],
  vat: ["VAT BILL OR NOT", "VAT BILL STATUS"],
  owner: ["OWNER NAME", "OWNER"],
  site: ["SITE", "SITE NAME"],
  plate: ["PLATE NUMBER", "PLATE NO"],
  workStart: ["WORK START"],
  lastWorking: ["LAST WORKING DAY"],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getField(data, aliases) {
  if (!data || typeof data !== "object") return "";
  for (const alias of aliases) {
    if (
      data[alias] !== undefined &&
      data[alias] !== null &&
      String(data[alias]).trim() !== ""
    ) {
      return String(data[alias]).trim();
    }
  }
  const normalizedAliases = aliases.map((a) =>
    a.replace(/\s+/g, "").toUpperCase(),
  );
  for (const key of Object.keys(data)) {
    const normKey = key.replace(/\s+/g, "").toUpperCase();
    if (
      normalizedAliases.includes(normKey) &&
      data[key] !== undefined &&
      data[key] !== null &&
      String(data[key]).trim() !== ""
    ) {
      return String(data[key]).trim();
    }
  }
  return "";
}

function normalizeVatCategory(rawVat) {
  const val = String(rawVat || "").trim().toUpperCase();
  if (!val) return "BLANK";
  if (val === "YES") return "YES";
  if (val === "NO") return "NO";
  if (val === "PARTIAL") return "PARTIAL";
  return "BLANK";
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = isError ? "toast show error" : "toast show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function clearSessionAndRedirect() {
  localStorage.removeItem("erpToken");
  localStorage.removeItem("erpUser");
  window.location.replace("index.html");
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem("erpThemeMaster");
  const icon = document.getElementById("themeIcon");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    if (icon) icon.textContent = "light_mode";
  } else {
    document.body.classList.remove("dark-mode");
    if (icon) icon.textContent = "dark_mode";
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark-mode");
  const isDark = document.body.classList.contains("dark-mode");
  localStorage.setItem("erpThemeMaster", isDark ? "dark" : "light");
  const icon = document.getElementById("themeIcon");
  if (icon) icon.textContent = isDark ? "light_mode" : "dark_mode";
}

async function loadSummaryData() {
  const tbody = document.getElementById("periodTableBody");
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading data...</td></tr>`;

  try {
    const [recordsRes, companiesRes] = await Promise.all([
      fetch("/api/mdb-issues", {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
      fetch("/api/companies-list", {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    ]);

    if (
      recordsRes.status === 401 ||
      recordsRes.status === 403 ||
      companiesRes.status === 401 ||
      companiesRes.status === 403
    ) {
      clearSessionAndRedirect();
      return;
    }

    const recordsJson = await recordsRes.json();
    const companiesJson = await companiesRes.json();

    if (!recordsRes.ok || !recordsJson.success) {
      throw new Error(recordsJson.message || "Failed to load Master Database records.");
    }

    allRecords = (recordsJson.records || []).map((rec) => {
      const data = rec.record_data || {};
      const company = getField(data, FIELD_KEYS.company);
      const vatRaw = getField(data, FIELD_KEYS.vat);
      const owner = getField(data, FIELD_KEYS.owner);
      const site = getField(data, FIELD_KEYS.site) || String(rec.site || "").trim();
      const plate =
        getField(data, FIELD_KEYS.plate) || String(rec.plate_number || "").trim();
      const workStart = getField(data, FIELD_KEYS.workStart);
      const lastWorking = getField(data, FIELD_KEYS.lastWorking);

      return {
        id: rec.id,
        sn: rec.sn,
        company,
        companyKey: company.toUpperCase(),
        vatCategory: normalizeVatCategory(vatRaw),
        owner,
        site,
        plate,
        workStart,
        lastWorking,
      };
    });

    const apiCompanies =
      companiesRes.ok && companiesJson.success && Array.isArray(companiesJson.companies)
        ? companiesJson.companies
        : [];
    const recordCompanies = allRecords
      .map((r) => r.company)
      .filter((c) => c !== "");

    const seen = new Map();
    [...apiCompanies, ...recordCompanies].forEach((c) => {
      const trimmed = String(c || "").trim();
      if (!trimmed) return;
      const key = trimmed.toUpperCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    });

    allCompanies = Array.from(seen.values());
    if (!selectedCompany && allCompanies.length > 0) {
      selectedCompany = allCompanies[0];
    }

    renderCompanyButtons();
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${escapeHtml(
      err.message || "Unable to load data.",
    )}</td></tr>`;
    showToast(err.message || "Error loading data", true);
  }
}

function renderCompanyButtons() {
  const bar = document.getElementById("companyBottomBar");
  if (!bar) return;

  if (allCompanies.length === 0) {
    bar.innerHTML = `<span class="company-loading">No companies found</span>`;
    return;
  }

  bar.innerHTML = allCompanies
    .map((company) => {
      const isActive = company.toUpperCase() === selectedCompany.toUpperCase();
      return `<button type="button" class="company-btn ${
        isActive ? "active" : ""
      }" data-company="${escapeHtml(company)}">${escapeHtml(company)}</button>`;
    })
    .join("");

  bar.querySelectorAll(".company-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      isVatSplitView = false;
      const btnVatSplitView = document.getElementById("btnVatSplitView");
      if (btnVatSplitView) btnVatSplitView.classList.remove("active");
      selectedCompany = btn.getAttribute("data-company") || "";
      renderCompanyButtons();
      renderTable();
    });
  });
}

function updateVatCounts(companyRecords) {
  const ownerSets = {
    YES: new Set(),
    NO: new Set(),
    PARTIAL: new Set(),
    BLANK: new Set(),
  };
  companyRecords.forEach((r) => {
    const ownerKey = (r.owner || "(No Owner)")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    if (ownerSets[r.vatCategory]) {
      ownerSets[r.vatCategory].add(ownerKey);
    }
  });

  document.getElementById("vatYesCount").textContent = ownerSets.YES.size;
  document.getElementById("vatNoCount").textContent = ownerSets.NO.size;
  document.getElementById("vatPartialCount").textContent = ownerSets.PARTIAL.size;
  document.getElementById("vatBlankCount").textContent = ownerSets.BLANK.size;
}

function computeVatNonVatData(records, applySearch = true) {
  const ownersWithVat = new Set();
  records.forEach((rec) => {
    if (rec.vatCategory === "YES" || rec.vatCategory === "PARTIAL") {
      const ownerKey = (rec.owner || "(No Owner)")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
      ownersWithVat.add(ownerKey);
    }
  });

  const vatOwnersMap = new Map();
  const nonVatOwnersMap = new Map();

  records.forEach((rec) => {
    const ownerDisplay = (rec.owner || "(No Owner)")
      .replace(/\s+/g, " ")
      .trim();
    const ownerKey = ownerDisplay.toUpperCase();
    const plateDisplay = (rec.plate || "(No Plate)")
      .replace(/\s+/g, " ")
      .trim();
    const plateKey = plateDisplay.toUpperCase();

    let targetMap;
    if (rec.vatCategory === "YES" || rec.vatCategory === "PARTIAL") {
      targetMap = vatOwnersMap;
    } else if (rec.vatCategory === "BLANK" && ownersWithVat.has(ownerKey)) {
      targetMap = vatOwnersMap;
    } else {
      targetMap = nonVatOwnersMap;
    }

    if (!targetMap.has(ownerKey)) {
      targetMap.set(ownerKey, {
        owner: ownerDisplay,
        ownerIsBlank: !rec.owner,
        platesMap: new Map(),
      });
    }

    const ownerEntry = targetMap.get(ownerKey);
    if (!ownerEntry.platesMap.has(plateKey)) {
      ownerEntry.platesMap.set(plateKey, plateDisplay);
    }
  });

  const q = applySearch ? searchTerm.trim().toLowerCase() : "";
  const buildDivisionRows = (map) => {
    let rows = Array.from(map.values())
      .map((entry) => ({
        owner: entry.owner,
        ownerIsBlank: entry.ownerIsBlank,
        plates: Array.from(entry.platesMap.values()).sort((a, b) =>
          a.localeCompare(b),
        ),
      }))
      .sort((a, b) => a.owner.localeCompare(b.owner));

    if (q) {
      rows = rows.filter(
        (r) =>
          r.owner.toLowerCase().includes(q) ||
          r.plates.some((p) => p.toLowerCase().includes(q)),
      );
    }
    return rows;
  };

  return {
    vatRows: buildDivisionRows(vatOwnersMap),
    nonVatRows: buildDivisionRows(nonVatOwnersMap),
  };
}

async function exportVatNonVatExcel() {
  if (typeof ExcelJS === "undefined" || typeof saveAs === "undefined") {
    showToast("Excel library not loaded.", true);
    return;
  }
  if (!allRecords || allRecords.length === 0) {
    showToast("No records available to export.", true);
    return;
  }

  const { vatRows, nonVatRows } = computeVatNonVatData(allRecords, true);
  const workbook = new ExcelJS.Workbook();

  const buildSheet = (sheetName, rows, headerColor) => {
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    const totalVehicles = rows.reduce((sum, r) => sum + r.plates.length, 0);
    ws.mergeCells("A1:D1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `${sheetName} — Unique Owners & Vehicles (${rows.length} Owners, ${totalVehicles} Vehicles)`;
    titleCell.font = { name: "Inter", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerColor } };
    titleCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(1).height = 26;

    const headerRow = ws.addRow(["SN", "Owner Name", "Plate No", "Vehicle Count"]);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Inter", size: 10.5, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };
    });

    let maxOwnerLen = 18;
    let maxPlateLen = 14;

    rows.forEach((row, idx) => {
      const plates = row.plates.length > 0 ? row.plates : ["(No Plate)"];
      maxOwnerLen = Math.max(maxOwnerLen, row.owner.length + 4);
      const startRow = ws.lastRow.number + 1;

      plates.forEach((plate, pIdx) => {
        maxPlateLen = Math.max(maxPlateLen, plate.length + 4);
        const r = ws.addRow([
          pIdx === 0 ? idx + 1 : "",
          pIdx === 0 ? row.owner : "",
          plate,
          pIdx === 0 ? plates.length : "",
        ]);
        r.height = 20;
        r.eachCell((cell, colNum) => {
          cell.font = { name: "Inter", size: 10, bold: colNum === 2 };
          cell.alignment = {
            horizontal: colNum === 2 || colNum === 3 ? "left" : "center",
            vertical: "middle",
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FF000000" } },
            left: { style: "thin", color: { argb: "FF000000" } },
            bottom: { style: "thin", color: { argb: "FF000000" } },
            right: { style: "thin", color: { argb: "FF000000" } },
          };
        });
      });

      const endRow = ws.lastRow.number;
      if (endRow > startRow) {
        ws.mergeCells(`A${startRow}:A${endRow}`);
        ws.mergeCells(`B${startRow}:B${endRow}`);
        ws.mergeCells(`D${startRow}:D${endRow}`);
      }
    });

    ws.columns = [
      { width: 8 },
      { width: Math.min(maxOwnerLen, 45) },
      { width: Math.min(maxPlateLen, 26) },
      { width: 15 },
    ];
  };

  buildSheet("VAT", vatRows, "FF0F766E");
  buildSheet("Non-VAT", nonVatRows, "FF334155");

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `VAT_NonVAT_Owners_Plates_${dateStr}.xlsx`,
  );
  showToast("Excel exported successfully.");
}

function renderVatSplitView(companyRecords) {
  const vatBody = document.getElementById("vatDivBody");
  const nonVatBody = document.getElementById("nonVatDivBody");
  const vatStats = document.getElementById("vatDivStats");
  const nonVatStats = document.getElementById("nonVatDivStats");

  const { vatRows, nonVatRows } = computeVatNonVatData(companyRecords, true);

  const renderDivisionHtml = (rows, emptyLabel) => {
    if (rows.length === 0) {
      return `<tr><td colspan="4" class="empty-state">${escapeHtml(emptyLabel)}</td></tr>`;
    }
    return rows
      .map((row, idx) => {
        const platesHtml = row.plates
          .map((p) => `<div class="cell-line">${escapeHtml(p)}</div>`)
          .join("");
        return `
          <tr>
            <td class="col-sn">${idx + 1}</td>
            <td class="col-owner ${row.ownerIsBlank ? "muted-label" : ""}">${escapeHtml(
              row.owner,
            )}</td>
            <td class="col-plate"><div class="cell-lines">${platesHtml}</div></td>
            <td class="col-count">${row.plates.length}</td>
          </tr>
        `;
      })
      .join("");
  };

  const vatVehicles = vatRows.reduce((sum, r) => sum + r.plates.length, 0);
  const nonVatVehicles = nonVatRows.reduce((sum, r) => sum + r.plates.length, 0);

  vatStats.textContent = `${vatRows.length} Owners • ${vatVehicles} Vehicles`;
  nonVatStats.textContent = `${nonVatRows.length} Owners • ${nonVatVehicles} Vehicles`;

  vatBody.innerHTML = renderDivisionHtml(
    vatRows,
    "No VAT records across all companies.",
  );
  nonVatBody.innerHTML = renderDivisionHtml(
    nonVatRows,
    "No Non-VAT records across all companies.",
  );
}

function renderTable() {
  const tbody = document.getElementById("periodTableBody");
  const tableWrapper = document.getElementById("periodTableWrapper");
  const vatSplitGrid = document.getElementById("vatSplitGrid");

  const selectedCompanyKey = selectedCompany.toUpperCase();
  const companyRecords = allRecords.filter(
    (r) => r.companyKey === selectedCompanyKey,
  );

  updateVatCounts(companyRecords);

  if (isVatSplitView) {
    if (tableWrapper) tableWrapper.style.display = "none";
    if (vatSplitGrid) vatSplitGrid.style.display = "grid";
    renderVatSplitView(allRecords);
    return;
  }

  if (tableWrapper) tableWrapper.style.display = "";
  if (vatSplitGrid) vatSplitGrid.style.display = "none";

  const vatRecords = companyRecords.filter(
    (r) => r.vatCategory === selectedVat,
  );

  // Group by Owner first (1 row per Owner), then by Site inside that Owner
  const ownerMap = new Map();
  vatRecords.forEach((rec) => {
    const ownerDisplay = (rec.owner || "(No Owner)").replace(/\s+/g, " ").trim();
    const ownerKey = ownerDisplay.toUpperCase();
    const siteDisplay = (rec.site || "(No Site)").replace(/\s+/g, " ").trim();
    const siteKey = siteDisplay.toUpperCase();

    if (!ownerMap.has(ownerKey)) {
      ownerMap.set(ownerKey, {
        owner: ownerDisplay,
        ownerIsBlank: !rec.owner,
        sitesMap: new Map(),
      });
    }

    const ownerEntry = ownerMap.get(ownerKey);
    if (!ownerEntry.sitesMap.has(siteKey)) {
      ownerEntry.sitesMap.set(siteKey, {
        site: siteDisplay,
        siteIsBlank: !rec.site,
        items: [],
      });
    }

    const plateDisplay = rec.plate || "(No Plate)";
    const startDisplay = rec.workStart || "-";
    const endDisplay = rec.lastWorking || "Running";

    ownerEntry.sitesMap.get(siteKey).items.push({
      plate: plateDisplay,
      period: `${startDisplay} - ${endDisplay}`,
      workStart: rec.workStart,
      lastWorking: rec.lastWorking,
    });
  });

  let ownerRows = Array.from(ownerMap.values())
    .map((entry) => {
      const sortedSites = Array.from(entry.sitesMap.values()).sort((a, b) =>
        a.site.localeCompare(b.site),
      );
      const displayBlocks = sortedSites.flatMap((s) =>
        splitSiteItemsIntoSections(s),
      );
      return {
        owner: entry.owner,
        ownerIsBlank: entry.ownerIsBlank,
        sites: displayBlocks,
      };
    })
    .sort((a, b) => a.owner.localeCompare(b.owner));

  const q = searchTerm.trim().toLowerCase();
  if (q) {
    ownerRows = ownerRows.filter(
      (row) =>
        row.owner.toLowerCase().includes(q) ||
        row.sites.some(
          (s) =>
            s.site.toLowerCase().includes(q) ||
            s.items.some(
              (i) =>
                i.plate.toLowerCase().includes(q) ||
                i.period.toLowerCase().includes(q),
            ),
        ),
    );
  }

  const vatLabels = {
    YES: "VAT = Yes",
    NO: "VAT = No",
    PARTIAL: "VAT = Partial",
    BLANK: "VAT = Blank",
  };

  if (ownerRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No records found for ${escapeHtml(
      selectedCompany || "selected company",
    )} (${escapeHtml(vatLabels[selectedVat])}).</td></tr>`;
    return;
  }

  tbody.innerHTML = ownerRows
    .map((row, idx) => {
      const sitesHtml = row.sites
        .map((s) => {
          const blockHeight = s.items.length * 26;
          const numPrefixHtml = s.sectionNum
            ? `<span class="section-num">${escapeHtml(s.sectionNum)}.</span>`
            : "";
          const fullTitle = s.sectionNum ? `${s.sectionNum}. ${s.site}` : s.site;
          return `<div class="site-block ${
            s.siteIsBlank ? "muted-label" : ""
          }" style="height: ${blockHeight}px;"><span class="site-name-text" title="${escapeHtml(
            fullTitle,
          )}">${numPrefixHtml}${escapeHtml(s.site)}</span></div>`;
        })
        .join("");

      const platesHtml = row.sites
        .map((s) => {
          const lines = s.items
            .map(
              (item) => `<div class="cell-line">${escapeHtml(item.plate)}</div>`,
            )
            .join("");
          return `<div class="site-block"><div class="cell-lines">${lines}</div></div>`;
        })
        .join("");

      const periodsHtml = row.sites
        .map((s) => {
          const lines = s.items
            .map(
              (item) => `<div class="cell-line">${escapeHtml(item.period)}</div>`,
            )
            .join("");
          return `<div class="site-block"><div class="cell-lines">${lines}</div></div>`;
        })
        .join("");

      return `
        <tr>
          <td class="col-sn">${idx + 1}</td>
          <td class="col-owner ${row.ownerIsBlank ? "muted-label" : ""}">${escapeHtml(
            row.owner,
          )}</td>
          <td class="col-site">${sitesHtml}</td>
          <td class="col-plate">${platesHtml}</td>
          <td class="col-period">${periodsHtml}</td>
        </tr>
      `;
    })
    .join("");
}

function initPage() {
  applySavedTheme();
  document.getElementById("currentUserName").textContent =
    authUser?.username || "User";

  const btnVatSplitView = document.getElementById("btnVatSplitView");

  document
    .querySelectorAll(".vat-ribbon .ribbon-button[data-vat]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        isVatSplitView = false;
        if (btnVatSplitView) btnVatSplitView.classList.remove("active");
        document
          .querySelectorAll(".vat-ribbon .ribbon-button[data-vat]")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectedVat = btn.getAttribute("data-vat") || "YES";
        renderTable();
      });
    });

  const btnSectionToggle = document.getElementById("btnSectionToggle");
  if (btnSectionToggle) {
    btnSectionToggle.addEventListener("click", () => {
      isVatSplitView = false;
      if (btnVatSplitView) btnVatSplitView.classList.remove("active");
      splitBySections = !splitBySections;
      btnSectionToggle.classList.toggle("active", splitBySections);
      btnSectionToggle.innerHTML = `<span class="material-icons" style="font-size: 16px">call_split</span> Split Sections: ${
        splitBySections ? "ON" : "OFF"
      }`;
      renderTable();
    });
  }

  if (btnVatSplitView) {
    btnVatSplitView.addEventListener("click", () => {
      isVatSplitView = !isVatSplitView;
      btnVatSplitView.classList.toggle("active", isVatSplitView);
      renderTable();
    });
  }

  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value || "";
    renderTable();
  });

  loadSummaryData();
}

initPage();