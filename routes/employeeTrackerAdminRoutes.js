const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Get ALL users
router.get('/all-users', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, role, status FROM employloguser ORDER BY id ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).json({ message: "Server error fetching users." });
    }
});

// Update user status
router.post('/update-status', async (req, res) => {
    const { id, status } = req.body;
    try {
        await pool.query(
            `UPDATE employloguser SET status = $1 WHERE id = $2`,
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
            `UPDATE employloguser SET role = 'super_admin' WHERE id = $1`,
            [id]
        );
        res.json({ success: true, message: "User promoted to Super Admin" });
    } catch (err) {
        console.error("Error promoting user:", err);
        res.status(500).json({ message: "Server error promoting user." });
    }
});

// Demote Super Admin
router.post('/demote-user', async (req, res) => {
    const { id } = req.body;
    if (id === 1) return res.status(403).json({ message: "Cannot demote the primary Super Admin." });

    try {
        await pool.query(
            `UPDATE employloguser SET role = 'user' WHERE id = $1`,
            [id]
        );
        res.json({ success: true, message: "Super Admin rights removed." });
    } catch (err) {
        console.error("Error demoting user:", err);
        res.status(500).json({ message: "Server error demoting user." });
    }
});

// Delete a user
const verifySuperAdmin = require('../middlewares/auth').verifySuperAdmin; // അഥവാ മിഡിൽവെയർ ഇമ്പോർട്ട് ചെയ്തിട്ടുണ്ടെങ്കിൽ

router.delete('/delete-user/:id', verifySuperAdmin, async (req, res) => {
    const { deleteSecret } = req.body;

    if (deleteSecret !== process.env.DELETE_SECRET) {
        return res.status(403).json({ success: false, message: "Access Denied: Invalid Delete Security Key." });
    }

    if (parseInt(req.params.id) === 1) {
        return res.status(403).json({ success: false, message: "Cannot delete the primary Super Admin." });
    }

    try {
        await pool.query(`DELETE FROM equipment_users WHERE id = $1`, [req.params.id]);
        res.json({ success: true, message: "User deleted successfully" });
    } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).json({ success: false, message: "Server error deleting user." });
    }
});

module.exports = router;