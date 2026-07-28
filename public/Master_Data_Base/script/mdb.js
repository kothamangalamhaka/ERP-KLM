let currentUser = JSON.parse(localStorage.getItem("erpUser")) || { role: "Super Admin", username: "Admin", site: "Main" };
let token = localStorage.getItem("erpToken") || "dummy_token";

let masterData = [];
let headersInfo = []; 
let nextSN = 1;
let isEditMode = false;
let headerFilters = {};
let currentFilterCol = "";
let sortConfig = null;

// Undo/Redo State
let historyStack = [];
let redoStack = [];

document.addEventListener("DOMContentLoaded", () => {
    initSettings();
    buildUserMenu();
    fetchData(); 
});

// =======================
// UI & SETTINGS
// =======================
function initSettings() {
    if(localStorage.getItem("erpThemeMaster") === "dark") document.body.classList.add("dark-mode");
    if(localStorage.getItem("erpHighlights") === "off") document.body.classList.add("no-highlights");
    let font = localStorage.getItem("erpFont");
    if(font) {
        document.body.style.fontFamily = font;
        document.getElementById("fontSelector").value = font;
    }
    document.getElementById("userInfoDisplay").innerText = currentUser.username;
}

function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("erpThemeMaster", document.body.classList.contains("dark-mode") ? "dark" : "light");
}

function toggleHighlights() {
    document.body.classList.toggle("no-highlights");
    localStorage.setItem("erpHighlights", document.body.classList.contains("no-highlights") ? "off" : "on");
}

function changeFont(font) {
    document.body.style.fontFamily = font;
    localStorage.setItem("erpFont", font);
}

function showToast(msg, type = "success") {
    let t = document.getElementById("toastMsg");
    t.innerText = msg;
    t.className = `toast-mini show ${type}`;
    setTimeout(() => { t.className = t.className.replace("show", ""); }, 3000);
}

function closeModal(id) { document.getElementById(id).style.display = "none"; }

// =======================
// USER MENU & ACTIONS
// =======================
function toggleUserMenu(e) {
    e.stopPropagation();
    document.getElementById("userDropdownMenu").classList.toggle("show");
}

function buildUserMenu() {
    const menu = document.getElementById("userDropdownMenu");
    let html = "";
    
    if (currentUser.role === "Super Admin" || currentUser.role === "Admin") {
        // Added links to Admin Console and View Logs
        html += `<button class="ud-item" onclick="window.location.href='./admin/index.html'"><span class="material-icons">admin_panel_settings</span> Admin Console</button>`;
        html += `<button class="ud-item" onclick="window.location.href='./log/index.html'"><span class="material-icons">history</span> View Logs</button>`;
        
        // Added Recycle Bin (Only for Super Admin)
        if (currentUser.role === "Super Admin") {
            html += `<button class="ud-item" style="color:var(--danger)" onclick="window.location.href='./recycle_bin.html'"><span class="material-icons">delete_sweep</span> Recycle Bin</button>`;
        }
        
        html += `<div class="ud-divider"></div>`;
        html += `<button class="ud-item" onclick="openColModal()"><span class="material-icons">view_column</span> Add Column</button>`;
        html += `<button class="ud-item" style="color:var(--warning)" onclick="sendAlerts()"><span class="material-icons">notifications_active</span> Send Alerts</button>`;
        html += `<div class="ud-divider"></div>`;
    }
    
    html += `<button class="ud-item" style="color:var(--danger)" onclick="logout()"><span class="material-icons">logout</span> Logout</button>`;
    menu.innerHTML = html;
}

function sendAlerts() {
    showToast("Alerts pushed to Telegram!", "success");
}

function logout() {
    localStorage.removeItem("erpUser");
    localStorage.removeItem("erpToken");
    window.location.reload();
}

// =======================
// DATA FETCHING & RENDERING 
// =======================
async function fetchData() {
    document.getElementById("loader").style.display = "flex";
    document.getElementById("tableContainer").style.display = "none";
    
    try {
        const res = await fetch("/api/get-master-data", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.success) {
            // Map backend data format to our frontend structure
            headersInfo = data.headers.map((h, i) => {
                // കൃത്യമായി ആ കോളത്തിന്റെ പേര് വെച്ച് വീതി (width) എടുക്കുന്നു
                let wObj = data.colWidths.find(w => w.name === h);
                let colWidth = wObj && wObj.width ? parseInt(String(wObj.width).replace("px", "")) : 150;
                
                // SN കോളം ആണെങ്കിൽ വീതി 50px ആയി ഫിക്സ് ചെയ്യുന്നു
                if(h.toUpperCase() === "SN") colWidth = 50;
                
                return {
                    name: h,
                    type: data.colTypes.find(t => t.name === h)?.type || "varchar",
                    locked: data.lockedCols.includes(h),
                    width: colWidth,
                    visible: true
                };
            });

            masterData = data.rows.map(rowArray => {
                let obj = { dbId: rowArray[rowArray.length - 1] };
                data.headers.forEach((h, i) => { obj[h] = rowArray[i]; });
                return obj;
            });
            nextSN = data.nextSN || 1;
            applyFiltersAndRender();
        }
    } catch (e) {
        showToast("Connection failed", "error");
    } finally {
        document.getElementById("loader").style.display = "none";
        document.getElementById("tableContainer").style.display = "block";
    }
}

function applyFiltersAndRender() {
    let globalSearchQ = document.getElementById("globalSearchInput") ? document.getElementById("globalSearchInput").value.toLowerCase().trim() : "";

    let filtered = masterData.filter(d => {
        // 1. Column-specific Excel Filters
        let pass = true;
        for (let col in headerFilters) {
            if (headerFilters[col].length > 0 && !headerFilters[col].includes(String(d[col]))) {
                pass = false; break;
            }
        }
        if (!pass) return false;

        // 2. Global Search (Only in Plate, Owner, and Driver columns)
        if (globalSearchQ !== "") {
            let matchFound = false;
            for (let key in d) {
                let kUpper = key.toUpperCase();
                // Check if the column name relates to Plate, Owner, or Driver
                if (kUpper.includes("PLATE") || kUpper.includes("OWNER") || kUpper.includes("DRIVER")) {
                    if (String(d[key]).toLowerCase().includes(globalSearchQ)) {
                        matchFound = true;
                        break;
                    }
                }
            }
            if (!matchFound) return false; // Hide row if not matched
        }

        return true;
    });

    if (sortConfig) {
        // ഡേറ്റ് കോളം ആണോ എന്ന് ചെക്ക് ചെയ്യാൻ
        let colInfo = headersInfo.find(c => c.name === sortConfig.key);
        let isDateCol = colInfo && (colInfo.type === 'date' || sortConfig.key.toUpperCase().includes("DATE") || sortConfig.key.toUpperCase().includes("WORK START") || sortConfig.key.toUpperCase().includes("REACHED"));

        const monthMap = { "jan":0, "feb":1, "mar":2, "apr":3, "may":4, "jun":5, "jul":6, "aug":7, "sep":8, "oct":9, "nov":10, "dec":11 };

        let parseDateStr = (str) => {
            if(!str) return 0;
            let parts = str.split('-');
            if(parts.length === 3) {
                let m = monthMap[parts[1].toLowerCase()];
                if(m !== undefined) return new Date(parts[2], m, parts[0]).getTime();
            }
            let t = Date.parse(str);
            return isNaN(t) ? 0 : t;
        };

        filtered.sort((a, b) => {
            let valA = String(a[sortConfig.key] || "").trim();
            let valB = String(b[sortConfig.key] || "").trim();

            if (isDateCol) {
                let timeA = parseDateStr(valA);
                let timeB = parseDateStr(valB);
                return sortConfig.dir === 'asc' ? timeA - timeB : timeB - timeA;
            } else {
                let numA = parseFloat(valA);
                let numB = parseFloat(valB);
                if(!isNaN(numA) && !isNaN(numB) && valA.match(/^[\d.]+$/) && valB.match(/^[\d.]+$/)) {
                    return sortConfig.dir === 'asc' ? numA - numB : numB - numA;
                }
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
                if(valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
                if(valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
                return 0;
            }
        });
    }
    renderNativeTable(filtered);
}

function renderNativeTable(data) {
    const thead = document.getElementById("masterHead");
    const tbody = document.getElementById("masterBody");
    
    let trHead = "<tr>";
    headersInfo.forEach((col) => {
        if(!col.visible) return;
        let lockIcon = col.locked ? `<span class="material-icons lock-icon-head" title="Locked Column">lock</span>` : "";
        let resizerHTML = col.name.toUpperCase() !== "SN" ? `<div class="resizer" data-col="${col.name}" onclick="event.stopPropagation()"></div>` : "";
        
        // Added data-colname attribute to easily locate the element later
        trHead += `
            <th data-colname="${col.name}" style="width: ${col.width}px; position: relative;" oncontextmenu="openHeaderContextMenu(event, '${col.name}')">
                <div class="th-content" style="${col.name.toUpperCase() === 'SN' ? 'justify-content: center;' : ''}">
                    <span>${col.name} ${lockIcon}</span>
                    ${col.name.toUpperCase() !== 'SN' ? `<span class="material-icons filter-icon" data-key="${col.name}" onclick="openFilterMenu(event, '${col.name}')">filter_list</span>` : ''}
                </div>
                ${resizerHTML}
            </th>
        `;
    });
    trHead += "</tr>";
    thead.innerHTML = trHead;

    let tbodyHTML = "";
    if(data.length === 0) {
        tbodyHTML = `<tr><td colspan="${headersInfo.length}" style="text-align:center;">No Data Found</td></tr>`;
    } else {
        data.forEach((row, rIdx) => {
            let statusClass = "";
            let s = (row.Status || "").toLowerCase();
            if(s === "released") statusClass = "status-released";
            else if(s === "replaced") statusClass = "status-replaced";
            else if(s === "mobilizing") statusClass = "status-mobilizing";

            tbodyHTML += `<tr class="${statusClass}" data-dbid="${row.dbId}" data-ridx="${rIdx}">`;
            headersInfo.forEach((col) => {
                if(!col.visible) return;
                
                let val = col.name.toUpperCase() === "SN" ? (rIdx + 1) : (row[col.name] || "");
                let isEditable = isEditMode && !col.locked && col.name.toUpperCase() !== "SN";
                
                // Alignment & Wrap Logic (Local overrides Global)
                let cAlign = col.align ? col.align : globalAlign;
                let cWrap = col.wrap !== undefined ? col.wrap : globalWrap;
                
                let alignStyle = col.name.toUpperCase() === "SN" ? 'text-align: center; font-weight: 600;' : `text-align: ${cAlign};`;
                let wrapStyle = cWrap ? 'white-space: normal; word-break: break-word;' : 'white-space: nowrap;';

                tbodyHTML += `<td 
                    class="${isEditable ? 'editable-cell' : ''}" 
                    style="${alignStyle} ${wrapStyle}"
                    ${isEditable ? 'contenteditable="true"' : ''} 
                    data-col="${col.name}" 
                    onblur="cellBlurred(this)"
                    onfocus="cellFocused(this)">${val}</td>`;
            });
            tbodyHTML += `</tr>`;
        });
    }
    tbody.innerHTML = tbodyHTML;

    for(let col in headerFilters) {
        if(headerFilters[col].length > 0) {
            let icon = document.querySelector(`.filter-icon[data-key="${col}"]`);
            if(icon) icon.classList.add("filter-active");
        }
    }
    
    initColumnResizers();
}

// =======================
// INLINE EDITING & UNDO/REDO 
// =======================
let pendingChanges = [];

function toggleBulkEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById("btnBulkEdit");
    const controls = document.getElementById("bulkEditControls");
    const tableWrap = document.getElementById("tableContainer");

    if (isEditMode) {
        btn.style.display = "none";
        controls.style.display = "flex";
        tableWrap.classList.add("edit-active");
        showToast("Edit Mode Enabled. You can paste Excel data directly.", "success");
    } else {
        btn.style.display = "flex";
        controls.style.display = "none";
        tableWrap.classList.remove("edit-active");
    }
    applyFiltersAndRender();
}

function cancelBulkEdits() {
    pendingChanges = [];
    fetchData(); // Reload original data
    toggleBulkEditMode();
}

async function saveBulkEdits() {
    if(pendingChanges.length === 0) {
        toggleBulkEditMode();
        return;
    }
    document.getElementById("loader").style.display = "flex";
    
    try {
        const res = await fetch("/api/update-cells-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ edits: pendingChanges })
        });
        const data = await res.json();
        if(data.success) {
            pendingChanges = [];
            historyStack = []; 
            redoStack = [];
            toggleBulkEditMode();
            showToast("Changes saved successfully!");
        } else {
            showToast(data.message, "error");
        }
    } catch(e) {
        showToast("Save failed", "error");
    } finally {
        fetchData();
    }
}

let activeCellOldVal = "";
function cellFocused(td) { activeCellOldVal = td.innerText.trim(); }
function cellBlurred(td) {
    let newVal = td.innerText.trim();
    if(newVal !== activeCellOldVal) {
        let dbId = td.parentElement.dataset.dbid;
        let col = td.dataset.col;
        
        historyStack.push({ dbId, colName: col, oldVal: activeCellOldVal, newVal });
        redoStack = []; 
        
        let existingIdx = pendingChanges.findIndex(c => c.dbId === dbId && c.colName === col);
        if(existingIdx >= 0) pendingChanges[existingIdx].newValue = newVal;
        else pendingChanges.push({ dbId, colName: col, newValue: newVal });
    }
}

function performUndo() {
    if(historyStack.length === 0) return showToast("Nothing to undo", "error");
    let last = historyStack.pop();
    redoStack.push(last);
    updateCellVisually(last.dbId, last.colName, last.oldVal);
    updatePendingArray(last.dbId, last.colName, last.oldVal);
}

function performRedo() {
    if(redoStack.length === 0) return showToast("Nothing to redo", "error");
    let action = redoStack.pop();
    historyStack.push(action);
    updateCellVisually(action.dbId, action.colName, action.newVal);
    updatePendingArray(action.dbId, action.colName, action.newVal);
}

function updateCellVisually(dbId, col, val) {
    let tr = document.querySelector(`tr[data-dbid="${dbId}"]`);
    if(tr) {
        let td = tr.querySelector(`td[data-col="${col}"]`);
        if(td) td.innerText = val;
    }
}

function updatePendingArray(dbId, col, val) {
    let row = masterData.find(d => d.dbId === dbId);
    let orig = row ? row[col] : "";
    let existingIdx = pendingChanges.findIndex(c => c.dbId === dbId && c.colName === col);
    
    if(val === orig) {
        if(existingIdx >= 0) pendingChanges.splice(existingIdx, 1);
    } else {
        if(existingIdx >= 0) pendingChanges[existingIdx].newValue = val;
        else pendingChanges.push({ dbId, colName: col, newValue: val });
    }
}

// Smart Excel Paste
document.getElementById("masterTable").addEventListener("paste", function(e) {
    if (!isEditMode) return;
    let target = e.target;
    if (!target.classList.contains("editable-cell")) return;
    
    e.preventDefault();
    let text = (e.originalEvent || e).clipboardData.getData("text/plain");
    let rows = text.split(/\r\n|\n|\r/);
    if(rows[rows.length-1] === "") rows.pop();

    let currentRow = target.parentElement;
    let editableCells = Array.from(currentRow.querySelectorAll(".editable-cell"));
    let startColIdx = editableCells.indexOf(target);

    rows.forEach((rowText) => {
        if(!currentRow) return; 
        let cols = rowText.split("\t");
        let activeEditables = Array.from(currentRow.querySelectorAll(".editable-cell"));
        
        cols.forEach((cellText, j) => {
            let targetTd = activeEditables[startColIdx + j];
            if(targetTd) {
                targetTd.focus();
                targetTd.innerText = cellText.trim();
                targetTd.blur(); 
            }
        });
        currentRow = currentRow.nextElementSibling;
    });
    showToast(`Pasted ${rows.length} rows`);
});

// =======================
// COLUMNS VISIBILITY & LOCK 
// =======================
function openColVisModal() {
    const grid = document.getElementById("colVisList");
    grid.innerHTML = "";
    headersInfo.forEach(h => {
        let lockClass = h.locked ? "locked" : "";
        let lockIcon = h.locked ? "lock" : "lock_open";
        grid.innerHTML += `
            <div class="col-vis-item">
                <div class="col-vis-item-left">
                    <input type="checkbox" id="chk_${h.name}" ${h.visible ? 'checked' : ''} onchange="toggleSingleCol('${h.name}', this.checked)">
                    <label for="chk_${h.name}">${h.name}</label>
                </div>
                <i class="material-icons lock-btn ${lockClass}" onclick="promptLockToggle('${h.name}', ${h.locked})" title="Lock/Unlock Column">${lockIcon}</i>
            </div>
        `;
    });
    document.getElementById("colVisModalOverlay").style.display = "flex";
}

function toggleSingleCol(colName, isVisible) {
    let col = headersInfo.find(c => c.name === colName);
    if(col) col.visible = isVisible;
    applyFiltersAndRender();
}

function toggleAllColumns(state) {
    headersInfo.forEach(h => h.visible = state);
    openColVisModal(); 
    applyFiltersAndRender();
}

function promptLockToggle(colName, isCurrentlyLocked) {
    if(currentUser.role !== "Super Admin" && currentUser.role !== "Admin") {
        return showToast("Admin access required to change locks", "error");
    }

    if(isCurrentlyLocked) {
        document.getElementById("unlockTargetCol").value = colName;
        document.getElementById("unlockPinInput").value = "";
        document.getElementById("unlockPromptModal").style.display = "flex";
        document.getElementById("unlockPinInput").focus();
    } else {
        executeLockToggle(colName, true, "");
    }
}

async function submitUnlockPin() {
    let pin = document.getElementById("unlockPinInput").value;
    let colName = document.getElementById("unlockTargetCol").value;
    
    try {
        const res = await fetch("/api/verify-mdb-lock", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pin: pin })
        });
        const data = await res.json();
        if(data.success) {
            executeLockToggle(colName, false, pin);
            closeModal("unlockPromptModal");
        } else {
            showToast(data.message, "error");
        }
    } catch(e) {
        showToast("Verification failed", "error");
    }
}

async function executeLockToggle(colName, lockState, pin) {
    try {
        const res = await fetch("/api/admin/toggle-lock", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ colName, isLocked: lockState, pin })
        });
        const data = await res.json();
        if(data.success) {
            let col = headersInfo.find(c => c.name === colName);
            if(col) col.locked = lockState;
            openColVisModal(); 
            applyFiltersAndRender(); 
            showToast(data.message, "success");
        } else {
            showToast(data.message, "error");
        }
    } catch(e) {
        showToast("Failed to update lock state", "error");
    }
}

let relativeColAction = null; // To track where to add the column

function openColModal(isRelative = false) {
    if (!isRelative) relativeColAction = null; // Standard add (at the end)
    
    // Clear previous inputs
    document.getElementById("newColName").value = "";
    document.getElementById("newColType").value = "varchar";
    
    document.getElementById("colModalOverlay").style.display = "flex";
    document.getElementById("userDropdownMenu").classList.remove("show");
}

async function submitNewColumn() {
    let name = document.getElementById("newColName").value;
    let type = document.getElementById("newColType").value;
    if(!name) return showToast("Enter column name", "error");
    
    let endpoint = "/api/add-column";
    let payload = { colName: name, colType: type };

    // If it was triggered from right-click context menu
    if (relativeColAction) {
        endpoint = "/api/add-column-relative";
        payload.relativeTo = relativeColAction.target;
        payload.position = relativeColAction.position;
    }

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.success) {
            closeModal("colModalOverlay");
            showToast("Column Added!");
            relativeColAction = null; // Reset state
            fetchData(); // Reloads columns directly from database
        } else {
            showToast(data.message, "error");
        }
    } catch(e) {
        showToast("Failed to add column", "error");
    }
}

// =======================
// CUSTOM FILTERS
// =======================
function openFilterMenu(e, colName) {
    if(e) e.stopPropagation();
    currentFilterCol = colName;
    const menu = document.getElementById("excelFilterMenu");
    const list = document.getElementById("filterChecklist");
    list.innerHTML = "";

    let colInfo = headersInfo.find(c => c.name === colName);
    let isDateCol = colInfo && (colInfo.type === 'date' || colName.toUpperCase().includes("DATE") || colName.toUpperCase().includes("WORK START") || colName.toUpperCase().includes("REACHED"));
    
    let uniqueVals = [...new Set(masterData.map(d => String(d[colName] || "").trim()))];
    let selected = headerFilters[colName] || [];
    let isAll = selected.length === 0;
    
    document.getElementById("filterSelectAll").checked = isAll;

    let htmlContent = ""; 

    if (isDateCol) {
        // 1. Group Dates by Year -> Month
        let dateTree = {};
        const monthNamesFull = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        uniqueVals.forEach(val => {
            if (val === "") return;
            let parts = val.split('-');
            if (parts.length === 3) {
                let day = parts[0];
                let mon = parts[1];
                let yr = parts[2];
                
                if (!dateTree[yr]) dateTree[yr] = {};
                if (!dateTree[yr][mon]) dateTree[yr][mon] = [];
                dateTree[yr][mon].push(val);
            }
        });

        // Sort Years Descending (Latest first)
        let sortedYears = Object.keys(dateTree).sort((a, b) => b.localeCompare(a));

        sortedYears.forEach(yr => {
            let yrId = "yr_" + Math.random().toString(36).substr(2, 6);
            htmlContent += `
                <div class="filter-item tree-year-node">
                    <span class="tree-toggle-btn" onclick="toggleTreeBranch(this)">▶</span>
                    <input type="checkbox" value="yr_${yr}" class="cb-filter cb-year" id="${yrId}" onchange="toggleYearGroup(this, '${yr}')" ${isAll ? 'checked' : ''}>
                    <label for="${yrId}">${yr}</label>
                </div>
                <div class="tree-children" id="children_${yrId}">
            `;

            let sortedMonths = Object.keys(dateTree[yr]).sort((a, b) => monthNamesFull.indexOf(a) - monthNamesFull.indexOf(b));
            
            sortedMonths.forEach(mon => {
                let monId = "mon_" + Math.random().toString(36).substr(2, 6);
                htmlContent += `
                    <div class="filter-item tree-month-node">
                        <span class="tree-toggle-btn" onclick="toggleTreeBranch(this)">▶</span>
                        <input type="checkbox" value="mon_${yr}_${mon}" class="cb-filter cb-month" id="${monId}" onchange="toggleMonthGroup(this, '${yr}', '${mon}')" ${isAll ? 'checked' : ''}>
                        <label for="${monId}">${mon} ${yr}</label>
                    </div>
                    <div class="tree-children" id="children_${monId}">
                `;

                dateTree[yr][mon].forEach(val => {
                    let isChecked = isAll || selected.includes(val);
                    let safeVal = val.replace(/"/g, '&quot;');
                    let safeId = "f_" + Math.random().toString(36).substr(2, 9);
                    let parts = val.split('-');
                    let dispDate = `${parts[2]} - ${parts[1]} - ${parts[0]}`; // 14 - Jun - 2025

                    htmlContent += `
                        <div class="filter-item tree-leaf-node">
                            <input type="checkbox" value="${safeVal}" class="cb-filter cb-date leaf-node" data-yr="${yr}" data-mon="${mon}" id="${safeId}" ${isChecked ? 'checked' : ''}>
                            <label for="${safeId}">${dispDate}</label>
                        </div>
                    `;
                });
                htmlContent += `</div>`; // End Month Children
            });
            htmlContent += `</div>`; // End Year Children
        });

        // Handle Blank values if any
        if (uniqueVals.includes("")) {
            let isChecked = isAll || selected.includes("");
            htmlContent += `
                <div class="filter-item">
                    <input type="checkbox" value="" class="cb-filter leaf-node" id="f_blank" ${isChecked ? 'checked' : ''}>
                    <label for="f_blank">(Blank)</label>
                </div>
            `;
        }

    } else {
        // Standard Flat Filter for Non-Date Columns
        uniqueVals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
        uniqueVals.forEach(val => {
            let isChecked = isAll || selected.includes(val);
            let disp = val === "" ? "(Blank)" : val;
            let safeVal = val.replace(/"/g, '&quot;'); 
            let safeId = "f_" + Math.random().toString(36).substr(2, 9); 
            
            htmlContent += `
                <div class="filter-item">
                    <input type="checkbox" value="${safeVal}" class="cb-filter" id="${safeId}" ${isChecked ? 'checked' : ''}>
                    <label for="${safeId}">${disp}</label>
                </div>
            `;
        });
    }
    
    list.innerHTML = htmlContent;

    let rect;
    if (e && e.currentTarget) {
        rect = e.currentTarget.getBoundingClientRect();
    } else {
        let th = document.querySelector(`th[data-colname="${colName}"]`);
        if(th) rect = th.getBoundingClientRect();
    }

    if (rect) {
        menu.style.position = "fixed";
        menu.style.top = (rect.bottom + 5) + "px";
        menu.style.left = rect.left + "px";
    }
    menu.style.display = "block";
}

// Helper functions for Tree View Expand/Collapse and Selection
function toggleTreeBranch(btn) {
    let nextDiv = btn.parentElement.nextElementSibling;
    if (nextDiv && nextDiv.classList.contains('tree-children')) {
        nextDiv.classList.toggle('show');
        btn.classList.toggle('expanded', nextDiv.classList.contains('show'));
    }
}

function toggleYearGroup(checkbox, yr) {
    let container = document.getElementById(`children_` + checkbox.id);
    if(container) {
        let childCbs = container.querySelectorAll('input[type="checkbox"]');
        childCbs.forEach(cb => cb.checked = checkbox.checked);
    }
}

function toggleMonthGroup(checkbox, yr, mon) {
    let container = document.getElementById(`children_` + checkbox.id);
    if(container) {
        let childCbs = container.querySelectorAll('input[type="checkbox"]');
        childCbs.forEach(cb => cb.checked = checkbox.checked);
    }
}

document.getElementById("filterSelectAll").addEventListener("change", function() {
    document.querySelectorAll(".cb-filter").forEach(cb => cb.checked = this.checked);
});

document.getElementById("filterSearchInput").addEventListener("keyup", function() {
    let q = this.value.toLowerCase();
    document.querySelectorAll("#filterChecklist .filter-item").forEach(div => {
        div.style.display = div.innerText.toLowerCase().includes(q) ? "flex" : "none";
    });
});

function closeExcelFilter() { document.getElementById("excelFilterMenu").style.display = "none"; }

function applyExcelFilter() {
    let selected = [];
    let total = 0, checked = 0;
    document.querySelectorAll(".cb-filter").forEach(cb => {
        total++;
        if(cb.checked) { selected.push(cb.value); checked++; }
    });
    
    if(checked === total || checked === 0) headerFilters[currentFilterCol] = [];
    else headerFilters[currentFilterCol] = selected;
    
    closeExcelFilter();
    applyFiltersAndRender();
}

function applySort(dir) {
    sortConfig = { key: currentFilterCol, dir: dir };
    closeExcelFilter();
    applyFiltersAndRender();
}

function clearAllFilters() {
    headerFilters = {};
    sortConfig = null;
    applyFiltersAndRender();
    showToast("Filters Cleared");
}

// =======================
// MISC FUNCTIONS
// =======================
function openAddEntryModal() {
    document.getElementById("dynamicFormFields").innerHTML = "";
    headersInfo.forEach(h => {
        if(h.name.toUpperCase() !== "SN") {
            document.getElementById("dynamicFormFields").innerHTML += `
                <div style="display:flex; flex-direction:column;">
                    <label style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:5px;">${h.name}</label>
                    <input type="${h.type === 'date' ? 'date' : 'text'}" class="modal-input new-entry-input" data-col="${h.name}" />
                </div>
            `;
        }
    });
    document.getElementById("entryModalOverlay").style.display = "flex";
}

async function submitNewEntry() {
    let rowDataObj = {};
    document.querySelectorAll(".new-entry-input").forEach(inp => {
        rowDataObj[inp.dataset.col] = inp.value;
    });
    
    try {
        const res = await fetch("/api/add-row", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ rowDataObj })
        });
        const data = await res.json();
        if(data.success) {
            closeModal("entryModalOverlay");
            showToast("Row Added!");
            fetchData();
        } else {
            showToast(data.message, "error");
        }
    } catch(e) {
        showToast("Failed to add entry", "error");
    }
}

function exportToExcel() {
    let ws = XLSX.utils.json_to_sheet(masterData);
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MasterData");
    XLSX.writeFile(wb, "Master_Database.xlsx");
}

function showActiveUsers(e) {
    e.stopPropagation();
    Swal.fire({
        title: "Active Users",
        html: `🟢 ${currentUser.username}`,
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000
    });
}

// =======================
// COLUMN RESIZING LOGIC
// =======================
function initColumnResizers() {
    const resizers = document.querySelectorAll('.resizer');
    let currentResizer = null;
    let startX = 0;
    let startWidth = 0;

    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', function(e) {
            e.stopPropagation(); // Prevent sorting/filter menu
            currentResizer = e.target;
            startX = e.pageX;
            startWidth = currentResizer.parentElement.offsetWidth;
            
            document.addEventListener('mousemove', resizeColumn);
            document.addEventListener('mouseup', stopResize);
            currentResizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
        });
    });

    function resizeColumn(e) {
        if (!currentResizer) return;
        const newWidth = Math.max(50, startWidth + (e.pageX - startX)); // Minimum 50px width
        currentResizer.parentElement.style.width = `${newWidth}px`;
    }

    function stopResize() {
        if (!currentResizer) return;
        
        let colName = currentResizer.dataset.col;
        let finalWidth = currentResizer.parentElement.offsetWidth;
        
        currentResizer.classList.remove('resizing');
        document.removeEventListener('mousemove', resizeColumn);
        document.removeEventListener('mouseup', stopResize);
        document.body.style.cursor = 'default';
        currentResizer = null;

        // Save new width
        saveColumnWidth(colName, finalWidth);
    }
}

async function saveColumnWidth(colName, width) {
    // Update local config
    let colInfo = headersInfo.find(c => c.name === colName);
    if(colInfo) colInfo.width = width;

    // Call Backend API to save width permanently
    try {
        await fetch("/api/update-col-width", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ colName: colName, width: `${width}px` })
        });
    } catch(e) {
        console.error("Failed to save column width");
    }
}

// =======================
// ALIGNMENT, WRAP & HEADER CONTEXT MENU
// =======================
let globalAlign = "left";
let globalWrap = false;
let targetContextCol = "";

function setGlobalAlign(align) {
    globalAlign = align;
    applyFiltersAndRender();
    showToast(`Global alignment set to ${align}`, "info");
}

function toggleGlobalWrap() {
    globalWrap = !globalWrap;
    applyFiltersAndRender();
    showToast(`Global Text Wrap: ${globalWrap ? 'ON' : 'OFF'}`, "info");
}

// List of mandatory/fixed columns that cannot be deleted
const FIXED_COLUMNS = [
    "SN", "PLATE NUMBER", "SITE", "STATUS", "COMPANY", "CUSTOMER", "IF SUB", 
    "WORK START", "LAST WORKING DAY", "DAYS WORKED", "EQUIPMENT REACHED AT SITE", 
    "RELEASE DATE", "REPLACED DATE", "OLD DRIVER NAME", "OD MOB", "OD WRK END", 
    "DRIVER NAME", "MOBILE"
];

function openHeaderContextMenu(e, colName) {
    if (colName.toUpperCase() === "SN") return; // Prevent options on SN column
    e.preventDefault();
    targetContextCol = colName;
    
    // Show/Hide Delete Option based on role and fixed columns
    let deleteBtn = document.getElementById("ctxDeleteColBtn");
    if (deleteBtn) {
        let isFixed = FIXED_COLUMNS.includes(colName.trim().toUpperCase());
        if (currentUser.role === "Super Admin" && !isFixed) {
            deleteBtn.style.display = "flex";
        } else {
            deleteBtn.style.display = "none";
        }
    }

    let menu = document.getElementById("headerContextMenu");
    // Changed to clientY and clientX for fixed positioning to avoid scroll offset bugs
    menu.style.top = e.clientY + "px";
    menu.style.left = e.clientX + "px";
    menu.style.display = "block";
}

// Unified Global Click Listener
document.addEventListener("click", (e) => {
    // 1. Close User Profile Dropdown
    if(!e.target.closest(".user-dropdown-container")) {
        document.getElementById("userDropdownMenu").classList.remove("show");
    }
    
    // 2. Close Excel Filter Menu (Prevent hiding if clicked from context menu)
    if(!e.target.closest(".excel-filter-menu") && !e.target.classList.contains("filter-icon") && !e.target.closest(".custom-context-menu")) {
        let filterMenu = document.getElementById("excelFilterMenu");
        if (filterMenu) filterMenu.style.display = "none";
    }
    
    // 3. Close Header Context Menu
    if(!e.target.closest(".custom-context-menu")) {
        let ctxMenu = document.getElementById("headerContextMenu");
        if (ctxMenu) ctxMenu.style.display = "none";
    }
});

async function handleHeaderAction(action) {
    let col = headersInfo.find(c => c.name === targetContextCol);
    if (!col) return;

    // Ensure Context Menu hides immediately on any action
    document.getElementById("headerContextMenu").style.display = "none";

    if (action === "filter") {
        openFilterMenu(null, col.name); // Call filter menu without mouse event
    }
    else if (action === "hide") {
        col.visible = false;
        applyFiltersAndRender();
        showToast(`${col.name} column hidden. Use Visibility icon to restore.`, "info");
    } 
    else if (action === "wrap") {
        col.wrap = col.wrap === undefined ? !globalWrap : !col.wrap;
        applyFiltersAndRender();
    } 
    else if (action.startsWith("align_")) {
        let alignVal = action.split("_")[1];
        col.align = alignVal;
        applyFiltersAndRender();
        
        // Save to Database (Admin Only check handled backend)
        try {
            await fetch("/api/admin/set-alignment", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ colName: col.name, alignment: alignVal })
            });
        } catch(e) { console.error("Could not save alignment"); }
    } 
    else if (action === "add_left" || action === "add_right") {
        if(currentUser.role !== "Super Admin" && currentUser.role !== "Admin") {
            return showToast("Admin access required to add columns.", "error");
        }
        let pos = action === "add_left" ? "left" : "right";
        
        // Save the target column and position, then open the modal
        relativeColAction = { target: col.name, position: pos };
        openColModal(true);
    } 
    else if (action === "delete") {
        if(currentUser.role !== "Super Admin") return showToast("Super Admin access required.", "error");

        Swal.fire({
            title: `Delete '${col.name}'?`,
            text: "Enter Super Admin Password to confirm. This action will hide the column.",
            input: 'password',
            inputAttributes: { autocapitalize: 'off' },
            showCancelButton: true,
            confirmButtonText: 'Delete Column',
            confirmButtonColor: 'var(--danger)',
            cancelButtonColor: '#64748b'
        }).then(async (result) => {
            if (result.isConfirmed && result.value) {
                try {
                    const res = await fetch("/api/admin/delete-column", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ colName: col.name, adminPassword: result.value })
                    });
                    const data = await res.json();
                    if(data.success) {
                        showToast(data.message, "success");
                        fetchData(); // Reload full structure from database
                    } else {
                        showToast(data.message, "error");
                    }
                } catch(e) {
                    showToast("Failed to delete column.", "error");
                }
            }
        });
    }
}