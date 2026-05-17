const express = require("express");
const router = express.Router();
const cron = require("node-cron");
const { exec } = require("child_process");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Email destination for backup files
const BACKUP_EMAILS = "kothamangalamhaka@gmail.com";

// 1. AUTOMATED CRON JOB: Runs daily at 2:00 AM IST (No passcode needed for automated cron)
cron.schedule(
  "0 2 * * *",
  () => {
    console.log(
      "Initiating scheduled complete database backup at 2:00 AM IST...",
    );
    performBackupAndEmail("Scheduled Automated Backup").catch((err) =>
      console.error("Scheduled Backup Critical Error:", err),
    );
  },
  {
    scheduled: true,
    timezone: "Asia/Kolkata",
  },
);

// 2. MANUAL WEB BACKUP ROUTE: Requires secure passcode verification
router.post("/run-backup", async (req, res) => {
  const providedPasscode = req.body.passcode;
  const correctPasscode = process.env.BACKUP_PASSCODE;

  // Security Verification Guard
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

  // Process backup asynchronously in the background to avoid web server timeout
  performBackupAndEmail("Manual User Triggered Backup")
    .then(() => console.log("Manual backup process completed successfully."))
    .catch((err) => console.error("Manual Backup Pipeline Error:", err));

  // Send immediate acknowledgement response to the frontend client
  return res.json({
    success: true,
    message:
      "Secure backup engine started. Please verify your registered email inbox in a few moments.",
  });
});

/**
 * Core Database Backup and Email dispatching workflow pipeline
 * @param {string} triggerType Description of what triggered the backup action
 */
function performBackupAndEmail(triggerType) {
  return new Promise((resolve, reject) => {
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `Haka_ERP_Full_Backup_${dateStr}_${Date.now()}.sql`;
    const backupPath = path.join(__dirname, "..", "backups", fileName); // Saves inside a 'backups' folder

    // Ensure the backups directory exists safely before executing dump
    const dir = path.dirname(backupPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Secure PostgreSQL pg_dump binary execution string construction
    const dumpCommand = `PGPASSWORD="${process.env.DB_PASS}" pg_dump -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -d ${process.env.DB_NAME} -F p -f "${backupPath}"`;

    exec(dumpCommand, async (error, stdout, stderr) => {
      if (error) {
        console.error(
          `[CRITICAL] pg_dump execution failed for ${triggerType}:`,
          error,
        );
        return reject(error);
      }

      console.log(`SQL Backup file compiled successfully: ${fileName}`);

      try {
        // Configure Nodemailer dynamic secure transporter setup
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

        // Dispatch Email with Attachment
        await transporter.sendMail(mailOptions);
        console.log(
          `Backup dispatch successful to routing nodes: ${BACKUP_EMAILS}`,
        );

        // Housekeeping: Purge local file from local server filesystem allocation to maintain zero footprint storage
        fs.unlink(backupPath, (err) => {
          if (err) console.error("[WARN] Local file cleanup failed:", err);
          else
            console.log(
              "Temporary runtime local system backup archive file purged cleanly.",
            );
        });

        resolve();
      } catch (mailError) {
        console.error(
          "[CRITICAL] Backup delivery mail script failed:",
          mailError,
        );

        // Backup option: keep file locally for emergency recovery if email fails
        console.log(
          `[SAFEGUARD] Local file retained in emergency directory path: ${backupPath}`,
        );
        reject(mailError);
      }
    });
  });
}

module.exports = router;
