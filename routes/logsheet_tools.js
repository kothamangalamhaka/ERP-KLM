const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const sharp = require("sharp");

let pdfLib;
try {
  pdfLib = require("pdf-lib");
} catch (e) {
  console.warn("pdf-lib not loaded:", e.message);
}

const { verifyEditor } = require("../middlewares/auth");

const router = express.Router();

const BASE_DIR = path.resolve(
  process.env.LOGSHEET_BASE_PATH || "/home/fefei/Server_DB",
);

function resolveSafePath(relPath) {
  if (!relPath || typeof relPath !== "string") return null;
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(BASE_DIR, cleaned);
  if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

async function syncSambaPermissions(targetPath, isDir = false) {
  try {
    await fs.promises.chmod(targetPath, isDir ? 0o775 : 0o664);
    const baseStat = await fs.promises.stat(BASE_DIR);
    await fs.promises.chown(targetPath, baseStat.uid, baseStat.gid);
  } catch (_) {}
}

// 1. ROTATE & SAVE DIRECTLY ON LOCAL DISK
router.post("/rotate-file", verifyEditor, async (req, res) => {
  try {
    const { filePath, rotation } = req.body;
    if (!filePath) {
      return res
        .status(400)
        .json({ success: false, message: "No path provided" });
    }

    const absPath = resolveSafePath(filePath);
    if (!absPath) {
      return res.status(403).json({ success: false, message: "Invalid path" });
    }

    if (!fs.existsSync(absPath)) {
      return res
        .status(404)
        .json({ success: false, message: "File not found" });
    }

    const ext = path.extname(absPath).toLowerCase();
    const rotDeg = parseInt(rotation, 10) || 0;

    if (rotDeg === 0 || rotDeg % 90 !== 0) {
      return res.json({ success: true, message: "No rotation needed" });
    }

    const fileBuffer = await fs.promises.readFile(absPath);

    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      const rotatedBuffer = await sharp(fileBuffer)
        .rotate(rotDeg)
        .withMetadata()
        .toBuffer();

      await fs.promises.writeFile(absPath, rotatedBuffer);
      await syncSambaPermissions(absPath, false);
      return res.json({
        success: true,
        message: "Image rotated and saved successfully",
      });
    } else if (ext === ".pdf") {
      if (!pdfLib || !pdfLib.PDFDocument) {
        return res
          .status(500)
          .json({ success: false, message: "pdf-lib library not installed" });
      }

      const pdfDoc = await pdfLib.PDFDocument.load(fileBuffer);
      const pages = pdfDoc.getPages();
      pages.forEach((page) => {
        const currentRot = page.getRotation().angle;
        page.setRotation(pdfLib.degrees((currentRot + rotDeg) % 360));
      });

      const savedBytes = await pdfDoc.save();
      await fs.promises.writeFile(absPath, Buffer.from(savedBytes));
      await syncSambaPermissions(absPath, false);
      return res.json({
        success: true,
        message: "PDF rotated and saved successfully",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported file type for rotation",
      });
    }
  } catch (err) {
    console.error("Local Rotate Save Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. RENAME FILE ON LOCAL DISK
router.post("/rename-file", verifyEditor, async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath) {
      return res
        .status(400)
        .json({ success: false, message: "Old path missing" });
    }

    const absOldPath = resolveSafePath(oldPath);
    if (!absOldPath) {
      return res.status(403).json({ success: false, message: "Invalid path" });
    }

    if (!fs.existsSync(absOldPath)) {
      return res.status(404).json({
        success: false,
        message: "Original file not found",
      });
    }

    const relDir = path.posix.dirname(oldPath);
    const absDir = path.dirname(absOldPath);
    const ext = path.extname(absOldPath);
    let cleanBaseName = path.basename(newName, ext).trim();

    cleanBaseName = cleanBaseName.replace(/[/\\?%*:|"<>]/g, "-");
    if (!cleanBaseName) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid file name" });
    }

    const newFileName = cleanBaseName + ext;
    const absTargetPath = path.join(absDir, newFileName);
    const relTargetPath = path.posix.join(relDir, newFileName);

    if (absOldPath !== absTargetPath && fs.existsSync(absTargetPath)) {
      return res.status(400).json({
        success: false,
        message: "A file with this name already exists",
      });
    }

    await fs.promises.rename(absOldPath, absTargetPath);
    await syncSambaPermissions(absTargetPath, false);
    res.json({
      success: true,
      newPath: relTargetPath,
      newBaseName: newFileName,
    });
  } catch (err) {
    console.error("Local Rename Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. EXTRACT PDF TO IMAGES & MOVE PDF TO TEMP ON LOCAL DISK
router.post("/extract-pdf", verifyEditor, async (req, res) => {
  const tempLocalDir = path.join(os.tmpdir(), `extract_${Date.now()}`);
  try {
    const { filePath } = req.body;
    if (!filePath) {
      return res
        .status(400)
        .json({ success: false, message: "PDF path missing" });
    }

    const absPdfPath = resolveSafePath(filePath);
    if (!absPdfPath) {
      return res.status(403).json({ success: false, message: "Invalid path" });
    }

    if (!fs.existsSync(absPdfPath)) {
      return res
        .status(404)
        .json({ success: false, message: "PDF not found" });
    }

    const ext = path.extname(absPdfPath).toLowerCase();
    if (ext !== ".pdf") {
      return res
        .status(400)
        .json({ success: false, message: "File is not a PDF" });
    }

    await fs.promises.mkdir(tempLocalDir, { recursive: true });
    const pdfBaseName = path.basename(absPdfPath, ext);
    const outputPrefix = path.join(tempLocalDir, `${pdfBaseName}_img`);

    const cmd = `pdfimages -png "${absPdfPath}" "${outputPrefix}"`;

    exec(cmd, async (error, stdout, stderr) => {
      if (error) {
        console.error("pdfimages exec error:", error, stderr);
        await fs.promises
          .rm(tempLocalDir, { recursive: true, force: true })
          .catch(() => {});
        return res.status(500).json({
          success: false,
          message: "Failed to extract images from PDF",
        });
      }

      try {
        const targetFolder = path.dirname(absPdfPath);

        const localFiles = await fs.promises.readdir(tempLocalDir);
        for (const f of localFiles) {
          if (f.endsWith(".png") || f.endsWith(".jpg")) {
            const srcImgPath = path.join(tempLocalDir, f);
            const destImgPath = path.join(targetFolder, f);
            await fs.promises.copyFile(srcImgPath, destImgPath);
            await syncSambaPermissions(destImgPath, false);
          }
        }

        const tempFolder = path.join(targetFolder, "Temp");
        if (!fs.existsSync(tempFolder)) {
          await fs.promises.mkdir(tempFolder, { recursive: true });
          await syncSambaPermissions(tempFolder, true);
        }

        const targetTempPdfPath = path.join(
          tempFolder,
          path.basename(absPdfPath),
        );
        await fs.promises.rename(absPdfPath, targetTempPdfPath);
        await syncSambaPermissions(targetTempPdfPath, false);

        await fs.promises
          .rm(tempLocalDir, { recursive: true, force: true })
          .catch(() => {});

        res.json({
          success: true,
          message: "Images extracted in original quality. PDF moved to Temp.",
        });
      } catch (fsErr) {
        console.error("Local extract sync error:", fsErr);
        await fs.promises
          .rm(tempLocalDir, { recursive: true, force: true })
          .catch(() => {});
        res.status(500).json({ success: false, message: fsErr.message });
      }
    });
  } catch (err) {
    console.error("Extract PDF Local Error:", err);
    await fs.promises
      .rm(tempLocalDir, { recursive: true, force: true })
      .catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
