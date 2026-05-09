let journalEntries = [];

// Filter System Variables
let activeTableFilters = {};
let currentFilterCol = "";

function showToast(msg, bg = '#10b981') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast'; t.style.background = bg;
    t.innerHTML = msg; c.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// 🟢 Login Logic
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('expense_token')) {
        loadApp();
    } else {
        document.getElementById('loginUserId').focus();
    }
});

async function executeLogin() {
    const userid = document.getElementById('loginUserId').value;
    const password = document.getElementById('loginPass').value;

    if (!userid || !password) return showToast("Enter credentials", "#ef4444");

    try {
        const res = await fetch('/expenses/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userid, password })
        });
        const data = await res.json();

        if (data.success) {
            sessionStorage.setItem('expense_token', data.token);
            loadApp();
        } else {
            showToast("Invalid Credentials!", "#ef4444");
            document.getElementById('loginPass').value = '';
        }
    } catch (err) {
        showToast("Server Connection Error.", "#ef4444");
    }
}

function executeLogout() {
    sessionStorage.removeItem('expense_token');
    window.location.reload();
}

async function loadApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appMain').style.display = 'block';
    await loadDataFromServer();
}

// 🟢 API Logic
async function loadDataFromServer() {
    const token = sessionStorage.getItem('expense_token');
    if (!token) return executeLogout();

    try {
        const res = await fetch('/expenses', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Unauthorized");

        const data = await res.json();
        journalEntries = data.map(item => ({
            id: item.id, date: item.entry_date, particulars: item.particulars,
            category: item.entry_type, source: item.ledger_head, amount: parseFloat(item.amount)
        }));
        renderTable();
    } catch (e) {
        showToast("Session Expired. Please login.", "#ef4444");
        executeLogout();
    }
}

function openEntryModal(editData = null) {
    if (editData) {
        document.getElementById('modalTitle').innerText = "Edit Transaction";
        document.getElementById('editId').value = editData.id;
        document.getElementById('popDate').value = editData.date;
        document.getElementById('popAmount').value = editData.amount;
        document.getElementById('popCategory').value = editData.category;
        document.getElementById('popSource').value = editData.source;
        document.getElementById('popParticulars').value = editData.particulars;
    } else {
        document.getElementById('modalTitle').innerText = "New Transaction";
        document.getElementById('editId').value = "";
        document.getElementById('popDate').valueAsDate = new Date();
        document.getElementById('popAmount').value = '';
        document.getElementById('popParticulars').value = '';
    }
    document.getElementById('entryModal').classList.add('active');
}

function openDeleteConfirm(id) {
    document.getElementById('deleteTargetId').value = id;
    document.getElementById('deleteConfirmKey').value = '';
    document.getElementById('deleteModal').classList.add('active');
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// 🟢 DIRECT DATABASE SAVE
async function handleEntrySave() {
    const editId = document.getElementById('editId').value;
    const entry = {
        date: document.getElementById('popDate').value,
        amount: parseFloat(document.getElementById('popAmount').value) || 0,
        type: document.getElementById('popCategory').value,
        ledger: document.getElementById('popSource').value,
        particulars: document.getElementById('popParticulars').value.trim()
    };

    if (!entry.particulars || entry.amount <= 0) return showToast('Check Details!', '#ef4444');

    const token = sessionStorage.getItem('expense_token');
    const btn = document.getElementById('saveBtnAction');
    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        let url = editId ? `/expenses/update/${editId}` : '/expenses/add';
        let method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(entry)
        });

        if (res.ok) {
            showToast(editId ? "Updated Successfully!" : "Saved Successfully!");
            closeModal('entryModal');
            await loadDataFromServer();
        } else {
            throw new Error('Server Error');
        }
    } catch (err) {
        showToast("Failed to save to database.", "#ef4444");
    } finally {
        btn.innerText = 'Save to DB';
        btn.disabled = false;
    }
}

// 🟢 SECURE DATABASE DELETE
async function executeDelete() {
    const id = document.getElementById('deleteTargetId').value;
    const key = document.getElementById('deleteConfirmKey').value;

    if (!key) return showToast("Enter Security Key!", "#ef4444");

    const token = sessionStorage.getItem('expense_token');
    const btn = document.getElementById('deleteBtnAction');
    btn.innerText = 'Deleting...';
    btn.disabled = true;

    try {
        const res = await fetch(`/expenses/delete/${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ key: key }) // 🟢 Send key to backend securely
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast("Deleted from Database!", "#f97316");
            closeModal('deleteModal');
            await loadDataFromServer();
        } else {
            showToast(data.message || "Failed to delete.", "#ef4444");
        }
    } catch (err) {
        showToast("Failed to delete.", "#ef4444");
    } finally {
        btn.innerText = 'Delete Now';
        btn.disabled = false;
    }
}

// 🟢 Formatter for filtering
function getFormattedValue(entry, col) {
    if (col === 'date') return new Date(entry.date).toLocaleDateString('en-GB');
    if (col === 'amount') return "₹ " + entry.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    return String(entry[col] || "");
}

// 🟢 Unified Filter & Render Logic
function renderTable() {
    // 1. Filter by Date Range
    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;
    let filtered = journalEntries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));

    // 2. Filter by Excel Columns
    filtered = filtered.filter(row => {
        for (let col in activeTableFilters) {
            if (activeTableFilters[col].length > 0) {
                let val = getFormattedValue(row, col);
                if (!activeTableFilters[col].includes(val)) return false;
            }
        }
        return true;
    });

    // 3. Render Table
    const tbody = document.getElementById('gridBody');
    tbody.innerHTML = '';
    const dataToRender = filtered.slice().reverse();

    dataToRender.forEach(e => {
        let badgeClass = 'bg-orange';
        if (e.category === 'Office Account' || e.category === 'Opening Balance') badgeClass = 'bg-green';
        else if (e.category.includes('Settlement')) badgeClass = 'bg-blue';
        else if (e.category === 'Expense' || e.category === 'Office Rent' || e.category === 'Office Electricity') badgeClass = 'bg-red';

        let catBadge = `<span class="badge ${badgeClass}">${e.category}</span>`;
        let escapedEntry = JSON.stringify(e).replace(/'/g, "&apos;").replace(/"/g, '&quot;');

        tbody.innerHTML += `
            <tr>
                <td>${new Date(e.date).toLocaleDateString('en-GB')}</td>
                <td style="font-weight:500;">${e.particulars}</td>
                <td>${catBadge}</td>
                <td><span class="badge bg-purple">${e.source}</span></td>
                <td style="text-align: right; font-weight: 600;">₹ ${e.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: center;" class="action-col no-export">
                    <button class="edit-btn" onclick='openEntryModal(${escapedEntry})'><i class="fas fa-pencil-alt"></i></button>
                    <button class="del-btn" onclick="openDeleteConfirm('${e.id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
    });
    calculateDashboard(dataToRender);
}

// 🟢 Compact Dashboard Calculation
function calculateDashboard(data) {
    let officeBal = 0, staffDue = 0, creditDue = 0, ajilsInvestment = 0;
    let rentTotal = 0, electTotal = 0, generalTotal = 0;

    data.forEach(e => {
        const amt = e.amount;

        // 1. Calculate Expenses Breakdown
        if (e.category === 'Office Rent') rentTotal += amt;
        else if (e.category === 'Office Electricity') electTotal += amt;
        else if (e.category === 'Expense' || e.category === 'Purchase') generalTotal += amt;

        // 2. Logic for Balances and Dues
        if (e.category === 'Opening Balance' || e.category === 'Office Account') {
            officeBal += amt;
            if (e.source === 'Ajils Account') ajilsInvestment += amt;
            if (e.source === 'Office Staff') staffDue += amt;
        }
        else if (e.category === 'Expense' || e.category === 'Purchase' || e.category === 'Office Rent' || e.category === 'Office Electricity') {
            if (e.source === 'Office Account') officeBal -= amt;
            if (e.source === 'Office Staff') staffDue += amt;
            if (e.source === 'Credit') creditDue += amt;
            if (e.source === 'Ajils Account') ajilsInvestment += amt;
        }
        else if (e.category.includes('Settlement')) {
            if (e.source === 'Office Account') officeBal -= amt;
            if (e.source === 'Ajils Account') ajilsInvestment += amt;
            if (e.category === 'Settlement - Staff') staffDue -= amt;
            if (e.category === 'Settlement - Credit') creditDue -= amt;
        }
    });

    let totalExp = rentTotal + electTotal + generalTotal;

    // 🟢 4 Compact Cards
    document.getElementById('reportGrid').innerHTML = `
        <div class="dash-card border-blue">
            <h4>🏢 Office A/c Balance</h4><p>₹ ${officeBal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <div class="dash-card border-orange">
            <h4>👨‍💼 Staff Due</h4><p>₹ ${staffDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <div class="dash-card border-purple">
            <h4>🛒 Credit Purchases</h4><p>₹ ${creditDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <div class="dash-card border-green">
            <h4>💼 MD - Ajils K S</h4><p>₹ ${ajilsInvestment.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>`;

    // 🟢 Single Line Total Expense Strip
    document.getElementById('totalStrip').innerHTML = `
        <div class="total-strip">
            <div class="strip-main">
                <i class="fas fa-chart-line"></i> <b>TOTAL EXPENSE:</b> <span>₹ ${totalExp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div class="strip-breakdown">
                <span>Office Rent: ₹ ${rentTotal.toLocaleString('en-IN')}</span>
                <span>Office Electricity: ₹ ${electTotal.toLocaleString('en-IN')}</span>
                <span>General Expenses: ₹ ${generalTotal.toLocaleString('en-IN')}</span>
            </div>
        </div>`;
}

// 🟢 Excel Style Filter Logic
function openFilterMenu(e, col) {
    e.stopPropagation();
    currentFilterCol = col;
    const menu = document.getElementById('filterMenu');
    const optionsContainer = document.getElementById('filterOptions');
    document.getElementById('filterSearch').value = '';

    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;
    let baseData = journalEntries.filter(entry => (!from || entry.date >= from) && (!to || entry.date <= to));

    const visibleOptionsData = baseData.filter(row => {
        for (let c in activeTableFilters) {
            if (c === col) continue;
            if (activeTableFilters[c].length > 0 && !activeTableFilters[c].includes(getFormattedValue(row, c))) return false;
        }
        return true;
    });

    const uniqueValues = [...new Set(visibleOptionsData.map(row => getFormattedValue(row, col)))].sort();

    optionsContainer.innerHTML = '';
    uniqueValues.forEach(val => {
        const isChecked = activeTableFilters[col] && activeTableFilters[col].includes(val);
        optionsContainer.innerHTML += `
            <label class="filter-item">
                <input type="checkbox" value="${val}" ${isChecked ? 'checked' : ''}>
                <span>${val}</span>
            </label>
        `;
    });

    menu.style.display = 'block';
    let leftPos = e.pageX;
    if (leftPos + 220 > window.innerWidth) leftPos = window.innerWidth - 240;
    menu.style.top = (e.pageY + 15) + "px";
    menu.style.left = leftPos + "px";
}

function filterCheckboxes() {
    const search = document.getElementById('filterSearch').value.toLowerCase();
    document.querySelectorAll('.filter-item').forEach(item => {
        const text = item.innerText.toLowerCase();
        item.style.display = text.includes(search) ? 'flex' : 'none';
    });
}

function applyTableFilters() {
    const selected = Array.from(document.querySelectorAll('#filterOptions input:checked')).map(cb => cb.value);
    activeTableFilters[currentFilterCol] = selected;

    const th = document.querySelector(`th[data-col="${currentFilterCol}"] .filter-icon`);
    if (th) th.style.color = selected.length > 0 ? "#2563eb" : "#cbd5e1";

    document.getElementById('filterMenu').style.display = 'none';
    renderTable();
}

function clearTableFilters() {
    activeTableFilters[currentFilterCol] = [];
    const th = document.querySelector(`th[data-col="${currentFilterCol}"] .filter-icon`);
    if (th) th.style.color = "#cbd5e1";
    document.getElementById('filterMenu').style.display = 'none';
    renderTable();
}

window.onclick = () => document.getElementById('filterMenu').style.display = 'none';
document.getElementById('filterMenu').onclick = (e) => e.stopPropagation();

// 🟢 Download Methods (Image & Excel)
function downloadImage() {
    document.querySelectorAll('.no-export').forEach(el => el.style.display = 'none');
    document.getElementById('toolbarArea').style.display = 'none';
    html2canvas(document.getElementById('ledgerContent'), { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = 'KLM_Report.png'; link.href = canvas.toDataURL(); link.click();
        document.querySelectorAll('.no-export').forEach(el => el.style.display = '');
        document.getElementById('toolbarArea').style.display = 'flex';
    });
}

function exportToExcel() {
    const token = sessionStorage.getItem('expense_token');
    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;

    let url = `/expenses/export-excel?token=${token}`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;

    window.location.href = url;
}