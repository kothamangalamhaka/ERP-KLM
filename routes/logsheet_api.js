process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const router = express.Router();
const { createClient } = require("webdav");
const { verifyToken } = require("../middlewares/auth");

const ncUrl = process.env.NEXTCLOUD_URL;
const ncUser = process.env.NEXTCLOUD_USER;
const ncPass = process.env.NEXTCLOUD_PASS;

const client = createClient(ncUrl, {
  username: ncUser,
  password: ncPass,
});

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

    // 🟢 Check all possible combinations (Short year vs Full year & Spaced vs No Space)
    const possiblePaths = [
      `/Log Sheet/${year}/${folderNameShort}/${plateNoSpaced}`,
      `/Log Sheet/${year}/${folderNameShort}/${plateNoClean}`,
      `/Log Sheet/${year}/${folderNameFull}/${plateNoSpaced}`,
      `/Log Sheet/${year}/${folderNameFull}/${plateNoClean}`,
    ];

    let targetPath = null;

    // Loop through combinations and find the exact matching folder
    for (const p of possiblePaths) {
      if (await client.exists(p)) {
        targetPath = p;
        break;
      }
    }

    if (!targetPath) {
      return res.json({
        success: true,
        files: [],
        message: "No files found. Folder path might be different in Nextcloud.",
      });
    }

    const directoryItems = await client.getDirectoryContents(targetPath);
    // Filter only files (images and pdfs)
    const files = directoryItems.filter(
      (item) =>
        item.type === "file" &&
        (item.mime.includes("image") || item.mime.includes("pdf")),
    );

    res.json({ success: true, files: files });
  } catch (error) {
    console.error("WebDAV List Error:", error);
    res.json({ success: false, message: error.message });
  }
});

// 2. Fetch/Stream Specific File
router.get("/file", async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send("No path provided");

    // Set Headers based on extension
    if (filePath.toLowerCase().endsWith(".pdf")) {
      res.setHeader("Content-Type", "application/pdf");
    }

    // Stream the file directly from Nextcloud to the client
    const readStream = client.createReadStream(filePath);
    readStream.pipe(res);
  } catch (error) {
    console.error("WebDAV File Fetch Error:", error);
    res.status(500).send("Error fetching file");
  }
});

module.exports = router;
