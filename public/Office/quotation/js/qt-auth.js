function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("qt_theme", next);
  } catch (e) {}
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById("themeBtn");
  if (!btn) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  btn.innerHTML =
    current === "dark"
      ? '<i class="fas fa-sun"></i>'
      : '<i class="fas fa-moon"></i>';
}

function toggleView(type) {
  document.getElementById("loginForm").style.display =
    type === "login" ? "block" : "none";
  document.getElementById("signupForm").style.display =
    type === "signup" ? "block" : "none";
  showAlert("", "");
}

function showAlert(msg, type) {
  const box = document.getElementById("alertBox");
  if (!box) return;
  if (!msg) {
    box.style.display = "none";
    return;
  }
  box.className = `alert alert-${type}`;
  box.innerText = msg;
  box.style.display = "block";
}

async function handleQtLogin() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;

  if (!username || !password) {
    showAlert("Please enter both username and password", "error");
    return;
  }

  try {
    const res = await fetch("/api/own-equipment/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (res.ok) {
      if (data.token) {
        localStorage.setItem("qt_token", data.token);
      }
      localStorage.setItem(
        "qt_user",
        JSON.stringify(data.user || { username }),
      );
      window.location.replace(window.qtSession.getLoginDestination());
    } else {
      showAlert(data.message || "Invalid credentials", "error");
    }
  } catch (err) {
    showAlert("Server error! Please try again later.", "error");
  }
}

async function handleQtSignup() {
  const username = document.getElementById("signupUser").value.trim();
  const password = document.getElementById("signupPass").value;

  if (!username || !password) {
    showAlert("Please enter username and password", "error");
    return;
  }

  try {
    const res = await fetch("/api/own-equipment/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (res.ok) {
      showAlert(
        "Registration request submitted! Please wait for Admin approval.",
        "success",
      );
      toggleView("login");
    } else {
      showAlert(data.message || "Signup failed", "error");
    }
  } catch (err) {
    showAlert("Server error! Please try again later.", "error");
  }
}

function clearAuthForms() {
  ["loginUser", "loginPass", "signupUser", "signupPass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  showAlert("", "");
}

window.addEventListener("pageshow", function () {
  if (localStorage.getItem("qt_token")) {
    window.location.replace(window.qtSession.getLoginDestination());
    return;
  }
  clearAuthForms();
});

document.addEventListener("DOMContentLoaded", () => {
  updateThemeIcon();
  if (localStorage.getItem("qt_token")) {
    window.location.replace(window.qtSession.getLoginDestination());
    return;
  }

  ["loginUser", "loginPass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleQtLogin();
      });
    }
  });

  ["signupUser", "signupPass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleQtSignup();
      });
    }
  });
});
