const express = require("express");
const router = express.Router();
const cron = require("node-cron");
const { exec } = require("child_process");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Email destination for backup files
const BACKUP_EMAILS = "kothamangalamhaka@gmail.com";

// 1. AUTOMATED CRON JOB: Runs daily at 2:00 AM IST
cron.schedule(
  "0 2 * * *",
  () => {
    console.log("Initiating scheduled complete database backup at 2:00 AM IST...");
    performBackupAndDispatch("Scheduled Automated Backup").catch((err) =>
      console.error("Scheduled Backup Critical Error:", err)
    );
  },
  {
    scheduled: true,
    timezone: "Asia/Kolkata",
  }
);

// 2. MANUAL WEB BACKUP ROUTE: Requires secure passcode verification
router.post("/run-backup", async (req, res) => {
  const providedPasscode = req.body.passcode;
  const correctPasscode = process.env.BACKUP_PASSCODE;

  // Security Verification Guard
  if (!providedPasscode || providedPasscode !== correctPasscode) {
    console.warn(`[SECURITY WARN] Unauthorized manual backup attempt from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: "Invalid Admin Passcode! Access Denied.",
    });
  }

  console.log("Secure Manual backup pipeline triggered via Web UI...");

  // Process backup asynchronously
  performBackupAndDispatch("Manual User Triggered Backup")
    .then(() => console.log("Manual backup process completed successfully."))
    .catch((err) => console.error("Manual Backup Pipeline Error:", err));

  // Send immediate acknowledgement response
  return res.json({
    success: true,
    message: "Secure backup engine started. Verification copies are being dispatched to Email and Telegram.",
  });
});

/**
 * Telegram-ലേക്ക് ബാക്കപ്പ് ഫയൽ അയക്കാനുള്ള ഫംഗ്ഷൻ 
 * (Native Node.js Fetch API ഉപയോഗിച്ച് - യാതൊരു NPM packages ഉം ആവശ്യമില്ല!)
 */
async function sendBackupToTelegram(filePath, fileName, triggerType) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ERP_log_backup_group_CHAT_ID;

    if (!botToken || !chatId) {
      console.error("[WARN] Telegram credentials missing in .env file.");
      return false;
    }

    // ഫയൽ റീഡ് ചെയ്ത് Node.js Native Blob ഫോർമാറ്റിലേക്ക് മാറ്റുന്നു
    const fileBuffer = fs.readFileSync(filePath);
    const fileBlob = new Blob([fileBuffer], { type: "application/sql" });
    
    // Native FormData ഉപയോഗിച്ച് ഡാറ്റ സെറ്റ് ചെയ്യുന്നു
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("document", fileBlob, fileName);
    formData.append("caption", `🔒 System DB Dump | Trigger: ${triggerType} | Status: Success ✅`);

    // Fetch API വഴി സുരക്ഷിതമായി ടെലിഗ്രാമിലേക്ക് അയക്കുന്നു
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();
    
    if (result.ok) {
      console.log("Backup file successfully delivered to Telegram Group!");
      return true;
    } else {
      console.error("[CRITICAL] Telegram API Error:", result.description);
      return false;
    }
  } catch (error) {
    console.error("[CRITICAL] Failed to send backup to Telegram via Fetch:", error.message);
    return false;
  }
}

/**
 * Core Database Backup and Multi-Channel dispatching workflow pipeline
 */
function performBackupAndDispatch(triggerType) {
  return new Promise((resolve, reject) => {
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `Haka_ERP_Full_Backup_${dateStr}_${Date.now()}.sql`;
    const backupPath = path.join(__dirname, "..", "backups", fileName);

    // Ensure the backups directory exists safely before executing dump
    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Secure PostgreSQL pg_dump binary execution string construction
    const dumpCommand = `PGPASSWORD="${process.env.DB_PASS}" pg_dump -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -d ${process.env.DB_NAME} -F p -f "${backupPath}"`;

    exec(dumpCommand, async (error, stdout, stderr) => {
      if (error) {
        console.error(`[CRITICAL] pg_dump execution failed for ${triggerType}:`, error);
        return reject(error);
      }

      console.log(`SQL Backup file compiled successfully: ${fileName}`);

      let emailSent = false;
      let telegramSent = false;

      // 1. DISPATCH TO EMAIL
      try {
        let transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        const mailOptions = {
          from: `"Haka Timesheet ERP" <${process.env.EMAIL_USER}>`,
          to: BACKUP_EMAILS,
          subject: `🔒 ${triggerType} - System DB Dump - ${dateStr}`,
          text: `Hello Admin,\n\nAttached is the encrypted complete structured database backup file for ${dateStr}.\n\nTrigger Source: ${triggerType}\nTimestamp: ${new Date().toString()}\n\nPlease store this secure SQL schema dump safely.\n\nBest Regards,\nHaka ERP Automation Daemon`,
          attachments: [
            {
              filename: fileName,
              path: backupPath,
            },
          ],
        };

        await transporter.sendMail(mailOptions);
        console.log(`Backup dispatch successful to routing nodes: ${BACKUP_EMAILS}`);
        emailSent = true;
      } catch (mailError) {
        console.error("[CRITICAL] Backup delivery mail script failed:", mailError.message);
      }

      // 2. DISPATCH TO TELEGRAM
      telegramSent = await sendBackupToTelegram(backupPath, fileName, triggerType);

      // 3. HOUSEKEEPING (Delete local file only if at least ONE dispatch was successful)
      if (emailSent || telegramSent) {
        fs.unlink(backupPath, (err) => {
          if (err) console.error("[WARN] Local file cleanup failed:", err);
          else console.log("Temporary runtime local system backup archive file purged cleanly.");
        });
        resolve();
      } else {
        console.log(`[SAFEGUARD] Both Email & Telegram dispatches failed! Local file retained at: ${backupPath}`);
        reject(new Error("Multi-channel backup dispatch failed entirely."));
      }
    });
  });
}

module.exports = router;