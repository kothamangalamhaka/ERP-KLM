let currentZoom = 1;
let currentRotation = 0;
let posX = 0, posY = 0;
let logsheetFiles = [];
let currentFileIndex = -1;
let currentToken = "";

let isDragging = false;
let startX, startY;

// 1. Open Viewer & Fetch Files (Modal Version)
async function openLogsheetViewer(plate) {
  if (!plate) {
    customAlert("No plate number provided.", "Notice");
    return;
  }

  const modal = document.getElementById("logsheetModal");
  const title = document.getElementById("logsheetTitle");
  const sidebar = document.getElementById("logsheetFileList");
  const viewer = document.getElementById("logsheetViewerContainer");
  const modalContent = document.getElementById("logsheetModalContent");

  const month = document.getElementById("selMonth").value;
  const year = document.getElementById("selYear").value;

  title.innerText = `Logsheets - ${plate} (${month} ${year})`;
  sidebar.innerHTML = '<div style="text-align:center; padding:20px;">Loading...</div>';
  viewer.innerHTML = '<div style="text-align:center; padding: 50px; color:#64748b;">Select a file from the list to view</div>';
  
  // Show Modal properly
  modal.style.display = "flex";
  modal.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
  modal.style.backdropFilter = "blur(2px)";
  modal.style.pointerEvents = "auto";

  // Setup Resizers
  const sidebarResizer = document.getElementById("sidebarResizer");
  const modalResizer = document.getElementById("modalResizer"); 

  let isResizingSidebar = false;
  let isResizingModal = false;

  if (sidebarResizer) {
    sidebarResizer.onmousedown = () => { isResizingSidebar = true; sidebarResizer.classList.add("active"); };
  }
  if (modalResizer) {
    modalResizer.onmousedown = (e) => { e.preventDefault(); isResizingModal = true; };
  }

  document.onmousemove = (e) => {
    if (isResizingSidebar) {
      let modalRect = modalContent.getBoundingClientRect();
      let newWidth = e.clientX - modalRect.left;
      if (newWidth > 150 && newWidth < 400) {
        sidebar.style.width = newWidth + "px";
        sidebar.style.flex = "none";
      }
    }
    if (isResizingModal) {
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth > 400 && newWidth < window.innerWidth - 50) {
         modalContent.style.width = newWidth + "px";
      }
    }
  };

  document.onmouseup = () => {
    isResizingSidebar = false;
    isResizingModal = false;
    if(sidebarResizer) sidebarResizer.classList.remove("active");
  };

  try {
    currentToken = localStorage.getItem("timesheetToken");
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

    logsheetFiles = data.files.sort((a, b) =>
      a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: "base" })
    );

    renderFileList();
    if (logsheetFiles.length > 0) selectFileIndex(0);
  } catch (error) {
    sidebar.innerHTML = `<div style="color:#ef4444; font-weight:bold; padding:10px;">Connection failed.</div>`;
  }
}

function renderFileList() {
  const sidebar = document.getElementById("logsheetFileList");
  sidebar.innerHTML = "";
  logsheetFiles.forEach((file, index) => {
    const div = document.createElement("div");
    div.className = "logsheet-file-item";
    div.id = `ls-file-${index}`;

    if (file.size === 0) div.classList.add("empty-file");

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

function selectFileIndex(index) {
  if (index < 0 || index >= logsheetFiles.length) return;
  currentFileIndex = index;

  document.querySelectorAll(".logsheet-file-item").forEach((el) => el.classList.remove("active"));
  const activeEl = document.getElementById(`ls-file-${index}`);
  if (activeEl) {
    activeEl.classList.add("active");
    activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const file = logsheetFiles[index];
  loadViewerContent(file.filename, file.mime, currentToken);
}

function closeLogsheetViewer() {
  const modal = document.getElementById("logsheetModal");
  modal.style.display = "none";
  modal.style.backgroundColor = "transparent";
  modal.style.backdropFilter = "none";
  modal.style.pointerEvents = "none";
  
  document.getElementById("logsheetViewerContainer").innerHTML = "";
  logsheetFiles = [];
  currentFileIndex = -1;
}

function loadViewerContent(filePath, mimeType, token) {
  const viewer = document.getElementById("logsheetViewerContainer");
  viewer.innerHTML = '<div style="text-align:center; padding:20px; font-weight:bold; color:#8b5cf6;">Loading File...</div>';

  currentZoom = 1;
  currentRotation = 0;
  posX = 0;
  posY = 0;

  const activeToken = localStorage.getItem("timesheetToken");
  const reqHeaders = { Authorization: "Bearer " + activeToken };

  fetch(`/timesheet/api/logsheets/file?path=${encodeURIComponent(filePath)}`, { headers: reqHeaders })
    .then((res) => {
      if (!res.ok) throw new Error("File fetch failed");
      return res.blob();
    })
    .then(async (blob) => {
      if (mimeType.includes("pdf")) {
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          viewer.innerHTML = `
            <div class="image-zoom-wrapper" id="imgWrapper" style="overflow: hidden;">
              <div id="zoomContent" style="display: flex; flex-direction: column; gap: 20px; align-items: center; transition: transform 0.1s ease-out; padding: 20px;">
              </div>
            </div>
            <div class="zoom-controls">
              <button class="zoom-btn" onclick="adjustZoom(-0.2)" title="Zoom Out">➖</button>
              <button class="zoom-btn" onclick="resetZoomRotate()" title="Reset">🔄</button>
              <button class="zoom-btn" onclick="adjustZoom(0.2)" title="Zoom In">➕</button>
              <button class="zoom-btn" onclick="rotateImage()" title="Rotate" style="color:#f59e0b;">⟳</button>
            </div>
          `;

          const zoomContent = document.getElementById("zoomContent");

          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.maxWidth = "100%";
            canvas.style.height = "auto";
            canvas.style.boxShadow = "0 4px 10px rgba(0,0,0,0.2)";
            canvas.style.backgroundColor = "#fff";

            const ctx = canvas.getContext("2d");
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            zoomContent.appendChild(canvas);
          }

          applyTransform();
          attachMouseEvents();
        } catch (pdfErr) {
          viewer.innerHTML = `<div style="color:#ef4444; font-weight:bold; padding:20px; text-align:center;">Failed to render PDF preview.</div>`;
        }
      } else {
        const fileURL = URL.createObjectURL(blob);
        viewer.innerHTML = `
          <div class="image-zoom-wrapper" id="imgWrapper" style="overflow: hidden;">
            <div id="zoomContent" style="display: flex; justify-content: center; align-items: center; transition: transform 0.1s ease-out;">
              <img src="${fileURL}" draggable="false" style="max-width: 100%; max-height: 100%; object-fit: contain; transition: transform 0.2s ease-out;" alt="Logsheet" />
            </div>
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

function adjustZoom(amount) {
  currentZoom += amount;
  if (currentZoom < 0.2) currentZoom = 0.2;
  if (currentZoom > 10) currentZoom = 10;
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
  posX = 0;
  posY = 0;
  applyTransform();
}

function applyTransform() {
  const content = document.getElementById("zoomContent");
  if (!content) return;

  content.style.transform = `translate(${posX}px, ${posY}px) scale(${currentZoom})`;

  const children = content.children;
  for (let i = 0; i < children.length; i++) {
    children[i].style.transform = `rotate(${currentRotation}deg)`;
    children[i].style.transition = "transform 0.2s ease-out";
    
    if (currentRotation % 180 !== 0) {
      children[i].style.margin = "10% 0"; 
    } else {
      children[i].style.margin = "0";
    }
  }
}

function attachMouseEvents() {
  const wrapper = document.getElementById("imgWrapper");
  if (!wrapper) return;

  wrapper.onwheel = (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      adjustZoom(0.2); 
    } else {
      adjustZoom(-0.2);
    }
  };

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

document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("logsheetModal");
  if (!modal || modal.style.display === "none") return;

  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    selectFileIndex(currentFileIndex + 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    selectFileIndex(currentFileIndex - 1);
  }
});

async function generatePdfFromFiles(filesArray, pdfFilename, btnElement, originalBtnText) {
  if (!filesArray.length) {
    customAlert("No valid files selected for PDF.", "Notice");
    return;
  }

  btnElement.disabled = true;
  btnElement.innerHTML = `Processing...`;

  try {
    const { PDFDocument } = PDFLib;
    const { jsPDF } = window.jspdf;
    
    const mergedPdf = await PDFDocument.create();
    const activeToken = localStorage.getItem("timesheetToken");
    const reqHeaders = { Authorization: "Bearer " + activeToken };

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const res = await fetch(`/timesheet/api/logsheets/file?path=${encodeURIComponent(file.filename)}`, { headers: reqHeaders });
      if (!res.ok) continue;
      
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();

      if (file.mime && file.mime.includes("pdf")) {
        const existingPdf = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(existingPdf, existingPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } else {
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);

        const imgData = canvas.toDataURL("image/jpeg", 0.9);
        const singleImgPdf = new jsPDF({
          orientation: bitmap.width > bitmap.height ? "l" : "p",
          unit: "mm",
          format: [bitmap.width * 0.264583, bitmap.height * 0.264583]
        });
        singleImgPdf.addImage(imgData, "JPEG", 0, 0, bitmap.width * 0.264583, bitmap.height * 0.264583, undefined, "FAST");
        
        const singlePdfBytes = singleImgPdf.output("arraybuffer");
        const tempPdf = await PDFDocument.load(singlePdfBytes);
        const [copiedPage] = await mergedPdf.copyPages(tempPdf, [0]);
        mergedPdf.addPage(copiedPage);
      }
    }

    const pdfBytes = await mergedPdf.save();
    const blobOutput = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blobOutput);
    link.download = pdfFilename;
    link.click();

  } catch (e) {
    console.error("PDF Merge Error:", e);
    customAlert("Failed to generate combined PDF.", "Error");
  } finally {
    btnElement.disabled = false;
    btnElement.innerHTML = originalBtnText;
  }
}

async function downloadAllAsPdf() {
  const btn = document.getElementById("btnDownloadPdf");
  const imageFiles = logsheetFiles.filter(
    (f) => f.mime && (f.mime.includes("image") || f.mime.includes("pdf")) && f.size > 0,
  );

  const plate = document.getElementById("logsheetTitle").innerText.replace("Logsheets - ", "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  await generatePdfFromFiles(imageFiles, `${plate}.pdf`, btn, "PDF");
}

async function downloadSelectedAsPdf() {
  const btn = document.getElementById("btnDownloadSelected");
  const checkboxes = document.querySelectorAll(".ls-checkbox");
  const selectedFiles = [];

  checkboxes.forEach((cb, index) => {
    if (
      cb.checked &&
      logsheetFiles[index].mime &&
      (logsheetFiles[index].mime.includes("image") || logsheetFiles[index].mime.includes("pdf")) &&
      logsheetFiles[index].size > 0
    ) {
      selectedFiles.push(logsheetFiles[index]);
    }
  });

  if (selectedFiles.length === 0) {
    customAlert("Please select at least one valid image file first.", "Notice");
    return;
  }

  const plate = document.getElementById("logsheetTitle").innerText.replace("Logsheets - ", "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  await generatePdfFromFiles(selectedFiles, `${plate}_Selected_Logsheets.pdf`, btn, "📑 Selected");
}

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
    const reqHeaders = { Authorization: "Bearer " + activeToken };

    const res = await fetch(`/timesheet/api/logsheets/file?path=${encodeURIComponent(file.filename)}`, { headers: reqHeaders });
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