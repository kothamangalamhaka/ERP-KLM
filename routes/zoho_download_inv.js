const express = require('express');
const router = express.Router();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const archiver = require('archiver');
require('dotenv').config();

const VENDORS = {
  "HAKA": { label: "Haka Contracting Est", email: "hakacontractingest", prefix: "HAK-INV" },
  "ALJODA": { label: "AL-JODA SARAA EQUIPMENT RENTAL Est", email: "evotech", prefix: "INV-25" },
  "MASAR": { label: "Etijah Al Masar General Contracting Est", email: "klm haka", prefix: "INV-MW" },
  "WE1": { label: "We1 Track Company", email: "we1trackco", prefix: "INV-WE1" }
};

router.get('/invoice-vendors', (req, res) => {
  res.json(VENDORS);
});

router.post('/invoice-download', (req, res) => {
  const { vendorKey, asZip } = req.body;
  const vendor = VENDORS[vendorKey];

  if (!vendor) {
    return res.status(400).json({ error: "Invalid Vendor Selected" });
  }

  let files = [];
  let processedCount = 0;
  const processedFiles = new Set();

  // Get today's date string in YYYY-MM-DD format
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const imap = new Imap({
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { servername: 'imap.gmail.com' }
  });

  imap.once('ready', () => {
    imap.openBox('INBOX', true, (err, box) => {
      if (err) return res.status(500).json({ error: err.message });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1); 

      imap.search([['SINCE', yesterday], ['FROM', vendor.email]], (err, results) => {
        if (err || !results || !results.length) {
          imap.end();
          return res.json({ count: 0 });
        }

        const fetch = imap.fetch(results, { bodies: '' });

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              if (!err && parsed.date) {
                // Check if the email date matches today's date strictly
                const emailDate = new Date(parsed.date);
                const emailDateStr = `${emailDate.getFullYear()}-${String(emailDate.getMonth() + 1).padStart(2, '0')}-${String(emailDate.getDate()).padStart(2, '0')}`;

                if (emailDateStr === todayStr && parsed.attachments) {
                  parsed.attachments.forEach(attachment => {
                    const fileName = attachment.filename;
                    if (fileName && 
                        fileName.toUpperCase().startsWith(vendor.prefix.toUpperCase()) && 
                        fileName.toLowerCase().endsWith('.pdf') && 
                        !processedFiles.has(fileName)) {
                      
                      processedFiles.add(fileName);
                      files.push({
                        name: fileName,
                        mimeType: attachment.contentType,
                        data: attachment.content.toString('base64'),
                        buffer: attachment.content
                      });
                    }
                  });
                }
              }
              
              processedCount++;
              if (processedCount === results.length) {
                imap.end();
                sendResponse();
              }
            });
          });
        });

        fetch.once('error', (err) => {
          imap.end();
          res.status(500).json({ error: "Fetch error" });
        });
      });
    });
  });

  imap.once('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  imap.connect();

  function sendResponse() {
    if (files.length === 0) {
      return res.json({ count: 0 });
    }

    if (asZip) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename=${vendor.label}_Invoices.zip`);
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      
      files.forEach(file => {
        archive.append(file.buffer, { name: file.name });
      });
      
      archive.finalize();
    } else {
      const jsonFiles = files.map(f => ({ name: f.name, mimeType: f.mimeType, data: f.data }));
      res.json({ isZip: false, count: files.length, files: jsonFiles });
    }
  }
});

module.exports = router;