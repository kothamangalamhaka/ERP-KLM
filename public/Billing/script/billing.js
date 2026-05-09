const companyData = {
    "Haka": { header: "https://i.ibb.co/Ld752yD5/hd.png", seal: "https://i.ibb.co/mrLFJdBy/sl.png", text: "Prepared & Approved by Haka Accounts", signature: "https://i.ibb.co/CK8X4YpV/Screenshot-2026-03-28-111438.png" },
    "Aljoda": { header: "https://i.ibb.co/3yMwhgD5/Screenshot-2026-03-28-103621.png", seal: "https://i.ibb.co/4gRPdGXc/Screenshot-2026-03-28-103653.png", text: "Prepared & Approved by Aljoda Sara Rentals Accounts", signature: "https://i.ibb.co/Z1b8gCwT/Screenshot-2026-03-28-111323.png" },
    "Masar Wheels": { header: "https://i.ibb.co/gM7QnS59/Screenshot-2026-03-28-103016.png", seal: "https://i.ibb.co/Y63vHZ9/Screenshot-2026-03-28-103341.png", text: "Prepared & Approved by Masar Wheels Accounts", signature: "https://i.ibb.co/bMPNp3SJ/Screenshot-2026-03-28-111529.png" },
    "We1 Track": { header: "https://i.ibb.co/4w55CkbM/Screenshot-2026-03-28-103434.png", seal: "https://i.ibb.co/XfybvXzL/Screenshot-2026-03-28-103519.png", text: "Prepared & Approved by We1 Track Accounts", signature: "https://i.ibb.co/pBmhnB2j/Screenshot-2026-03-28-111612.png" }
};

let masterData = [];
let savedBillingData = [];
let filteredData = [];

let isRatesAndVatHidden = true;
let isRatesOnlyHidden = false;
let isVatOnlyHidden = false;
let isRentHidden = false;
let isImagesHidden = true;
let isAdjEnabled = false;

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');

    if (token) {
        document.getElementById('loader').style.display = 'flex';

        try {
            const res = await fetch('/billing/verify-session', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            document.getElementById('loader').style.display = 'none';

            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    loadApp();
                } else {
                    executeLogout();
                }
            } else {
                executeLogout();
            }
        } catch (err) {
            document.getElementById('loader').style.display = 'none';
            console.error("Session verification failed:", err);
            executeLogout();
        }
    } else {
        document.getElementById('loginUserId').focus();
    }
});

async function executeLogin() {
    const username = document.getElementById('loginUserId').value;
    const password = document.getElementById('loginPass').value;

    if (!username || !password) return alert("Enter credentials");

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (data.success) {
            if (data.user.role === 'Viewer') {
                alert("Access Denied: Viewers cannot access billing.");
                return;
            }
            localStorage.setItem('token', data.token);
            loadApp();
        } else {
            alert(data.message || "Invalid Credentials!");
            document.getElementById('loginPass').value = '';
        }
    } catch (err) {
        alert("Server Connection Error.");
    }
}

function executeLogout() {
    localStorage.removeItem('token');
    window.location.reload();
}

function loadApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainAppContainer').style.display = 'block';

    document.getElementById('hideRatesToggle').checked = true;

    initMonth();
    addRow();
    changeCompany();
    applyHiddenColumns();
}

function resetForm() {
    document.getElementById('tableBody').innerHTML = '';
    document.getElementById('adjBody').innerHTML = '';

    addRow();
    if (isAdjEnabled) addAdjRow();
    updateGrandTotal();

    document.getElementById('ownerSelector').value = 'All';
    document.getElementById('selectedOwnerText').innerText = 'All Owners';
    document.getElementById('siteSelector').value = 'All';

    filterData('all');
    showToast("Table Cleared!");
}

function toggleOwnerDropdown() {
    let opts = document.getElementById('ownerOptions');
    opts.classList.toggle('show');
    if (opts.classList.contains('show')) {
        let searchInput = document.getElementById('ownerSearchInput');
        searchInput.value = '';
        filterOwnerDropdownSearch();
        searchInput.focus();
    }
}

function selectOwner(val, text) {
    document.getElementById('ownerSelector').value = val;
    document.getElementById('selectedOwnerText').innerText = text;
    document.getElementById('ownerOptions').classList.remove('show');
    filterData('owner');
}

function filterOwnerDropdownSearch() {
    let filter = document.getElementById('ownerSearchInput').value.toUpperCase();
    let items = document.getElementById('ownerListContainer').getElementsByClassName('custom-dropdown-item');
    for (let i = 0; i < items.length; i++) {
        let txtValue = items[i].textContent || items[i].innerText;
        items[i].style.display = (txtValue.toUpperCase().indexOf(filter) > -1) ? "" : "none";
    }
}

function toggleImages() {
    isImagesHidden = !isImagesHidden;
    const header = document.getElementById('mainHeaderImage');
    const seal = document.getElementById('mainSealImage');
    const signArea = document.getElementById('footerSignArea');
    const btn = document.getElementById('btnToggleImages');

    if (isImagesHidden) {
        header.classList.add('hidden-image');
        seal.classList.add('hidden-image');
        signArea.classList.add('hidden-image');
        btn.innerText = 'Show Images';
        btn.style.backgroundColor = '#6f42c1';
    } else {
        header.classList.remove('hidden-image');
        seal.classList.remove('hidden-image');
        signArea.classList.remove('hidden-image');
        btn.innerText = 'Hide Images';
        btn.style.backgroundColor = '#20c997';
    }
}

function toggleRatesAndVatView() {
    isRatesAndVatHidden = document.getElementById('hideRatesToggle').checked;
    if (isRatesAndVatHidden) {
        document.getElementById('hideRatesOnlyToggle').checked = false;
        document.getElementById('hideVatOnlyToggle').checked = false;
        isRatesOnlyHidden = false;
        isVatOnlyHidden = false;
    }
    applyHiddenColumns();
}

function toggleRatesOnlyView() {
    isRatesOnlyHidden = document.getElementById('hideRatesOnlyToggle').checked;
    if (isRatesOnlyHidden) {
        document.getElementById('hideRatesToggle').checked = false;
        isRatesAndVatHidden = false;
    }
    applyHiddenColumns();
}

function toggleVatOnlyView() {
    isVatOnlyHidden = document.getElementById('hideVatOnlyToggle').checked;
    if (isVatOnlyHidden) {
        document.getElementById('hideRatesToggle').checked = false;
        isRatesAndVatHidden = false;
    }
    applyHiddenColumns();
}

function toggleRentView() {
    isRentHidden = document.getElementById('hideRentToggle').checked;
    applyHiddenColumns();
}

function applyHiddenColumns(skipCalculate = false) {
    document.querySelectorAll('.rate-col').forEach(el => {
        if (isRatesAndVatHidden || isRatesOnlyHidden) el.classList.add('hidden-export');
        else el.classList.remove('hidden-export');
    });

    document.querySelectorAll('.vat-col').forEach(el => {
        if (isRatesAndVatHidden || isVatOnlyHidden) el.classList.add('hidden-export');
        else el.classList.remove('hidden-export');
    });

    document.querySelectorAll('.total-col').forEach(el => {
        if (isRatesAndVatHidden || isVatOnlyHidden) el.classList.add('hidden-export');
        else el.classList.remove('hidden-export');
    });

    document.querySelectorAll('.rent-col').forEach(el => {
        if (isRentHidden) el.classList.add('hidden-export');
        else el.classList.remove('hidden-export');
    });

    if (!skipCalculate) {
        calculateAll();
    }
}

function toggleAdjustments() {
    isAdjEnabled = !isAdjEnabled;
    document.getElementById('adjustmentsSection').style.display = isAdjEnabled ? 'block' : 'none';
    if (isAdjEnabled && document.getElementById('adjBody').rows.length === 0) addAdjRow();
    updateGrandTotal();
}

function initMonth() {
    const optsContainer = document.getElementById('monthOptions');
    optsContainer.innerHTML = '';
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    let currentD = new Date();
    let currentYear = currentD.getFullYear();
    let currentMonth = currentD.getMonth();
    let startYear = 2026;
    let startMonth = 0;

    for (let y = startYear; y <= currentYear; y++) {
        let mStart = (y === startYear) ? startMonth : 0;
        let mEnd = (y === currentYear) ? currentMonth : 11;

        for (let m = mStart; m <= mEnd; m++) {
            let value = `${months[m]} ${y}`;
            optsContainer.innerHTML += `<div class="custom-dropdown-item" onclick="selectMonth('${value}')">${value}</div>`;
        }
    }
    optsContainer.innerHTML += `<div class="custom-dropdown-item custom-dropdown-add" onclick="addNewMonth()">➕ Add New</div>`;
    selectMonth(`${months[currentMonth]} ${currentYear}`);
}

function toggleMonthDropdown() {
    document.getElementById('monthOptions').classList.toggle('show');
}

function selectMonth(val) {
    document.getElementById('selectedMonthText').innerText = val;
    document.getElementById('monthOptions').classList.remove('show');
    updateTableDates();
}

function addNewMonth() {
    let newVal = prompt("Enter new Month & Year (e.g., May 2026):");
    if (newVal && newVal.trim() !== "") selectMonth(newVal.trim());
}

document.addEventListener('click', function (e) {
    if (!e.target.closest('#monthDropdownContainer')) {
        let monthOpts = document.getElementById('monthOptions');
        if (monthOpts) monthOpts.classList.remove('show');
    }
    if (!e.target.closest('#ownerDropdownContainer')) {
        let ownerOpts = document.getElementById('ownerOptions');
        if (ownerOpts) ownerOpts.classList.remove('show');
    }
});

function getShortDate() {
    let val = document.getElementById('selectedMonthText').innerText.trim();
    if (!val || val === "Loading...") return "";
    let parts = val.split(' ');
    if (parts.length >= 2) return parts[0].substring(0, 3) + " " + parts[1].substring(2, 4);
    return val;
}

function updateTableDates() {
    let shortDate = getShortDate();
    document.querySelectorAll('.date-cell').forEach(cell => {
        if (!cell.querySelector('input')) cell.innerText = shortDate;
    });
}

function changeCompany() {
    const selectedCompany = document.getElementById('companySelector').value;
    const data = companyData[selectedCompany];
    if (data) {
        document.getElementById('mainHeaderImage').src = data.header;
        document.getElementById('mainSealImage').src = data.seal;
        document.getElementById('footerText').innerText = data.text;
        document.getElementById('mainSignatureImage').src = data.signature;
    }
}

function goToDashboard() {
    window.location.href = '/billing/dashboard';
}

function fetchDataFromERP() {
    const fullMonth = document.getElementById('selectedMonthText').innerText.trim();
    const token = localStorage.getItem('token');

    if (!fullMonth || fullMonth === "Loading...") {
        return showToast("Please select a valid month.");
    }

    document.getElementById('loader').style.display = 'flex';

    fetch('/billing/vehicles?month=' + encodeURIComponent(fullMonth), {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => {
            if (!res.ok) throw new Error("Session Expired or Unauthorized");
            return res.json();
        })
        .then(data => {
            if (data.success) {
                masterData = [];
                savedBillingData = data.saved_bills || [];

                data.data.forEach(item => {
                    let plate = item.plate_number || "";
                    let savedForPlate = savedBillingData.filter(s => s.plate_no === plate);

                    if (savedForPlate.length > 0) {
                        let seenSites = new Set();
                        savedForPlate.forEach(savedItem => {
                            let siteKey = (savedItem.site_name || item.site || "").trim().toUpperCase();
                            if (!seenSites.has(siteKey)) {
                                seenSites.add(siteKey);
                                masterData.push({
                                    plate: plate.toUpperCase(),
                                    owner: item.owner || "",
                                    site: savedItem.site_name || item.site || "",
                                    driver: item.driver_name || "",
                                    vtype: item.vehicle_type || "",
                                    nrate: item.nrate || 0,
                                    otrate: item.otrate || 0,
                                    vat_bill: item.vat_bill || "No",
                                    active_sites: item.active_sites || [],
                                    saved_ref: savedItem,
                                    is_saved: true
                                });
                            }
                        });
                    } else {
                        masterData.push({
                            plate: plate.toUpperCase(),
                            owner: item.owner || "",
                            site: item.site || "",
                            driver: item.driver_name || "",
                            vtype: item.vehicle_type || "",
                            nrate: item.nrate || 0,
                            otrate: item.otrate || 0,
                            vat_bill: item.vat_bill || "No",
                            active_sites: item.active_sites || [],
                            is_saved: false
                        });
                    }
                });

                filteredData = [...masterData];

                const owners = [...new Set(masterData.map(m => m.owner).filter(o => o !== ""))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                const ownerListContainer = document.getElementById('ownerListContainer');
                ownerListContainer.innerHTML = '';

                let allDiv = document.createElement('div');
                allDiv.className = 'custom-dropdown-item';
                allDiv.textContent = 'All Owners';
                allDiv.onclick = function () { selectOwner('All', 'All Owners'); };
                ownerListContainer.appendChild(allDiv);

                owners.forEach(o => {
                    let div = document.createElement('div');
                    div.className = 'custom-dropdown-item';
                    div.textContent = o;
                    div.onclick = function () { selectOwner(o, o); };
                    ownerListContainer.appendChild(div);
                });

                const sites = [...new Set(masterData.map(m => m.site).filter(s => s !== ""))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                const siteSelect = document.getElementById('siteSelector');
                siteSelect.innerHTML = '<option value="All">All Sites</option>';

                sites.forEach(s => {
                    let opt = document.createElement('option');
                    opt.value = s;
                    opt.textContent = s;
                    siteSelect.appendChild(opt);
                });

                updateTableDates();
                filterData('init');

                if (masterData.length > 0) {
                    showToast(`Fetched ${masterData.length} entries & ${savedBillingData.length} saved bills!`);
                } else {
                    showToast("No running vehicles found in DB.");
                }
            } else {
                showToast("Backend Error: " + data.message);
            }
            document.getElementById('loader').style.display = 'none';
        })
        .catch(err => {
            document.getElementById('loader').style.display = 'none';
            showToast(err.message || "Server Connection Failed!");
            if (err.message.includes("Expired")) setTimeout(executeLogout, 2000);
        });
}

function filterData(source) {
    let selectedOwner = document.getElementById('ownerSelector').value;
    let selectedSite = document.getElementById('siteSelector').value;

    if (source === 'site' || source === 'init') {
        let validOwners = selectedSite === "All"
            ? [...new Set(masterData.map(m => m.owner).filter(o => o !== ""))]
            : [...new Set(masterData.filter(m => m.site === selectedSite).map(m => m.owner).filter(o => o !== ""))];

        validOwners.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        const ownerListContainer = document.getElementById('ownerListContainer');
        ownerListContainer.innerHTML = '';

        let allDiv = document.createElement('div');
        allDiv.className = 'custom-dropdown-item';
        allDiv.textContent = 'All Owners';
        allDiv.onclick = function () { selectOwner('All', 'All Owners'); };
        ownerListContainer.appendChild(allDiv);

        validOwners.forEach(o => {
            let div = document.createElement('div');
            div.className = 'custom-dropdown-item';
            div.textContent = o;
            div.onclick = function () { selectOwner(o, o); };
            ownerListContainer.appendChild(div);
        });

        if (selectedOwner !== "All" && !validOwners.includes(selectedOwner)) {
            document.getElementById('ownerSelector').value = "All";
            document.getElementById('selectedOwnerText').innerText = "All Owners";
            selectedOwner = "All";
        }
    }

    filteredData = masterData.filter(d => {
        let matchOwner = selectedOwner === "All" || d.owner === selectedOwner;
        let matchSite = selectedSite === "All" || d.site === selectedSite;
        return matchOwner && matchSite;
    });

    const tbody = document.getElementById('tableBody');

    if (selectedOwner !== "All" || selectedSite !== "All") {
        tbody.innerHTML = '';
        if (filteredData.length === 0) {
            addRow();
        } else {
            filteredData.forEach((match) => {
                let tr = addRow(true);
                let pInput = tr.querySelector('.plate');
                pInput.value = match.plate;
                autoFill(pInput, true);
            });
        }
        showToast(`Loaded ${filteredData.length} vehicles`);
    } else {
        tbody.innerHTML = '';
        addRow();
    }

    autoConfigureColumns();
    updateOwnerDisplay();
}

function addRow(returnElement = false) {
    const tbody = document.getElementById('tableBody');
    const rowCount = tbody.rows.length + 1;
    const tr = document.createElement('tr');

    const rateClass = (isRatesAndVatHidden || isRatesOnlyHidden) ? " hidden-export" : "";
    const vatClass = (isRatesAndVatHidden || isVatOnlyHidden) ? " hidden-export" : "";
    const totalClass = (isRatesAndVatHidden || isVatOnlyHidden) ? " hidden-export" : "";
    const rentClass = isRentHidden ? " hidden-export" : "";

    tr.innerHTML = `
<td class="row-num">${rowCount}</td>
<td class="date-cell">${getShortDate()}</td>
<td><input type="text" class="vtype" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td class="col-driver-cell"><input type="text" class="driver" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td class="no-export hidden-export" style="padding: 2px;">
    <select class="site-dropdown table-select" style="font-weight:bold; color:#1a4d80; width:100%;"><option value="N/A">N/A</option></select>
</td>
<td class="autocomplete-wrapper">
<input type="text" class="plate" oninput="showSuggestions(this)" onkeydown="handleGlobalKeyDown(event, this)" onblur="handlePlateBlur(this)" autocomplete="off">
<div class="suggestion-box"></div>
</td>
<td><input type="number" class="nhr" value="0" oninput="calculate(this)" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td class="rate-col${rateClass}"><input type="number" class="nrate" value="0" oninput="calculate(this)" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td><input type="number" class="othr" value="0" oninput="calculate(this)" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td class="rate-col${rateClass}"><input type="number" class="otrate" value="0" oninput="calculate(this)" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td class="rent-col${rentClass}"><input type="number" class="rent" value="0.00" oninput="calculateFromRent(this)" onkeydown="handleGlobalKeyDown(event, this)"></td>
<td class="vat-col no-export${vatClass}">
<select class="vat-rate table-select" onchange="calculate(this)">
    <option value="15">15%</option>
    <option value="0">0%</option>
</select>
</td>
<td class="vat vat-col${vatClass}">0.00</td>
<td class="total total-col${totalClass}">0.00</td>
<td class="no-export"><button type="button" class="btn-remove" onclick="removeRow(this)">✖</button></td>
`;
    tbody.appendChild(tr);

    if (returnElement) {
        return tr;
    }
}

function addAdjRow() {
    const tbody = document.getElementById('adjBody');
    const rowCount = tbody.rows.length + 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
<td class="adj-num">${rowCount}</td>
<td style="position: relative; padding: 0; cursor: pointer;">
 <span class="adj-date-display" style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; font-weight:bold; pointer-events:none;"></span>
 <input type="month" class="adj-date no-export-col" onchange="formatDateDisplay(this)" style="opacity:0; width:100%; height:100%; position:absolute; inset:0; cursor:pointer; margin:0; padding:0;">
</td>
<td class="autocomplete-wrapper">
<input type="text" class="plate adj-plate" oninput="showSuggestions(this)" onkeydown="handleGlobalKeyDown(event, this)" onblur="handlePlateBlur(this)" autocomplete="off">
<div class="suggestion-box"></div>
</td>
<td><input type="text" class="adj-desc" style="font-weight:bold;"></td>
<td><input type="number" class="adj-amt" value="0" oninput="updateGrandTotal()"></td>
<td class="no-export-col">
<select class="adj-type table-select" onchange="updateGrandTotal()"><option value="add">Add</option><option value="less">Less</option></select>
</td>
<td class="no-export"><button type="button" class="btn-remove" onclick="removeAdjRow(this)">✖</button></td>
`;
    tbody.appendChild(tr);
    updateGrandTotal();
}

function formatDateDisplay(input) {
    if (!input.value) {
        input.previousElementSibling.innerText = "";
        return;
    }
    const parts = input.value.split('-');
    if (parts.length === 2) {
        const year = parts[0].slice(-2);
        const monthIndex = parseInt(parts[1]) - 1;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        input.previousElementSibling.innerText = `${months[monthIndex]} ${year}`;
    }
}

function removeRow(btn) {
    try {
        let row = btn.closest('tr');
        if (row) row.remove();

        let tbody = document.getElementById('tableBody');
        if (tbody.rows.length === 0) {
            addRow();
        } else {
            Array.from(tbody.rows).forEach((r, index) => {
                let numCell = r.querySelector('.row-num');
                if (numCell) numCell.innerText = index + 1;
            });
        }

        updateGrandTotal();
        autoConfigureColumns();
        updateOwnerDisplay();
    } catch (e) {
        console.error("Error removing row:", e);
    }
}

function removeAdjRow(btn) {
    try {
        let row = btn.closest('tr');
        if (row) row.remove();

        let tbody = document.getElementById('adjBody');
        Array.from(tbody.rows).forEach((r, index) => {
            let numCell = r.querySelector('.adj-num');
            if (numCell) numCell.innerText = index + 1;
        });

        updateGrandTotal();
    } catch (e) {
        console.error("Error removing adj row:", e);
    }
}

function handleGlobalKeyDown(e, input) {
    if (input.classList.contains('plate') && navigateSuggestions(e, input)) return;

    const allowedKeys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'];
    if (!allowedKeys.includes(e.key)) return;

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && input.type === 'number') {
        e.preventDefault();
    }

    const td = input.closest('td');
    const tr = input.closest('tr');
    const colIndex = Array.from(tr.children).indexOf(td);
    let targetInput = null;

    if (e.key === 'ArrowRight') {
        const nextTd = td.nextElementSibling;
        if (nextTd) targetInput = nextTd.querySelector('input');
    } else if (e.key === 'ArrowLeft') {
        const prevTd = td.previousElementSibling;
        if (prevTd) targetInput = prevTd.querySelector('input');
    } else if (e.key === 'ArrowDown') {
        const nextTr = tr.nextElementSibling;
        if (nextTr) {
            const targetTd = nextTr.children[colIndex];
            if (targetTd) targetInput = targetTd.querySelector('input');
        }
    } else if (e.key === 'ArrowUp') {
        const prevTr = tr.previousElementSibling;
        if (prevTr) {
            const targetTd = prevTr.children[colIndex];
            if (targetTd) targetInput = targetTd.querySelector('input');
        }
    }

    if (targetInput) {
        e.preventDefault();
        targetInput.focus();
        if (targetInput.type === 'text' || targetInput.type === 'number') targetInput.select();
    }
}

function navigateSuggestions(e, input) {
    const box = input.parentElement.querySelector('.suggestion-box');
    if (!box || box.style.display === 'none') return false;

    let items = box.querySelectorAll('.suggestion-item');
    if (items.length === 0) return false;

    let activeIndex = -1;
    items.forEach((item, index) => {
        if (item.classList.contains('active')) activeIndex = index;
    });

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex++;
        if (activeIndex >= items.length) activeIndex = 0;
        setActive(items, activeIndex, box);
        return true;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex--;
        if (activeIndex < 0) activeIndex = items.length - 1;
        setActive(items, activeIndex, box);
        return true;
    } else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        input.value = activeIndex > -1 ? items[activeIndex].innerText : items[0].innerText;
        box.style.display = 'none';
        autoFill(input);

        if (e.key === 'ArrowRight' || e.key === 'Tab') {
            const td = input.closest('td');
            const nextTd = td.nextElementSibling;
            if (nextTd) {
                const targetInput = nextTd.querySelector('input');
                if (targetInput) {
                    targetInput.focus();
                    if (targetInput.type === 'text' || targetInput.type === 'number') targetInput.select();
                }
            }
        }
        return true;
    }
    return false;
}

function setActive(items, index, box) {
    items.forEach(item => item.classList.remove('active'));
    items[index].classList.add('active');

    const itemHeight = items[index].offsetHeight;
    const itemTop = items[index].offsetTop;

    if (itemTop < box.scrollTop) {
        box.scrollTop = itemTop;
    } else if (itemTop + itemHeight > box.scrollTop + box.offsetHeight) {
        box.scrollTop = itemTop + itemHeight - box.offsetHeight;
    }
}

function showSuggestions(input) {
    const val = input.value.trim().toUpperCase().replace(/\s+/g, '');
    const box = input.parentElement.querySelector('.suggestion-box');

    if (!val) {
        box.style.display = 'none';
        return;
    }

    const plates = [...new Set(filteredData.map(r => r.plate))];
    const matches = plates.filter(p => p && p.toUpperCase().replace(/\s+/g, '').includes(val));

    if (matches.length > 0) {
        box.innerHTML = '';
        matches.forEach((match, index) => {
            let div = document.createElement('div');
            div.className = 'suggestion-item';
            if (index === 0) div.classList.add('active');
            div.innerText = match;
            div.onmousedown = function (e) {
                e.preventDefault();
                input.value = match;
                box.style.display = 'none';
                autoFill(input);
            };
            box.appendChild(div);
        });
        box.style.display = 'block';
    } else {
        box.style.display = 'none';
    }
}

function handlePlateBlur(input) {
    setTimeout(() => {
        let box = input.parentElement.querySelector('.suggestion-box');
        if (box) box.style.display = 'none';
        autoFill(input);
    }, 200);
}

function autoFill(input, isAutoLoad = false) {
    const val = input.value.trim().toUpperCase().replace(/\s+/g, '');
    const row = input.closest('tr');

    if (!val || row.closest('table').id === 'adjTable') return;

    if (!isAutoLoad && input.dataset.lastPlate === val) return;
    input.dataset.lastPlate = val;

    const masterMatch = filteredData.find(r => r.plate && r.plate.toUpperCase().replace(/\s+/g, '') === val);
    const savedMatch = masterMatch && masterMatch.is_saved ? masterMatch.saved_ref : savedBillingData.find(r => r.plate_no && r.plate_no.toUpperCase().replace(/\s+/g, '') === val);

    let siteSelect = row.querySelector('.site-dropdown');
    siteSelect.innerHTML = '';

    let availableSites = [];
    if (masterMatch && masterMatch.active_sites && masterMatch.active_sites.length > 0) {
        availableSites = masterMatch.active_sites;
    } else {
        let fallbackSite = masterMatch ? masterMatch.site : (savedMatch ? savedMatch.site_name : "N/A");
        availableSites = [fallbackSite];
    }

    availableSites.forEach(site => {
        let opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        siteSelect.appendChild(opt);
    });

    if (savedMatch && savedMatch.site_name) {
        siteSelect.value = savedMatch.site_name;
    }

    if (availableSites.length <= 1) {
        siteSelect.style.appearance = 'none';
        siteSelect.style.pointerEvents = 'none';
        siteSelect.style.background = 'transparent';
    } else {
        siteSelect.style.appearance = 'auto';
        siteSelect.style.pointerEvents = 'auto';
        siteSelect.style.background = 'white';
    }

    if (savedMatch) {
        input.value = savedMatch.plate_no;
        row.querySelector('.vtype').value = savedMatch.vtype;
        row.querySelector('.driver').value = masterMatch ? masterMatch.driver : savedMatch.driver;
        row.querySelector('.nhr').value = parseFloat(savedMatch.nhr);

        let preciseNrate = parseFloat(savedMatch.nrate);
        let preciseOtrate = parseFloat(savedMatch.otrate);

        // Prioritize Timesheet calculated rate dynamically, else use saved DB rate
        if (masterMatch && masterMatch.nrate) {
            if (Math.abs(preciseNrate - masterMatch.nrate) < 0.05) preciseNrate = masterMatch.nrate;
            if (Math.abs(preciseOtrate - masterMatch.otrate) < 0.05) preciseOtrate = masterMatch.otrate;
        }

        row.querySelector('.nrate').value = preciseNrate;
        row.querySelector('.othr').value = parseFloat(savedMatch.othr);
        row.querySelector('.otrate').value = preciseOtrate;

        let vatRateDropdown = row.querySelector('.vat-rate');
        let savedVat = parseFloat(savedMatch.vat_percent);

        if (savedVat === 15 || savedVat === 0) {
            vatRateDropdown.value = String(savedVat);
        } else {
            vatRateDropdown.value = (masterMatch && masterMatch.vat_bill === "Yes") ? "15" : "0";
        }

    } else if (masterMatch) {
        input.value = masterMatch.plate;
        row.querySelector('.vtype').value = masterMatch.vtype;
        row.querySelector('.driver').value = masterMatch.driver;
        row.querySelector('.nhr').value = 0;
        row.querySelector('.nrate').value = masterMatch.nrate;
        row.querySelector('.othr').value = 0;
        row.querySelector('.otrate').value = masterMatch.otrate;

        let vatRateDropdown = row.querySelector('.vat-rate');
        vatRateDropdown.value = (masterMatch.vat_bill === "Yes") ? "15" : "0";
    }

    calculate(input);

    if (!isAutoLoad) {
        autoConfigureColumns(true);
        updateOwnerDisplay();

        const tbody = document.getElementById('tableBody');
        if (row === tbody.lastElementChild) {
            addRow();
        }
    }
}

function calculateAll() {
    document.querySelectorAll('#tableBody .nhr').forEach(input => calculate(input));
}

function calculate(input) {
    const row = input.closest('tr');
    const nhr = parseFloat(row.querySelector('.nhr').value) || 0;
    let nrate = parseFloat(row.querySelector('.nrate').value) || 0;
    const othr = parseFloat(row.querySelector('.othr').value) || 0;
    let otrate = parseFloat(row.querySelector('.otrate').value) || 0;

    if (input && !input.classList.contains('otrate')) {
        otrate = nrate * 0.7;
        row.querySelector('.otrate').value = otrate;
    }

    const rent = (nhr * nrate) + (othr * otrate);
    row.querySelector('.rent').value = rent.toFixed(2);

    const vatRate = parseFloat(row.querySelector('.vat-rate').value) || 0;

    let isVatDisabled = isRatesAndVatHidden || isVatOnlyHidden;
    let vat = (vatRate > 0 && !isVatDisabled) ? rent * (vatRate / 100) : 0;

    row.querySelector('.vat').innerText = vat.toFixed(2);
    row.querySelector('.total').innerText = (rent + vat).toFixed(2);

    updateGrandTotal();
}

function calculateFromRent(input) {
    const row = input.closest('tr');
    const rent = parseFloat(row.querySelector('.rent').value) || 0;

    row.querySelector('.nhr').value = 0;
    row.querySelector('.othr').value = 0;

    const vatRate = parseFloat(row.querySelector('.vat-rate').value) || 0;
    let isVatDisabled = isRatesAndVatHidden || isVatOnlyHidden;
    let vat = (vatRate > 0 && !isVatDisabled) ? rent * (vatRate / 100) : 0;

    row.querySelector('.vat').innerText = vat.toFixed(2);
    row.querySelector('.total').innerText = (rent + vat).toFixed(2);

    updateGrandTotal();
}

function updateGrandTotal() {
    let gRent = 0, gVat = 0, gTotal = 0, gNhr = 0, gOthr = 0;

    document.querySelectorAll('#tableBody tr').forEach(row => {
        if (!row.classList.contains('empty-row-hidden')) {
            gNhr += parseFloat(row.querySelector('.nhr').value) || 0;
            gOthr += parseFloat(row.querySelector('.othr').value) || 0;
            gRent += parseFloat(row.querySelector('.rent').value) || 0;
            gVat += parseFloat(row.querySelector('.vat').innerText) || 0;
            gTotal += parseFloat(row.querySelector('.total').innerText) || 0;
        }
    });

    document.getElementById('grandNHr').innerText = gNhr;
    document.getElementById('grandOTHr').innerText = gOthr;
    document.getElementById('grandRent').innerText = gRent.toFixed(2);
    document.getElementById('grandVat').innerText = gVat.toFixed(2);
    document.getElementById('grandTotal').innerText = gTotal.toFixed(2);

    let finalBal = gTotal;
    let totalAdj = 0;

    if (isAdjEnabled) {
        document.querySelectorAll('#adjBody tr').forEach(row => {
            let amt = parseFloat(row.querySelector('.adj-amt').value) || 0;
            let type = row.querySelector('.adj-type').value;
            if (type === 'add') {
                finalBal += amt;
                totalAdj += amt;
            } else {
                finalBal -= amt;
                totalAdj -= amt;
            }
        });
    }

    document.getElementById('adjGrandTotal').innerText = totalAdj.toFixed(2);
    document.getElementById('finalBalance').innerText = finalBal.toFixed(2);
}

function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg;
    t.className = "show";
    setTimeout(() => t.className = "", 3000);
}

function submitData() {
    const fullMonth = document.getElementById('selectedMonthText').innerText.trim();
    const token = localStorage.getItem('token');

    if (!fullMonth || fullMonth === "Loading...") {
        showToast("Please select Month first.");
        return;
    }

    const dataToUpdate = [];
    document.querySelectorAll('#tableBody tr').forEach(row => {
        const plate = row.querySelector('.plate').value.trim();

        if (plate) {
            let dbMatch = masterData.find(d => d.plate && d.plate.toUpperCase() === plate.toUpperCase());

            let siteVal = row.querySelector('.site-dropdown').value;
            let rentVal = parseFloat(row.querySelector('.rent').value) || 0;
            let vatPerc = parseFloat(row.querySelector('.vat-rate').value) || 0;
            let vatAmt = parseFloat(row.querySelector('.vat').innerText) || 0;

            if (isRatesAndVatHidden || isVatOnlyHidden) {
                vatPerc = 0;
                vatAmt = 0;
            }

            let totalVal = rentVal + vatAmt;
            let adjDescStr = "";
            let adjAmtTotal = 0;

            if (isAdjEnabled) {
                document.querySelectorAll('#adjBody tr').forEach(adjRow => {
                    let adjPlate = adjRow.querySelector('.adj-plate').value.trim();
                    if (adjPlate.toUpperCase() === plate.toUpperCase()) {
                        let rawDesc = adjRow.querySelector('.adj-desc').value.trim();
                        let formattedDate = adjRow.querySelector('.adj-date-display').innerText.trim();
                        let descWithDate = rawDesc ? `${rawDesc} - ${formattedDate}` : formattedDate;

                        let amt = parseFloat(adjRow.querySelector('.adj-amt').value) || 0;
                        let type = adjRow.querySelector('.adj-type').value;
                        if (type === 'less') amt = -Math.abs(amt);

                        adjDescStr += (adjDescStr ? ", " : "") + descWithDate;
                        adjAmtTotal += amt;
                    }
                });
            }

            let afterAdjustment = totalVal + adjAmtTotal;

            dataToUpdate.push({
                date: row.querySelector('.date-cell').innerText.trim(),
                owner: dbMatch ? dbMatch.owner : "",
                site_name: siteVal,
                db_rate: dbMatch ? dbMatch.original_rate : 0,
                vtype: row.querySelector('.vtype').value,
                driver: row.querySelector('.driver').value,
                plate: plate,
                nhr: parseFloat(row.querySelector('.nhr').value) || 0,
                nrate: parseFloat(row.querySelector('.nrate').value) || 0,
                othr: parseFloat(row.querySelector('.othr').value) || 0,
                otrate: parseFloat(row.querySelector('.otrate').value) || 0,
                rent: rentVal,
                vat_percent: vatPerc,
                vat_amount: vatAmt,
                total: totalVal,
                adjustment_desc: adjDescStr,
                adjusted_amount: adjAmtTotal,
                after_adjustment: afterAdjustment
            });
        }
    });

    if (dataToUpdate.length === 0) {
        showToast("No data to submit.");
        return;
    }

    document.getElementById('loader').style.display = 'flex';

    fetch('/billing/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ billing_period: fullMonth, items: dataToUpdate })
    })
        .then(res => {
            if (!res.ok) throw new Error("Unauthorized");
            return res.json();
        })
        .then(res => {
            document.getElementById('loader').style.display = 'none';
            showToast(res.success ? "Data saved to ERP Database!" : "Error: " + res.message);
        })
        .catch(err => {
            document.getElementById('loader').style.display = 'none';
            showToast("Error connecting to server. Is session expired?");
            if (err.message.includes("Unauthorized")) setTimeout(executeLogout, 2000);
        });
}

function getDynamicFileName() {
    let plates = [];
    document.querySelectorAll('#tableBody tr').forEach(row => {
        if (!row.classList.contains('empty-row-hidden')) {
            let p = row.querySelector('.plate');
            if (p && p.value.trim() !== "") plates.push(p.value.trim());
        }
    });

    if (isAdjEnabled) {
        document.querySelectorAll('#adjBody tr').forEach(row => {
            let p = row.querySelector('.adj-plate');
            if (p && p.value.trim() !== "") plates.push(p.value.trim());
        });
    }

    let uniquePlates = [...new Set(plates)];
    let fileNameStr = "Bill";

    if (uniquePlates.length === 1) {
        fileNameStr = uniquePlates[0];
    } else if (uniquePlates.length > 1) {
        let ownerName = document.getElementById('ownerSelector').value;
        if (ownerName && ownerName !== "All") {
            fileNameStr = ownerName;
        } else {
            fileNameStr = document.getElementById('companySelector').value + "_Multiple";
        }
    } else {
        fileNameStr = document.getElementById('companySelector').value;
    }

    let shortDate = getShortDate().replace(' ', '_');
    fileNameStr = fileNameStr.replace(/[^a-zA-Z0-9_ -]/g, '_');

    return fileNameStr + '_' + shortDate + '.png';
}

function hideElementsForExport() {
    document.querySelectorAll('.no-export').forEach(el => el.style.display = 'none');

    let grandTotalTd = document.querySelector('#billTable tfoot td');
    if (grandTotalTd) grandTotalTd.setAttribute('colspan', '5');

    document.querySelectorAll('.adj-date').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.adj-date-display').forEach(el => el.style.display = 'flex');

    document.querySelectorAll('#tableBody tr').forEach(row => {
        let pInput = row.querySelector('.plate');
        if (pInput && pInput.value.trim() === "") {
            row.classList.add('empty-row-hidden');
        } else {
            let inputsToWrap = row.querySelectorAll('.driver, .vtype, .plate, .nhr, .nrate, .othr, .otrate, .rent');
            inputsToWrap.forEach(input => {
                const span = document.createElement('span');
                span.className = 'temp-export-span';

                if (input.classList.contains('nrate') || input.classList.contains('otrate') || input.classList.contains('rent')) {
                    let numVal = parseFloat(input.value);
                    span.innerText = isNaN(numVal) ? "0.00" : numVal.toFixed(2);
                } else {
                    span.innerText = input.value;
                }

                span.style.display = 'block';
                span.style.width = '100%';
                span.style.wordWrap = 'break-word';
                span.style.whiteSpace = 'normal';
                span.style.fontSize = '13px';
                span.style.lineHeight = '1.2';
                span.style.padding = '4px 2px';
                input.style.display = 'none';
                input.parentNode.appendChild(span);
            });
        }
    });

    let hideOwnerCheck = document.getElementById('hideOwnerToggle');
    let ownerDisplay = document.getElementById('billOwnerDisplay');
    if (hideOwnerCheck && hideOwnerCheck.checked && ownerDisplay) {
        ownerDisplay.style.display = 'none';
    }
}

function showElementsAfterExport() {
    document.querySelectorAll('.no-export').forEach(el => el.style.display = '');

    let grandTotalTd = document.querySelector('#billTable tfoot td');
    if (grandTotalTd) grandTotalTd.setAttribute('colspan', '6');

    document.querySelectorAll('.adj-date').forEach(el => el.style.display = 'block');
    document.querySelectorAll('.adj-date-display').forEach(el => el.style.display = 'none');

    document.querySelectorAll('.empty-row-hidden').forEach(row => row.classList.remove('empty-row-hidden'));
    document.querySelectorAll('.temp-export-span').forEach(el => el.remove());
    document.querySelectorAll('.driver, .vtype, .plate, .nhr, .nrate, .othr, .otrate, .rent').forEach(el => el.style.display = '');

    let ownerDisplay = document.getElementById('billOwnerDisplay');
    if (ownerDisplay) {
        ownerDisplay.style.display = '';
    }
}

async function exportImage() {
    hideElementsForExport();
    const element = document.getElementById('billContainer');
    const canvas = await html2canvas(element, { scale: 4, useCORS: true });
    showElementsAfterExport();

    const link = document.createElement('a');
    link.download = getDynamicFileName();
    link.href = canvas.toDataURL('image/png');
    link.click();
}

async function shareToWhatsApp() {
    hideElementsForExport();
    const element = document.getElementById('billContainer');
    const canvas = await html2canvas(element, { scale: 4, useCORS: true });
    showElementsAfterExport();

    const fileName = getDynamicFileName();

    canvas.toBlob(async (blob) => {
        try {
            const file = new File([blob], fileName, { type: 'image/png' });
            const shareData = { files: [file] };

            if (navigator.canShare && navigator.canShare(shareData)) {
                await navigator.share(shareData);
                showToast("Image shared successfully!");
            } else {
                const dataUrl = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = fileName;
                link.click();
                showToast("Direct sharing not supported on this browser. Image downloaded.");
            }
        } catch (error) {
            console.error('Sharing failed', error);
            showToast("Sharing cancelled or failed.");
        }
    }, 'image/png', 1.0);
}

function autoConfigureColumns(skipCalculate = false) {
    let hasVat = false;
    let rowCount = 0;

    document.querySelectorAll('#tableBody tr').forEach(row => {
        let pInput = row.querySelector('.plate');
        if (pInput && pInput.value.trim() !== "") {
            rowCount++;
            let match = masterData.find(m => m.plate === pInput.value.trim().toUpperCase());
            if (match && match.vat_bill === "Yes") {
                hasVat = true;
            }
        }
    });

    if (rowCount > 0) {
        if (hasVat) {
            document.getElementById('hideRatesOnlyToggle').checked = true;
            document.getElementById('hideRatesToggle').checked = false;
            document.getElementById('hideVatOnlyToggle').checked = false;
            isRatesOnlyHidden = true;
            isRatesAndVatHidden = false;
            isVatOnlyHidden = false;
        } else {
            document.getElementById('hideRatesToggle').checked = true;
            document.getElementById('hideRatesOnlyToggle').checked = false;
            document.getElementById('hideVatOnlyToggle').checked = false;
            isRatesAndVatHidden = true;
            isRatesOnlyHidden = false;
            isVatOnlyHidden = false;
        }
        applyHiddenColumns(skipCalculate);
    }
}

function updateOwnerDisplay() {
    let owners = [];

    document.querySelectorAll('#tableBody tr').forEach(row => {
        if (!row.classList.contains('empty-row-hidden')) {
            let pInput = row.querySelector('.plate');
            if (pInput && pInput.value.trim() !== "") {
                let match = masterData.find(m => m.plate === pInput.value.trim().toUpperCase());
                if (match && match.owner && match.owner.trim() !== "") {
                    owners.push(match.owner.trim());
                }
            }
        }
    });

    let uniqueOwners = [...new Set(owners)];
    let ownerNameStr = uniqueOwners.join(", ");

    let displayEl = document.getElementById('billOwnerDisplay');
    if (displayEl) {
        displayEl.innerText = ownerNameStr ? "OWNER : " + ownerNameStr : "";

        let toggleLabel = document.getElementById('hideOwnerToggle').closest('label');
        if (toggleLabel) {
            toggleLabel.style.display = ownerNameStr ? "flex" : "none";
        }
    }
}