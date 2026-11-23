let registeredEqFaceDescriptor = null;
let activeEqFaceAction = null;
let eqRfTempCreds = null;
let eqCamStream = null;
let eqCaptureTimer = null;
let eqLivenessPassed = false;
let isEqProcessing = false;

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

async function handleLogin() {
  const username = document.getElementById("loginUser").value;
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
      // Equipment Tracker നായി സ്വന്തമായി ടോക്കണും യൂസറും സേവ് ചെയ്യുന്നു
      if (data.token) {
        localStorage.setItem("eq_token", data.token);
      }
      localStorage.setItem("eq_user", JSON.stringify(data.user));

      window.location.replace(
        window.ownEquipmentSession.getLoginDestination(),
      );
    } else {
      showAlert(data.message, "error");
    }
  } catch (err) {
    showAlert("Server error! Please try again later.", "error");
  }
}

async function handleSignup() {
  const username = document.getElementById("signupUser").value;
  const password = document.getElementById("signupPass").value;

  if (!username || !password) {
    showAlert("Please enter username and password", "error");
    return;
  }

  try {
    const res = await fetch("/api/own-equipment/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        faceDescriptor: registeredEqFaceDescriptor,
      }),
    });
    const data = await res.json();

    if (res.ok) {
      clearAuthForms();
      toggleView("login");
      showAlert(
        "Registration request submitted! Please wait for Admin approval.",
        "success",
      );
    } else {
      showAlert(data.message, "error");
    }
  } catch (err) {
    showAlert("Server error! Please try again later.", "error");
  }
}

function clearAuthForms() {
  const fields = ["loginUser", "loginPass", "signupUser", "signupPass"];

  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  registeredEqFaceDescriptor = null;
  const regFaceBtn = document.getElementById("regFaceBtn");
  const regFaceStatus = document.getElementById("regFaceStatus");
  if (regFaceBtn) {
    regFaceBtn.style.background = "";
    regFaceBtn.innerText = "📷 Capture Face for Signup";
  }
  if (regFaceStatus) {
    regFaceStatus.style.display = "none";
  }

  showAlert("", "");
}

// ---------- ERP Face Lock Rule (Direct Camera Face Capture - No MediaPipe) ----------
function executeFaceLogin() {
  startEqFaceAuth("login");
}

function openEqResetFaceModal() {
  document.getElementById("eqRfUsername").value = "";
  document.getElementById("eqRfPassword").value = "";
  document.getElementById("eqResetVerifyModal").style.display = "flex";
}

function closeEqResetFaceModal() {
  document.getElementById("eqResetVerifyModal").style.display = "none";
  eqRfTempCreds = null;
}

function eqBufToB64Url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function eqB64UrlToBuf(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

async function verifyAndStartEqFaceReset() {
  const username = document.getElementById("eqRfUsername").value.trim();
  const password = document.getElementById("eqRfPassword").value;

  if (!username || !password) {
    closeEqResetFaceModal();
    showAlert("Enter both username and password.", "error");
    return;
  }

  if (!window.PublicKeyCredential) {
    closeEqResetFaceModal();
    showAlert("Open via HTTPS (https://fefei.tail129892.ts.net:5000) to enable Windows Hello.", "error");
    return;
  }

  try {
    const optRes = await fetch("/api/own-equipment/auth/webauthn/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const optData = await optRes.json();
    if (!optData.success) {
      closeEqResetFaceModal();
      showAlert(optData.message || "Invalid credentials.", "error");
      return;
    }

    const opts = optData.options;
    opts.challenge = eqB64UrlToBuf(opts.challenge);
    opts.user.id = eqB64UrlToBuf(opts.user.id);
    if (opts.excludeCredentials) {
      opts.excludeCredentials = opts.excludeCredentials.map((c) => ({
        ...c,
        id: eqB64UrlToBuf(c.id),
      }));
    }

    const cred = await navigator.credentials.create({ publicKey: opts });
    const credential = {
      id: cred.id,
      rawId: eqBufToB64Url(cred.rawId),
      type: cred.type,
      response: {
        attestationObject: eqBufToB64Url(cred.response.attestationObject),
        clientDataJSON: eqBufToB64Url(cred.response.clientDataJSON),
        transports: cred.response.getTransports ? cred.response.getTransports() : ["internal"],
      },
    };

    const verRes = await fetch("/api/own-equipment/auth/webauthn/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: optData.userId, credential }),
    });
    const verData = await verRes.json();
    closeEqResetFaceModal();

    if (verData.success) {
      localStorage.setItem("eq_webauthn_enabled", "1");
      const faceBtn = document.querySelector(".face-corner-btn");
      if (faceBtn) faceBtn.style.display = "flex";
      showAlert(verData.message, "success");
    } else {
      showAlert(verData.message || "Biometric setup failed.", "error");
    }
  } catch (err) {
    closeEqResetFaceModal();
    showAlert(err.message || "Windows Hello cancelled or unavailable.", "error");
  }
}

async function executeEqWebAuthnLogin() {
  if (!window.PublicKeyCredential) {
    showAlert("Open via HTTPS (https://fefei.tail129892.ts.net:5000) for Windows Hello.", "error");
    return;
  }
  try {
    const optRes = await fetch("/api/own-equipment/auth/webauthn/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const optData = await optRes.json();
    if (!optData.success) {
      showAlert(optData.message || "Failed to start Windows Hello.", "error");
      return;
    }

    const challengeB64 = optData.options.challenge;
    const opts = optData.options;
    opts.challenge = eqB64UrlToBuf(opts.challenge);

    const assertion = await navigator.credentials.get({ publicKey: opts });
    const credential = {
      id: assertion.id,
      rawId: eqBufToB64Url(assertion.rawId),
      type: assertion.type,
      response: {
        authenticatorData: eqBufToB64Url(assertion.response.authenticatorData),
        clientDataJSON: eqBufToB64Url(assertion.response.clientDataJSON),
        signature: eqBufToB64Url(assertion.response.signature),
        userHandle: assertion.response.userHandle ? eqBufToB64Url(assertion.response.userHandle) : null,
      },
    };

    const verRes = await fetch("/api/own-equipment/auth/webauthn/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, challenge: challengeB64 }),
    });
    const verData = await verRes.json();

    if (verData.success && verData.token) {
      localStorage.setItem("eq_token", verData.token);
      localStorage.setItem("eq_user", JSON.stringify(verData.user));
      window.location.replace(window.ownEquipmentSession.getLoginDestination());
    } else {
      showAlert(verData.message || "Biometric login failed.", "error");
    }
  } catch (err) {
    showAlert("Windows Hello cancelled or not registered on this device.", "error");
  }
}

async function startEqFaceAuth(action) {
  closeEqUniversalFace();

  activeEqFaceAction = action;
  const modal = document.getElementById("eqUniversalFaceModal");
  const video = document.getElementById("eqUniversalVideo");
  const instruction = document.getElementById("eqUniversalInstruction");
  const title = document.getElementById("eqFaceModalTitle");

  title.innerText =
    action === "login"
      ? "Face Login"
      : action === "register"
        ? "Register Face ID"
        : "Reset Face ID";
  modal.style.display = "flex";
  eqLivenessPassed = false;
  isEqProcessing = false;
  instruction.innerText = "Opening Camera...";
  instruction.style.color = "#38bdf8";

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API unavailable on this connection.");
    }

    eqCamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = eqCamStream;
    await video.play();

    instruction.innerText = "Scanning face... Look straight at the camera";
    instruction.style.color = "#4ade80";

    if (eqCaptureTimer) clearTimeout(eqCaptureTimer);
    eqCaptureTimer = setTimeout(async () => {
      if (!eqCamStream || eqLivenessPassed || isEqProcessing) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        eqLivenessPassed = true;
        instruction.innerText = "Capturing & Verifying...";
        await handleEqFaceCapture(video);
      } else {
        video.addEventListener(
          "loadeddata",
          async () => {
            if (!eqCamStream || eqLivenessPassed || isEqProcessing) return;
            eqLivenessPassed = true;
            instruction.innerText = "Capturing & Verifying...";
            await handleEqFaceCapture(video);
          },
          { once: true },
        );
      }
    }, 1200);
  } catch (err) {
    console.error("Camera Init Error:", err);
    closeEqUniversalFace();
    showAlert(
      "Camera Error: " + (err.message || "Access denied or unavailable."),
      "error",
    );
  }
}

async function handleEqFaceCapture(frame) {
  isEqProcessing = true;
  const canvas = document.getElementById("eqUniversalCanvas");
  const vw = frame.videoWidth || 320;
  const vh = frame.videoHeight || 240;
  const scale = Math.min(1, 480 / Math.max(vw, vh));
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  const imageData = canvas.toDataURL("image/jpeg", 0.92);

  if (activeEqFaceAction === "login") {
    try {
      const res = await fetch("/py/own-equipment-face-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageData,
          face_trust_token: localStorage.getItem("eq_face_trust_token"),
        }),
      });
      const data = await res.json();
      closeEqUniversalFace();

      if (data.success) {
        if (data.token) {
          localStorage.setItem("eq_token", data.token);
        }
        localStorage.setItem("eq_user", JSON.stringify(data.user));
        window.location.replace(
          window.ownEquipmentSession.getLoginDestination(),
        );
      } else {
        showAlert(data.message || "Face recognition failed.", "error");
      }
    } catch (err) {
      closeEqUniversalFace();
      showAlert("Error connecting to server.", "error");
    }
  } else if (
    activeEqFaceAction === "register" ||
    activeEqFaceAction === "reset"
  ) {
    try {
      const res = await fetch("/py/face-encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData }),
      });
      const data = await res.json();
      closeEqUniversalFace();

      if (!data.success || !data.descriptor) {
        showAlert(
          data.message || "Failed to encode face. Please retry.",
          "error",
        );
        return;
      }

      if (activeEqFaceAction === "register") {
        registeredEqFaceDescriptor = data.descriptor;
        const regFaceBtn = document.getElementById("regFaceBtn");
        const regFaceStatus = document.getElementById("regFaceStatus");
        if (regFaceBtn) {
          regFaceBtn.style.background = "#10b981";
          regFaceBtn.innerText = "✓ Face ID Captured";
        }
        if (regFaceStatus) {
          regFaceStatus.style.display = "block";
        }
      } else if (activeEqFaceAction === "reset") {
        const resetRes = await fetch("/api/own-equipment/auth/reset-face-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: eqRfTempCreds.username,
            password: eqRfTempCreds.password,
            faceDescriptor: data.descriptor,
          }),
        });
        const resetData = await resetRes.json();
        eqRfTempCreds = null;
        if (resetData.success) {
          toggleView("login");
          showAlert(resetData.message || "Face data updated successfully!", "success");
        } else {
          showAlert(resetData.message || "Failed to update face data.", "error");
        }
      }
    } catch (err) {
      closeEqUniversalFace();
      showAlert("Error processing face descriptor.", "error");
    }
  }
}

function closeEqUniversalFace() {
  const modal = document.getElementById("eqUniversalFaceModal");
  if (modal) modal.style.display = "none";
  isEqProcessing = false;
  eqLivenessPassed = false;
  if (eqCaptureTimer) {
    clearTimeout(eqCaptureTimer);
    eqCaptureTimer = null;
  }
  if (eqCamStream) {
    eqCamStream.getTracks().forEach((track) => track.stop());
    eqCamStream = null;
  }
  const video = document.getElementById("eqUniversalVideo");
  if (video) video.srcObject = null;
}

// Normal page load + browser Back/Forward restore & Enter key listener
window.addEventListener("pageshow", function () {
  if (localStorage.getItem("eq_token")) {
    window.location.replace(
      window.ownEquipmentSession.getLoginDestination(),
    );
    return;
  }
  clearAuthForms();
});

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("eq_token")) {
    window.location.replace(
      window.ownEquipmentSession.getLoginDestination(),
    );
    return;
  }
  ["loginUser", "loginPass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleLogin();
      });
    }
  });
  ["signupUser", "signupPass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSignup();
      });
    }
  });
  ["eqRfUsername", "eqRfPassword"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") verifyAndStartEqFaceReset();
      });
    }
  });

  const faceBtn = document.querySelector(".face-corner-btn");
  if (faceBtn) {
    faceBtn.style.display = localStorage.getItem("eq_webauthn_enabled")
      ? "flex"
      : "none";
  }
});