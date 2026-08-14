function toggleView(type) {
    document.getElementById('loginForm').style.display = type === 'login' ? 'block' : 'none';
    document.getElementById('signupForm').style.display = type === 'signup' ? 'block' : 'none';
    showAlert('', '');
}

function showAlert(msg, type) {
    const box = document.getElementById('alertBox');
    if (!box) return;
    if (!msg) { box.style.display = 'none'; return; }
    box.className = `alert alert-${type}`;
    box.innerText = msg;
    box.style.display = 'block';
}

async function handleLogin() {
    const username = document.getElementById('loginUser').value;
    const password = document.getElementById('loginPass').value;

    if (!username || !password) {
        showAlert('Please enter both username and password', 'error');
        return;
    }

    try {
const res = await fetch('/api/own-equipment/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
});
        const data = await res.json();

        if (res.ok) {
            // Equipment Tracker നായി സ്വന്തമായി ടോക്കണും യൂസറും സേവ് ചെയ്യുന്നു
            if (data.token) {
                localStorage.setItem('eq_token', data.token);
            }
            localStorage.setItem('eq_user', JSON.stringify(data.user));

            window.location.href = 'Dashboard.html';
        } else {
            showAlert(data.message, 'error');
        }
    } catch (err) {
        showAlert('Server error! Please try again later.', 'error');
    }
}

async function handleSignup() {
    const username = document.getElementById('signupUser').value;
    const password = document.getElementById('signupPass').value;

    if (!username || !password) {
        showAlert('Please enter username and password', 'error');
        return;
    }

    try {
        const res = await fetch('/api/own-equipment/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
            showAlert('Registration request submitted! Please wait for Admin approval.', 'success');
            toggleView('login');
        } else {
            showAlert(data.message, 'error');
        }
    } catch (err) {
        showAlert('Server error! Please try again later.', 'error');
    }
}

function clearAuthForms() {
    const fields = [
        'loginUser',
        'loginPass',
        'signupUser',
        'signupPass'
    ];

    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    showAlert('', '');
}

// Normal page load + browser Back/Forward restore
window.addEventListener('pageshow', function () {
    clearAuthForms();
});
