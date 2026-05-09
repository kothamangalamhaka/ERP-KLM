let allData = [];
let activeFilters = {};
let currentFilterCol = "";

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (token) {
        document.getElementById('loader').style.display = 'block';
        try {
            const res = await fetch('/billing/verify-session', {
                headers: { 'Authorization': `Bearer ${token}` }
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
            localStorage.setItem('token', data.token);
            loadApp();
        } else {
            alert(data.message || "Invalid Credentials!");
        }
    } catch (err) { alert("Server Error"); }
}

function executeLogout() {
    localStorage.removeItem('token');
    window.location.reload();
}

function loadApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainAppContainer').style.display = 'block';
    fetchDashboardData();
}

function fetchDashboardData() {
    const token = localStorage.getItem('token');
    fetch('/billing/dashboard-data', {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => {
            if (!res.ok) throw new Error("Unauthorized");
            return res.json();
        })
        .then(data => {
            document.getElementById('loader').style.display = 'none';
            if (data.success) {
                allData = data.data;
                renderTable();
                attachHeaderListeners();
            }
        })
        .catch(err => {
            document.getElementById('loader').innerText = 'Session Expired. Please Login.';
            setTimeout(executeLogout, 2000);
        });
}

function renderTable() {
    const tbody = document.getElementById('dashboardBody');
    tbody.innerHTML = '';
    document.getElementById('dashboardTable').style.display = 'table';

    let filtered = allData.filter(row => {
        for (let col in activeFilters) {
            if (activeFilters[col].length > 0 && !activeFilters[col].includes(String(row[col] || "-"))) {
                return false;
            }
        }
        return true;
    });

    filtered.forEach(row => {
        let tr = document.createElement('tr');
        // 🟢 Reordered: Month -> Site -> Owner -> Plate
        tr.innerHTML = `
            <td style="color:#1a4d80;">${row.billing_month || '-'}</td>
            <td style="font-weight:bold; color:#d62828;">${row.site_name || '-'}</td>
            <td style="font-weight:normal;">${row.owner || '-'}</td>
            <td>${row.plate_no || '-'}</td>
            <td>${row.nhr || 0}</td>
            <td>${row.othr || 0}</td>
            <td class="money">${parseFloat(row.rent || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td class="money">${parseFloat(row.vat_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td style="font-size:11px;">${row.adjustment_desc || '-'}</td>
            <td class="money">${parseFloat(row.adjusted_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td class="money grand-total">${parseFloat(row.after_adjustment || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        `;
        tbody.appendChild(tr);
    });
}

function attachHeaderListeners() {
    document.querySelectorAll('th[data-col]').forEach(th => {
        th.onclick = (e) => {
            const col = th.getAttribute('data-col');
            openFilterMenu(e, col);
        };
    });
}

function openFilterMenu(e, col) {
    e.stopPropagation();
    currentFilterCol = col;
    const menu = document.getElementById('filterMenu');
    const optionsContainer = document.getElementById('filterOptions');
    document.getElementById('filterSearch').value = '';

    const visibleOptionsData = allData.filter(row => {
        for (let c in activeFilters) {
            if (c === col) continue;
            if (activeFilters[c].length > 0 && !activeFilters[c].includes(String(row[c] || "-"))) return false;
        }
        return true;
    });

    const uniqueValues = [...new Set(visibleOptionsData.map(row => String(row[col] || "-")))].sort();

    optionsContainer.innerHTML = '';
    uniqueValues.forEach(val => {
        const isChecked = activeFilters[col] && activeFilters[col].includes(val);
        optionsContainer.innerHTML += `
            <label class="filter-item">
                <input type="checkbox" value="${val}" ${isChecked ? 'checked' : ''}>
                <span>${val}</span>
            </label>
        `;
    });

    menu.style.display = 'block';

    let leftPos = e.pageX;
    if (leftPos + 250 > window.innerWidth) {
        leftPos = window.innerWidth - 270;
    }

    menu.style.top = (e.pageY + 10) + "px";
    menu.style.left = leftPos + "px";
}

function filterCheckboxes() {
    const search = document.getElementById('filterSearch').value.toLowerCase();
    document.querySelectorAll('.filter-item').forEach(item => {
        const text = item.innerText.toLowerCase();
        item.style.display = text.includes(search) ? 'flex' : 'none';
    });
}

function applyFilters() {
    const selected = Array.from(document.querySelectorAll('#filterOptions input:checked')).map(cb => cb.value);
    activeFilters[currentFilterCol] = selected;

    const th = document.querySelector(`th[data-col="${currentFilterCol}"] .filter-icon`);
    if (selected.length > 0) th.style.color = "#2563eb";
    else th.style.color = "#cbd5e1";

    document.getElementById('filterMenu').style.display = 'none';
    renderTable();
}

function clearFilters() {
    activeFilters[currentFilterCol] = [];
    const th = document.querySelector(`th[data-col="${currentFilterCol}"] .filter-icon`);
    if (th) th.style.color = "#cbd5e1";
    document.getElementById('filterMenu').style.display = 'none';
    renderTable();
}

window.onclick = () => document.getElementById('filterMenu').style.display = 'none';
document.getElementById('filterMenu').onclick = (e) => e.stopPropagation();

async function exportToExcel() {
    const token = localStorage.getItem('token');
    const monthFilter = activeFilters['billing_month'] && activeFilters['billing_month'].length === 1 ? activeFilters['billing_month'][0] : 'All';
    const btn = document.querySelector('.btn-excel');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Downloading...';
    btn.disabled = true;

    try {
        const res = await fetch(`/billing/export-excel?month=${encodeURIComponent(monthFilter)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Download Failed!");

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        let sheetName = monthFilter === 'All' ? 'All_Months' : monthFilter;
        a.download = `Billing_${sheetName.replace(/ /g, '_')}.xlsx`;

        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        console.error(error);
        alert("Export Failed! Access Denied or Session Expired.");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}