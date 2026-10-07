const express = require("express");
const router = express.Router();
router.use(express.json());
const cron = require("node-cron");
const { exec } = require("child_process");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Fallback logic to ensure environment variables are loaded
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Email destination for backup files
const BACKUP_EMAILS = "kothamangalamhaka@gmail.com";

// Check Node.js Version on startup
const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
if (nodeVersion < 18) {
  console.warn(
    `[WARNING] You are using Node.js v${process.versions.node}. Native 'fetch' and 'Blob' require Node v18+. Telegram backup might fail.`,
  );
}

// 1. AUTOMATED CRON JOB: Runs daily at 2:00 AM IST
cron.schedule(
  "0 2 * * *",
  () => {
    console.log(
      "Initiating scheduled complete database backup at 2:00 AM IST...",
    );
    performBackupAndDispatch("Scheduled Automated Backup").catch((err) =>
      console.error("Scheduled Backup Critical Error:", err),
    );
  },
  {
    scheduled: true,
    timezone: "Asia/Kolkata",
  },
);

// 2. MANUAL WEB BACKUP ROUTE
router.post("/run-backup", async (req, res) => {
  const providedPasscode = req.body.passcode;
  const correctPasscode = process.env.BACKUP_PASSCODE;

  if (!providedPasscode || providedPasscode !== correctPasscode) {
    console.warn(
      `[SECURITY WARN] Unauthorized manual backup attempt from IP: ${req.ip}`,
    );
    return res.status(401).json({
      success: false,
      message: "Invalid Admin Passcode! Access Denied.",
    });
  }

  console.log("Secure Manual backup pipeline triggered via Web UI...");

  // Send immediate response so frontend doesn't timeout
  res.json({
    success: true,
    message:
      "Secure backup engine started. Verification copies are being dispatched...",
  });

  // Process backup asynchronously in the background
  try {
    await performBackupAndDispatch("Manual User Triggered Backup");
    console.log("Manual backup process completed successfully.");
  } catch (err) {
    console.error("Manual Backup Pipeline Error:", err);
  }
});

/**
 * Telegram Dispatching Logic (Native Fetch)
 * Note: Requires Node.js v18 or above
 */
async function sendBackupToTelegram(filePath, fileName, triggerType) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ERP_log_backup_group_CHAT_ID;

    if (!botToken || !chatId) {
      console.error("[WARN] Telegram credentials missing in .env file.");
      return false;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileBlob = new Blob([fileBuffer], { type: "application/sql" });

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("document", fileBlob, fileName);
    formData.append(
      "caption",
      `🔒 System DB Dump | Trigger: ${triggerType} | Status: Success ✅\nSize: ${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendDocument`,
      {
        method: "POST",
        body: formData,
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);

    const result = await response.json();

    if (result.ok) {
      console.log("✅ Backup file successfully delivered to Telegram Group!");
      return true;
    } else {
      console.error("[CRITICAL] Telegram API Error:", result.description);
      return false;
    }
  } catch (error) {
    console.error(
      "[CRITICAL] Failed to send backup to Telegram:",
      error.message,
    );
    return false;
  }
}

/**
 * Core Database Backup Workflow
 */
function performBackupAndDispatch(triggerType) {
  return new Promise((resolve, reject) => {
    // Environment Variables Validation Check
    if (
      !process.env.DB_USER ||
      !process.env.DB_PASS ||
      !process.env.EMAIL_PASS
    ) {
      console.error(
        "[CRITICAL] Environment variables are missing! Ensure .env is properly loaded.",
      );
      return reject(
        new Error(
          "Server configuration error: Missing essential environment variables.",
        ),
      );
    }

    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `Haka_ERP_Full_Backup_${dateStr}_${Date.now()}.sql`;
    const backupPath = path.join(__dirname, "..", "backups", fileName);

    // Create directory safely
    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Log loaded variables to ensure they exist (except passwords)
    console.log("DB_USER:", process.env.DB_USER);
    console.log("DB_HOST:", process.env.DB_HOST);
    console.log("DB_PORT:", process.env.DB_PORT);
    console.log("DB_NAME:", process.env.DB_NAME);
    console.log(
      "DB_PASS:",
      process.env.DB_PASS ? "SET (Hidden for security)" : "NOT SET",
    );

    const dumpCommand = `pg_dump -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -d ${process.env.DB_NAME} -F p -f "${backupPath}"`;

    const execOptions = {
      env: {
        ...process.env,
        PGPASSWORD: process.env.DB_PASS, // Securely pass password to pg_dump
      },
    };

    exec(dumpCommand, execOptions, async (error, stdout, stderr) => {
      if (error) {
        console.error(`[CRITICAL] pg_dump execution failed:`, error);
        return reject(error);
      }

      // Check if file actually exists and has data
      if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
        return reject(
          new Error(
            "Backup file is empty or was not created. Check DB connection.",
          ),
        );
      }

      console.log(`✅ SQL Backup file compiled successfully: ${fileName}`);

      let emailSent = false;
      let telegramSent = false;

      // 1. EMAIL DISPATCH
      try {
        let transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS, // Make sure this is a 16-char Gmail App Password
          },
        });

        const mailOptions = {
          from: `"Haka Timesheet ERP" <${process.env.EMAIL_USER}>`,
          to: BACKUP_EMAILS,
          subject: `🔒 ${triggerType} - System DB Dump - ${dateStr}`,
          text: `Hello Admin,\n\nDatabase backup is attached.\nTrigger: ${triggerType}\nTimestamp: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n\nBest Regards,\nHaka ERP Automation.`,
          attachments: [{ filename: fileName, path: backupPath }],
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Backup dispatch successful to Email.`);
        emailSent = true;
      } catch (mailError) {
        console.error("❌ Backup delivery mail failed:", mailError.message);
      }

      // 2. TELEGRAM DISPATCH
      telegramSent = await sendBackupToTelegram(
        backupPath,
        fileName,
        triggerType,
      );

      // 3. SECURE HOUSEKEEPING
      try {
        if (emailSent && telegramSent) {
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath); // Sync delete to prevent race conditions
            console.log("🧹 Temporary local backup file purged cleanly.");
          }
          resolve();
        } else if (emailSent || telegramSent) {
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
            console.log(
              "⚠️ Partial success (One dispatch failed). Temporary local backup file purged cleanly.",
            );
          }
          resolve();
        } else {
          console.warn(
            `[SAFEGUARD] Both dispatches failed! Local file retained at: ${backupPath}`,
          );
          reject(new Error("Multi-channel backup dispatch failed entirely."));
        }
      } catch (cleanupError) {
        console.error("Error during file cleanup:", cleanupError);
        resolve(); // Resolve anyway so the process doesn't hang
      }
    });
  });
}

module.exports = router;
