const MDB_REVIEW_KEY = "_MDB_ISSUE_REVIEWS";
const DAY_MS = 24 * 60 * 60 * 1000;

const issueToken = localStorage.getItem("erpToken");
const issueUser = JSON.parse(localStorage.getItem("erpUser") || "null");
let issueRecords = [];
let toastTimer;

const FIELD_ALIASES = {
  plate: ["PLATE NUMBER", "PLATE NO"],
  workStart: ["WORK START"],
  equipmentReached: ["EQUIPMENT REACHED AT SITE"],
  lastWorking: ["LAST WORKING DAY"],
  site: ["SITE", "SITE NAME"],
  ifSub: ["IF SUB", "SUB COMPANY"],
  company: ["COMPANY"],
  customer: ["CUSTOMER"],
  status: ["STATUS"],
  owner: ["OWNER NAME", "OWNER"],
  ownerMobile: [
    "OWNER NUMBER",
    "MOBILE (OWNER)",
    "OWNER MOBILE",
    "OWNER MOBILE NO",
  ],
  driver: ["DRIVER NAME", "DRIVER"],
  iqamaNo: ["IQAMA NUMBER", "IQAMA NO"],
  iqamaExpiry: ["IQAMA EXPIRE DATE", "IQAMA EXPIRE"],
  licenceExpiry: [
    "LICENSE EXPIRE DATE",
    "LICENSE EXPIRE",
    "LICENCE EXPIRE DATE",
    "LICENCE EXPIRE",
  ],
  insuranceExpiry: [
    "EQ INSURANSE EXPIRE DATE",
    "EQ INSURANCE EXPIRE DATE",
    "EQ INSURAN",
    "EQ INSURANCE",
  ],
  fahsExpiry: ["FAHS MVPI EXPIRE", "FAHS MVPI", "FAHS MVPI EXPIRE DATE"],
  fieldCo: ["FIELD COORDINATOR", "FIELD CO"],
  siteCo: ["SITE COORDINATOR", "SITE CO"],
};

if (!issueToken || !issueUser) {
  window.location.replace("index.html");
} else {
  document.getElementById("currentUserName").innerText =
    issueUser.username || "User";
  initializeIssueScreen();
}

function initializeIssueScreen() {
  document.querySelectorAll(".ribbon-button").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll(".ribbon-button")
        .forEach((item) => item.classList.remove("active"));
      document
        .querySelectorAll(".issue-panel")
        .forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.panel).classList.add("active");
    });
  });

  loadIssueData();
}

async function loadIssueData() {
  setLoading(true);
  try {
    const response = await fetch("/api/mdb-issues", {
      headers: { Authorization: `Bearer ${issueToken}` },
    });

    if (response.status === 401 || response.status === 403) {
      clearIssueSession();
      return;
    }

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Unable to load Master Database issues.");
    }

    issueRecords = (data.records || []).map(normalizeRecord);
    renderAllIssues();
    showToast(`Checked ${issueRecords.length} Master Database records.`);
  } catch (error) {
    showToast(error.message || "Unable to load issue data.", true);
  } finally {
    setLoading(false);
  }
}

function normalizeRecord(record) {
  const data = record.record_data || {};
  const reviewRoot = data[MDB_REVIEW_KEY];
  const reviews =
    reviewRoot && typeof reviewRoot === "object" && !Array.isArray(reviewRoot)
      ? reviewRoot
      : {};

  return {
    id: record.id,
    sn: record.sn,
    data,
    reviews,
    plate: getField(data, FIELD_ALIASES.plate) || record.plate_number || "",
    workStart: getField(data, FIELD_ALIASES.workStart),
    equipmentReached: getField(data, FIELD_ALIASES.equipmentReached),
    lastWorking: getField(data, FIELD_ALIASES.lastWorking),
    site: getField(data, FIELD_ALIASES.site) || record.site || "",
    ifSub: getField(data, FIELD_ALIASES.ifSub),
    company: getField(data, FIELD_ALIASES.company),
    customer: getField(data, FIELD_ALIASES.customer),
    status: getField(data, FIELD_ALIASES.status),
    owner: getField(data, FIELD_ALIASES.owner),
    ownerMobile: getField(data, FIELD_ALIASES.ownerMobile),
    driver: getField(data, FIELD_ALIASES.driver),
    iqamaNo: getField(data, FIELD_ALIASES.iqamaNo),
    iqamaExpiry: getField(data, FIELD_ALIASES.iqamaExpiry),
    licenceExpiry: getField(data, FIELD_ALIASES.licenceExpiry),
    insuranceExpiry: getField(data, FIELD_ALIASES.insuranceExpiry),
    fahsExpiry: getField(data, FIELD_ALIASES.fahsExpiry),
    fieldCo: getField(data, FIELD_ALIASES.fieldCo),
    siteCo: getField(data, FIELD_ALIASES.siteCo),
  };
}

function normalizeKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeMobile(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .replace(/^00/, "");
}

function getField(data, aliases) {
  const normalizedAliases = aliases.map(normalizeKey);
  const key = Object.keys(data).find((item) =>
    normalizedAliases.includes(normalizeKey(item)),
  );
  const value = key ? data[key] : "";
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseDateValue(value) {
  if (!value) return null;
  const input = String(value).trim();
  let match;

  if ((match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return validUtcDate(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
  }

  if (
    (match = input.match(
      /^(\d{1,2})[\s./-]([A-Za-z]{3,9}|\d{1,2})[\s./-](\d{2,4})$/,
    ))
  ) {
    const monthPart = match[2];
    const monthNames = [
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
    const month = /^\d+$/.test(monthPart)
      ? Number(monthPart) - 1
      : monthNames.indexOf(monthPart.substring(0, 3).toUpperCase());
    const year =
      match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validUtcDate(year, month, Number(match[1]));
  }

  return null;
}

function validUtcDate(year, month, day) {
  if (!Number.isInteger(year) || month < 0 || month > 11 || day < 1 || day > 31)
    return null;
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  )
    return null;
  return date;
}

function dayDifference(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}

function renderAllIssues() {
  const workStartIssues = buildWorkStartIssues();
  const ownerIssues = buildOwnerIssues();
  const siteEndIssues = buildSiteEndIssues();
  const noOwnerIssues = issueRecords.filter(
    (record) => !record.owner || !record.ownerMobile,
  );
  const expiryIssues = buildExpiryIssues();

  renderWorkStartIssues(workStartIssues);
  renderOwnerIssues(ownerIssues);
  renderSiteEndIssues(siteEndIssues);
  renderNoOwnerIssues(noOwnerIssues);
  renderExpiryIssues(expiryIssues);

  setCount("workStartCount", workStartIssues.length);
  setCount(
    "ownerCount",
    ownerIssues.byPlate.length + ownerIssues.byMobile.length,
  );
  setCount("siteEndCount", siteEndIssues.length);
  setCount("noOwnerCount", noOwnerIssues.length);
  setCount(
    "expiryCount",
    Object.values(expiryIssues).reduce((sum, rows) => sum + rows.length, 0),
  );
}

function buildWorkStartIssues() {
  return issueRecords
    .map((record) => {
      const workStartDate = parseDateValue(record.workStart);
      const reachedDate = parseDateValue(record.equipmentReached);
      if (!record.workStart && !record.equipmentReached) return null;
      const gap =
        workStartDate && reachedDate
          ? dayDifference(workStartDate, reachedDate)
          : null;
      if (gap === 0) return null;
      const review = record.reviews.work_start_gap || {};
      return { ...record, gap, review, cleared: review.cleared === true };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(a.cleared) - Number(b.cleared) ||
        normalizeKey(a.plate).localeCompare(normalizeKey(b.plate)),
    );
}

function buildOwnerIssues() {
  const plateGroups = groupBy(issueRecords, (record) =>
    normalizeKey(record.plate),
  );
  const mobileGroups = groupBy(issueRecords, (record) =>
    normalizeMobile(record.ownerMobile),
  );

  const byPlate = flattenConflicts(
    plateGroups,
    (record) => normalizeName(record.owner),
    (record) =>
      Boolean(normalizeKey(record.plate) && normalizeName(record.owner)),
  );
  const byMobile = flattenConflicts(
    mobileGroups,
    (record) => normalizeName(record.owner),
    (record) =>
      Boolean(
        normalizeMobile(record.ownerMobile) && normalizeName(record.owner),
      ),
  );

  return { byPlate, byMobile };
}

function groupBy(rows, keyGetter) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyGetter(row);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function flattenConflicts(groups, distinctValueGetter, eligibilityGetter) {
  const output = [];
  groups.forEach((rows) => {
    const eligible = rows.filter(eligibilityGetter);
    const distinctValues = new Set(
      eligible.map(distinctValueGetter).filter(Boolean),
    );
    if (distinctValues.size > 1) output.push(...eligible);
  });
  return output.sort(
    (a, b) =>
      normalizeKey(a.plate).localeCompare(normalizeKey(b.plate)) ||
      normalizeName(a.owner).localeCompare(normalizeName(b.owner)),
  );
}

function buildSiteEndIssues() {
  const plateGroups = groupBy(issueRecords, (record) =>
    normalizeKey(record.plate),
  );
  const issues = [];

  plateGroups.forEach((rows) => {
    if (rows.length < 2) return;
    const ordered = rows
      .map((record) => ({
        ...record,
        workStartDate: parseDateValue(record.workStart),
      }))
      .filter((record) => record.workStartDate)
      .sort((a, b) => a.workStartDate - b.workStartDate);

    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = parseDateValue(previous.lastWorking);
      if (!previousEnd) continue;
      const gap = dayDifference(current.workStartDate, previousEnd);
      issues.push({
        id: `${previous.id}-${current.id}`,
        plate: current.plate,
        workStart: current.workStart,
        lastWorking: previous.lastWorking,
        site: `${previous.site || "-"} → ${current.site || "-"}`,
        gap,
      });
    }
  });

  return issues.sort(
    (a, b) =>
      normalizeKey(a.plate).localeCompare(normalizeKey(b.plate)) ||
      a.gap - b.gap,
  );
}

function getExpiryState(value) {
  const date = parseDateValue(value);
  if (!date) return null;
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const days = dayDifference(date, today);
  return days <= 30 ? { date, days, value } : null;
}

function buildExpiryIssues() {
  const categories = {
    iqamaOnly: [],
    licenceOnly: [],
    iqamaAndLicence: [],
    insuranceOnly: [],
    fahsOnly: [],
    insuranceAndFahs: [],
  };

  issueRecords.forEach((record) => {
    const iqama = getExpiryState(record.iqamaExpiry);
    const licence = getExpiryState(record.licenceExpiry);
    const insurance = getExpiryState(record.insuranceExpiry);
    const fahs = getExpiryState(record.fahsExpiry);

    if (iqama && licence)
      categories.iqamaAndLicence.push({ ...record, iqama, licence });
    else if (iqama) categories.iqamaOnly.push({ ...record, expiry: iqama });
    else if (licence)
      categories.licenceOnly.push({ ...record, expiry: licence });

    if (insurance && fahs)
      categories.insuranceAndFahs.push({ ...record, insurance, fahs });
    else if (insurance)
      categories.insuranceOnly.push({ ...record, expiry: insurance });
    else if (fahs) categories.fahsOnly.push({ ...record, expiry: fahs });
  });

  Object.values(categories).forEach((rows) => rows.sort(expiryRowComparator));
  return categories;
}

function expiryRowComparator(a, b) {
  const aDays =
    a.expiry?.days ??
    Math.min(
      a.iqama?.days ?? Infinity,
      a.licence?.days ?? Infinity,
      a.insurance?.days ?? Infinity,
      a.fahs?.days ?? Infinity,
    );
  const bDays =
    b.expiry?.days ??
    Math.min(
      b.iqama?.days ?? Infinity,
      b.licence?.days ?? Infinity,
      b.insurance?.days ?? Infinity,
      b.fahs?.days ?? Infinity,
    );
  const aExpired = aDays < 0;
  const bExpired = bDays < 0;
  if (aExpired !== bExpired) return aExpired ? 1 : -1;
  return aExpired ? bDays - aDays : aDays - bDays;
}

function renderWorkStartIssues(rows) {
  const canEdit = issueUser.role !== "Viewer";
  const columns = [
    textColumn("Work Start", "workStart"),
    textColumn("EQ Reached", "equipmentReached"),
    textColumn("Plate No", "plate"),
    textColumn("Site Name", "site"),
    textColumn("If Sub", "ifSub"),
    textColumn("Company", "company"),
    textColumn("Customer", "customer"),
    textColumn("Status", "status"),
    {
      label: "Days Gap",
      value: (row) =>
        Number.isFinite(row.gap) ? row.gap : "Missing / invalid date",
      render: (row) =>
        Number.isFinite(row.gap)
          ? `<span class="gap-badge ${row.gap >= 0 ? "gap-positive" : "gap-negative"}">${row.gap > 0 ? "+" : ""}${row.gap} days</span>`
          : '<span class="gap-badge gap-negative">Missing / invalid date</span>',
    },
    {
      label: "Check",
      value: (row) => (row.cleared ? "Cleared" : "Open"),
      render: (row) =>
        `<input class="review-checkbox" type="checkbox" ${row.cleared ? "checked" : ""} ${canEdit ? "" : "disabled"} aria-label="Mark gap cleared" onchange="saveWorkStartReview(${row.id}, this.checked, this.closest('tr').querySelector('.review-remark').value)" />`,
    },
    {
      label: "Check Data Remark",
      value: (row) => row.review.remark || "",
      render: (row) =>
        `<textarea class="review-remark" maxlength="2000" placeholder="Reason…" ${canEdit ? "" : "disabled"} onblur="saveWorkStartReview(${row.id}, this.closest('tr').querySelector('.review-checkbox').checked, this.value)">${escapeHtml(row.review.remark || "")}</textarea>`,
    },
  ];
  document.getElementById("workStartTables").innerHTML = tableCardMarkup({
    id: "work-start-issues",
    title: "Work Start vs Equipment Reached",
    subtitle:
      "Open issues stay at the top. Checked rows are highlighted and moved below.",
    columns,
    rows,
    rowClass: (row) => (row.cleared ? "review-cleared" : ""),
  });
}

function renderOwnerIssues(issues) {
  document.getElementById("plateOwnerTable").innerHTML = tableCardMarkup({
    id: "plate-owner-issues",
    title: "Same Plate · Different Owner",
    subtitle: "Plate formatting, spaces and letter case are ignored.",
    columns: [
      textColumn("Plate No", "plate"),
      textColumn("Owner Name", "owner"),
      textColumn("Site Name", "site"),
    ],
    rows: issues.byPlate,
  });

  document.getElementById("mobileOwnerTable").innerHTML = tableCardMarkup({
    id: "mobile-owner-issues",
    title: "Same Mobile · Different Owner",
    subtitle:
      "Only records sharing a mobile number with different owner names are listed.",
    columns: [
      textColumn("Plate No", "plate"),
      textColumn("Site", "site"),
      textColumn("Owner Name", "owner"),
      textColumn("Owner Mobile No", "ownerMobile"),
    ],
    rows: issues.byMobile,
  });
}

function renderSiteEndIssues(rows) {
  const columns = [
    textColumn("Work Start", "workStart"),
    textColumn("Last Working Day", "lastWorking"),
    textColumn("Plate No", "plate"),
    textColumn("Site", "site"),
    {
      label: "Relation",
      value: (row) => relationText(row.gap),
      render: (row) => relationBadge(row.gap),
    },
  ];

  document.getElementById("siteEndTables").innerHTML = tableCardMarkup({
    id: "site-end-issues",
    title: "Site End Timeline",
    subtitle:
      "Compares each plate’s previous Last Working Day with its next Work Start.",
    columns,
    rows,
  });
}

function renderNoOwnerIssues(rows) {
  document.getElementById("noOwnerTables").innerHTML = tableCardMarkup({
    id: "no-owner-issues",
    title: "Missing Owner Details",
    subtitle: "Owner name missing, mobile missing, or both fields missing.",
    columns: [
      textColumn("Plate No", "plate"),
      textColumn("Site", "site"),
      textColumn("Owner Name", "owner", "Missing"),
      textColumn("Owner Mobile", "ownerMobile", "Missing"),
    ],
    rows,
  });
}

function renderExpiryIssues(issues) {
  const driverBase = [
    textColumn("Plate No", "plate"),
    textColumn("Driver Name", "driver"),
    textColumn("Iqama No", "iqamaNo"),
  ];
  const equipmentBase = [
    textColumn("Plate No", "plate"),
    textColumn("Owner Name", "owner"),
    textColumn("Owner Mobile", "ownerMobile"),
  ];
  const coordinators = [
    textColumn("Field Co", "fieldCo"),
    textColumn("Site Co", "siteCo"),
  ];

  const cards = [
    tableCardMarkup({
      id: "iqama-expiry",
      title: "Iqama Expiry",
      subtitle: "Iqama-only alerts: next 30 days first, expired records below.",
      columns: [
        ...driverBase,
        expiryDateColumn("Iqama Expiry", "expiry"),
        expiryGapColumn("expiry"),
        ...coordinators,
      ],
      rows: issues.iqamaOnly,
    }),
    tableCardMarkup({
      id: "licence-expiry",
      title: "Licence Expiry",
      subtitle:
        "Licence-only alerts: next 30 days first, expired records below.",
      columns: [
        textColumn("Plate No", "plate"),
        textColumn("Driver Name", "driver"),
        expiryDateColumn("Licence Expiry", "expiry"),
        expiryGapColumn("expiry"),
        ...coordinators,
      ],
      rows: issues.licenceOnly,
    }),
    tableCardMarkup({
      id: "iqama-licence-expiry",
      title: "Iqama + Licence Expiry",
      subtitle: "Both documents are due or already expired.",
      columns: [
        ...driverBase,
        expiryDateColumn("Iqama Expiry", "iqama"),
        expiryGapColumn("iqama", "Iqama Gap"),
        expiryDateColumn("Licence Expiry", "licence"),
        expiryGapColumn("licence", "Licence Gap"),
        ...coordinators,
      ],
      rows: issues.iqamaAndLicence,
    }),
    tableCardMarkup({
      id: "insurance-expiry",
      title: "Equipment Insurance Expiry",
      subtitle: "Insurance-only alerts for equipment.",
      columns: [
        ...equipmentBase,
        expiryDateColumn("Expiry Date", "expiry"),
        expiryGapColumn("expiry"),
        ...coordinators,
      ],
      rows: issues.insuranceOnly,
    }),
    tableCardMarkup({
      id: "fahs-expiry",
      title: "FAHS / MVPI Expiry",
      subtitle: "FAHS/MVPI-only alerts for equipment.",
      columns: [
        ...equipmentBase,
        expiryDateColumn("Expiry Date", "expiry"),
        expiryGapColumn("expiry"),
        ...coordinators,
      ],
      rows: issues.fahsOnly,
    }),
    tableCardMarkup({
      id: "insurance-fahs-expiry",
      title: "Insurance + FAHS / MVPI Expiry",
      subtitle: "Both equipment documents are due or already expired.",
      columns: [
        ...equipmentBase,
        expiryDateColumn("Insurance Expiry", "insurance"),
        expiryGapColumn("insurance", "Insurance Gap"),
        expiryDateColumn("FAHS Expiry", "fahs"),
        expiryGapColumn("fahs", "FAHS Gap"),
        ...coordinators,
      ],
      rows: issues.insuranceAndFahs,
    }),
  ];
  document.getElementById("expiryTables").innerHTML = cards.join("");
}

function textColumn(label, key, emptyText = "-") {
  return {
    label,
    value: (row) => row[key] || emptyText,
  };
}

function expiryDateColumn(label, key) {
  return {
    label,
    value: (row) => row[key]?.value || "-",
  };
}

function expiryGapColumn(key, label = "Days Gap") {
  return {
    label,
    value: (row) => expiryText(row[key]?.days),
    render: (row) => expiryBadge(row[key]?.days),
  };
}

function tableCardMarkup({
  id,
  title,
  subtitle,
  columns,
  rows,
  rowClass = () => "",
}) {
  const headerCells = columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join("");
  const filterCells = columns
    .map(
      (column, index) =>
        `<th><input class="column-filter" type="search" data-column="${index}" placeholder="Filter" aria-label="Filter ${escapeAttribute(column.label)}" oninput="filterIssueTable(this)" /></th>`,
    )
    .join("");
  const body =
    rows.length > 0
      ? rows
          .map((row) => {
            const cells = columns
              .map((column) => {
                const rawValue = column.value ? column.value(row) : "";
                const display = column.render
                  ? column.render(row)
                  : escapeHtml(rawValue);
                return `<td data-filter-value="${escapeAttribute(rawValue)}">${display}</td>`;
              })
              .join("");
            return `<tr class="data-row ${escapeAttribute(rowClass(row))}">${cells}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${columns.length}"><div class="empty-state"><span class="material-icons">task_alt</span>No issues found</div></td></tr>`;

  return `
    <article class="table-card" data-table-id="${escapeAttribute(id)}">
      <div class="copy-area" id="copy-${escapeAttribute(id)}">
        <div class="table-card-header">
          <div>
            <h2>${escapeHtml(title)} · <span class="table-count">${rows.length}</span></h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          <button class="copy-button" type="button" data-html2canvas-ignore="true" onclick="copyIssueTable('${escapeAttribute(id)}')" title="Copy table as HQ PNG">📋</button>
        </div>
        <div class="table-scroll">
          <table class="issue-table">
            <thead>
              <tr>${headerCells}</tr>
              <tr class="filter-row" data-html2canvas-ignore="true">${filterCells}</tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}
function relationText(gap) {
  if (gap < 0) return `Overlap ${Math.abs(gap)} days`;
  if (gap === 0) return "Same day";
  return `Starts after ${gap} days`;
}

function relationBadge(gap) {
  const className = gap < 0 ? "overlap" : gap === 0 ? "same-day" : "after-end";
  return `<span class="relation-badge ${className}">${escapeHtml(relationText(gap))}</span>`;
}

function expiryText(days) {
  if (!Number.isFinite(days)) return "-";
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return "Expires today";
  return `${days} days remaining`;
}

function expiryBadge(days) {
  if (!Number.isFinite(days)) return "-";
  return `<span class="expiry-badge ${days < 0 ? "expired" : "future"}">${escapeHtml(expiryText(days))}</span>`;
}

function filterIssueTable(input) {
  const table = input.closest("table");
  const filters = [...table.querySelectorAll(".column-filter")].map(
    (field) => ({
      column: Number(field.dataset.column),
      value: field.value.trim().toLowerCase(),
    }),
  );

  table.querySelectorAll("tbody .data-row").forEach((row) => {
    const visible = filters.every((filter) => {
      if (!filter.value) return true;
      const cellValue =
        row.cells[filter.column]?.dataset.filterValue?.toLowerCase() || "";
      return cellValue.includes(filter.value);
    });
    row.style.display = visible ? "" : "none";
  });
}

async function saveWorkStartReview(recordId, cleared, remark) {
  if (issueUser.role === "Viewer") return;
  const record = issueRecords.find((item) => item.id === recordId);
  if (!record) return;

  setLoading(true);
  try {
    const response = await fetch("/api/mdb-issues/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${issueToken}`,
      },
      body: JSON.stringify({
        recordId,
        issueKey: "work_start_gap",
        cleared,
        remark,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success)
      throw new Error(data.message || "Unable to save review.");
    record.reviews.work_start_gap = data.review;
    renderWorkStartIssues(buildWorkStartIssues());
    showToast(cleared ? "Issue marked as cleared." : "Issue review updated.");
  } catch (error) {
    renderWorkStartIssues(buildWorkStartIssues());
    showToast(error.message || "Unable to save review.", true);
  } finally {
    setLoading(false);
  }
}

async function copyIssueTable(tableId) {
  const copyArea = document.getElementById(`copy-${tableId}`);
  if (!copyArea || typeof html2canvas !== "function") {
    showToast("Image copy library is unavailable.", true);
    return;
  }

  const scrollArea = copyArea.querySelector(".table-scroll");
  const previousMaxHeight = scrollArea.style.maxHeight;
  const previousOverflow = scrollArea.style.overflow;
  scrollArea.style.maxHeight = "none";
  scrollArea.style.overflow = "visible";
  setLoading(true);

  try {
    const canvas = await html2canvas(copyArea, {
      scale: 3,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png", 1),
    );
    if (!blob) throw new Error("Unable to create table image.");

    if (
      navigator.clipboard &&
      window.isSecureContext &&
      typeof ClipboardItem !== "undefined"
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      showToast("High-quality table image copied.");
    } else {
      const link = document.createElement("a");
      link.download = `${tableId}.png`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
      showToast("Clipboard unavailable; PNG downloaded instead.");
    }
  } catch (error) {
    showToast(error.message || "Unable to copy table image.", true);
  } finally {
    scrollArea.style.maxHeight = previousMaxHeight;
    scrollArea.style.overflow = previousOverflow;
    setLoading(false);
  }
}

function setCount(elementId, value) {
  document.getElementById(elementId).innerText = value;
}

function setLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);
  toast.innerText = message;
  toast.className = isError ? "show error" : "show";
  toastTimer = setTimeout(() => {
    toast.className = "";
  }, 3000);
}

function clearIssueSession() {
  localStorage.removeItem("erpToken");
  localStorage.removeItem("erpUser");
  window.location.replace("index.html");
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
