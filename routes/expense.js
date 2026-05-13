const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs"); // 🟢 Excel Export Library
const { verifyToken } = require("../middlewares/auth");

const JWT_SECRET = process.env.JWT_SECRET || "expense_secure_secret_key";

// 🟢 Secure Admin Login Route
router.post("/login", (req, res) => {
  const { userid, password } = req.body;

  const validUserId = process.env.KLMUID;
  const validPassword = process.env.KLMPSSD;

  if (!validUserId || !validPassword) {
    return res.status(500).json({
      success: false,
      message: "Server credentials not configured properly.",
    });
  }

  if (userid === validUserId && password === validPassword) {
    const token = jwt.sign({ role: "expense_admin" }, JWT_SECRET, {
      expiresIn: "12h",
    });
    res.json({ success: true, token });
  } else {
    res
      .status(401)
      .json({ success: false, message: "Invalid User ID or Password" });
  }
});

router.use(verifyToken);

// 1. Get all entries
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM journal_entries ORDER BY entry_date ASC, id ASC",
    );
    res.json(result.rows);
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server Error Fetching Data" });
  }
});

// 2. Add New Entry
router.post("/add", async (req, res) => {
  try {
    const { date, particulars, ledger, type, amount } = req.body;
    await pool.query(
      "INSERT INTO journal_entries (entry_date, particulars, ledger_head, entry_type, amount) VALUES ($1, $2, $3, $4, $5)",
      [date, particulars, ledger, type, amount],
    );
    res.json({ success: true, message: "Entry Added Successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add entry" });
  }
});

// 3. Update Existing Entry
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { date, particulars, ledger, type, amount } = req.body;
    await pool.query(
      "UPDATE journal_entries SET entry_date=$1, particulars=$2, ledger_head=$3, entry_type=$4, amount=$5 WHERE id=$6",
      [date, particulars, ledger, type, amount, id],
    );
    res.json({ success: true, message: "Entry Updated Successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update entry" });
  }
});

// 4. Secure Delete Entry with Environment Key validation
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { key } = req.body;

    // 🟢 .env ഫയലിൽ നിന്നും പാസ്‌വേഡ് ചെക്ക് ചെയ്യുന്നു
    const validKey = process.env.DELETE_KEY;
    if (!validKey) {
      return res.status(500).json({
        success: false,
        message: "Delete key not configured on server",
      });
    }

    if (key !== validKey) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Delete Security Key" });
    }

    await pool.query("DELETE FROM journal_entries WHERE id=$1", [id]);
    res.json({ success: true, message: "Entry Deleted Successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete entry" });
  }
});

// 5. Excel Export Route 🟢
router.get("/export-excel", async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = "SELECT * FROM journal_entries";
    let params = [];

    if (from && to) {
      query += " WHERE entry_date >= $1 AND entry_date <= $2";
      params = [from, to];
    } else if (from) {
      query += " WHERE entry_date >= $1";
      params = [from];
    } else if (to) {
      query += " WHERE entry_date <= $1";
      params = [to];
    }

    query += " ORDER BY entry_date ASC, id ASC";

    const result = await pool.query(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Expense Report");

    worksheet.columns = [
      { header: "Date", key: "date", width: 15 },
      { header: "Particulars", key: "particulars", width: 40 },
      { header: "Category", key: "category", width: 25 },
      { header: "Source", key: "source", width: 25 },
      { header: "Amount", key: "amount", width: 15 },
    ];

    result.rows.forEach((row) => {
      worksheet.addRow({
        date: new Date(row.entry_date).toLocaleDateString("en-GB"),
        particulars: row.particulars,
        category: row.entry_type,
        source: row.ledger_head,
        amount: parseFloat(row.amount),
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=KLM_Expense_Report.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Export Error:", error);
    res.status(500).send("Error generating Excel: " + error.message);
  }
});

module.exports = router;
