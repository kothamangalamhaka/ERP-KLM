const MDB_REVIEW_KEY = "_MDB_ISSUE_REVIEWS";
const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_OWNER_MOBILES = new Set([
  "966553610195",
  "9660553610195",
  "553610195",
  "0553610195",
]);
 
const issueToken = localStorage.getItem("erpToken");
const issueUser = JSON.parse(localStorage.getItem("erpUser") || "null");
let issueRecords = [];
let toastTimer;
let activeExcelFilter = null;
const tableExcelFilters = new Map();
const tableSorts = new Map();
 
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
  ownerMobile: ["OWNER NUMBER", "MOBILE (OWNER)", "OWNER MOBILE", "OWNER MOBILE NO"],
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
  document.getElementById("currentUserName").innerText = issueUser.username || "User";
  initializeIssueScreen();
}
 
function initializeIssueScreen() {
  document.querySelectorAll(".ribbon-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".ribbon-button").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".issue-panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.panel).classList.add("active");
    });
  });
 
  document.addEventListener("click", (event) => {
    const popup = document.getElementById("excelFilterPopup");
    if (!event.target.closest("#excelFilterPopup") && !event.target.closest(".excel-filter-button")) {
      popup.classList.remove("show");
    }
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
    tableExcelFilters.clear();
    tableSorts.clear();
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
  const reviews = reviewRoot && typeof reviewRoot === "object" && !Array.isArray(reviewRoot)
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
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
 
function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}
 
function normalizeMobile(value) {
  return String(value || "").replace(/\D/g, "").replace(/^00/, "");
}
 
function getField(data, aliases) {
  const normalizedAliases = aliases.map(normalizeKey);
  const key = Object.keys(data).find((item) => normalizedAliases.includes(normalizeKey(item)));
  const value = key ? data[key] : "";
  return value === null || value === undefined ? "" : String(value).trim();
}
 
function parseDateValue(value) {
  if (!value) return null;
  const input = String(value).trim();
  let match;
 
  if ((match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return validUtcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
 
  if ((match = input.match(/^(\d{1,2})[\s./-]([A-Za-z]{3,9}|\d{1,2})[\s./-](\d{2,4})$/))) {
    const monthPart = match[2];
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const month = /^\d+$/.test(monthPart)
      ? Number(monthPart) - 1
      : monthNames.indexOf(monthPart.substring(0, 3).toUpperCase());
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validUtcDate(year, month, Number(match[1]));
  }
 
  return null;
}
 
function validUtcDate(year, month, day) {
  if (!Number.isInteger(year) || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}
 
function dayDifference(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}
 
function renderAllIssues() {
  const workStartIssues = buildWorkStartIssues();
  const ownerIssues = buildOwnerIssues();
  const siteEndIssues = buildSiteEndIssues();
  const noOwnerIssues = issueRecords
    .filter((record) => !record.owner || !record.ownerMobile)
    .sort((a, b) => {
      const aOwner = normalizeName(a.owner);
      const bOwner = normalizeName(b.owner);
      if (!aOwner && bOwner) return 1;
      if (aOwner && !bOwner) return -1;
      return aOwner.localeCompare(bOwner) || normalizeKey(a.plate).localeCompare(normalizeKey(b.plate));
    });
  const expiryIssues = buildExpiryIssues();
 
  renderWorkStartIssues(workStartIssues);
  renderOwnerIssues(ownerIssues);
  renderSiteEndIssues(siteEndIssues);
  renderNoOwnerIssues(noOwnerIssues);
  renderExpiryIssues(expiryIssues);
 
  setCount("workStartCount", workStartIssues.filter((row) => !row.cleared).length);
  setCount("ownerCount", getOpenOwnerIssueCount(ownerIssues));
  setCount("siteEndCount", siteEndIssues.length);
  setCount("noOwnerCount", noOwnerIssues.length);
  setCount("expiryCount", Object.values(expiryIssues).reduce((sum, rows) => sum + rows.length, 0));
}
 
function buildWorkStartIssues() {
  return issueRecords
    .map((record) => {
      const workStartDate = parseDateValue(record.workStart);
      const reachedDate = parseDateValue(record.equipmentReached);
      if (!record.workStart && !record.equipmentReached) return null;
      const gap = workStartDate && reachedDate
        ? dayDifference(workStartDate, reachedDate)
        : null;
      if (gap === 0) return null;
      const review = record.reviews.work_start_gap || {};
      return { ...record, gap, review, cleared: review.cleared === true };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.cleared) - Number(b.cleared) || normalizeKey(a.plate).localeCompare(normalizeKey(b.plate)));
}
 
function buildOwnerIssues() {
  const plateGroups = groupBy(issueRecords, (record) => normalizeKey(record.plate));
  const mobileGroups = groupBy(issueRecords, (record) => normalizeMobile(record.ownerMobile));
 
  const byPlate = buildPlateOwnerConflicts(plateGroups);
  const byMobile = buildMobileOwnerConflicts(mobileGroups);
 
  return { byPlate, byMobile };
}
 
function buildPlateOwnerConflicts(groups) {
  const output = [];
 
  groups.forEach((rows) => {
    const ownerGroups = new Map();
    rows.forEach((row) => {
      const ownerKey = normalizeName(row.owner);
      if (!ownerKey) return;
      if (!ownerGroups.has(ownerKey)) ownerGroups.set(ownerKey, []);
      ownerGroups.get(ownerKey).push(row);
    });
    if (ownerGroups.size < 2) return;
 
   const reviewRecord = rows.find((row) => row.reviews.plate_owner_conflict);
    const record = reviewRecord || rows.reduce((first, row) => row.id < first.id ? row : first);
    const review = reviewRecord?.reviews.plate_owner_conflict || {};
    const owners = [...ownerGroups.values()]
      .map((ownerRows) => ownerRows[0].owner)
      .sort((a, b) => normalizeName(a).localeCompare(normalizeName(b)));
    output.push({
      recordId: record.id,
      plate: record.plate,
      owners,
      review,
      cleared: review.cleared === true,
    });
  });
 
  return output.sort(
    (a, b) =>
      Number(a.cleared) - Number(b.cleared) ||
      normalizeKey(a.plate).localeCompare(normalizeKey(b.plate)),
  );
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
 
function buildMobileOwnerConflicts(groups) {
  const ownerGroups = new Map();
  groups.forEach((rows) => {
    const eligible = rows.filter((record) => {
      const mobile = normalizeMobile(record.ownerMobile);
      return Boolean(mobile && !EXCLUDED_OWNER_MOBILES.has(mobile) && normalizeName(record.owner));
    });
    const distinctOwners = new Set(eligible.map((record) => normalizeName(record.owner)));
    if (distinctOwners.size < 2) return;

    eligible.forEach((record) => {
      const ownerKey = normalizeName(record.owner);
      if (!ownerGroups.has(ownerKey)) {
        ownerGroups.set(ownerKey, { owner: record.owner, mobiles: new Map() });
      }
      ownerGroups.get(ownerKey).mobiles.set(normalizeMobile(record.ownerMobile), record.ownerMobile);
    });
  });
  return [...ownerGroups.values()]
    .map((group) => ({
      owner: group.owner,
      mobiles: [...group.mobiles.values()].sort((a, b) => normalizeMobile(a).localeCompare(normalizeMobile(b))),
    }))
    .sort((a, b) => normalizeName(a.owner).localeCompare(normalizeName(b.owner)));
}

function getOpenOwnerIssueCount(issues) {
  return issues.byPlate.filter((row) => !row.cleared).length + issues.byMobile.length;
}
 
function buildSiteEndIssues() {
  const plateGroups = groupBy(issueRecords, (record) => normalizeKey(record.plate));
  const issues = [];
 
  plateGroups.forEach((rows) => {
    if (rows.length < 2) return;
    const ordered = rows
      .map((record) => ({ ...record, workStartDate: parseDateValue(record.workStart) }))
      .filter((record) => record.workStartDate)
      .sort((a, b) => a.workStartDate - b.workStartDate);
 
    for (let previousIndex = 0; previousIndex < ordered.length - 1; previousIndex++) {
      const previous = ordered[previousIndex];
      const previousEnd = parseDateValue(previous.lastWorking);
      if (!previousEnd) continue;
 
      for (let currentIndex = previousIndex + 1; currentIndex < ordered.length; currentIndex++) {
        const current = ordered[currentIndex];
        if (normalizeName(current.site) === normalizeName(previous.site)) continue;
        if (current.workStartDate >= previousEnd) continue;
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
    }
  });
 
  return issues.sort((a, b) => normalizeKey(a.plate).localeCompare(normalizeKey(b.plate)) || a.gap - b.gap);
}
 
function getExpiryState(value) {
  const date = parseDateValue(value);
  if (!date) return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
    const status = normalizeName(record.status).toLowerCase();
    if (!["running", "mobilizing", "mobilising"].includes(status)) return;
 
    const iqama = getExpiryState(record.iqamaExpiry);
    const licence = getExpiryState(record.licenceExpiry);
    const insurance = getExpiryState(record.insuranceExpiry);
    const fahs = getExpiryState(record.fahsExpiry);
 
    if (iqama && licence) categories.iqamaAndLicence.push({ ...record, iqama, licence });
    else if (iqama) categories.iqamaOnly.push({ ...record, expiry: iqama });
    else if (licence) categories.licenceOnly.push({ ...record, expiry: licence });
 
    if (insurance && fahs) categories.insuranceAndFahs.push({ ...record, insurance, fahs });
    else if (insurance) categories.insuranceOnly.push({ ...record, expiry: insurance });
    else if (fahs) categories.fahsOnly.push({ ...record, expiry: fahs });
  });
 
  Object.values(categories).forEach((rows) => rows.sort(expiryRowComparator));
  return categories;
}
 
function expiryRowComparator(a, b) {
  const aDays = a.expiry?.days ?? Math.min(a.iqama?.days ?? Infinity, a.licence?.days ?? Infinity, a.insurance?.days ?? Infinity, a.fahs?.days ?? Infinity);
  const bDays = b.expiry?.days ?? Math.min(b.iqama?.days ?? Infinity, b.licence?.days ?? Infinity, b.insurance?.days ?? Infinity, b.fahs?.days ?? Infinity);
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
      value: (row) => Number.isFinite(row.gap) ? row.gap : "Missing / invalid date",
      render: (row) => Number.isFinite(row.gap)
        ? `<span class="gap-badge ${row.gap >= 0 ? "gap-positive" : "gap-negative"}">${row.gap > 0 ? "+" : ""}${row.gap} days</span>`
        : '<span class="gap-badge gap-negative">Missing / invalid date</span>',
    },
    
    {
      label: "Check",
      value: (row) => row.cleared ? "Cleared" : "Open",
      render: (row) => `<input class="review-checkbox" type="checkbox" ${row.cleared ? "checked" : ""} ${canEdit ? "" : "disabled"} aria-label="Mark gap cleared" onchange="saveWorkStartReview(${row.id}, this.checked, this.closest('tr').querySelector('.review-remark').value)" />`,
    },
    {
      label: "Check Data Remark",
      value: (row) => row.review.remark || "",
      render: (row) => `<textarea class="review-remark" maxlength="2000" placeholder="Reason…" ${canEdit ? "" : "disabled"} onblur="saveWorkStartReview(${row.id}, this.closest('tr').querySelector('.review-checkbox').checked, this.value)">${escapeHtml(row.review.remark || "")}</textarea>`,
    },
  ];
 
  document.getElementById("workStartTables").innerHTML = tableCardMarkup({
    id: "work-start-issues",
    title: "Work Start vs Equipment Reached",
    subtitle: "Open issues stay at the top. Checked rows are highlighted and moved below.",
    columns,
    rows,
    rowClass: (row) => row.cleared ? "review-cleared" : "",
  });
  applyTableExcelFilters("work-start-issues");
}
 
function renderOwnerIssues(issues) {
  const canEdit = issueUser.role !== "Viewer";
  const ownerColumnCount = Math.max(1, ...issues.byPlate.map((row) => row.owners.length));
  const mobileColumnCount = Math.max(1, ...issues.byMobile.map((row) => row.mobiles.length));
  const ownerColumns = Array.from({ length: ownerColumnCount }, (_, index) => ({
    label: `Owner Name ${index + 1}`,
    value: (row) => row.owners[index] || "",
  }));
  const mobileColumns = Array.from({ length: mobileColumnCount }, (_, index) => ({
    label: `Mobile ${index + 1}`,
    value: (row) => row.mobiles[index] || "",
  }));

  document.getElementById("plateOwnerTable").innerHTML = tableCardMarkup({
    id: "plate-owner-issues",
    title: "Same Plate · Different Owner",
     subtitle: "Each plate is shown once. Blank owner cells are kept when another plate needs more owner columns.",
    columns: [
      textColumn("Plate No", "plate"),
      ...ownerColumns,
      {
        label: "Check",
        value: (row) => row.cleared ? "Cleared" : "Open",
        render: (row) => `<input class="review-checkbox" type="checkbox" ${row.cleared ? "checked" : ""} ${canEdit ? "" : "disabled"} aria-label="Mark owner conflict cleared" onchange="savePlateOwnerReview(${row.recordId}, this.checked, this.closest('tr').querySelector('.review-remark').value)" />`,
      },
      {
       label: "Owner Change Remark",
        value: (row) => row.review.remark || "",
        render: (row) => `<textarea class="review-remark" maxlength="2000" placeholder="Owner change reason…" ${canEdit ? "" : "disabled"} onblur="savePlateOwnerReview(${row.recordId}, this.closest('tr').querySelector('.review-checkbox').checked, this.value)">${escapeHtml(row.review.remark || "")}</textarea>`,
      },
      ],
    rows: issues.byPlate,
    rowClass: (row) => row.cleared ? "review-cleared" : "",
  });
 
  document.getElementById("mobileOwnerTable").innerHTML = tableCardMarkup({
    id: "mobile-owner-issues",
    title: "Same Mobile · Different Owner",
   subtitle: "Owners involved in a shared-mobile conflict are listed once with their conflicting mobile numbers.",
    columns: [
      textColumn("Owner Name", "owner"),
       ...mobileColumns,
    ],
    rows: issues.byMobile,
  });

  applyTableExcelFilters("plate-owner-issues");
  applyTableExcelFilters("mobile-owner-issues");
}
 
function renderSiteEndIssues(rows) {
  const columns = [
    textColumn("Site A Work End", "lastWorking"),
    textColumn("Site B Work Start", "workStart"),
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
   subtitle: "Only overlapping site periods are listed: Site B starts before Site A ends.",
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
  const siteColumn = textColumn("Site", "site");
  const coordinators = [textColumn("Field Co", "fieldCo"), textColumn("Site Co", "siteCo")];
 
  const cards = [
    tableCardMarkup({
      id: "iqama-expiry",
      title: "Iqama Expiry",
      subtitle: "Iqama-only alerts: next 30 days first, expired records below.",
      columns: [...driverBase, siteColumn, expiryDateColumn("Iqama Expiry", "expiry"), expiryGapColumn("expiry"), ...coordinators],
      rows: issues.iqamaOnly,
    }),
    tableCardMarkup({
      id: "licence-expiry",
      title: "Licence Expiry",
      subtitle: "Licence-only alerts: next 30 days first, expired records below.",
      columns: [textColumn("Plate No", "plate"), textColumn("Driver Name", "driver"), siteColumn, expiryDateColumn("Licence Expiry", "expiry"), expiryGapColumn("expiry"), ...coordinators],
      rows: issues.licenceOnly,
    }),
    tableCardMarkup({
      id: "iqama-licence-expiry",
      title: "Iqama + Licence Expiry",
      subtitle: "Both documents are due or already expired.",
      columns: [
        ...driverBase,
        siteColumn,
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
      columns: [...equipmentBase, siteColumn, expiryDateColumn("Expiry Date", "expiry"), expiryGapColumn("expiry"), ...coordinators],
      rows: issues.insuranceOnly,
    }),
    tableCardMarkup({
      id: "fahs-expiry",
      title: "FAHS / MVPI Expiry",
      subtitle: "FAHS/MVPI-only alerts for equipment.",
      columns: [...equipmentBase, siteColumn, expiryDateColumn("Expiry Date", "expiry"), expiryGapColumn("expiry"), ...coordinators],
      rows: issues.fahsOnly,
    }),
    tableCardMarkup({
      id: "insurance-fahs-expiry",
      title: "Insurance + FAHS / MVPI Expiry",
      subtitle: "Both equipment documents are due or already expired.",
      columns: [
        ...equipmentBase,
        siteColumn,
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
    value: (row) => Number.isFinite(row[key]?.days) ? row[key].days : "-",
    cellClass: (row) => row[key]?.days < 0 ? "expiry-expired-cell" : "expiry-future-cell",
  };
}
 
function tableCardMarkup({ id, title, subtitle, columns, rows, rowClass = () => "" }) {
  const headerCells = columns.map((column, index) => `
    <th>
      <div class="table-header-content">
        <span>${escapeHtml(column.label)}</span>
        <button
          class="excel-filter-button"
          type="button"
          data-filter-button="${escapeAttribute(id)}-${index}"
          data-html2canvas-ignore="true"
          onclick="openExcelFilter(event, '${escapeAttribute(id)}', ${index}, '${escapeAttribute(column.label)}')"
          title="Excel-style filter"
        ><span class="material-icons">filter_list</span></button>
      </div>
    </th>
  `).join("");
  const body = rows.length > 0
    ? rows.map((row) => {
      const cells = columns.map((column) => {
        const rawValue = column.value ? column.value(row) : "";
        const display = column.render ? column.render(row) : escapeHtml(rawValue);
        const cellClass = column.cellClass ? column.cellClass(row) : "";
        return `<td class="${escapeAttribute(cellClass)}" data-filter-value="${escapeAttribute(rawValue)}">${display}</td>`;
      }).join("");
      return `<tr class="data-row ${escapeAttribute(rowClass(row))}">${cells}</tr>`;
    }).join("")
    : `<tr><td colspan="${columns.length}"><div class="empty-state"><span class="material-icons">task_alt</span>No issues found</div></td></tr>`;
 
  return `
    <article class="table-card" data-table-id="${escapeAttribute(id)}">
      <div class="copy-area" id="copy-${escapeAttribute(id)}">
        <div class="table-card-header">
          <div>
            <h2>${escapeHtml(title)} · <span class="table-count" data-total-count="${rows.length}">${rows.length}</span></h2>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          <div class="export-actions" data-html2canvas-ignore="true">
            <button class="copy-button" type="button" onclick="copyIssueTable('${escapeAttribute(id)}')" title="Copy table as HQ PNG">📋</button>
            <button class="pdf-button" type="button" onclick="downloadIssueTablePdf('${escapeAttribute(id)}')" title="Download print-ready A4 PDF">📄</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="issue-table">
            <thead>
              <tr>${headerCells}</tr>
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
 
function openExcelFilter(event, tableId, columnIndex, label) {
  event.stopPropagation();
  const card = document.querySelector(`[data-table-id="${cssEscape(tableId)}"]`);
  if (!card) return;
  const values = [...card.querySelectorAll("tbody .data-row")]
    .map((row) => row.cells[columnIndex]?.dataset.filterValue || "")
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const filterKey = `${tableId}:${columnIndex}`;
  const selected = tableExcelFilters.get(filterKey) || new Set(values);
  activeExcelFilter = { tableId, columnIndex, filterKey, values };
  const activeSort = tableSorts.get(tableId);
 
  document.getElementById("excelFilterTitle").innerText = `Filter: ${label}`;
  document.getElementById("excelSortAsc").classList.toggle("active", activeSort?.columnIndex === columnIndex && activeSort.direction === "asc");
  document.getElementById("excelSortDesc").classList.toggle("active", activeSort?.columnIndex === columnIndex && activeSort.direction === "desc");
  document.getElementById("excelFilterSearch").value = "";
  document.getElementById("excelFilterOptions").innerHTML = values.map((value) => `
    <label class="excel-option">
      <input type="checkbox" value="${escapeAttribute(value)}" ${selected.has(value) ? "checked" : ""} onchange="updateExcelSelectAllState()" />
      <span title="${escapeAttribute(value || "(Blank)")}">${escapeHtml(value || "(Blank)")}</span>
    </label>
  `).join("");
  updateExcelSelectAllState();
 
  const popup = document.getElementById("excelFilterPopup");
  popup.classList.add("show");
  const left = Math.min(event.clientX, window.innerWidth - 275);
  const top = Math.min(event.clientY + 8, window.innerHeight - 430);
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top = `${Math.max(8, top)}px`;
  document.getElementById("excelFilterSearch").focus();
}
 
function searchExcelFilterOptions(query) {
  const normalized = String(query || "").toLowerCase();
  document.querySelectorAll("#excelFilterOptions .excel-option").forEach((option) => {
    option.style.display = option.innerText.toLowerCase().includes(normalized) ? "flex" : "none";
  });
  updateExcelSelectAllState();
}
 
function toggleExcelFilterOptions(checked) {
  document.querySelectorAll("#excelFilterOptions .excel-option").forEach((option) => {
    if (option.style.display !== "none") option.querySelector("input").checked = checked;
  });
}
 
function updateExcelSelectAllState() {
  const visible = [...document.querySelectorAll("#excelFilterOptions .excel-option")]
    .filter((option) => option.style.display !== "none");
  document.getElementById("excelFilterSelectAll").checked = visible.length > 0 && visible.every((option) => option.querySelector("input").checked);
}
 
function applyActiveExcelFilter() {
  if (!activeExcelFilter) return;
  const selected = new Set(
    [...document.querySelectorAll("#excelFilterOptions input:checked")].map((input) => input.value),
  );
  if (selected.size === activeExcelFilter.values.length) tableExcelFilters.delete(activeExcelFilter.filterKey);
  else tableExcelFilters.set(activeExcelFilter.filterKey, selected);
  applyTableExcelFilters(activeExcelFilter.tableId);
  document.getElementById("excelFilterPopup").classList.remove("show");
}
 
function clearActiveExcelFilter() {
  if (!activeExcelFilter) return;
  tableExcelFilters.delete(activeExcelFilter.filterKey);
  applyTableExcelFilters(activeExcelFilter.tableId);
  document.getElementById("excelFilterPopup").classList.remove("show");
}
 
function sortActiveExcelColumn(direction) {
  if (!activeExcelFilter || !["asc", "desc"].includes(direction)) return;
  tableSorts.set(activeExcelFilter.tableId, {
    columnIndex: activeExcelFilter.columnIndex,
    direction,
  });
  applyTableExcelFilters(activeExcelFilter.tableId);
  document.getElementById("excelFilterPopup").classList.remove("show");
}
 
function applyTableExcelFilters(tableId) {
  const card = document.querySelector(`[data-table-id="${cssEscape(tableId)}"]`);
  if (!card) return;
  const filters = [...tableExcelFilters.entries()]
    .filter(([key]) => key.startsWith(`${tableId}:`))
    .map(([key, selected]) => ({ column: Number(key.split(":").pop()), selected }));
   const body = card.querySelector("tbody");
  const rows = [...body.querySelectorAll(".data-row")];
  const activeSort = tableSorts.get(tableId);
  if (activeSort) {
    const direction = activeSort.direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const aValue = a.cells[activeSort.columnIndex]?.dataset.filterValue || "";
      const bValue = b.cells[activeSort.columnIndex]?.dataset.filterValue || "";
      return aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
    rows.forEach((row) => body.appendChild(row));
  }

  let visibleCount = 0;
  rows.forEach((row) => {
    row.style.display = filters.every((filter) => filter.selected.has(row.cells[filter.column]?.dataset.filterValue || "")) ? "" : "none";
    if (row.style.display !== "none") visibleCount++;
  });
  card.querySelectorAll(".excel-filter-button").forEach((button) => {
    const key = button.dataset.filterButton.replace(`${tableId}-`, `${tableId}:`);
    button.classList.toggle("active", tableExcelFilters.has(key));
  });
  const count = card.querySelector(".table-count");
  if (count) {
    const totalCount = Number(count.dataset.totalCount) || 0;
    count.innerText = filters.length > 0 ? `${visibleCount}/${totalCount}` : totalCount;
  }
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
    if (!response.ok || !data.success) throw new Error(data.message || "Unable to save review.");
    record.reviews.work_start_gap = data.review;
    const workStartIssues = buildWorkStartIssues();
    renderWorkStartIssues(workStartIssues);
    setCount("workStartCount", workStartIssues.filter((row) => !row.cleared).length);
    showToast(cleared ? "Issue marked as cleared." : "Issue review updated.");
  } catch (error) {
    renderWorkStartIssues(buildWorkStartIssues());
    showToast(error.message || "Unable to save review.", true);
  } finally {
    setLoading(false);
  }
}

async function savePlateOwnerReview(recordId, cleared, remark) {
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
        issueKey: "plate_owner_conflict",
        cleared,
        remark,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "Unable to save owner review.");
    record.reviews.plate_owner_conflict = data.review;
    const ownerIssues = buildOwnerIssues();
    renderOwnerIssues(ownerIssues);
    setCount("ownerCount", getOpenOwnerIssueCount(ownerIssues));
    showToast(cleared ? "Owner issue marked as cleared." : "Owner review updated.");
  } catch (error) {
    renderOwnerIssues(buildOwnerIssues());
    showToast(error.message || "Unable to save owner review.", true);
  } finally {
    setLoading(false);
  }
} 

async function copyIssueTable(tableId) {
  const card = document.querySelector(`[data-table-id="${cssEscape(tableId)}"]`);
  if (!card || typeof html2canvas !== "function") {
    showToast("Image copy library is unavailable.", true);
    return;
  }
 
  const copyArea = card.querySelector(".copy-area").cloneNode(true);
  copyArea.querySelectorAll(".export-actions, .excel-filter-button").forEach((element) => element.remove());
  copyArea.querySelectorAll("tbody .data-row").forEach((row) => {
    if (row.style.display === "none") row.remove();
  });
  const columnCount = copyArea.querySelectorAll("thead th").length;
  const exportWidth = Math.min(2200, Math.max(1400, columnCount * 150));
  Object.assign(copyArea.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${exportWidth}px`,
    background: "#ffffff",
    zIndex: "-1",
  });
  const scrollArea = copyArea.querySelector(".table-scroll");
  scrollArea.style.maxHeight = "none";
  scrollArea.style.overflow = "visible";
  const table = copyArea.querySelector("table");
  table.style.width = "100%";
  table.style.minWidth = "0";
  copyArea.querySelectorAll("th").forEach((header) => { header.style.position = "static"; });
  document.body.appendChild(copyArea);
  setLoading(true);
 
  try {
    const canvas = await html2canvas(copyArea, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: copyArea.scrollWidth,
      height: copyArea.scrollHeight,
      windowWidth: copyArea.scrollWidth,
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (!blob) throw new Error("Unable to create table image.");
 
    if (navigator.clipboard && window.isSecureContext && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("High-quality table image copied.");
    } else {
      const link = document.createElement("a");
      link.download = `${tableId}.png`;
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      showToast("Clipboard unavailable; PNG downloaded instead.");
    }
  } catch (error) {
    showToast(error.message || "Unable to copy table image.", true);
  } finally {
    copyArea.remove();
    setLoading(false);
  }
}
 
function downloadIssueTablePdf(tableId) {
  const card = document.querySelector(`[data-table-id="${cssEscape(tableId)}"]`);
  const jsPdfClass = window.jspdf?.jsPDF;
  if (!card || !jsPdfClass) {
    showToast("PDF library is unavailable.", true);
    return;
  }
 
  const table = card.querySelector("table");
  const headers = [...table.querySelectorAll("thead th")].map((cell) =>
    cell.querySelector(".table-header-content > span")?.innerText.trim() || cell.innerText.trim(),
  );
  const rowElements = [...table.querySelectorAll("tbody .data-row")].filter((row) => row.style.display !== "none");
  const rows = rowElements.map((row) => [...row.cells].map((cell) => ({
    text: cell.dataset.filterValue || cell.innerText.trim(),
    className: cell.className,
  })));
  if (rows.length === 0) {
    showToast("No visible rows to export.", true);
    return;
  }
 
  setLoading(true);
  try {
    const orientation = headers.length > 6 ? "landscape" : "portrait";
    const documentPdf = new jsPdfClass({ orientation, unit: "mm", format: "a4", compress: true });
    const pageWidth = documentPdf.internal.pageSize.getWidth();
    const pageHeight = documentPdf.internal.pageSize.getHeight();
    const margin = 10;
    const title = card.querySelector("h2")?.innerText.trim() || "MDB Issues";
    const usableWidth = pageWidth - margin * 2;
    const fontSize = headers.length > 9 ? 6 : headers.length > 6 ? 7 : 8;
    const lineHeight = fontSize * 0.42;
    const columnWeights = headers.map((header, index) => {
      const maxLength = Math.max(header.length, ...rows.slice(0, 100).map((row) => row[index]?.text.length || 0));
      return Math.min(28, Math.max(8, maxLength));
    });
    const totalWeight = columnWeights.reduce((sum, value) => sum + value, 0);
    const columnWidths = columnWeights.map((weight) => usableWidth * weight / totalWeight);
    let pageNumber = 1;
    let cursorY = margin;
 
    const drawPageHeading = () => {
      documentPdf.setTextColor(15, 41, 66);
      documentPdf.setFont("helvetica", "bold");
      documentPdf.setFontSize(11);
      documentPdf.text(title, margin, cursorY + 4);
      documentPdf.setFont("helvetica", "normal");
      documentPdf.setFontSize(7);
      documentPdf.setTextColor(100, 116, 139);
      documentPdf.text(`Page ${pageNumber}`, pageWidth - margin, cursorY + 4, { align: "right" });
      cursorY += 9;
    };
 
    const drawRow = (cells, isHeader = false, rowClass = "") => {
      documentPdf.setFontSize(fontSize);
      documentPdf.setFont("helvetica", isHeader ? "bold" : "normal");
      const lines = cells.map((cell, index) => documentPdf.splitTextToSize(String(cell.text ?? cell), Math.max(4, columnWidths[index] - 3)));
      const rowHeight = Math.max(7, ...lines.map((lineSet) => lineSet.length * lineHeight + 3));
      if (!isHeader && cursorY + rowHeight > pageHeight - margin) {
        documentPdf.addPage();
        pageNumber++;
        cursorY = margin;
        drawPageHeading();
        drawRow(headers, true);
      }
 
      let cursorX = margin;
      lines.forEach((lineSet, index) => {
        const sourceCell = cells[index];
        const className = typeof sourceCell === "object" ? sourceCell.className : "";
        if (isHeader) documentPdf.setFillColor(26, 77, 128);
        else if (className.includes("expiry-expired-cell")) documentPdf.setFillColor(255, 228, 230);
        else if (className.includes("expiry-future-cell")) documentPdf.setFillColor(254, 243, 199);
        else if (rowClass.includes("review-cleared")) documentPdf.setFillColor(220, 252, 231);
        else documentPdf.setFillColor(255, 255, 255);
        documentPdf.setDrawColor(203, 213, 225);
        documentPdf.rect(cursorX, cursorY, columnWidths[index], rowHeight, "FD");
        documentPdf.setTextColor(isHeader ? 255 : 30, isHeader ? 255 : 41, isHeader ? 255 : 59);
        documentPdf.text(lineSet, cursorX + 1.5, cursorY + 3.2, { baseline: "top" });
        cursorX += columnWidths[index];
      });
      cursorY += rowHeight;
    };
 
    drawPageHeading();
    drawRow(headers, true);
    rows.forEach((row, index) => drawRow(row, false, rowElements[index].className));
    documentPdf.save(`${tableId}.pdf`);
    showToast("Print-ready A4 PDF downloaded.");
  } catch (error) {
    showToast(error.message || "Unable to create PDF.", true);
  } finally {
    setLoading(false);
  }
}
 
function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
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
  toastTimer = setTimeout(() => { toast.className = ""; }, 3000);
}
 
function clearIssueSession() {
  localStorage.removeItem("erpToken");
  localStorage.removeItem("erpUser");
  window.location.replace("index.html");
}
 
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
 
function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}