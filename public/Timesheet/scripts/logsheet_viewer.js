let currentZoom = 1;
let currentRotation = 0;
let posX = 0,
  posY = 0; // 🟢 New variables for tracking movement
let logsheetFiles = [];
let currentFileIndex = -1;
let currentToken = "";

let isDragging = false;
let startX, startY;

// 1. Open Viewer & Fetch Files
async function openLogsheetViewer(passedPlate = "") {
  let plate = passedPlate;
  const selPlateEl = document.getElementById("selPlate");
  if (!plate && selPlateEl) {
    plate = selPlateEl.value.trim().toUpperCase();
  }

  const month = document.getElementById("selMonth").value;
  const year = document.getElementById("selYear").value;

  if (!plate) {
    customAlert(
      "Please select a Plate Number first to view logsheets.",
      "Notice",
    );
    return;
  }

  const modal = document.getElementById("logsheetModal");
  const title = document.getElementById("logsheetTitle");
  const sidebar = document.getElementById("logsheetFileList");
  const viewer = document.getElementById("logsheetViewerContainer");

  title.innerText = `Logsheets - ${plate} (${month} ${year})`;
  sidebar.innerHTML =
    '<div style="text-align:center; padding:20px;">Loading...</div>';
  viewer.innerHTML =
    '<div style="text-align:center; padding: 50px; color:#64748b;">Select a file from the list to view</div>';
  modal.style.display = "flex";

  initResizers(); // Initialize resizers once modal opens

  try {
    currentToken = localStorage.getItem("timesheetToken");

    // 🟢 Fix: Ensure token is strictly passed to prevent 401
    const reqHeaders = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + currentToken,
    };

    const response = await fetch("/timesheet/api/logsheets/list", {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ month, year, plate_no: plate }),
    });

    const data = await response.json();

    if (!data.success) {
      sidebar.innerHTML = `<div style="color:#ef4444; font-weight:bold; padding:10px;">${data.message}</div>`;
      return;
    }

    if (data.files.length === 0) {
      sidebar.innerHTML = `<div style="padding:10px; color:#64748b; text-align:center;">No files found.</div>`;
      logsheetFiles = [];
      return;
    }

    // Sort files numerically (1, 2, 3...)
    logsheetFiles = data.files.sort((a, b) =>
      a.basename.localeCompare(b.basename, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    renderFileList();

    // Auto-load first file
    if (logsheetFiles.length > 0) {
      selectFileIndex(0);
    }
  } catch (error) {
    sidebar.innerHTML = `<div style="color:#ef4444; font-weight:bold; padding:10px;">Connection failed.</div>`;
  }
}

// 2. Render Sidebar List (Updated with Checkboxes, File Size & 0B check)
function renderFileList() {
  const sidebar = document.getElementById("logsheetFileList");
  sidebar.innerHTML = "";
  logsheetFiles.forEach((file, index) => {
    const div = document.createElement("div");
    div.className = "logsheet-file-item";
    div.id = `ls-file-${index}`;

    // 0B check
    if (file.size === 0) div.classList.add("empty-file");

    // Added inline styles to prevent word breaking and keep it in a single line
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; overflow:hidden; width:100%;">
        <input type="checkbox" class="ls-checkbox" id="ls-check-${index}" onclick="event.stopPropagation();" style="flex-shrink: 0; width: 15px; height: 15px; cursor: pointer; margin: 0;" />
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1;" title="${file.basename}">${file.basename}</span>
      </div>
    `;

    div.onclick = () => selectFileIndex(index);
    sidebar.appendChild(div);
  });
}

// 🟢 Helper to format file size
function formatBytes(bytes, decimals = 1) {
  if (!+bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function selectFileIndex(index) {
  if (index < 0 || index >= logsheetFiles.length) return;
  currentFileIndex = index;

  // Highlight active
  document
    .querySelectorAll(".logsheet-file-item")
    .forEach((el) => el.classList.remove("active"));
  const activeEl = document.getElementById(`ls-file-${index}`);
  if (activeEl) {
    activeEl.classList.add("active");
    activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const file = logsheetFiles[index];
  loadViewerContent(file.filename, file.mime, currentToken);
}

function closeLogsheetViewer() {
  document.getElementById("logsheetModal").style.display = "none";
  document.getElementById("logsheetViewerContainer").innerHTML = "";
  logsheetFiles = [];
  currentFileIndex = -1;
}

// 🟢 3. Load Viewer Content (With rotation support)
function loadViewerContent(filePath, mimeType, token) {
  const viewer = document.getElementById("logsheetViewerContainer");
  viewer.innerHTML =
    '<div style="text-align:center; padding:20px; font-weight:bold; color:#8b5cf6;">Loading File...</div>';

  currentZoom = 1;
  currentRotation = 0;
  posX = 0; // 🟢 Reset position X
  posY = 0; // 🟢 Reset position Y

  const activeToken = localStorage.getItem("timesheetToken");
  const reqHeaders = {
    Authorization: "Bearer " + activeToken,
  };

  fetch(`/timesheet/api/logsheets/file?path=${encodeURIComponent(filePath)}`, {
    headers: reqHeaders,
  })
    .then((res) => {
      if (!res.ok) throw new Error("File fetch failed");
      return res.blob();
    })
    .then((blob) => {
      const fileURL = URL.createObjectURL(blob);
      if (mimeType.includes("pdf")) {
        viewer.innerHTML = `<iframe src="${fileURL}#toolbar=0" style="width:100%; height:100%; border:none;"></iframe>`;
      } else {
        viewer.innerHTML = `
          <div class="image-zoom-wrapper" id="imgWrapper">
            <img src="${fileURL}" id="zoomImage" draggable="false" style="max-width: 100%; max-height: 100%; object-fit: contain;" alt="Logsheet" />
          </div>
          <div class="zoom-controls">
            <button class="zoom-btn" onclick="adjustZoom(-0.2)" title="Zoom Out">➖</button>
            <button class="zoom-btn" onclick="resetZoomRotate()" title="Reset">🔄</button>
            <button class="zoom-btn" onclick="adjustZoom(0.2)" title="Zoom In">➕</button>
            <button class="zoom-btn" onclick="rotateImage()" title="Rotate" style="color:#f59e0b;">⟳</button>
          </div>
        `;
        applyTransform();
        attachMouseEvents();
      }
    })
    .catch((err) => {
      viewer.innerHTML = `<div style="color:#ef4444; font-weight:bold; padding:20px; text-align:center;">Failed to load file.</div>`;
    });
}

// 🟢 4. Zoom & Rotation Logic
function adjustZoom(amount) {
  currentZoom += amount;
  if (currentZoom < 0.2) currentZoom = 0.2; // Min zoom
  if (currentZoom > 10) currentZoom = 10; // Max zoom
  applyTransform();
}

function rotateImage() {
  currentRotation += 90;
  if (currentRotation >= 360) currentRotation = 0;
  applyTransform();
}

function resetZoomRotate() {
  currentZoom = 1;
  currentRotation = 0;
  posX = 0; // 🟢 Reset position X
  posY = 0; // 🟢 Reset position Y
  applyTransform();
}

function applyTransform() {
  const img = document.getElementById("zoomImage");
  if (!img) return;

  // 🟢 Translate moves the image freely, Scale makes it bigger, Rotate spins it
  img.style.transform = `translate(${posX}px, ${posY}px) scale(${currentZoom}) rotate(${currentRotation}deg)`;
}
// 🟢 5. Mouse Wheel & Drag-to-Pan Events
function attachMouseEvents() {
  const wrapper = document.getElementById("imgWrapper");
  if (!wrapper) return;

  // Mouse Wheel to Zoom
  wrapper.onwheel = (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      adjustZoom(0.2); // Scroll Up = Zoom In
    } else {
      adjustZoom(-0.2); // Scroll Down = Zoom Out
    }
  };

  // Drag to Pan using Translate X/Y
  wrapper.onmousedown = (e) => {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX - posX;
    startY = e.clientY - posY;
    wrapper.style.cursor = "grabbing";
  };

  wrapper.onmouseleave = () => {
    isDragging = false;
    wrapper.style.cursor = "grab";
  };

  wrapper.onmouseup = () => {
    isDragging = false;
    wrapper.style.cursor = "grab";
  };

  wrapper.onmousemove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    posX = e.clientX - startX;
    posY = e.clientY - startY;
    applyTransform();
  };
}

// 🟢 6. Keyboard Navigation (Left/Right Arrows)
document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("logsheetModal");
  if (!modal || modal.style.display === "none") return;

  // Ignore if typing in input/textarea on the grid
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    selectFileIndex(currentFileIndex + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    selectFileIndex(currentFileIndex - 1);
  }
});

// 🟢 7. Resizer Logic (Modal Width & Sidebar Width)
function initResizers() {
  const modalContent = document.getElementById("logsheetModalContent");
  const modalResizer = document.getElementById("modalResizer");
  const sidebar = document.getElementById("logsheetFileList");
  const sidebarResizer = document.getElementById("sidebarResizer");

  // Modal Left Edge Resize
  let isResizingModal = false;
  modalResizer.addEventListener("mousedown", () => {
    isResizingModal = true;
  });

  // Sidebar Right Edge Resize
  let isResizingSidebar = false;
  sidebarResizer.addEventListener("mousedown", () => {
    isResizingSidebar = true;
    sidebarResizer.classList.add("active");
  });

  document.addEventListener("mousemove", (e) => {
    if (isResizingModal) {
      // Calculate width from right edge of screen to mouse pointer
      let newWidth = window.innerWidth - e.clientX - 15; // 15px is the right margin
      if (newWidth > 300 && newWidth < window.innerWidth - 100) {
        modalContent.style.width = newWidth + "px";
      }
    }
    if (isResizingSidebar) {
      let modalRect = modalContent.getBoundingClientRect();
      let newWidth = e.clientX - modalRect.left;
      if (newWidth > 150 && newWidth < 500) {
        sidebar.style.width = newWidth + "px";
        sidebar.style.flex = "none"; // Override flex layout if any
      }
    }
  });

  document.addEventListener("mouseup", () => {
    isResizingModal = false;
    if (isResizingSidebar) {
      isResizingSidebar = false;
      sidebarResizer.classList.remove("active");
    }
  });
}

// ✅ Shared Core Function for PDF Generation (Stretching Fixed with Auto Orientation)
async function generatePdfFromFiles(
  filesArray,
  pdfFilename,
  btnElement,
  originalBtnText,
) {
  if (!filesArray.length) {
    customAlert("No valid images found for PDF.", "Notice");
    return;
  }

  btnElement.disabled = true;
  btnElement.innerHTML = `Processing...`;

  try {
    const { jsPDF } = window.jspdf;
    let doc = null;

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];

      const activeToken = localStorage.getItem("timesheetToken");
      const reqHeaders = {
        Authorization: "Bearer " + activeToken,
      };

      const res = await fetch(
        `/timesheet/api/logsheets/file?path=${encodeURIComponent(file.filename)}`,
        { headers: reqHeaders },
      );

      if (!res.ok) continue;
      const blob = await res.blob();

      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);

      const imgData = canvas.toDataURL("image/jpeg", 1.0);

      // Convert px to mm
      const pdfWidth = bitmap.width * 0.264583;
      const pdfHeight = bitmap.height * 0.264583;

      // FIX: Dynamically check orientation to prevent jsPDF from auto-swapping dimensions!
      const orientation = pdfWidth > pdfHeight ? "l" : "p";

      if (i === 0) {
        doc = new jsPDF({
          orientation: orientation,
          unit: "mm",
          format: [pdfWidth, pdfHeight],
          compress: true,
        });
      } else {
        doc.addPage([pdfWidth, pdfHeight], orientation);
      }

      doc.addImage(
        imgData,
        "JPEG",
        0,
        0,
        pdfWidth,
        pdfHeight,
        undefined,
        "FAST",
      );
    }

    if (!doc) {
      customAlert("PDF generation failed.", "Error");
      return;
    }

    doc.save(pdfFilename);
  } catch (e) {
    console.error("PDF Error:", e);
    customAlert("Failed to generate PDF.", "Error");
  } finally {
    btnElement.disabled = false;
    btnElement.innerHTML = originalBtnText;
  }
}

// ✅ 1. Download ALL as PDF
async function downloadAllAsPdf() {
  const btn = document.getElementById("btnDownloadPdf");
  const imageFiles = logsheetFiles.filter(
    (f) => f.mime && f.mime.includes("image") && f.size > 0,
  );

  const plate = document
    .getElementById("logsheetTitle")
    .innerText.replace("Logsheets - ", "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  await generatePdfFromFiles(
    imageFiles,
    `${plate}_All_Logsheets.pdf`,
    btn,
    "PDF",
  );
}

// ✅ 2. Download SELECTED as PDF
async function downloadSelectedAsPdf() {
  const btn = document.getElementById("btnDownloadSelected");
  const checkboxes = document.querySelectorAll(".ls-checkbox");
  const selectedFiles = [];

  checkboxes.forEach((cb, index) => {
    if (
      cb.checked &&
      logsheetFiles[index].mime &&
      logsheetFiles[index].mime.includes("image") &&
      logsheetFiles[index].size > 0
    ) {
      selectedFiles.push(logsheetFiles[index]);
    }
  });

  if (selectedFiles.length === 0) {
    customAlert("Please select at least one valid image file first.", "Notice");
    return;
  }

  const plate = document
    .getElementById("logsheetTitle")
    .innerText.replace("Logsheets - ", "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  await generatePdfFromFiles(
    selectedFiles,
    `${plate}_Selected_Logsheets.pdf`,
    btn,
    "📑 Selected",
  );
}

// ✅ 3. Download CURRENT Image directly
async function downloadCurrentImage() {
  if (currentFileIndex === -1 || !logsheetFiles[currentFileIndex]) {
    customAlert("No image is currently being viewed.", "Notice");
    return;
  }

  const file = logsheetFiles[currentFileIndex];
  const btn = document.getElementById("btnDownloadCurrent");
  btn.disabled = true;
  btn.innerText = "Wait...";

  try {
    const activeToken = localStorage.getItem("timesheetToken");
    const reqHeaders = {
      Authorization: "Bearer " + activeToken,
    };

    const res = await fetch(
      `/timesheet/api/logsheets/file?path=${encodeURIComponent(file.filename)}`,
      { headers: reqHeaders },
    );

    if (!res.ok) throw new Error("Fetch failed");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = file.basename;
    document.body.appendChild(a);
    a.click();

    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (error) {
    console.error("Download Error:", error);
    customAlert("Failed to download current image.", "Error");
  } finally {
    btn.disabled = false;
    btn.innerText = "⬇ Current";
  }
}
