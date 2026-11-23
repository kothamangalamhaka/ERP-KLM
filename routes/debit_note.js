const express = require("express");
const pool = require("../config/db");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { PDFDocument, PDFName } = require("pdf-lib");
const router = express.Router();

async function ensureDnFaceTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS debit_note_faces (
      id SERIAL PRIMARY KEY,
      face_descriptor JSONB NOT NULL,
      device_label TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function euclideanDistance(desc1, desc2) {
  if (
    !Array.isArray(desc1) ||
    !Array.isArray(desc2) ||
    desc1.length !== desc2.length
  ) {
    return 999;
  }
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = Number(desc1[i]) - Number(desc2[i]);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

let sseClients = [];

function broadcastDebitNoteUpdate(action, data, senderId = null) {
  const payload = JSON.stringify({ action, data, sender: senderId });
  sseClients.forEach((client) => {
    try {
      if (!client.res.writableEnded && !client.res.destroyed) {
        client.res.write(`data: ${payload}\n\n`);
      }
    } catch (e) {
      console.error("SSE Broadcast Error:", e.message);
    }
  });
}

router.get("/api/stream", (req, res) => {
  const code = req.query.security_code || req.headers["x-security-code"];
  const validCode =
    process.env.VAT_TRACKER_CODE || process.env.KLM_SECURITY_CODE;
  if (validCode && code !== validCode) {
    return res.status(403).end();
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  res.write(": connected\n\n");

  const clientId = Date.now() + Math.random();
  sseClients.push({ id: clientId, res });

  const keepAliveInterval = setInterval(() => {
    try {
      if (!res.writableEnded && !res.destroyed) {
        res.write(": keepalive\n\n");
      } else {
        clearInterval(keepAliveInterval);
      }
    } catch (e) {
      clearInterval(keepAliveInterval);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAliveInterval);
    sseClients = sseClients.filter((c) => c.id !== clientId);
  });
});

function verifyVatTrackerCode(req, res, next) {
  const code =
    req.headers["x-security-code"] ||
    req.body.security_code ||
    req.query.security_code;
  const validCode =
    process.env.VAT_TRACKER_CODE || process.env.KLM_SECURITY_CODE;
  if (!validCode || code === validCode) {
    return next();
  }
  return res
    .status(403)
    .json({ success: false, message: "Security Code Verification Failed" });
}

const uploadDir = path.join(__dirname, "../public/uploads/Debit_Note");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage uses temp filename first, then renamed precisely from DB / parameters
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".pdf";
    const tempName = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    cb(null, tempName);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function generateNextAutoPlateId(dbClient = pool) {
  await dbClient.query(
    `CREATE SEQUENCE IF NOT EXISTS debit_notes_auto_plate_seq START 1`,
  );
  // Sync sequence with highest existing numeric auto_plate_id so duplicates never occur
  await dbClient.query(`
    SELECT setval(
      'debit_notes_auto_plate_seq',
      GREATEST(
        COALESCE((SELECT MAX(NULLIF(REGEXP_REPLACE(auto_plate_id, '[^0-9]', '', 'g'), '')::bigint) FROM debit_notes), 0),
        1
      ),
      EXISTS(SELECT 1 FROM debit_notes WHERE auto_plate_id IS NOT NULL AND TRIM(auto_plate_id) != '')
    )
  `);
  const seqRes = await dbClient.query(
    `SELECT LPAD(nextval('debit_notes_auto_plate_seq')::text, 4, '0') AS code`,
  );
  return seqRes.rows[0].code;
}

function buildDebitNoteFileName({
  rowId,
  plateNo,
  autoPlateId,
  monthYear,
  particulars,
  ext,
}) {
  const rawPlate = (plateNo || "").trim().toUpperCase();
  const cleanMonth = (monthYear || "MONTH")
    .trim()
    .toUpperCase()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const cleanPart = (particulars || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 50);

  if (rawPlate) {
    const cleanPlate = rawPlate
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const idTag = rowId ? `_ID${rowId}` : `_${Date.now()}`;
    return cleanPart
      ? `${cleanPlate}_${cleanMonth}_${cleanPart}${idTag}${ext}`
      : `${cleanPlate}_${cleanMonth}${idTag}${ext}`;
  } else {
    const uid = (autoPlateId || "0001").trim();
    const idTag = rowId ? `_ID${rowId}` : "";
    return cleanPart
      ? `${uid}_${cleanMonth}_${cleanPart}${idTag}${ext}`
      : `${uid}_${cleanMonth}${idTag}${ext}`;
  }
}

function parseMonthYearRange(monthYearStr) {
  if (!monthYearStr) return null;
  const parts = monthYearStr.trim().split(/[\s-]+/);
  if (parts.length < 2) return null;
  const monthMap = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const mKey = parts[0].toLowerCase().substring(0, 3);
  let yVal = parseInt(parts[1], 10);
  if (isNaN(yVal)) return null;
  if (yVal < 100) yVal += 2000;
  if (monthMap[mKey] === undefined) return null;

  const mIdx = monthMap[mKey];
  const startDate = new Date(Date.UTC(yVal, mIdx, 1));
  const endDate = new Date(Date.UTC(yVal, mIdx + 1, 0));
  return {
    start: startDate.toISOString().split("T")[0],
    end: endDate.toISOString().split("T")[0],
  };
}

// Deep inspection: Check text, metadata, and embedded images in the bottom signature region
async function inspectPageForExistingSeal(pdfDoc, pdfBuffer) {
  try {
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return false;
    const targetPage = pages[pages.length - 1];

    // 1. Check Document Keywords
    const keywords = pdfDoc.getKeywords() || "";
    if (keywords.includes("DIGITAL_SEAL_APPLIED")) {
      return true;
    }

    // 2. Check text keywords using pdfjs
    const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
    const uint8Array = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(doc.numPages);
    const textContent = await page.getTextContent();

    for (const item of textContent.items) {
      const str = (item.str || "").toLowerCase();
      if (
        str.includes("we1 track") ||
        str.includes("al-joda") ||
        str.includes("aljoda") ||
        str.includes("haka") ||
        str.includes("masar") ||
        str.includes("7051729619") ||
        str.includes("113133290")
      ) {
        return true;
      }
    }

    // 3. Inspect Embedded Images on the page
    const resources = targetPage.node.Resources();
    if (resources) {
      const xObject = resources.lookup(PDFName.of("XObject"));
      if (xObject) {
        const xObjectDict = xObject.asMap();
        // If multiple images are embedded in the bottom acceptance area, seal exists
        if (xObjectDict.size > 2) {
          return true;
        }
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

async function findTextCoordinates(pdfBuffer) {
  try {
    const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
    const uint8Array = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const doc = await loadingTask.promise;

    const pageNum = doc.numPages;
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();

    let anchors = {
      store: null,
      acceptedBy: null,
      subcontractor: null,
      projectManager: null,
    };

    for (const item of textContent.items) {
      const str = (item.str || "").toLowerCase().trim();
      if (!str) continue;

      if (str === "store" || str.includes("store")) {
        anchors.store = { x: item.transform[4], y: item.transform[5] };
      } else if (str.includes("accepted by") || str === "accepted by") {
        anchors.acceptedBy = { x: item.transform[4], y: item.transform[5] };
      } else if (str.includes("subcontractor")) {
        anchors.subcontractor = { x: item.transform[4], y: item.transform[5] };
      } else if (
        str.includes("project manager") ||
        str.includes("project director")
      ) {
        anchors.projectManager = { x: item.transform[4], y: item.transform[5] };
      }
    }

    return anchors;
  } catch (err) {
    console.error("Error detecting text coordinates:", err.message);
    return null;
  }
}

async function applySealToPdf(filePath, companyName) {
  if (!fs.existsSync(filePath)) {
    return { success: false, reason: "NOT_FOUND" };
  }
  if (!companyName) {
    return { success: false, reason: "NO_COMPANY" };
  }

  const comp = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  let sealFileName = null;

  if (comp.includes("haka")) sealFileName = "Haka.png";
  else if (comp.includes("masar")) sealFileName = "masar.png";
  else if (comp.includes("we1") || comp.includes("we"))
    sealFileName = "we1.png";
  else if (comp.includes("joda") || comp.includes("aljoda"))
    sealFileName = "aljoda.png";

  if (!sealFileName) {
    return { success: false, reason: "SEAL_FILE_MISSING" };
  }

  const sealPath = path.join(
    __dirname,
    "../public/Debit_Notes/Seal",
    sealFileName,
  );
  if (!fs.existsSync(sealPath)) {
    return { success: false, reason: "SEAL_NOT_CONFIGURED" };
  }

  try {
    const existingPdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Deep detection for existing seal/signature image or texts
    const alreadyPresent = await inspectPageForExistingSeal(
      pdfDoc,
      existingPdfBytes,
    );
    if (alreadyPresent) {
      return { success: false, reason: "ALREADY_SEALED" };
    }

    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
      return { success: false, reason: "EMPTY_PDF" };
    }

    const targetPage = pages[pages.length - 1];
    const { width, height } = targetPage.getSize();

    const sealImageBytes = fs.readFileSync(sealPath);
    const sealImage = await pdfDoc.embedPng(sealImageBytes);

    // Neat compact dimensions
    const stampWidth = 72;
    const stampHeight = (sealImage.height / sealImage.width) * stampWidth;

    const anchors = await findTextCoordinates(existingPdfBytes);

    let stampX;
    let stampY;

    if (anchors && anchors.store) {
      // Clear of 'STORE' word: shifted down and rightwards away from the text
      stampX = Math.min(anchors.store.x + 35, width - stampWidth - 110);
      stampY = anchors.store.y - stampHeight - 25;
    } else if (anchors && anchors.acceptedBy) {
      stampX = Math.max(35, anchors.acceptedBy.x - stampWidth - 25);
      stampY = anchors.acceptedBy.y - 5;
    } else if (anchors && anchors.subcontractor) {
      stampX = width - stampWidth - 130;
      stampY = anchors.subcontractor.y - stampHeight - 25;
    } else {
      stampX = width - stampWidth - 130;
      stampY = 145;
    }

    // Border safety rules
    if (stampX + stampWidth > width - 50) {
      stampX = width - stampWidth - 60;
    }
    if (stampX < 45) {
      stampX = 50;
    }
    if (stampY < 80) {
      stampY = 85;
    }
    if (stampY + stampHeight > height - 70) {
      stampY = height - stampHeight - 75;
    }

    targetPage.drawImage(sealImage, {
      x: stampX,
      y: stampY,
      width: stampWidth,
      height: stampHeight,
      opacity: 0.94,
    });

    pdfDoc.setKeywords(["DIGITAL_SEAL_APPLIED", comp]);

    const modifiedPdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, modifiedPdfBytes);
    return { success: true, reason: "APPLIED" };
  } catch (err) {
    console.error("PDF Seal Error:", err.message);
    return { success: false, reason: "ERROR", error: err.message };
  }
}

router.post("/api/verify-code", (req, res) => {
  const { code } = req.body;
  const validCode =
    process.env.VAT_TRACKER_CODE || process.env.KLM_SECURITY_CODE;
  if (code && code === validCode) {
    return res.json({ success: true, message: "Authorized" });
  }
  return res.json({ success: false, message: "Invalid Security Code" });
});

// 1. Register Face Descriptor for Debit Notes (Requires valid Access Code)
router.post("/api/face/register", async (req, res) => {
  try {
    const { code, faceDescriptor, deviceLabel } = req.body;
    const validCode =
      process.env.VAT_TRACKER_CODE || process.env.KLM_SECURITY_CODE;
    if (!validCode || code !== validCode) {
      return res.json({
        success: false,
        message: "Invalid Access Code!",
      });
    }
    if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return res.json({
        success: false,
        message: "Face data not detected. Try again.",
      });
    }

    await ensureDnFaceTable();
    await pool.query(
      `INSERT INTO debit_note_faces (face_descriptor, device_label) VALUES ($1::jsonb, $2)`,
      [JSON.stringify(faceDescriptor), deviceLabel || "Authorized Face"],
    );

    res.json({
      success: true,
      code: validCode,
      message: "Face Registered & Unlocked!",
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// 2. Verify Face Descriptor & Unlock Debit Notes
router.post("/api/face/verify", async (req, res) => {
  try {
    const { faceDescriptor } = req.body;
    if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return res.json({
        success: false,
        message: "Face not detected.",
      });
    }

    await ensureDnFaceTable();
    const facesRes = await pool.query(
      "SELECT id, face_descriptor FROM debit_note_faces",
    );
    if (facesRes.rows.length === 0) {
      return res.json({
        success: false,
        notRegistered: true,
        message: "No face registered yet. Click ➕ with Access Code first.",
      });
    }

    let bestDistance = 999;
    for (const row of facesRes.rows) {
      const storedDesc = Array.isArray(row.face_descriptor)
        ? row.face_descriptor
        : JSON.parse(row.face_descriptor || "[]");
      const dist = euclideanDistance(faceDescriptor, storedDesc);
      if (dist < bestDistance) bestDistance = dist;
    }

    // Standard face recognition threshold (0.48)
    if (bestDistance <= 0.48) {
      const validCode =
        process.env.VAT_TRACKER_CODE || process.env.KLM_SECURITY_CODE || "";
      return res.json({
        success: true,
        code: validCode,
        message: "Face Verified!",
      });
    }

    return res.json({
      success: false,
      message: "Face did not match!",
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.get("/api/records", verifyVatTrackerCode, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        TO_CHAR(received_date, 'YYYY-MM-DD') AS received_date,
        TO_CHAR(submitted_date, 'YYYY-MM-DD') AS submitted_date,
        month_year, approved_by, particulars, plate_no,
        COALESCE(auto_plate_id, '') AS auto_plate_id,
        driver_name, site, company, customer,
        COALESCE(amount, 0) as amount,
        vat_status,
        COALESCE(vat_amount, 0) as vat_amount,
        COALESCE(total_amount, 0) as total_amount,
        COALESCE(qc_entry, 0) as qc_entry,
        owner_name, status, ref_no, work_order, remark,
        attachment_path
      FROM debit_notes
      ORDER BY id ASC
    `);

    const missingIds = [];
    const sanitizedRows = result.rows.map((row) => {
      if (row.attachment_path && String(row.attachment_path).trim() !== "") {
        const cleanRel = String(row.attachment_path).trim().replace(/^\/+/, "");
        const fullPath = path.join(__dirname, "../public", cleanRel);
        if (!fs.existsSync(fullPath)) {
          missingIds.push(row.id);
          return { ...row, attachment_path: null };
        }
      }
      return row;
    });

    if (missingIds.length > 0) {
      await pool.query(
        `UPDATE debit_notes SET attachment_path = NULL WHERE id = ANY($1::int[])`,
        [missingIds],
      );
    }

    res.json({ success: true, data: sanitizedRows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

router.get("/api/dropdowns", verifyVatTrackerCode, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT category, val_name FROM debit_note_dropdowns ORDER BY sort_order ASC, val_name ASC`,
    );
    const dropdowns = {
      approved_by: [],
      site: [],
      company: [],
      customer: [],
      status: [],
    };
    result.rows.forEach((r) => {
      if (dropdowns[r.category]) {
        dropdowns[r.category].push(r.val_name);
      }
    });

    if (dropdowns.status.length > 0) {
      dropdowns.status = dropdowns.status.filter(
        (s) => s.toLowerCase() !== "received",
      );
      dropdowns.status.unshift("Received");
    } else {
      dropdowns.status = ["Received", "Signed"];
    }

    const vRes = await pool.query(
      `SELECT plate_no FROM timesheet_vehicles ORDER BY plate_no ASC`,
    );
    const plates = vRes.rows
      .map((r) => (r.plate_no || "").trim().toUpperCase())
      .filter(Boolean);

    res.json({ success: true, dropdowns, plates });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

router.post("/api/add-dropdown", verifyVatTrackerCode, async (req, res) => {
  try {
    const { category, value } = req.body;
    if (!category || !value) {
      return res.json({ success: false, message: "Invalid parameters" });
    }
    const cleanCategory = String(category).trim();
    const cleanVal = String(value).trim();

    await pool.query(
      `INSERT INTO debit_note_dropdowns (category, val_name, sort_order) 
       VALUES ($1::text, $2::text, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM debit_note_dropdowns WHERE category = $1::text))
       ON CONFLICT (category, val_name) DO NOTHING`,
      [cleanCategory, cleanVal],
    );
    res.json({ success: true, message: "Added successfully" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

router.post(
  "/api/resolve-driver-owner",
  verifyVatTrackerCode,
  async (req, res) => {
    try {
      const { plate_no, month_year } = req.body;
      if (!plate_no) {
        return res.json({ success: true, driver_name: "", owner_name: "" });
      }
      const cleanPlate = plate_no.trim().toUpperCase();
      const dateRange = parseMonthYearRange(month_year);

      let driverNames = [];
      let ownerNames = [];

      if (dateRange) {
        const dRes = await pool.query(
          `SELECT DISTINCT driver_name FROM vehicle_driver_log
         WHERE UPPER(TRIM(plate_no)) = $1
           AND (work_start_date IS NULL OR work_start_date <= $2::date)
           AND (work_end_date IS NULL OR work_end_date >= $3::date)
           AND driver_name IS NOT NULL AND TRIM(driver_name) != ''`,
          [cleanPlate, dateRange.end, dateRange.start],
        );
        driverNames = dRes.rows.map((r) => r.driver_name.trim());

        const oRes = await pool.query(
          `SELECT DISTINCT owner_name FROM vehicle_owner_log
         WHERE UPPER(TRIM(plate_no)) = $1
           AND (work_start_date IS NULL OR work_start_date <= $2::date)
           AND (work_end_date IS NULL OR work_end_date >= $3::date)
           AND owner_name IS NOT NULL AND TRIM(owner_name) != ''`,
          [cleanPlate, dateRange.end, dateRange.start],
        );
        ownerNames = oRes.rows.map((r) => r.owner_name.trim());
      }

      if (driverNames.length === 0) {
        const fallbackD = await pool.query(
          `SELECT driver_name FROM timesheet_vehicles WHERE UPPER(TRIM(plate_no)) = $1`,
          [cleanPlate],
        );
        if (fallbackD.rows.length > 0 && fallbackD.rows[0].driver_name) {
          driverNames.push(fallbackD.rows[0].driver_name.trim());
        }
      }

      if (ownerNames.length === 0) {
        const fallbackO = await pool.query(
          `SELECT owner_name FROM timesheet_vehicles WHERE UPPER(TRIM(plate_no)) = $1`,
          [cleanPlate],
        );
        if (fallbackO.rows.length > 0 && fallbackO.rows[0].owner_name) {
          ownerNames.push(fallbackO.rows[0].owner_name.trim());
        }
      }

      res.json({
        success: true,
        driver_name: driverNames.join(" / "),
        owner_name: ownerNames.join(" / "),
      });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  },
);

// File upload: strictly names file as PLATE_MONTH.pdf
router.post(
  "/api/upload-attachment",
  verifyVatTrackerCode,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.json({ success: false, message: "No file uploaded" });
      }

      const rowId = req.body.id ? Number(req.body.id) : null;
      let finalPlate = (req.body.plate_no || "").trim().toUpperCase();
      let finalMonth = (req.body.month_year || "").trim().toUpperCase();
      let finalParticulars = (req.body.particulars || "").trim();
      let finalAutoPlateId = (req.body.auto_plate_id || "").trim();
      let oldAttachmentPath = null;

      if (rowId) {
        const rowData = await pool.query(
          `SELECT plate_no, auto_plate_id, month_year, particulars, attachment_path FROM debit_notes WHERE id = $1`,
          [rowId],
        );
        if (rowData.rows.length > 0) {
          finalPlate = (rowData.rows[0].plate_no || finalPlate || "")
            .trim()
            .toUpperCase();
          finalAutoPlateId = (
            rowData.rows[0].auto_plate_id ||
            finalAutoPlateId ||
            ""
          ).trim();
          finalMonth = (rowData.rows[0].month_year || finalMonth || "MONTH")
            .trim()
            .toUpperCase();
          finalParticulars = (
            rowData.rows[0].particulars ||
            finalParticulars ||
            ""
          ).trim();
          oldAttachmentPath = rowData.rows[0].attachment_path || null;
        }
      }

      // Generate unique 0001+ ID if Plate No is empty
      if (!finalPlate && !finalAutoPlateId) {
        finalAutoPlateId = await generateNextAutoPlateId();
      }

      const ext = path.extname(req.file.originalname) || ".pdf";
      const targetFileName = buildDebitNoteFileName({
        rowId,
        plateNo: finalPlate,
        autoPlateId: finalAutoPlateId,
        monthYear: finalMonth,
        particulars: finalParticulars,
        ext,
      });
      const targetFilePath = path.join(uploadDir, targetFileName);

      // Remove only THIS row's previous file if replacing on the same row
      if (oldAttachmentPath) {
        const oldFull = path.join(
          __dirname,
          "../public",
          oldAttachmentPath.replace(/^\/+/, ""),
        );
        if (fs.existsSync(oldFull) && oldFull !== targetFilePath) {
          try {
            fs.unlinkSync(oldFull);
          } catch (e) {}
        }
      }

      fs.renameSync(req.file.path, targetFilePath);
      const relativePath = `/uploads/Debit_Note/${targetFileName}`;

      if (rowId) {
        await pool.query(
          `UPDATE debit_notes
           SET attachment_path = $1,
               auto_plate_id = COALESCE(NULLIF($2, ''), auto_plate_id),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [relativePath, finalPlate ? "" : finalAutoPlateId, rowId],
        );
      }

      res.json({
        success: true,
        file_path: relativePath,
        file_name: targetFileName,
        auto_plate_id: finalPlate ? "" : finalAutoPlateId,
      });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  },
);

// Bulk attach single shared PDF across selected rows having the same Ref No
router.post(
  "/api/upload-by-ref",
  verifyVatTrackerCode,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.json({ success: false, message: "No file uploaded" });
      }

      const refNo = (req.body.ref_no || "").trim();
      let rowIds = [];
      try {
        rowIds = JSON.parse(req.body.row_ids || "[]")
          .map((id) => Number(id))
          .filter((id) => id > 0);
      } catch (e) {
        rowIds = [];
      }

      if (!refNo || rowIds.length === 0) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.json({
          success: false,
          message: "Select a valid Ref No and at least one row",
        });
      }

      const cleanRef = refNo
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      const ext = path.extname(req.file.originalname) || ".pdf";
      const targetFileName = `REF_${cleanRef}${ext}`;
      const targetFilePath = path.join(uploadDir, targetFileName);

      // Clean up previous individual files if they are not shared with unselected rows
      const prevRes = await pool.query(
        `SELECT id, attachment_path FROM debit_notes WHERE id = ANY($1::int[])`,
        [rowIds],
      );
      const oldPaths = [
        ...new Set(
          prevRes.rows
            .map((r) => r.attachment_path)
            .filter((p) => p && String(p).trim() !== ""),
        ),
      ];

      if (fs.existsSync(targetFilePath)) {
        fs.unlinkSync(targetFilePath);
      }
      fs.renameSync(req.file.path, targetFilePath);

      const relativePath = `/uploads/Debit_Note/${targetFileName}`;

      await pool.query(
        `UPDATE debit_notes
         SET attachment_path = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($2::int[])`,
        [relativePath, rowIds],
      );

      // Safely remove replaced old files only if no remaining DB row references them
      for (const oldRel of oldPaths) {
        if (oldRel === relativePath) continue;
        const stillUsed = await pool.query(
          `SELECT 1 FROM debit_notes WHERE attachment_path = $1 LIMIT 1`,
          [oldRel],
        );
        if (stillUsed.rows.length === 0) {
          const oldFull = path.join(
            __dirname,
            "../public",
            oldRel.replace(/^\/+/, ""),
          );
          if (fs.existsSync(oldFull)) {
            try {
              fs.unlinkSync(oldFull);
            } catch (e) {}
          }
        }
      }

      const senderId = req.headers["x-client-id"] || null;
      const updatedRowsRes = await pool.query(
        `SELECT id, TO_CHAR(received_date, 'YYYY-MM-DD') AS received_date, TO_CHAR(submitted_date, 'YYYY-MM-DD') AS submitted_date,
         month_year, approved_by, particulars, plate_no, COALESCE(auto_plate_id, '') AS auto_plate_id,
         driver_name, site, company, customer,
         COALESCE(amount, 0) as amount, vat_status, COALESCE(vat_amount, 0) as vat_amount, COALESCE(total_amount, 0) as total_amount,
         COALESCE(qc_entry, 0) as qc_entry,
         owner_name, status, ref_no, work_order, remark, attachment_path
         FROM debit_notes WHERE id = ANY($1::int[])`,
        [rowIds],
      );

      updatedRowsRes.rows.forEach((uRow) => {
        broadcastDebitNoteUpdate("UPSERT", uRow, senderId);
      });

      res.json({
        success: true,
        file_path: relativePath,
        updated_count: rowIds.length,
      });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  },
);

router.post("/api/save-row", verifyVatTrackerCode, async (req, res) => {
  try {
    const {
      id,
      received_date,
      submitted_date,
      month_year,
      approved_by,
      particulars,
      plate_no,
      auto_plate_id,
      driver_name,
      site,
      company,
      customer,
      amount,
      vat_status,
      qc_entry,
      owner_name,
      status,
      ref_no,
      work_order,
      remark,
      attachment_path,
    } = req.body;

    const numAmount = parseFloat(amount) || 0;
    const numQcEntry =
      qc_entry !== null &&
      qc_entry !== undefined &&
      String(qc_entry).trim() !== ""
        ? parseFloat(qc_entry)
        : null;

    const cleanPlateVal = plate_no ? plate_no.trim().toUpperCase() : "";
    let finalAutoId = (auto_plate_id || "").trim();

    const hasData =
      cleanPlateVal !== "" ||
      (particulars && particulars.trim() !== "") ||
      numAmount > 0 ||
      (received_date && received_date.trim() !== "") ||
      (numQcEntry !== null && numQcEntry > 0);

    if (!id && !hasData) {
      return res.json({ success: false, message: "Empty row ignored" });
    }
    const isExcluded = String(vat_status).toLowerCase() === "excluded";
    const vatAmount = isExcluded
      ? parseFloat((numAmount * 0.15).toFixed(2))
      : 0.0;
    const totalAmount = parseFloat((numAmount + vatAmount).toFixed(2));

    let finalId = id;
    const cleanReceivedDate =
      received_date && String(received_date).trim() !== ""
        ? String(received_date).trim()
        : null;
    const cleanSubmittedDate =
      submitted_date && String(submitted_date).trim() !== ""
        ? String(submitted_date).trim()
        : null;

    if (id) {
      const oldMetaRes = await pool.query(
        `SELECT attachment_path, auto_plate_id FROM debit_notes WHERE id = $1`,
        [id],
      );
      if (!cleanPlateVal) {
        finalAutoId =
          (oldMetaRes.rows[0]?.auto_plate_id || "").trim() ||
          finalAutoId ||
          (await generateNextAutoPlateId());
      } else {
        finalAutoId = oldMetaRes.rows[0]?.auto_plate_id || finalAutoId || "";
      }

      let updatedAttachmentPath = attachment_path || null;
      const existingAttPath =
        updatedAttachmentPath || oldMetaRes.rows[0]?.attachment_path || null;

      const isSharedRefFile =
        existingAttPath &&
        path.basename(existingAttPath).toUpperCase().startsWith("REF_");

      if (existingAttPath && !isSharedRefFile) {
        const oldFull = path.join(
          __dirname,
          "../public",
          existingAttPath.replace(/^\/+/, ""),
        );
        if (fs.existsSync(oldFull)) {
          const ext = path.extname(oldFull) || ".pdf";
          const newFileName = buildDebitNoteFileName({
            rowId: id,
            plateNo: cleanPlateVal,
            autoPlateId: finalAutoId,
            monthYear: month_year,
            particulars,
            ext,
          });
          const newFull = path.join(uploadDir, newFileName);

          if (oldFull !== newFull && !fs.existsSync(newFull)) {
            try {
              fs.renameSync(oldFull, newFull);
              updatedAttachmentPath = `/uploads/Debit_Note/${newFileName}`;
            } catch (renErr) {
              console.warn(
                "Debit note attachment rename skipped:",
                renErr.message,
              );
            }
          }
        } else {
          updatedAttachmentPath = null;
          await pool.query(
            `UPDATE debit_notes SET attachment_path = NULL WHERE id = $1`,
            [id],
          );
        }
      }

      await pool.query(
        `UPDATE debit_notes SET
          received_date = $1::date,
          submitted_date = $2::date,
          month_year = $3,
          approved_by = $4,
          particulars = $5,
          plate_no = $6,
          auto_plate_id = $7,
          driver_name = $8,
          site = $9,
          company = $10,
          customer = $11,
          amount = $12,
          vat_status = $13,
          vat_amount = $14,
          total_amount = $15,
          qc_entry = $16,
          owner_name = $17,
          status = $18,
          ref_no = $19,
          work_order = $20,
          remark = $21,
          attachment_path = COALESCE($22, attachment_path),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $23`,
        [
          cleanReceivedDate,
          cleanSubmittedDate,
          month_year || null,
          approved_by || null,
          particulars || null,
          cleanPlateVal || null,
          finalAutoId || null,
          driver_name || null,
          site || null,
          company || null,
          customer || null,
          numAmount,
          vat_status || "Included",
          vatAmount,
          totalAmount,
          numQcEntry,
          owner_name || null,
          status || "Received",
          ref_no || null,
          work_order || null,
          remark || null,
          updatedAttachmentPath,
          id,
        ],
      );
    } else {
      if (!cleanPlateVal && !finalAutoId) {
        finalAutoId = await generateNextAutoPlateId();
      }

      const insertRes = await pool.query(
        `INSERT INTO debit_notes (
          received_date, submitted_date, month_year, approved_by, particulars, plate_no, auto_plate_id,
          driver_name, site, company, customer, amount, vat_status, vat_amount, total_amount,
          qc_entry, owner_name, status, ref_no, work_order, remark, attachment_path
        ) VALUES ($1::date, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING id`,
        [
          cleanReceivedDate,
          cleanSubmittedDate,
          month_year || null,
          approved_by || null,
          particulars || null,
          cleanPlateVal || null,
          finalAutoId || null,
          driver_name || null,
          site || null,
          company || null,
          customer || null,
          numAmount,
          vat_status || "Included",
          vatAmount,
          totalAmount,
          numQcEntry,
          owner_name || null,
          status || "Received",
          ref_no || null,
          work_order || null,
          remark || null,
          attachment_path || null,
        ],
      );
      finalId = insertRes.rows[0].id;
    }

    const senderId = req.headers["x-client-id"] || null;

    let sealResult = { success: false, reason: "NOT_REQUESTED" };
    if (String(status).trim().toLowerCase() === "signed") {
      const fileQuery = await pool.query(
        `SELECT attachment_path, company FROM debit_notes WHERE id = $1`,
        [finalId],
      );

      if (fileQuery.rows.length > 0 && fileQuery.rows[0].attachment_path) {
        const relPath = fileQuery.rows[0].attachment_path;
        const fullDiskPath = path.join(__dirname, "../public", relPath);
        const comp = fileQuery.rows[0].company || company;
        sealResult = await applySealToPdf(fullDiskPath, comp);
      }
    }

    const broadcastRowRes = await pool.query(
      `SELECT id, TO_CHAR(received_date, 'YYYY-MM-DD') AS received_date, TO_CHAR(submitted_date, 'YYYY-MM-DD') AS submitted_date,
       month_year, approved_by, particulars, plate_no, COALESCE(auto_plate_id, '') AS auto_plate_id,
       driver_name, site, company, customer,
       COALESCE(amount, 0) as amount, vat_status, COALESCE(vat_amount, 0) as vat_amount, COALESCE(total_amount, 0) as total_amount,
       COALESCE(qc_entry, 0) as qc_entry,
       owner_name, status, ref_no, work_order, remark, attachment_path FROM debit_notes WHERE id = $1`,
      [finalId],
    );

    if (broadcastRowRes.rows.length > 0) {
      const bRow = broadcastRowRes.rows[0];
      if (bRow.attachment_path) {
        const fullP = path.join(
          __dirname,
          "../public",
          bRow.attachment_path.replace(/^\/+/, ""),
        );
        if (!fs.existsSync(fullP)) {
          bRow.attachment_path = null;
        }
      }
      broadcastDebitNoteUpdate("UPSERT", bRow, senderId);
    }

    const latestAttPath =
      broadcastRowRes.rows.length > 0
        ? broadcastRowRes.rows[0].attachment_path
        : updatedAttachmentPath;

    res.json({
      success: true,
      id: finalId,
      auto_plate_id: finalAutoId || "",
      attachment_path: latestAttPath || null,
      vat_amount: vatAmount,
      total_amount: totalAmount,
      seal_applied: sealResult.success,
      seal_reason: sealResult.reason,
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

router.post("/api/delete-row", verifyVatTrackerCode, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ success: false, message: "ID missing" });

    const prevRes = await pool.query(
      `SELECT attachment_path FROM debit_notes WHERE id = $1`,
      [id],
    );
    const oldAtt = prevRes.rows[0]?.attachment_path || null;

    const senderId = req.headers["x-client-id"] || null;
    await pool.query(`DELETE FROM debit_notes WHERE id = $1`, [id]);

    // Remove file from disk ONLY if no other row references it
    if (oldAtt) {
      const stillUsed = await pool.query(
        `SELECT 1 FROM debit_notes WHERE attachment_path = $1 LIMIT 1`,
        [oldAtt],
      );
      if (stillUsed.rows.length === 0) {
        const fullDisk = path.join(
          __dirname,
          "../public",
          oldAtt.replace(/^\/+/, ""),
        );
        if (fs.existsSync(fullDisk)) {
          try {
            fs.unlinkSync(fullDisk);
          } catch (e) {}
        }
      }
    }

    broadcastDebitNoteUpdate("DELETE", { id }, senderId);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;
