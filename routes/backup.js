const cron = require('node-cron');
const { exec } = require('child_process');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ==========================================
// BACKUP CONFIGURATION
// ==========================================
// You can add multiple emails in the future separated by commas.
// Example: 'kothamangalamhaka@gmail.com, partner@gmail.com, admin@domain.com'
const BACKUP_EMAILS = 'kothamangalamhaka@gmail.com';

// Schedule configured for 2:00 AM IST Daily
cron.schedule('0 2 * * *', () => {
    console.log('Initiating complete database backup at 2:00 AM IST...');
    performBackupAndEmail();
}, {
    scheduled: true,
    timezone: "Asia/Kolkata" // Forces the job to run exactly at Indian Standard Time
});

async function performBackupAndEmail() {
    // Generate date string for the file name (YYYY-MM-DD format)
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `Haka_ERP_Full_Backup_${dateStr}.sql`;
    const backupPath = path.join(__dirname, fileName);

    // pg_dump extracts the ENTIRE database (all current and future tables) securely
    const dumpCommand = `PGPASSWORD="${process.env.DB_PASS}" pg_dump -U ${process.env.DB_USER} -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -d ${process.env.DB_NAME} -F p -f "${backupPath}"`;

    exec(dumpCommand, async (error, stdout, stderr) => {
        if (error) {
            console.error('Database Backup Failed:', error);
            return;
        }

        console.log(`Full backup created successfully: ${fileName}`);

        try {
            // Setup email transporter
            let transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });

            // Email properties
            const mailOptions = {
                from: `"Haka Timesheet ERP" <${process.env.EMAIL_USER}>`,
                to: BACKUP_EMAILS,
                subject: `Automated Full DB Backup - ${dateStr}`,
                text: `Hello,\n\nPlease find attached the complete database backup for ${dateStr}. This file contains all tables, records, and data structures. Keep this file secure.\n\nRegards,\nHaka ERP System`,
                attachments: [
                    {
                        filename: fileName,
                        path: backupPath
                    }
                ]
            };

            // Send Email
            await transporter.sendMail(mailOptions);
            console.log(`Backup sent successfully to: ${BACKUP_EMAILS}`);

            // Delete local file after sending to save server disk space
            fs.unlink(backupPath, (err) => {
                if (err) console.error('Error deleting local backup file:', err);
                else console.log('Temporary local backup file removed.');
            });

        } catch (mailError) {
            console.error('Failed to send backup email:', mailError);
        }
    });
}

performBackupAndEmail();