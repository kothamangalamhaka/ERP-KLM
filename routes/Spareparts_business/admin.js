const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware: Verify Spare Parts Super Admin
function verifySpSuperAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (
      err ||
      decoded.module !== "spare_parts" ||
      decoded.role !== "Super Admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Super Admin access required." });
    }
    req.spUser = decoded;
    next();
  });
}

// List all users
router.get("/users", verifySpSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, display_name, username, email, role, status, created_at
       FROM spare_parts_users
       ORDER BY CASE WHEN status = 'Pending' THEN 0 ELSE 1 END, created_at DESC`,
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error("SP Admin List Error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load users." });
  }
});

// Approve / Reject / Change Role
router.post("/update-status", verifySpSuperAdmin, async (req, res) => {
  try {
    const { userId, status, role } = req.body;
    if (Number(userId) === Number(req.spUser.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot modify your own account." });
    }

    const allowedStatus = ["Active", "Pending", "Rejected"];
    const allowedRole = ["User", "Super Admin"];
    if (!allowedStatus.includes(status) || !allowedRole.includes(role)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status or role." });
    }

    await pool.query(
      "UPDATE spare_parts_users SET status = $1, role = $2 WHERE id = $3",
      [status, role, userId],
    );
    res.json({
      success: true,
      message: `User updated to ${status} (${role}).`,
    });
  } catch (err) {
    console.error("SP Admin Update Error:", err.message);
    res.status(500).json({ success: false, message: "Update failed." });
  }
});

// Reset User Password
router.post("/reset-password", verifySpSuperAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 4 characters.",
      });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE spare_parts_users SET password_hash = $1 WHERE id = $2",
      [hash, userId],
    );
    res.json({ success: true, message: "Password reset successful." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Password reset failed." });
  }
});

// Delete User
router.delete("/delete-user/:id", verifySpSuperAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === Number(req.spUser.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot delete your own account." });
    }
    await pool.query("DELETE FROM spare_parts_users WHERE id = $1", [targetId]);
    res.json({ success: true, message: "User deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: "Delete failed." });
  }
});

module.exports = router;
