const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Get ALL users
router.get('/all-users', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, role, status FROM equipment_users ORDER BY id ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).json({ message: "Server error fetching users." });
    }
});

// Update user status (Approve / Suspend / Reject)
router.post('/update-status', async (req, res) => {
    const { id, status } = req.body;
    try {
        await pool.query(
            `UPDATE equipment_users SET status = $1 WHERE id = $2`,
            [status, id]
        );
        res.json({ success: true, message: `User status updated to ${status}` });
    } catch (err) {
        console.error("Error updating status:", err);
        res.status(500).json({ message: "Server error updating status." });
    }
});

// Promote user to Super Admin
router.post('/make-super-admin', async (req, res) => {
    const { id } = req.body;
    try {
        await pool.query(
            `UPDATE equipment_users SET role = 'super_admin' WHERE id = $1`,
            [id]
        );
        res.json({ success: true, message: "User promoted to Super Admin" });
    } catch (err) {
        console.error("Error promoting user:", err);
        res.status(500).json({ message: "Server error promoting user." });
    }
});

// Demote Super Admin back to normal User
router.post('/demote-user', async (req, res) => {
    const { id } = req.body;
    
    // Protect Primary Super Admin (ID 1) from being demoted
    if (id === 1) {
        return res.status(403).json({ message: "Cannot demote the primary Super Admin." });
    }

    try {
        await pool.query(
            `UPDATE equipment_users SET role = 'user' WHERE id = $1`,
            [id]
        );
        res.json({ success: true, message: "Super Admin rights removed." });
    } catch (err) {
        console.error("Error demoting user:", err);
        res.status(500).json({ message: "Server error demoting user." });
    }
});

// Delete a user
router.delete('/delete-user/:id', async (req, res) => {
    // Protect Primary Super Admin (ID 1) from being deleted
    if (parseInt(req.params.id) === 1) {
        return res.status(403).json({ message: "Cannot delete the primary Super Admin." });
    }

    try {
        await pool.query(`DELETE FROM equipment_users WHERE id = $1`, [req.params.id]);
        res.json({ success: true, message: "User deleted successfully" });
    } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).json({ message: "Server error deleting user." });
    }
});

module.exports = router;