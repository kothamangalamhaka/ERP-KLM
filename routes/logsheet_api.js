const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const BASE_DIR = path.resolve(
  process.env.LOGSHEET_BASE_PATH || "/home/fefei/Server_DB",
);

const mimeMap = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
};

function resolveSafePath(relPath) {
  if (!relPath || typeof relPath !== "string") return null;
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(BASE_DIR, cleaned);
  if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

// Month Mapping Logic
const monthMap = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

// 1. Get List of Files
router.post("/list", async (req, res) => {
  try {
    const { month, year, plate_no } = req.body;
    if (!month || !year || !plate_no) throw new Error("Missing parameters");

    const shortYear = year.toString().slice(-2); // e.g., 26
    const fullYear = year.toString(); // e.g., 2026

    // 🟢 Generate multiple possible month folder names
    const folderNameShort = `${monthMap[month]}.${month} ${shortYear}`;
    const folderNameFull = `${monthMap[month]}.${month} ${fullYear}`;

    const plateNoClean = plate_no.replace(/\s+/g, ""); // e.g., 7109VDA
    const plateNoSpaced = plate_no; // e.g., 7109 VDA

    // Check all possible combinations (Short year vs Full year & Spaced vs No Space)
    const possibleRelPaths = [
      `/Log Sheet/${year}/${folderNameShort}/${plateNoSpaced}`,
      `/Log Sheet/${year}/${folderNameShort}/${plateNoClean}`,
      `/Log Sheet/${year}/${folderNameFull}/${plateNoSpaced}`,
      `/Log Sheet/${year}/${folderNameFull}/${plateNoClean}`,
    ];

    let targetRelPath = null;
    let targetAbsPath = null;

    for (const relP of possibleRelPaths) {
      const absP = resolveSafePath(relP);
      if (!absP) continue;
      try {
        const stat = await fs.promises.stat(absP);
        if (stat.isDirectory()) {
          targetRelPath = relP;
          targetAbsPath = absP;
          break;
        }
      } catch (_) {}
    }

    if (!targetAbsPath) {
      return res.json({
        success: true,
        files: [],
        message: "No files found. Folder path might be different.",
      });
    }

    const entries = await fs.promises.readdir(targetAbsPath, {
      withFileTypes: true,
    });

    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const mime = mimeMap[ext];
      if (!mime) continue;

      const fileAbsPath = path.join(targetAbsPath, entry.name);
      const stat = await fs.promises.stat(fileAbsPath);

      files.push({
        filename: path.posix.join(targetRelPath, entry.name),
        basename: entry.name,
        type: "file",
        size: stat.size,
        mime: mime,
      });
    }

    res.json({ success: true, files: files });
  } catch (error) {
    console.error("Local Logsheet List Error:", error);
    res.json({ success: false, message: error.message });
  }
});

// 2. Fetch/Stream Specific File
router.get("/file", async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send("No path provided");

    const absPath = resolveSafePath(filePath);
    if (!absPath) return res.status(403).send("Invalid path");

    try {
      const stat = await fs.promises.stat(absPath);
      if (!stat.isFile()) return res.status(404).send("File not found");
      res.setHeader("Content-Length", stat.size);
    } catch (_) {
      return res.status(404).send("File not found");
    }

    const ext = path.extname(absPath).toLowerCase();
    if (mimeMap[ext]) {
      res.setHeader("Content-Type", mimeMap[ext]);
    }

    const readStream = fs.createReadStream(absPath);
    readStream.on("error", (err) => {
      console.error("Local Logsheet Stream Error:", err);
      if (!res.headersSent) res.status(500).send("Error reading file");
    });
    readStream.pipe(res);
  } catch (error) {
    console.error("Local Logsheet File Fetch Error:", error);
    if (!res.headersSent) res.status(500).send("Error fetching file");
  }
});

module.exports = router;
