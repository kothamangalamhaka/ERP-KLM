const express = require("express");
const pool = require("../config/db");
const axios = require("axios");
const jwt = require("jsonwebtoken"); // Ithu puthiyathayi add cheythu
const {
  verifyToken,
  verifyEditor,
  verifySuperAdmin,
} = require("../middlewares/auth");
const router = express.Router();

// ==========================================
// ADMIN LOGIN API FOR ZOHO HUB
// ==========================================
router.post("/api/zoho/admin-login", (req, res) => {
  const { username, password } = req.body;

  // .env file-il ninnu credentials edukkunnu
  const validUser = process.env.ZOHO_ADMIN_USER;
  const validPass = process.env.ZOHO_ADMIN_PASS;

  if (username === validUser && password === validPass) {
    // verifyEditor middleware pass aavan vendi 'Super Admin' role kodukkunnu
    const token = jwt.sign(
      { id: "zoho_admin", username: validUser, role: "Super Admin" },
      process.env.JWT_SECRET,
      { expiresIn: "24h" },
    );
    res.json({ success: true, token });
  } else {
    res.json({ success: false, message: "Invalid Username or Password!" });
  }
});

// ==========================================
// 1. ZOHO COMPANIES APIs
// ==========================================

// Get all companies
router.get("/api/zoho/companies", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM zoho_companies ORDER BY id ASC",
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Add or Update a Company
router.post("/api/zoho/company", verifyEditor, async (req, res) => {
  try {
    const {
      id,
      company_name,
      zoho_org_id,
      client_id,
      client_secret,
      refresh_token,
    } = req.body;

    if (id) {
      await pool.query(
        `UPDATE zoho_companies 
                 SET company_name=$1, zoho_org_id=$2, client_id=$3, client_secret=$4, refresh_token=$5 
                 WHERE id=$6`,
        [
          company_name,
          zoho_org_id,
          client_id,
          client_secret,
          refresh_token,
          id,
        ],
      );
    } else {
      await pool.query(
        `INSERT INTO zoho_companies (company_name, zoho_org_id, client_id, client_secret, refresh_token) 
                 VALUES ($1, $2, $3, $4, $5)`,
        [company_name, zoho_org_id, client_id, client_secret, refresh_token],
      );
    }
    res.json({ success: true, message: "Company saved successfully!" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Delete a Company
router.post("/api/zoho/company/delete", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("DELETE FROM zoho_companies WHERE id=$1", [id]);
    res.json({ success: true, message: "Company deleted successfully." });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ==========================================
// 2. ZOHO PROJECT MAPPINGS APIs
// ==========================================

// Get all project mappings with company name info
router.get("/api/zoho/projects", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT pm.*, c.company_name, c.zoho_org_id 
            FROM zoho_project_mappings pm
            JOIN zoho_companies c ON pm.company_id = c.id
            ORDER BY pm.id ASC
        `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Add or Update a Project Mapping
router.post("/api/zoho/project", verifyEditor, async (req, res) => {
  try {
    const { id, company_id, erp_site_keyword, zoho_project_name } = req.body;

    // Clean keyword to lower case to make matching easier and safe
    const cleanKeyword = erp_site_keyword.trim().toLowerCase();

    if (id) {
      await pool.query(
        `UPDATE zoho_project_mappings 
                 SET company_id=$1, erp_site_keyword=$2, zoho_project_name=$3 
                 WHERE id=$4`,
        [company_id, cleanKeyword, zoho_project_name, id],
      );
    } else {
      await pool.query(
        `INSERT INTO zoho_project_mappings (company_id, erp_site_keyword, zoho_project_name) 
                 VALUES ($1, $2, $3)`,
        [company_id, cleanKeyword, zoho_project_name],
      );
    }
    res.json({ success: true, message: "Project mapping saved successfully!" });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// Delete a Project Mapping
router.post("/api/zoho/project/delete", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("DELETE FROM zoho_project_mappings WHERE id=$1", [id]);
    res.json({ success: true, message: "Project mapping deleted." });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ==========================================
// 3. CORE ZOHO FETCH LOGIC WITH JOIN MAPPING
// ==========================================

async function getZohoAccessToken(clientId, clientSecret, refreshToken) {
  const tokenUrl = "https://accounts.zoho.sa/oauth/v2/token";
  const tokenParams = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const response = await axios.post(tokenUrl, tokenParams);
  return response.data.access_token;
}

// Normalized Invoice Fetching Integration Route
router.post("/api/zoho/test-fetch", verifyToken, async (req, res) => {
  try {
    const { plate_no, full_site_name } = req.body; // e.g., plate_no: '8859 KEB', full_site_name: 'Bisha L&T'
    const searchSite = full_site_name.trim().toLowerCase();

    // Join query to find matching rule using keyword logic inside full site name
    const mappingResult = await pool.query(
      `SELECT pm.*, c.zoho_org_id, c.client_id, c.client_secret, c.refresh_token, c.company_name 
             FROM zoho_project_mappings pm
             JOIN zoho_companies c ON pm.company_id = c.id
             WHERE $1 ILIKE '%' || pm.erp_site_keyword || '%' LIMIT 1`,
      [searchSite],
    );

    if (mappingResult.rows.length === 0) {
      return res.json({
        success: false,
        message:
          "No matching Zoho project mapping found for this site keyword.",
      });
    }

    const match = mappingResult.rows[0];

    // Access Token Generation
    const accessToken = await getZohoAccessToken(
      match.client_id,
      match.client_secret,
      match.refresh_token,
    );

    // Fetch invoices via search text (Plate No matching inside description)
    const invoiceUrl = `https://www.zohoapis.sa/books/v3/invoices?organization_id=${match.zoho_org_id}&search_text=${encodeURIComponent(plate_no)}`;
    const config = {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    };

    const invoiceResponse = await axios.get(invoiceUrl, config);
    const allInvoices = invoiceResponse.data.invoices;

    // Perfect filtering: Project name handle cheyyaan
    // Note: Real filter applied once project response logic maps with Zoho response keys
    res.json({
      success: true,
      matched_company: match.company_name,
      keyword_used: match.erp_site_keyword,
      zoho_project_target: match.zoho_project_name,
      total_found: allInvoices.length,
      data: allInvoices,
    });
  } catch (error) {
    console.error(
      "Zoho Normalized Fetch Error:",
      error.response ? error.response.data : error.message,
    );
    res.json({
      success: false,
      message: "Error running normalized fetch from Zoho API",
    });
  }
});

module.exports = router;
