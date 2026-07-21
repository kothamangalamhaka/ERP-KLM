document.addEventListener('DOMContentLoaded', () => {
    loadAllUsers();
});

async function loadAllUsers() {
    try {
        const res = await fetch('/api/own-equipment/admin/all-users');
        const users = await res.json();
        const tbody = document.getElementById('userTable');
        
        if (!tbody) return;
        tbody.innerHTML = '';

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No users found.</td></tr>`;
            return;
        }

        users.forEach(u => {
            let actions = '';
            
            // Primary Admin (ID 1) നെ തൊടാൻ പാടില്ല
            if (u.id === 1) {
                actions = '<span style="color:gray; font-weight:bold;">Primary Admin (No Actions)</span>';
            } else {
                if (u.role === 'super_admin') {
                    // Super Admin ആണെങ്കിൽ താഴേക്ക് മാറ്റാനുള്ള ഓപ്ഷൻ
                    actions += `<button style="background:#f39c12; color:white; border:none; padding:6px 12px; cursor:pointer; border-radius:4px; margin-right:5px;" onclick="demoteUser(${u.id})">Remove Admin</button>`;
                } else {
                    // Normal User ഓപ്ഷനുകൾ
                    if (u.status === 'pending') {
                        actions += `<button class="btn-approve" onclick="updateStatus(${u.id}, 'approved')">Approve</button>`;
                        actions += `<button class="btn-reject" onclick="updateStatus(${u.id}, 'rejected')">Reject</button>`;
                    } else if (u.status === 'approved') {
                        actions += `<button class="btn-reject" onclick="updateStatus(${u.id}, 'suspended')">Suspend</button>`;
                    } else {
                        actions += `<button class="btn-approve" onclick="updateStatus(${u.id}, 'approved')">Approve</button>`;
                    }

                    // Make Super Admin Button
                    actions += `<button style="background:#2980b9; color:white; border:none; padding:6px 12px; cursor:pointer; border-radius:4px; margin-right:5px;" onclick="makeSuperAdmin(${u.id})">Make Admin</button>`;
                }
                
                // ഡിലീറ്റ് ബട്ടൺ (ID 1 ഒഴികെ എല്ലാവർക്കും)
                actions += `<button class="btn-delete" onclick="deleteUser(${u.id})">Delete</button>`;
            }

            // സ്റ്റാറ്റസ് അനുസരിച്ച് കളർ കൊടുക്കുന്നു
            let statusColor = 'black';
            if (u.status === 'approved') statusColor = 'green';
            if (u.status === 'pending') statusColor = 'orange';
            if (u.status === 'suspended' || u.status === 'rejected') statusColor = 'red';

            tbody.innerHTML += `
                <tr>
                    <td>${u.id}</td>
                    <td><b>${u.username}</b></td>
                    <td style="text-transform: capitalize;">${u.role.replace('_', ' ')}</td>
                    <td><span style="color:${statusColor}; font-weight:bold; text-transform:capitalize;">${u.status}</span></td>
                    <td>${actions}</td>
                </tr>
            `;
        });
    } catch (err) {
        console.error('Error fetching users:', err);
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
            loadAllUsers();
        } else {
            alert('Failed to update status.');
        }
    } catch (err) {
        console.error('Error updating status:', err);
    }
}

async function makeSuperAdmin(id) {
    if (!confirm("Are you sure you want to promote this user to Super Admin?")) return;
    
    try {
        const res = await fetch('/api/own-equipment/admin/make-super-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        if (res.ok) {
            loadAllUsers();
        } else {
            alert('Failed to promote user.');
        }
    } catch (err) {
        console.error('Error promoting user:', err);
    }
}

async function demoteUser(id) {
    if (!confirm("Are you sure you want to remove Super Admin rights from this user?")) return;
    
    try {
        const res = await fetch('/api/own-equipment/admin/demote-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        if (res.ok) {
            loadAllUsers();
        } else {
            alert('Failed to remove admin rights.');
        }
    } catch (err) {
        console.error('Error demoting user:', err);
    }
}

async function deleteUser(id) {
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
    
    try {
        const res = await fetch(`/api/own-equipment/admin/delete-user/${id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            loadAllUsers();
        } else {
            alert('Failed to delete user.');
        }
    } catch (err) {
        console.error('Error deleting user:', err);
    }
}