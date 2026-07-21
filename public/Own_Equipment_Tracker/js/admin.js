document.addEventListener('DOMContentLoaded', () => {
    loadPendingUsers();
});

async function loadPendingUsers() {
    try {
        const res = await fetch('/api/own-equipment/admin/pending-users');
        const users = await res.json();
        const tbody = document.getElementById('userTable');
        
        if (!tbody) return;
        tbody.innerHTML = '';

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No pending approval requests.</td></tr>`;
            return;
        }

        users.forEach(u => {
            tbody.innerHTML += `
                <tr>
                    <td>${u.id}</td>
                    <td>${u.username}</td>
                    <td><span style="color:orange; font-weight:bold;">${u.status}</span></td>
                    <td>
                        <button class="btn-approve" onclick="updateStatus(${u.id}, 'approved')">Approve</button>
                        <button class="btn-reject" onclick="updateStatus(${u.id}, 'rejected')">Reject</button>
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error('Error fetching pending users:', err);
    }
}

async function updateStatus(id, status) {
    try {
        const res = await fetch('/api/own-equipment/admin/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status })
        });

        if (res.ok) {
            loadPendingUsers();
        } else {
            alert('Failed to update status.');
        }
    } catch (err) {
        console.error('Error updating status:', err);
    }
}