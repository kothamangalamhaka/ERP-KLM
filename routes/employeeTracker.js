const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const multer = require('multer');
const path = require('path');

// Multer Storage Setup for Images & Documents
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'image') {
            cb(null, 'public/uploads/employee_images/');
        } else {
            cb(null, 'public/uploads/employee_docs/');
        }
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// 1. Get All Employees with Category Filter
router.get('/all', async (req, res) => {
    try {
        const { category } = req.query;
        // 'All' category defaults to newest first
        let query = 'SELECT * FROM employees ORDER BY id DESC';
        let params = [];
        
        if (category && category !== 'All') {
            // Specific categories are sorted by unique_id in ascending order
            query = 'SELECT * FROM employees WHERE category = $1 ORDER BY unique_id ASC';
            params = [category];
        }
        const result = await pool.query(query, params);
        res.json({ success: true, employees: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. Add New Employee with Unique ID Generation
router.post('/add', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'document', maxCount: 1 }]), async (req, res) => {
    try {
        const { 
            name, designation, joining_date, category, mobile, alt_mobile, address, 
            passport_no, notes, emergency_name, emergency_mobile, 
            emergency_alt, emergency_relation 
        } = req.body;

        let prefix = 'EMP';
        if (category === 'Director') prefix = 'DIR';
        else if (category === 'Site Co') prefix = 'SC';
        else if (category === 'Field Co') prefix = 'FL';
        else if (category === 'Office Admin') prefix = 'OF-AD';
        else if (category === 'Office Accounts') prefix = 'OF-ACC';

        const countRes = await pool.query('SELECT COUNT(*) FROM employees WHERE category = $1', [category]);
        const nextIdNum = parseInt(countRes.rows[0].count) + 1;
        const unique_id = `${prefix}-${String(nextIdNum).padStart(3, '0')}`;
        const imagePath = req.files['image'] ? `/uploads/employee_images/${req.files['image'][0].filename}` : null;

        const newEmp = await pool.query(
            `INSERT INTO employees (unique_id, name, designation, joining_date, category, image_path, mobile, alt_mobile, address, passport_no, notes, emergency_name, emergency_mobile, emergency_alt, emergency_relation)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
            [unique_id, name, designation, joining_date, category, imagePath, mobile, alt_mobile, address, passport_no, notes, emergency_name, emergency_mobile, emergency_alt, emergency_relation]
        );

        if (req.files['document']) {
            const docPath = `/uploads/employee_docs/${req.files['document'][0].filename}`;
            const docName = req.files['document'][0].originalname;
            await pool.query(
                `INSERT INTO employee_documents (employee_id, doc_name, file_path) VALUES ($1, $2, $3)`,
                [newEmp.rows[0].id, docName, docPath]
            );
        }
        res.json({ success: true, message: "Employee added successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Edit Employee & Track Position History Change (Updated for Timeline)
router.post('/edit/:id', upload.single('image'), async (req, res) => {
    try {
        const empId = req.params.id;
        const { 
            name, designation, joining_date, category, prev_end_date, new_start_date, released_date, mobile, alt_mobile, address, 
            passport_no, notes, emergency_name, emergency_mobile, 
            emergency_alt, emergency_relation 
        } = req.body;

        const oldData = await pool.query('SELECT category, designation, joining_date FROM employees WHERE id = $1', [empId]);
        if (oldData.rows.length === 0) return res.status(404).json({ success: false, message: "Employee not found" });

        const prevCat = oldData.rows[0].category;
        const prevDesig = oldData.rows[0].designation;
        const prevJoiningDate = oldData.rows[0].joining_date;

        let activeJoiningDate = joining_date;

        // If category changed, log to history and update active joining date
        if (prevCat !== category) {
            activeJoiningDate = new_start_date; // New role starts from new date
            await pool.query(
                `INSERT INTO employee_history (employee_id, previous_category, previous_designation, start_date, end_date) VALUES ($1, $2, $3, $4, $5)`,
                [empId, prevCat, prevDesig, prevJoiningDate, prev_end_date]
            );
        }

        let query = `UPDATE employees SET name = $1, designation = $2, joining_date = $3, category = $4, mobile = $5, alt_mobile = $6, address = $7, passport_no = $8, notes = $9, emergency_name = $10, emergency_mobile = $11, emergency_alt = $12, emergency_relation = $13, released_date = $14`;
        let params = [name, designation, activeJoiningDate, category, mobile, alt_mobile, address, passport_no, notes, emergency_name, emergency_mobile, emergency_alt, emergency_relation, released_date || null];

        if (req.file) {
            query += `, image_path = $15`;
            params.push(`/uploads/employee_images/${req.file.filename}`);
        }
        query += ` WHERE id = $${params.length + 1}`;
        params.push(empId);

        await pool.query(query, params);
        res.json({ success: true, message: "Employee updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. Get Employee History (Updated Order)
router.get('/details/:id', async (req, res) => {
    try {
        const empId = req.params.id;
        const emp = await pool.query('SELECT * FROM employees WHERE id = $1', [empId]);
        // Order by start_date to show timeline correctly
        const history = await pool.query('SELECT * FROM employee_history WHERE employee_id = $1 ORDER BY start_date ASC', [empId]);
        const docs = await pool.query('SELECT * FROM employee_documents WHERE employee_id = $1', [empId]);

        res.json({ success: true, employee: emp.rows[0], history: history.rows, documents: docs.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/delete/:id', async (req, res) => {
    try {
        const { deleteSecret } = req.body;
        
        // Simple and strict .env Secret Key check (Bypasses JWT issues)
        if (!process.env.DELETE_SECRET || deleteSecret !== process.env.DELETE_SECRET) {
            return res.status(403).json({ success: false, message: "Access Denied: Invalid Delete Security Key." });
        }

        await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: "Staff deleted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. Upload Additional Document for Employee
router.post('/upload-doc/:id', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });
        const docPath = `/uploads/employee_docs/${req.file.filename}`;
        const docName = req.file.originalname;
        
        await pool.query(
            `INSERT INTO employee_documents (employee_id, doc_name, file_path) VALUES ($1, $2, $3)`,
            [req.params.id, docName, docPath]
        );
        res.json({ success: true, message: "Document uploaded successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;