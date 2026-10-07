let securityCode = localStorage.getItem("debitNoteSecurityCode") || "";
let records = [];
const myClientId = Math.random().toString(36).substring(2, 15);

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

let dropdownOptions = {
  approved_by: [],
  site: [],
  company: [],
  customer: [],
  status: [],
};
let vehiclePlates = [];
let isEditMode = false;
let isStatusEditMode = false; // Dedicated status edit toggle
let activeRowIndex = null;
let activeHeaderCol = null;
let activeFilters = {};

let currentPickerRowIdx = null;
let currentPickerYear = new Date().getFullYear();
let activeUploadRowIdx = null;

function formatDateDisplay(dStr) {
  if (!dStr) return "";
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const m = monthNames[d.getMonth()];
  const y = d.getFullYear();
  return `${day}-${m}-${y}`;
}

let promptResolver = null;
function showCustomPrompt(title, desc = "Enter value below:") {
  return new Promise((resolve) => {
    promptResolver = resolve;
    document.getElementById("customPromptTitle").innerText = title;
    document.getElementById("customPromptDesc").innerText = desc;
    const input = document.getElementById("customPromptInput");
    input.value = "";
    document.getElementById("customPromptModal").style.display = "flex";
    setTimeout(() => input.focus(), 80);
  });
}

function resolveCustomPrompt(val) {
  document.getElementById("customPromptModal").style.display = "none";
  if (promptResolver) {
    promptResolver(val ? val.trim() : null);
    promptResolver = null;
  }
}

function openMonthYearPicker(e, rowIdx) {
  if (!isEditMode) return;
  e.stopPropagation();
  isModalPickerActive = false;
  currentPickerRowIdx = rowIdx;

  const existingVal = records[rowIdx].month_year || "";
  const parts = existingVal.trim().split(/[\s-]+/);
  if (parts.length >= 2) {
    let y = parseInt(parts[1], 10);
    if (!isNaN(y)) {
      currentPickerYear = y < 100 ? y + 2000 : y;
    }
  } else {
    currentPickerYear = new Date().getFullYear();
  }

  document.getElementById("mypYearDisplay").innerText = currentPickerYear;

  const picker = document.getElementById("monthYearPicker");
  picker.style.display = "block";

  const rect = e.target.getBoundingClientRect();
  let top = rect.bottom + window.scrollY + 4;
  let left = rect.left + window.scrollX;

  if (left + 230 > window.innerWidth) {
    left = window.innerWidth - 240;
  }

  picker.style.top = `${top}px`;
  picker.style.left = `${left}px`;
}

function shiftPickerYear(delta) {
  currentPickerYear += delta;
  document.getElementById("mypYearDisplay").innerText = currentPickerYear;
}

let isModalPickerActive = false;

function openModalMonthYearPicker(e) {
  e.stopPropagation();
  isModalPickerActive = true;
  currentPickerRowIdx = null;

  const existingVal = document.getElementById("m_month_year").value || "";
  const parts = existingVal.trim().split(/[\s-]+/);
  if (parts.length >= 2) {
    let y = parseInt(parts[1], 10);
    if (!isNaN(y)) {
      currentPickerYear = y < 100 ? y + 2000 : y;
    }
  } else {
    currentPickerYear = new Date().getFullYear();
  }

  document.getElementById("mypYearDisplay").innerText = currentPickerYear;

  const picker = document.getElementById("monthYearPicker");
  picker.style.display = "block";

  const rect = e.currentTarget.getBoundingClientRect();
  let top = rect.bottom + window.scrollY + 4;
  let left = rect.left + window.scrollX;

  if (left + 230 > window.innerWidth) {
    left = window.innerWidth - 240;
  }

  picker.style.top = `${top}px`;
  picker.style.left = `${left}px`;
}

async function selectPickerMonth(monthAbbr) {
  const shortYear = String(currentPickerYear).slice(-2);
  const formattedMonthYear = `${monthAbbr} ${shortYear}`;

  if (isModalPickerActive) {
    document.getElementById("m_month_year").value = formattedMonthYear;
    document.getElementById("monthYearPicker").style.display = "none";
    isModalPickerActive = false;
    await modalResolveDriverOwner();
    return;
  }

  if (currentPickerRowIdx === null) return;

  records[currentPickerRowIdx].month_year = formattedMonthYear;
  document.getElementById("monthYearPicker").style.display = "none";

  await autoLookupDriverOwner(currentPickerRowIdx);
  saveRowToBackend(currentPickerRowIdx);
  renderTable();
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
      initDebitNotes();
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
    initDebitNotes();
  }
});

function showStatus(msg, type = "saved") {
  const s = document.getElementById("saveStatus");
  if (s) {
    s.innerText = msg;
    s.className = `save-indicator ${type}`;
    if (type === "saved") {
      setTimeout(() => {
        s.className = "save-indicator";
        s.innerText = "✓ Ready";
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

async function initDebitNotes() {
  showStatus("Loading...", "saving");
  try {
    const [dropRes, recRes] = await Promise.all([
      fetch("/debit-notes/api/dropdowns", {
        headers: { "x-security-code": securityCode },
      }).then((r) => r.json()),
      fetch("/debit-notes/api/records", {
        headers: { "x-security-code": securityCode },
      }).then((r) => r.json()),
    ]);

    if (!dropRes.success || !recRes.success) {
      if (dropRes.message === "Security Code Verification Failed") {
        document.getElementById("securityModal").style.display = "flex";
        return;
      }
      throw new Error(dropRes.message || recRes.message);
    }

    dropdownOptions = dropRes.dropdowns;
    if (dropdownOptions.status && dropdownOptions.status.length > 0) {
      dropdownOptions.status = dropdownOptions.status.filter(
        (s) => s.toLowerCase() !== "received",
      );
      dropdownOptions.status.unshift("Received");
    }
    vehiclePlates = Array.isArray(dropRes.plates) ? dropRes.plates : [];

    const dl = document.getElementById("plateList");
    if (dl) {
      dl.innerHTML = vehiclePlates
        .map((p) => `<option value="${p}">${p}</option>`)
        .join("");
    }

    records = recRes.data;
    ensureEmptyRowBuffer();
    renderTable();
    setupRealtimeSync();
    showStatus("✓ Loaded", "saved");
  } catch (e) {
    showStatus("Error: " + e.message, "error");
  }
}

function setupRealtimeSync() {
  if (window.debitNoteEventSource) return;

  const streamUrl = `/debit-notes/api/stream?security_code=${encodeURIComponent(securityCode)}`;
  const evtSource = new EventSource(streamUrl);
  window.debitNoteEventSource = evtSource;

  evtSource.onmessage = function (event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.sender === myClientId) return;

      if (msg.action === "UPSERT") {
        const incomingRow = msg.data;
        const existingIdx = records.findIndex(
          (r) => r.id && Number(r.id) === Number(incomingRow.id),
        );

        if (existingIdx !== -1) {
          records[existingIdx] = incomingRow;
        } else {
          const bufferIdx = records.findIndex((r) => !r.id);
          if (bufferIdx !== -1) {
            records.splice(bufferIdx, 0, incomingRow);
          } else {
            records.push(incomingRow);
          }
        }
        ensureEmptyRowBuffer();
        renderTable();
        showStatus("⚡ Live Synced", "saved");
      } else if (msg.action === "DELETE") {
        records = records.filter(
          (r) => !r.id || Number(r.id) !== Number(msg.data.id),
        );
        ensureEmptyRowBuffer();
        renderTable();
        showStatus("⚡ Live Synced", "saved");
      }
    } catch (err) {
      console.error("Live Sync Error:", err);
    }
  };

  evtSource.onerror = function () {
    evtSource.close();
    window.debitNoteEventSource = null;
    setTimeout(setupRealtimeSync, 5000);
  };
}

function createBlankRowObj() {
  return {
    id: null,
    received_date: "",
    submitted_date: "",
    month_year: "",
    approved_by: "",
    particulars: "",
    plate_no: "",
    driver_name: "",
    site: "",
    company: "",
    customer: "",
    amount: "",
    vat_status: "Included",
    vat_amount: 0.0,
    total_amount: 0.0,
    owner_name: "",
    status: "Received",
    ref_no: "",
    work_order: "",
    remark: "",
    attachment_path: "",
  };
}

function ensureEmptyRowBuffer() {
  if (!isEditMode) {
    records = records.filter((r) => r.id !== null && r.id !== undefined);
    return;
  }

  if (!records || records.length === 0) {
    records = [createBlankRowObj()];
    return;
  }

  const lastRow = records[records.length - 1];
  const lastRowAmt = parseFloat(lastRow.amount) || 0;

  const isLastRowEmpty =
    !lastRow.id &&
    (!lastRow.plate_no || String(lastRow.plate_no).trim() === "") &&
    (!lastRow.particulars || String(lastRow.particulars).trim() === "") &&
    (!lastRow.received_date || String(lastRow.received_date).trim() === "") &&
    (!lastRow.submitted_date || String(lastRow.submitted_date).trim() === "") &&
    (!lastRow.month_year || String(lastRow.month_year).trim() === "") &&
    (!lastRow.approved_by || String(lastRow.approved_by).trim() === "") &&
    (!lastRow.site || String(lastRow.site).trim() === "") &&
    (!lastRow.company || String(lastRow.company).trim() === "") &&
    (!lastRow.customer || String(lastRow.customer).trim() === "") &&
    lastRowAmt === 0;

  if (!isLastRowEmpty) {
    records.push(createBlankRowObj());
  }
}

function handleLastRowLiveInput(idx) {
  if (isEditMode && idx === records.length - 1) {
    records.push(createBlankRowObj());
    renderTable();
  }
}

function renderTable() {
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="20" style="text-align: center; padding: 25px; color: #64748b;">No Debit Notes found. Click '➕ Add New Data' or 'Edit Data' to add.</td></tr>`;
    return;
  }

  // Duplicate കണ്ടുപിടിക്കാനായി Plate No + Month + Amount എന്നിവയുടെ കീ മാപ്പ് ഉണ്ടാക്കുന്നു
  const duplicateCounts = {};
  records.forEach((r) => {
    const p = (r.plate_no || "").trim().toUpperCase();
    const m = (r.month_year || "").trim().toUpperCase();
    const a = parseFloat(r.amount) || 0;
    // ആവശ്യത്തിന് ഡാറ്റയുള്ള വരികൾ മാത്രം പരിഗണിക്കുന്നു
    if (p && m && a > 0) {
      const key = `${p}|${m}|${a.toFixed(2)}`;
      duplicateCounts[key] = (duplicateCounts[key] || 0) + 1;
    }
  });

  records.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = idx;

    const numAmt = parseFloat(row.amount) || 0;
    const rowPlate = (row.plate_no || "").trim().toUpperCase();
    const rowMonth = (row.month_year || "").trim().toUpperCase();
    const isDup = rowPlate && rowMonth && numAmt > 0 && duplicateCounts[`${rowPlate}|${rowMonth}|${numAmt.toFixed(2)}`] > 1;

    if (isDup) {
      tr.classList.add("row-duplicate");
      tr.title = "⚠️ Duplicate detected: Same Plate No, Month & Amount!";
    }
    const isExcluded = String(row.vat_status).toLowerCase() === "excluded";
    const vatVal = isExcluded ? (numAmt * 0.15).toFixed(2) : "0.00";
    const totalVal = (numAmt + parseFloat(vatVal)).toFixed(2);

    const isEditable = isEditMode;
    const editAttr = isEditable ? 'contenteditable="true"' : "";
    const roAttr = isEditable ? "" : 'readonly tabindex="-1"';
    const disAttr = isEditable ? "" : 'disabled tabindex="-1"';
    const calIcon = isEditable
      ? `<span style="font-size: 10px; color: #64748b; padding-left: 2px;">📅</span>`
      : "";

    // Edit Data (isEditMode) il ellam editable aakum; Status Edit (isStatusEditMode) il mathram 'Paid' lock aakum
    const isRowPaid =
      String(row.status || "")
        .trim()
        .toLowerCase() === "paid";
    const isStatusEditable = isEditMode || (isStatusEditMode && !isRowPaid);

    let attachmentHtml = "";
    if (row.attachment_path) {
      attachmentHtml = `
        <div style="display:flex; align-items:center; gap:4px; justify-content:center;">
          <button type="button" class="btn-attachment has-file" onclick="openPdfViewerModal('${row.attachment_path}', '${escapeHTML(row.plate_no || "")}', '${escapeHTML(row.month_year || "")}')" title="View Attachment">📎 View</button>
          <button type="button" class="btn-attachment has-file" style="padding:3px 6px;" onclick="downloadAttachmentWithCustomName(event, '${row.attachment_path}', '${escapeHTML(row.plate_no || "")}', '${escapeHTML(row.month_year || "")}')" title="Download Original Quality">📥</button>
          ${isEditable ? `<button type="button" class="btn-attachment" style="padding:2px 5px;" onclick="triggerRowFileUpload(${idx})" title="Change file">🔄</button>` : ""}
        </div>
      `;
    } else {
      attachmentHtml = isEditable
        ? `<button type="button" class="btn-attachment" onclick="triggerRowFileUpload(${idx})">📤 Upload</button>`
        : `<span style="color:#94a3b8; font-size:11px;">No file</span>`;
    }

    const receivedDateHtml = isEditable
      ? `<input type="date" class="cell-input" value="${row.received_date || ""}" onchange="updateCellData(${idx}, 'received_date', this.value)">`
      : escapeHTML(formatDateDisplay(row.received_date));

    const submittedDateHtml = isEditable
      ? `<input type="date" class="cell-input" value="${row.submitted_date || ""}" onchange="updateCellData(${idx}, 'submitted_date', this.value)">`
      : escapeHTML(formatDateDisplay(row.submitted_date));

    const monthHtml = isEditable
      ? `<div class="month-picker-trigger" onclick="openMonthYearPicker(event, ${idx})">
          <input type="text" class="cell-input" placeholder="Select Month" value="${row.month_year || ""}" readonly style="cursor: pointer; font-weight: 600; color: #0284c7; text-align: center;" tabindex="-1">
          ${calIcon}
        </div>`
      : `<span style="font-weight: 600; color: #0284c7;">${escapeHTML(row.month_year || "")}</span>`;

    const plateHtml = isEditable
      ? `<input 
          type="text" 
          list="plateList" 
          class="cell-input" 
          style="text-transform: uppercase; font-weight: 600; width: 100%; border: none; background: transparent; outline: none; padding: 4px 6px; text-align: center;" 
          value="${escapeHTML(row.plate_no || "")}" 
          oninput="handleLastRowLiveInput(${idx})" 
          onchange="onPlateChange(${idx}, this.value)" 
          placeholder="Plate No"
          autocomplete="off"
        >`
      : `<span style="font-weight: 700;">${escapeHTML(row.plate_no || "")}</span>`;

    const vatStatusHtml = isEditable
      ? `<select class="cell-select" onchange="onVatStatusChange(${idx}, this.value)">
          <option value="Included" ${row.vat_status === "Included" ? "selected" : ""}>Included (0%)</option>
          <option value="Excluded" ${row.vat_status === "Excluded" ? "selected" : ""}>Excluded (15%)</option>
        </select>`
      : escapeHTML(row.vat_status || "Included");

    tr.innerHTML = `
      <td class="col-sn-cell" oncontextmenu="openSnMenu(event, ${idx})">${idx + 1}</td>
      
      <td>${receivedDateHtml}</td>
      
      <td>${submittedDateHtml}</td>
      
      <td class="col-month-cell">${monthHtml}</td>
      
      <td style="text-align: center;">${renderDropdownCell(idx, "approved_by", row.approved_by, dropdownOptions.approved_by, isEditable)}</td>
      
      <td ${editAttr} oninput="handleLastRowLiveInput(${idx})" onblur="updateCellData(${idx}, 'particulars', this.innerText.trim())">${escapeHTML(row.particulars || "")}</td>
      
      <td style="text-align: center; padding-left: 5px; padding-right: 5px;">${plateHtml}</td>
      
      <td ${editAttr} oninput="handleLastRowLiveInput(${idx})" onblur="updateCellData(${idx}, 'driver_name', this.innerText.trim())">${escapeHTML(row.driver_name || "")}</td>
      
      <td>${renderDropdownCell(idx, "site", row.site, dropdownOptions.site, isEditable)}</td>
      
      <td>${renderDropdownCell(idx, "company", row.company, dropdownOptions.company, isEditable)}</td>
      
      <td>${renderDropdownCell(idx, "customer", row.customer, dropdownOptions.customer, isEditable)}</td>
      
      <td ${editAttr} style="font-weight: 600; text-align: right;" oninput="handleLastRowLiveInput(${idx})" onblur="onAmountChange(${idx}, this.innerText.trim())">${escapeHTML(row.amount || "")}</td>
      
      <td title="VAT Amount: SAR ${vatVal}">${vatStatusHtml}</td>
      
      <td style="font-weight: 700; text-align: right; color: #0284c7; padding-right: 10px;">
        ${totalVal}
      </td>
      
      <td ${editAttr} oninput="handleLastRowLiveInput(${idx})" onblur="updateCellData(${idx}, 'owner_name', this.innerText.trim())">${escapeHTML(row.owner_name || "")}</td>
      
      <td style="${!isEditMode && isStatusEditMode && isRowPaid ? "background: #f1f5f9; cursor: not-allowed;" : ""}">
        ${renderDropdownCell(idx, "status", row.status, dropdownOptions.status, isStatusEditable)}
      </td>
      
      <td ${editAttr} oninput="handleLastRowLiveInput(${idx})" onblur="updateCellData(${idx}, 'ref_no', this.innerText.trim())">${escapeHTML(row.ref_no || "")}</td>

      <td ${editAttr} oninput="handleLastRowLiveInput(${idx})" onblur="updateCellData(${idx}, 'work_order', this.innerText.trim())">${escapeHTML(row.work_order || "")}</td>

      <td ${editAttr} oninput="handleLastRowLiveInput(${idx})" onblur="updateCellData(${idx}, 'remark', this.innerText.trim())">${escapeHTML(row.remark || "")}</td>

      <td style="text-align: center;">${attachmentHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  applyFiltersAndSearch();
}

function renderDropdownCell(
  rowIdx,
  category,
  currentVal,
  optionsList,
  isEditable,
) {
  if (!isEditable) {
    return escapeHTML(currentVal || "");
  }

  let optsHtml = (optionsList || [])
    .map(
      (opt) =>
        `<option value="${escapeHTML(opt)}" ${opt === currentVal ? "selected" : ""}>${escapeHTML(opt)}</option>`,
    )
    .join("");
  return `
    <select class="cell-select" onchange="handleDropdownChange(${rowIdx}, '${category}', this.value)">
      <option value="">-- Select --</option>
      ${optsHtml}
      ${isEditMode ? `<option value="__ADD_NEW__" style="font-weight: bold; color: #2563eb;">➕ Add New</option>` : ""}
    </select>
  `;
}

async function handleDropdownChange(rowIdx, category, selectedVal) {
  if (selectedVal === "__ADD_NEW__") {
    const fieldLabel = category.replace("_", " ").toUpperCase();
    const cleanVal = await showCustomPrompt(
      `Add New ${fieldLabel}`,
      `Enter new ${fieldLabel.toLowerCase()} to save permanently:`,
    );

    if (cleanVal) {
      showStatus("Saving...", "saving");
      try {
        const res = await fetch("/debit-notes/api/add-dropdown", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-security-code": securityCode,
          },
          body: JSON.stringify({ category, value: cleanVal }),
        }).then((r) => r.json());

        if (res.success) {
          if (!dropdownOptions[category].includes(cleanVal)) {
            dropdownOptions[category].push(cleanVal);
            if (["site", "customer", "approved_by"].includes(category)) {
              dropdownOptions[category].sort();
            }
          }
          records[rowIdx][category] = cleanVal;
          saveRowToBackend(rowIdx);
          renderTable();
          showStatus("✓ Added " + cleanVal, "saved");
        } else {
          showStatus(res.message || "Failed to add", "error");
          renderTable();
        }
      } catch (e) {
        showStatus("Network Error", "error");
        renderTable();
      }
    } else {
      renderTable();
    }
  } else {
    records[rowIdx][category] = selectedVal;
    ensureEmptyRowBuffer();
    saveRowToBackend(rowIdx);
    renderTable();
  }
}

function triggerRowFileUpload(idx) {
  activeUploadRowIdx = idx;
  const fileInput = document.getElementById("rowFileInput");
  fileInput.value = "";
  fileInput.click();
}

async function handleRowFileSelected(e) {
  const file = e.target.files[0];
  if (!file || activeUploadRowIdx === null) return;
  const row = records[activeUploadRowIdx];

  const formData = new FormData();
  formData.append("id", row.id || "");
  formData.append("plate_no", (row.plate_no || "").trim().toUpperCase());
  formData.append("month_year", (row.month_year || "").trim().toUpperCase());
  formData.append("file", file);

  showStatus("Uploading file: 0%", "saving");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/debit-notes/api/upload-attachment");
  xhr.setRequestHeader("x-security-code", securityCode);

  xhr.upload.onprogress = function (ev) {
    if (ev.lengthComputable) {
      const pct = Math.round((ev.loaded / ev.total) * 100);
      showStatus(`Uploading file: ${pct}%`, "saving");
    }
  };

  xhr.onload = function () {
    if (xhr.status === 200) {
      const res = JSON.parse(xhr.responseText);
      if (res.success) {
        row.attachment_path = res.file_path;
        showStatus("✓ Uploaded (100%)", "saved");
        saveRowToBackend(activeUploadRowIdx);
        renderTable();
      } else {
        showStatus("Upload failed: " + res.message, "error");
      }
    } else {
      showStatus("Upload HTTP error", "error");
    }
  };

  xhr.onerror = function () {
    showStatus("Upload Network Error", "error");
  };

  xhr.send(formData);
}

async function onPlateChange(idx, val) {
  records[idx].plate_no = val.trim().toUpperCase();
  await autoLookupDriverOwner(idx);
  ensureEmptyRowBuffer();
  saveRowToBackend(idx);
  renderTable();
}

function onAmountChange(idx, val) {
  records[idx].amount = val;
  ensureEmptyRowBuffer();
  saveRowToBackend(idx);
  renderTable();
}

function onVatStatusChange(idx, val) {
  records[idx].vat_status = val;
  ensureEmptyRowBuffer();
  saveRowToBackend(idx);
  renderTable();
}

function updateCellData(idx, field, val) {
  records[idx][field] = val;
  ensureEmptyRowBuffer();
  saveRowToBackend(idx);
  renderTable();
}

async function autoLookupDriverOwner(idx) {
  const r = records[idx];
  if (!r.plate_no) return;
  showStatus("Looking up logs...", "saving");
  try {
    const res = await fetch("/debit-notes/api/resolve-driver-owner", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-security-code": securityCode,
      },
      body: JSON.stringify({ plate_no: r.plate_no, month_year: r.month_year }),
    }).then((res) => res.json());

    if (res.success) {
      r.driver_name = res.driver_name;
      r.owner_name = res.owner_name;
      renderTable();
    }
  } catch (err) {
    console.error(err);
  }
}

let saveQueue = [];
let isQueueProcessing = false;

async function processSaveQueue() {
  if (isQueueProcessing || saveQueue.length === 0) return;
  isQueueProcessing = true;

  while (saveQueue.length > 0) {
    const { idx, resolve, reject } = saveQueue.shift();
    const row = records[idx];

    if (!row) {
      if (resolve) resolve();
      continue;
    }

    const isSignedAction = String(row.status).trim().toLowerCase() === "signed";
    if (isSignedAction) {
      showStatus(`⏳ Inspecting file & Stamping (Row ${idx + 1})...`, "saving");
    } else {
      showStatus("Saving...", "saving");
    }

    try {
      const res = await fetch("/debit-notes/api/save-row", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-security-code": securityCode,
          "x-client-id": myClientId,
        },
        body: JSON.stringify(row),
      }).then((r) => r.json());

      if (res.success) {
        row.id = Number(res.id);
        row.vat_amount = res.vat_amount;
        row.total_amount = res.total_amount;

        if (res.seal_applied) {
          showStatus(`✓ Seal & Sign Applied (Row ${idx + 1})`, "saved");
        } else if (res.seal_reason === "ALREADY_SEALED") {
          showStatus(
            `ℹ️ Seal / Signature already exists in file (Row ${idx + 1})`,
            "saved",
          );
        } else {
          showStatus("✓ Saved", "saved");
        }

        ensureEmptyRowBuffer();
        renderTable();
        if (resolve) resolve(res);
      } else {
        showStatus(res.message || "Error", "error");
        if (reject) reject(new Error(res.message));
      }
    } catch (e) {
      showStatus("Error: " + e.message, "error");
      if (reject) reject(e);
    }
  }

  isQueueProcessing = false;
}

function saveRowToBackend(idx) {
  const row = records[idx];
  if (!row) return;

  const numAmt = parseFloat(row.amount) || 0;
  const hasContent =
    (row.plate_no && String(row.plate_no).trim() !== "") ||
    (row.particulars && String(row.particulars).trim() !== "") ||
    (row.received_date && String(row.received_date).trim() !== "") ||
    numAmt > 0;

  if (!row.id && !hasContent) {
    return;
  }

  return new Promise((resolve, reject) => {
    saveQueue.push({ idx, resolve, reject });
    processSaveQueue();
  });
}

function openAddNewDataModal() {
  document.getElementById("newRecordForm").reset();

  const populateSelect = (id, list) => {
    const sel = document.getElementById(id);
    sel.innerHTML =
      `<option value="">-- Select --</option>` +
      (list || [])
        .map(
          (v) => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`,
        )
        .join("");
  };

  populateSelect("m_approved_by", dropdownOptions.approved_by);
  populateSelect("m_site", dropdownOptions.site);
  populateSelect("m_company", dropdownOptions.company);
  populateSelect("m_customer", dropdownOptions.customer);
  populateSelect("m_status", dropdownOptions.status);
  document.getElementById("m_status").value = "Received";

  document.getElementById("m_total_amount").value = "0.00";
  document.getElementById("modalUploadProgressContainer").style.display =
    "none";
  document.getElementById("addNewDataModal").style.display = "flex";
}

function closeAddNewDataModal() {
  document.getElementById("addNewDataModal").style.display = "none";
}

async function modalResolveDriverOwner() {
  const plate = document
    .getElementById("m_plate_no")
    .value.trim()
    .toUpperCase();
  const month = document.getElementById("m_month_year").value.trim();
  if (!plate) return;

  try {
    const res = await fetch("/debit-notes/api/resolve-driver-owner", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-security-code": securityCode,
      },
      body: JSON.stringify({ plate_no: plate, month_year: month }),
    }).then((r) => r.json());

    if (res.success) {
      document.getElementById("m_driver_name").value = res.driver_name || "";
      document.getElementById("m_owner_name").value = res.owner_name || "";
    }
  } catch (e) {
    console.error(e);
  }
}

function modalCalculateTotal() {
  const amt = parseFloat(document.getElementById("m_amount").value) || 0;
  const isExcluded =
    document.getElementById("m_vat_status").value === "Excluded";
  const vat = isExcluded ? amt * 0.15 : 0;
  document.getElementById("m_total_amount").value = (amt + vat).toFixed(2);
}

async function submitNewRecordModal(e) {
  e.preventDefault();
  const btn = document.getElementById("mSubmitBtn");
  btn.disabled = true;
  btn.innerText = "Saving...";

  const newRec = {
    received_date: document.getElementById("m_received_date").value,
    submitted_date: document.getElementById("m_submitted_date").value,
    month_year: document.getElementById("m_month_year").value.trim(),
    approved_by: document.getElementById("m_approved_by").value,
    particulars: document.getElementById("m_particulars").value.trim(),
    plate_no: document.getElementById("m_plate_no").value.trim().toUpperCase(),
    driver_name: document.getElementById("m_driver_name").value,
    site: document.getElementById("m_site").value,
    company: document.getElementById("m_company").value,
    customer: document.getElementById("m_customer").value,
    amount: document.getElementById("m_amount").value,
    vat_status: document.getElementById("m_vat_status").value,
    owner_name: document.getElementById("m_owner_name").value,
    status: document.getElementById("m_status").value,
    ref_no: document.getElementById("m_ref_no").value.trim(),
    work_order: document.getElementById("m_work_order").value.trim(),
    remark: document.getElementById("m_remark").value.trim(),
    attachment_path: "",
  };

  try {
    const res = await fetch("/debit-notes/api/save-row", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-security-code": securityCode,
        "x-client-id": myClientId,
      },
      body: JSON.stringify(newRec),
    }).then((r) => r.json());

    if (!res.success) throw new Error(res.message || "Failed to save record");

    const newId = res.id;
    newRec.id = newId;
    newRec.vat_amount = res.vat_amount;
    newRec.total_amount = res.total_amount;

    const fileInput = document.getElementById("m_file");
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append("id", newId);
      formData.append("plate_no", newRec.plate_no || "VEHICLE");
      formData.append("month_year", newRec.month_year || "MONTH");
      formData.append("file", file);

      const progContainer = document.getElementById(
        "modalUploadProgressContainer",
      );
      const progBar = document.getElementById("modalUploadProgressBar");
      const progText = document.getElementById("modalUploadProgressText");
      progContainer.style.display = "block";

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/debit-notes/api/upload-attachment");
        xhr.setRequestHeader("x-security-code", securityCode);

        xhr.upload.onprogress = function (ev) {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            progBar.style.width = pct + "%";
            progText.innerText = `Uploading: ${pct}%`;
          }
        };

        xhr.onload = function () {
          if (xhr.status === 200) {
            const upRes = JSON.parse(xhr.responseText);
            if (upRes.success) {
              newRec.attachment_path = upRes.file_path;
              resolve();
            } else reject(new Error(upRes.message));
          } else reject(new Error("File upload failed"));
        };

        xhr.onerror = () => reject(new Error("Network Error"));
        xhr.send(formData);
      });
    }

    const existingIdx = records.findIndex(
      (r) => Number(r.id) === Number(newId),
    );
    if (existingIdx !== -1) {
      records[existingIdx] = newRec;
    } else {
      const bufferIdx = records.findIndex((r) => !r.id);
      if (bufferIdx !== -1) {
        records.splice(bufferIdx, 0, newRec);
      } else {
        records.push(newRec);
      }
    }

    ensureEmptyRowBuffer();
    renderTable();
    closeAddNewDataModal();
    showStatus("✓ Record Created Successfully", "saved");
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Save Debit Note";
  }
}

function openSnMenu(e, idx) {
  e.preventDefault();
  activeRowIndex = idx;
  const menu = document.getElementById("snContextMenu");
  menu.style.display = "flex";
  menu.style.left = e.pageX + "px";
  menu.style.top = e.pageY + "px";

  const isBuffer = idx === records.length - 1 && !records[idx].id;
  const cloneBtn = document.getElementById("cmCloneRowBtn");
  if (cloneBtn) cloneBtn.style.display = isBuffer ? "none" : "flex";
  document.getElementById("cmDeleteRowBtn").style.display = isBuffer
    ? "none"
    : "flex";
}

document.addEventListener("click", (e) => {
  const menu = document.getElementById("snContextMenu");
  if (menu) menu.style.display = "none";

  const monthPicker = document.getElementById("monthYearPicker");
  if (
    monthPicker &&
    !e.target.closest("#monthYearPicker") &&
    !e.target.closest(".month-picker-trigger")
  ) {
    monthPicker.style.display = "none";
  }
});

function contextAddRow() {
  records.splice(activeRowIndex + 1, 0, createBlankRowObj());
  renderTable();
}

function contextCloneRow() {
  if (activeRowIndex === null || !records[activeRowIndex]) return;
  const source = records[activeRowIndex];

  // ആദ്യം മോഡൽ തുറന്ന് ഡ്രോപ്‌ഡൗൺ ഓപ്ഷനുകൾ ലോഡ് ചെയ്യുക
  openAddNewDataModal();

  // തിരഞ്ഞെടുത്ത വരിയിലെ ഡാറ്റാ മോഡലിലേക്ക് ഫിൽ ചെയ്തു കൊടുക്കുക
  document.getElementById("m_received_date").value = source.received_date || "";
  document.getElementById("m_submitted_date").value = source.submitted_date || "";
  document.getElementById("m_month_year").value = source.month_year || "";
  document.getElementById("m_approved_by").value = source.approved_by || "";
  document.getElementById("m_particulars").value = source.particulars || "";
  document.getElementById("m_plate_no").value = source.plate_no || "";
  document.getElementById("m_driver_name").value = source.driver_name || "";
  document.getElementById("m_site").value = source.site || "";
  document.getElementById("m_company").value = source.company || "";
  document.getElementById("m_customer").value = source.customer || "";
  document.getElementById("m_amount").value = source.amount || "";
  document.getElementById("m_vat_status").value = source.vat_status || "Included";
  document.getElementById("m_owner_name").value = source.owner_name || "";
  document.getElementById("m_status").value = source.status || "Received";
  
  if (document.getElementById("m_ref_no")) {
    document.getElementById("m_ref_no").value = source.ref_no || "";
  }
  document.getElementById("m_work_order").value = source.work_order || "";
  document.getElementById("m_remark").value = source.remark || "";

  // Total Amount കാൽക്കുലേറ്റ് ചെയ്യുക
  modalCalculateTotal();
}

async function contextDeleteRow() {
  const row = records[activeRowIndex];
  if (!row.id) {
    records.splice(activeRowIndex, 1);
    ensureEmptyRowBuffer();
    renderTable();
    return;
  }

  showStatus("Deleting...", "saving");
  try {
    const res = await fetch("/debit-notes/api/delete-row", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-security-code": securityCode,
        "x-client-id": myClientId,
      },
      body: JSON.stringify({ id: row.id }),
    }).then((r) => r.json());

    if (res.success) {
      records.splice(activeRowIndex, 1);
      ensureEmptyRowBuffer();
      renderTable();
      showStatus("✓ Deleted", "saved");
    } else {
      showStatus(res.message || "Delete failed", "error");
    }
  } catch (e) {
    showStatus("Delete failed: " + e.message, "error");
  }
}

function openHeaderFilter(e, col) {
  e.preventDefault();
  activeHeaderCol = col;
  const popup = document.getElementById("filterPopup");
  popup.style.display = "flex";
  popup.style.left = Math.min(e.pageX, window.innerWidth - 270) + "px";
  popup.style.top = e.pageY + "px";

  document.getElementById("filterSearchInput").value = "";
  document.getElementById("filterPopupTitle").innerText =
    "Filter: " + col.replace("_", " ").toUpperCase();

  const unique = new Set();

  if (col === "attachment") {
    unique.add("Has Attachment");
    unique.add("No Attachment");
  } else {
    records.forEach((r) => {
      let v = r[col];
      if (v === null || v === undefined || String(v).trim() === "")
        v = "(Blanks)";
      unique.add(String(v).trim());
    });
  }

  const sorted = Array.from(unique).sort();
  const listEl = document.getElementById("filterList");
  listEl.innerHTML = "";

  let allChecked = true;
  sorted.forEach((v) => {
    const isChecked = !activeFilters[col] || activeFilters[col].includes(v);
    if (!isChecked) allChecked = false;
    listEl.innerHTML += `
      <div class="filter-item">
        <input type="checkbox" value="${escapeHTML(v)}" ${isChecked ? "checked" : ""} class="col-filter-cb" onchange="syncSelectAllCheckbox()">
        <label>${escapeHTML(v)}</label>
      </div>
    `;
  });

  const selectAllCb = document.getElementById("filterSelectAllCb");
  if (selectAllCb) {
    selectAllCb.checked = allChecked && sorted.length > 0;
  }
}

function searchFilterList() {
  const q = document.getElementById("filterSearchInput").value.toLowerCase();
  document.querySelectorAll("#filterList .filter-item").forEach((item) => {
    const lbl = item.querySelector("label").innerText.toLowerCase();
    item.style.display = lbl.includes(q) ? "flex" : "none";
  });
  syncSelectAllCheckbox();
}

function toggleSelectAllFilters(checkState) {
  // നിലവിൽ സെർച്ചിൽ ഫിൽറ്റർ ആയി കാണുന്ന (visible) ഐറ്റങ്ങളെ മാത്രം ബാധിക്കും
  document.querySelectorAll("#filterList .filter-item").forEach((item) => {
    if (item.style.display !== "none") {
      const cb = item.querySelector(".col-filter-cb");
      if (cb) cb.checked = checkState;
    }
  });
  const selectAllCb = document.getElementById("filterSelectAllCb");
  if (selectAllCb) selectAllCb.checked = checkState;
}

function syncSelectAllCheckbox() {
  const visibleCbs = Array.from(document.querySelectorAll("#filterList .filter-item"))
    .filter((item) => item.style.display !== "none")
    .map((item) => item.querySelector(".col-filter-cb"))
    .filter(Boolean);

  const selectAllCb = document.getElementById("filterSelectAllCb");
  if (!selectAllCb || visibleCbs.length === 0) return;

  const allSelected = visibleCbs.every((cb) => cb.checked);
  selectAllCb.checked = allSelected;
}

function applyCurrentFilter() {
  const checked = Array.from(
    document.querySelectorAll(".col-filter-cb:checked"),
  ).map((cb) => cb.value);
  activeFilters[activeHeaderCol] = checked;
  document.getElementById("filterPopup").style.display = "none";
  applyFiltersAndSearch();
}

function clearCurrentFilter() {
  delete activeFilters[activeHeaderCol];
  document.getElementById("filterPopup").style.display = "none";
  applyFiltersAndSearch();
}

function sortCurrentColumn(direction) {
  records.sort((a, b) => {
    let va = a[activeHeaderCol] || "";
    let vb = b[activeHeaderCol] || "";
    return direction === "asc"
      ? va.toString().localeCompare(vb.toString())
      : vb.toString().localeCompare(va.toString());
  });
  document.getElementById("filterPopup").style.display = "none";
  renderTable();
}

function applyGlobalSearch() {
  applyFiltersAndSearch();
}

function applyFiltersAndSearch() {
  const searchType = document.getElementById("searchType").value;
  const q = document.getElementById("searchInput").value.trim().toUpperCase();

  const trs = document.querySelectorAll("#tableBody tr");
  records.forEach((row, idx) => {
    if (!trs[idx]) return;
    let visible = true;

    for (let col in activeFilters) {
      if (col === "attachment") {
        const hasFile = Boolean(row.attachment_path && String(row.attachment_path).trim() !== "");
        const statusVal = hasFile ? "Has Attachment" : "No Attachment";
        if (!activeFilters[col].includes(statusVal)) {
          visible = false;
          break;
        }
      } else {
        let v = row[col];
        if (v === null || v === undefined || String(v).trim() === "")
          v = "(Blanks)";
        if (!activeFilters[col].includes(String(v).trim())) {
          visible = false;
          break;
        }
      }
    }

    if (visible && q) {
      if (searchType === "general") {
        const rowStr = Object.values(row).join(" ").toUpperCase();
        if (!rowStr.includes(q)) visible = false;
      } else {
        const val = (row[searchType] || "").toUpperCase();
        if (!val.includes(q)) visible = false;
      }
    }

    trs[idx].style.display = visible ? "" : "none";
  });
}

// Full Edit Mode Toggle
function toggleEditMode() {
  isEditMode = !isEditMode;
  if (isEditMode) isStatusEditMode = false;
  document.getElementById("editModeBtn").innerText = isEditMode
    ? "💾 Read Only"
    : "✏️ Edit Data";
  document.getElementById("statusEditModeBtn").innerText = "⚡ Edit Status";
  document.body.classList.toggle("editable-active", isEditMode);
  ensureEmptyRowBuffer();
  renderTable();
}

// Status-Only Edit Mode Toggle
function toggleStatusEditMode() {
  isStatusEditMode = !isStatusEditMode;
  if (isStatusEditMode) {
    isEditMode = false;
    document.getElementById("editModeBtn").innerText = "✏️ Edit Data";
    document.body.classList.remove("editable-active");
  }
  const btn = document.getElementById("statusEditModeBtn");
  btn.innerText = isStatusEditMode ? "💾 Lock Status" : "⚡ Edit Status";
  btn.style.background = isStatusEditMode ? "#0284c7" : "transparent";
  btn.style.color = isStatusEditMode ? "#ffffff" : "#0284c7";
  ensureEmptyRowBuffer();
  renderTable();
}

function exportToExcel() {
  const wb = XLSX.utils.book_new();

  const headers = [
    "SN",
    "Received Date",
    "Submitted Date",
    "Month",
    "Approved By",
    "Particulars",
    "Plate No",
    "Driver Name",
    "Site",
    "Company",
    "Customer",
    "Amount",
    "VAT Status",
    "Total Amount",
    "Owner Name",
    "Status",
    "Ref No",
    "Work Order",
    "Remark",
    "Attachment Link",
  ];

  const exportData = [headers];

  records.forEach((r, idx) => {
    if (!r.id && !r.plate_no && !r.amount) return;
    const numAmt = parseFloat(r.amount) || 0;
    const isExcluded = String(r.vat_status).toLowerCase() === "excluded";
    const vatVal = isExcluded ? numAmt * 0.15 : 0;
    const totVal = numAmt + vatVal;

    exportData.push([
      idx + 1,
      formatDateDisplay(r.received_date),
      formatDateDisplay(r.submitted_date),
      r.month_year || "",
      r.approved_by || "",
      r.particulars || "",
      r.plate_no || "",
      r.driver_name || "",
      r.site || "",
      r.company || "",
      r.customer || "",
      numAmt,
      r.vat_status || "Included",
      totVal,
      r.owner_name || "",
      r.status || "",
      r.ref_no || "",
      r.work_order || "",
      r.remark || "",
      r.attachment_path
        ? "https://fefei.tail129892.ts.net" + r.attachment_path
        : "",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(exportData);
  ws["!views"] = [
    {
      state: "frozen",
      ySplit: 1,
      topLeftCell: "A2",
      activePane: "bottomLeft",
    },
  ];
  ws["!autofilter"] = { ref: ws["!ref"] };

  XLSX.utils.book_append_sheet(wb, ws, "Debit Notes");
  XLSX.writeFile(wb, "Debit_Notes_Report.xlsx");
}

async function downloadAttachmentWithCustomName(
  e,
  fileUrl,
  plateNo,
  monthYear,
) {
  e.preventDefault();
  if (!fileUrl) return;

  const cleanPlate = (plateNo || "VEHICLE")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase();
  const cleanMonth = (monthYear || "MONTH")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase();

  const ext = fileUrl.split(".").pop().split(/\#|\?/)[0] || "pdf";
  const downloadFileName = `${cleanPlate}_${cleanMonth}.${ext}`;

  showStatus("Downloading file...", "saving");

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error("Network response was not ok");

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = downloadFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(blobUrl);
    showStatus("✓ Downloaded", "saved");
  } catch (err) {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = downloadFileName;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showStatus("✓ Downloaded", "saved");
  }
}

let activeViewerUrl = "";
let activeViewerPlate = "";
let activeViewerMonth = "";

function openPdfViewerModal(fileUrl, plateNo, monthYear) {
  if (!fileUrl) return;
  activeViewerUrl = fileUrl;
  activeViewerPlate = plateNo || "";
  activeViewerMonth = monthYear || "";

  document.getElementById("pdfViewerTitle").innerText = `${plateNo || "VEHICLE"} - ${monthYear || "ATTACHMENT"}`;
  document.getElementById("pdfViewerFrame").src = fileUrl;
  document.getElementById("pdfViewerModal").style.display = "flex";
}

function closePdfViewerModal() {
  document.getElementById("pdfViewerModal").style.display = "none";
  document.getElementById("pdfViewerFrame").src = "";
  activeViewerUrl = "";
}

function viewerOpenNewTab() {
  if (!activeViewerUrl) return;
  window.open(activeViewerUrl, "_blank");
}

function viewerDownloadFile() {
  if (!activeViewerUrl) return;
  downloadAttachmentWithCustomName(
    new Event("click"),
    activeViewerUrl,
    activeViewerPlate,
    activeViewerMonth,
  );
}

async function viewerCopyAsImage() {
  if (!activeViewerUrl) return;
  showStatus("Rendering & copying image...", "saving");

  try {
    // PDF ആണെങ്കിൽ ക്യാൻവാസിലേക്ക് റെൻഡർ ചെയ്യാനായി pdfjs ഉപയോഗിക്കാം അല്ലെങ്കിൽ സാധാരണ ഇമേജ് ആണെങ്കിൽ നേരിട്ട് കോപ്പി ചെയ്യാം
    const isPdf = activeViewerUrl.toLowerCase().split(/[#?]/)[0].endsWith(".pdf");

    if (!isPdf) {
      const resp = await fetch(activeViewerUrl);
      const blob = await resp.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      showStatus("✓ Image Copied to Clipboard", "saved");
      return;
    }

    // PDF ആവുമ്പോൾ PDF.js ലൈബ്രറി ഉപയോഗിച്ച് ഒന്നാമത്തെ പേജ് canvas ലേക്ക് render ചെയ്യുന്നു
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
        script.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
          resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const loadingTask = window.pdfjsLib.getDocument(activeViewerUrl);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    canvas.toBlob(async (blob) => {
      if (!blob) {
        showStatus("Failed to create image blob", "error");
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        showStatus("✓ PDF Page 1 Copied as Image", "saved");
      } catch (err) {
        console.error(err);
        showStatus("Clipboard permission denied", "error");
      }
    }, "image/png");
  } catch (e) {
    console.error("Copy Image Error:", e);
    showStatus("Copy Failed: " + e.message, "error");
  }
}
