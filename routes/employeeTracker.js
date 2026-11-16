const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper: Generate Unique Employee ID based on First/Initial Category
async function generateNextEmployeeId(initialCategory) {
  let prefix = "EMP";
  if (initialCategory === "Director") prefix = "DIR";
  else if (initialCategory === "Site Co") prefix = "SC";
  else if (initialCategory === "Field Co") prefix = "FL";
  else if (initialCategory === "Business Co") prefix = "BC";
  else if (
    initialCategory === "Office Staff" ||
    initialCategory === "Office Admin"
  )
    prefix = "OF-ST";
  else if (initialCategory === "Office Accounts") prefix = "OF-ACC";

  // Find highest existing sequence number for this prefix (safe even if employee changed category later)
  const maxRes = await pool.query(
    `SELECT COALESCE(MAX(CAST(substring(unique_id FROM '-([0-9]+)$') AS INTEGER)), 0) AS max_num
         FROM employees
         WHERE unique_id LIKE $1`,
    [`${prefix}-%`],
  );
  const nextNum = (parseInt(maxRes.rows[0].max_num, 10) || 0) + 1;
  return `${prefix}-${String(nextNum).padStart(3, "0")}`;
}

// 1. Get All Employees with Category Filter (Active Vehicle Expiry Guaranteed)
router.get("/all", async (req, res) => {
  try {
    const { category } = req.query;
    let query = `
            SELECT
                e.*,
                CASE
                    WHEN e.vehicle_status = 'Sold' THEN NULL
                    ELSE COALESCE(av.fahs_expiry, e.fahs_expiry)
                END AS fahs_expiry,
                CASE
                    WHEN e.vehicle_status = 'Sold' THEN NULL
                    ELSE COALESCE(av.insurance_expiry, e.insurance_expiry)
                END AS insurance_expiry
            FROM employees e
            LEFT JOIN LATERAL (
                SELECT fahs_expiry, insurance_expiry
                FROM employee_vehicle_history
                WHERE employee_id = e.id AND status = 'Active'
                ORDER BY purchase_date DESC NULLS LAST, id DESC
                LIMIT 1
            ) av ON TRUE
            ORDER BY e.id DESC
        `;
    let params = [];

    if (category && category !== "All") {
      query = `
                SELECT
                    e.*,
                    CASE
                        WHEN e.vehicle_status = 'Sold' THEN NULL
                        ELSE COALESCE(av.fahs_expiry, e.fahs_expiry)
                    END AS fahs_expiry,
                    CASE
                        WHEN e.vehicle_status = 'Sold' THEN NULL
                        ELSE COALESCE(av.insurance_expiry, e.insurance_expiry)
                    END AS insurance_expiry
                FROM employees e
                LEFT JOIN LATERAL (
                    SELECT fahs_expiry, insurance_expiry
                    FROM employee_vehicle_history
                    WHERE employee_id = e.id AND status = 'Active'
                    ORDER BY purchase_date DESC NULLS LAST, id DESC
                    LIMIT 1
                ) av ON TRUE
                WHERE e.category = $1
                ORDER BY e.unique_id ASC
            `;
      params = [category];
    }
    const result = await pool.query(query, params);
    res.json({ success: true, employees: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Add New Employee
router.post(
  "/add",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "documents", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        department,
        designation,
        joining_date,
        category,
        site_name,
        vehicle_model,
        plate_no,
        chassis_no,
        serial_no,
        vehicle_purchase_date,
        fahs_expiry,
        insurance_expiry,
        mobile,
        alt_mobile,
        address,
        passport_no,
        passport_expiry,
        notes,
        emergency_name,
        emergency_mobile,
        emergency_alt,
        emergency_relation,
        country,
        iqama_no,
        iqama_expiry,
        licence_expiry,
        health_insurance_expiry,
        sponsor_name,
      } = req.body;

      const cleanDate = (val) =>
        val && String(val).trim() !== "" ? val : null;

      // Determine First Category from Past Designations (earliest start_date) if provided
      let firstCategory = category;
      if (req.body.past_designations) {
        try {
          const parsedPast = JSON.parse(req.body.past_designations);
          if (Array.isArray(parsedPast) && parsedPast.length > 0) {
            const sortedByStart = [...parsedPast].sort((a, b) => {
              const dA = a.start_date
                ? new Date(a.start_date).getTime()
                : Infinity;
              const dB = b.start_date
                ? new Date(b.start_date).getTime()
                : Infinity;
              return dA - dB;
            });
            if (sortedByStart[0] && sortedByStart[0].previous_category) {
              firstCategory = sortedByStart[0].previous_category;
            }
          }
        } catch (e) {}
      }

      const unique_id = await generateNextEmployeeId(firstCategory);

      let imagePath = null;
      if (req.files && req.files["image"] && req.files["image"][0]) {
        const imgFile = req.files["image"][0];
        const imgName = `${unique_id}_profile${path.extname(imgFile.originalname)}`;
        const imgDir = path.join(
          __dirname,
          "../public/uploads/employee_images/",
        );
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        const imgFullPath = path.join(imgDir, imgName);
        fs.writeFileSync(imgFullPath, imgFile.buffer);
        imagePath = `/uploads/employee_images/${imgName}`;
      }

      const vehicle_status = vehicle_model || plate_no ? "Active" : null;

      const newEmp = await pool.query(
        `INSERT INTO employees (unique_id, name, department, designation, joining_date, category, site_name, vehicle_model, plate_no, chassis_no, serial_no, vehicle_purchase_date, fahs_expiry, insurance_expiry, vehicle_status, image_path, mobile, alt_mobile, address, passport_no, passport_expiry, notes, emergency_name, emergency_mobile, emergency_alt, emergency_relation, country, iqama_no, iqama_expiry, licence_expiry, health_insurance_expiry, sponsor_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32) RETURNING *`,
        [
          unique_id,
          name,
          department || null,
          designation,
          cleanDate(joining_date),
          category,
          site_name || null,
          vehicle_model || null,
          plate_no || null,
          chassis_no || null,
          serial_no || null,
          cleanDate(vehicle_purchase_date),
          cleanDate(fahs_expiry),
          cleanDate(insurance_expiry),
          vehicle_status,
          imagePath,
          mobile || null,
          alt_mobile || null,
          address || null,
          passport_no || null,
          cleanDate(passport_expiry),
          notes || null,
          emergency_name || null,
          emergency_mobile || null,
          emergency_alt || null,
          emergency_relation || null,
          country || "Kingdom of Saudi Arabia",
          iqama_no || null,
          cleanDate(iqama_expiry),
          cleanDate(licence_expiry),
          cleanDate(health_insurance_expiry),
          sponsor_name || null,
        ],
      );

      const targetEmpId = newEmp.rows[0].id;

      // Save Past Designations if provided
      if (req.body.past_designations) {
        try {
          const pastDesigs = JSON.parse(req.body.past_designations);
          if (Array.isArray(pastDesigs)) {
            for (const pd of pastDesigs) {
              await pool.query(
                `INSERT INTO employee_history (employee_id, previous_category, previous_department, previous_designation, previous_site, start_date, end_date)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  targetEmpId,
                  pd.previous_category || null,
                  pd.previous_department || null,
                  pd.previous_designation || null,
                  pd.previous_site || null,
                  cleanDate(pd.start_date),
                  cleanDate(pd.end_date),
                ],
              );
            }
          }
        } catch (e) {
          console.error("Error parsing past_designations:", e);
        }
      }

      // Save Past Vehicles (status = 'Sold') if provided
      if (req.body.past_vehicles) {
        try {
          const pastVehs = JSON.parse(req.body.past_vehicles);
          if (Array.isArray(pastVehs)) {
            for (const pv of pastVehs) {
              await pool.query(
                `INSERT INTO employee_vehicle_history (employee_id, vehicle_model, plate_no, chassis_no, serial_no, purchase_date, sold_date, fahs_expiry, insurance_expiry, status)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Sold')`,
                [
                  targetEmpId,
                  pv.vehicle_model || null,
                  pv.plate_no || null,
                  pv.chassis_no || null,
                  pv.serial_no || null,
                  cleanDate(pv.purchase_date),
                  cleanDate(pv.sold_date),
                  cleanDate(pv.fahs_expiry),
                  cleanDate(pv.insurance_expiry),
                ],
              );
            }
          }
        } catch (e) {
          console.error("Error parsing past_vehicles:", e);
        }
      }

      // Save Active Vehicle to Vehicle History
      if (plate_no || vehicle_model || chassis_no || serial_no) {
        await pool.query(
          `INSERT INTO employee_vehicle_history (employee_id, vehicle_model, plate_no, chassis_no, serial_no, purchase_date, fahs_expiry, insurance_expiry, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')`,
          [
            targetEmpId,
            vehicle_model || null,
            plate_no || null,
            chassis_no || null,
            serial_no || null,
            cleanDate(vehicle_purchase_date),
            cleanDate(fahs_expiry),
            cleanDate(insurance_expiry),
          ],
        );
      }

      // Handle Documents
      const uploadedDocs =
        req.files && (req.files["documents"] || req.files["document"]);
      if (uploadedDocs) {
        const docs = Array.isArray(uploadedDocs)
          ? uploadedDocs
          : [uploadedDocs];
        let docNames = req.body.doc_names || [];
        if (!Array.isArray(docNames)) docNames = [docNames];

        const maxDocRes = await pool.query(
          `SELECT COALESCE(MAX(CAST(substring(file_path FROM '-([0-9]+)\\.[^/]+$') AS INTEGER)), 0) AS max_number FROM employee_documents WHERE employee_id = $1`,
          [targetEmpId],
        );
        let docCount = parseInt(maxDocRes.rows[0].max_number, 10) || 0;

        for (let i = 0; i < docs.length; i++) {
          docCount++;
          const fileExt = path.extname(docs[i].originalname);
          const customFileName = `${unique_id}-${docCount}${fileExt}`;
          const docFullPath = path.join(
            __dirname,
            "../public/uploads/employee_docs/",
            customFileName,
          );
          fs.writeFileSync(docFullPath, docs[i].buffer);
          const docPath = `/uploads/employee_docs/${customFileName}`;
          const customDocName = docNames[i] || docs[i].originalname;

          await pool.query(
            `INSERT INTO employee_documents (employee_id, doc_name, file_path) VALUES ($1, $2, $3)`,
            [targetEmpId, customDocName, docPath],
          );
        }
      }
      res.json({ success: true, message: "Employee added successfully!" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// 3. Edit Employee & Handle Vehicle/Role/Dept History
router.post(
  "/edit/:id",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "documents", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const empId = req.params.id;
      const {
        name,
        department,
        designation,
        joining_date,
        category,
        site_name,
        prev_end_date,
        new_start_date,
        released_date,
        mobile,
        alt_mobile,
        address,
        passport_no,
        passport_expiry,
        notes,
        emergency_name,
        emergency_mobile,
        emergency_alt,
        emergency_relation,
        doc_action,
        replace_doc_id,
        vehicle_action,
        vehicle_model,
        plate_no,
        chassis_no,
        serial_no,
        vehicle_purchase_date,
        fahs_expiry,
        insurance_expiry,
        vehicle_sold_date,
        new_vehicle_model,
        new_plate_no,
        new_chassis_no,
        new_serial_no,
        new_vehicle_purchase_date,
        new_fahs_expiry,
        new_insurance_expiry,
        country,
        iqama_no,
        iqama_expiry,
        licence_expiry,
        health_insurance_expiry,
        sponsor_name,
      } = req.body;

      const cleanDate = (val) =>
        val && String(val).trim() !== "" ? val : null;

      const oldData = await pool.query(
        "SELECT unique_id, category, department, designation, site_name, vehicle_model, plate_no, chassis_no, serial_no, vehicle_purchase_date, fahs_expiry, insurance_expiry, vehicle_status, vehicle_sold_date, joining_date, country, iqama_no, iqama_expiry, licence_expiry, health_insurance_expiry, sponsor_name FROM employees WHERE id = $1",
        [empId],
      );
      if (oldData.rows.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "Employee not found" });

      const empData = oldData.rows[0];
      const prevCat = empData.category;
      const prevDept = (empData.department || "").trim();
      const prevDesig = empData.designation;
      const prevSite = (empData.site_name || "").trim();
      const prevJoiningDate = empData.joining_date;

      let activeJoiningDate = joining_date;
      const isCategoryChanged = prevCat !== category && prevCat !== "Released";
      const isSiteChanged = prevSite !== (site_name || "").trim();
      const isDeptChanged = prevDept !== (department || "").trim();
      const isDesigChanged = prevDesig !== (designation || "").trim();

      if (
        (isCategoryChanged ||
          isSiteChanged ||
          isDeptChanged ||
          isDesigChanged) &&
        prevCat !== "Released"
      ) {
        activeJoiningDate = new_start_date || activeJoiningDate;
        await pool.query(
          `INSERT INTO employee_history (employee_id, previous_category, previous_department, previous_designation, previous_site, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            empId,
            prevCat,
            prevDept || null,
            prevDesig,
            prevSite || null,
            prevJoiningDate,
            prev_end_date,
          ],
        );
      }

      // Vehicle Actions Logic
      let curVehModel =
        vehicle_model !== undefined ? vehicle_model : empData.vehicle_model;
      let curPlateNo = plate_no !== undefined ? plate_no : empData.plate_no;
      let curChassisNo =
        chassis_no !== undefined ? chassis_no : empData.chassis_no;
      let curSerialNo = serial_no !== undefined ? serial_no : empData.serial_no;
      let curPurchDate =
        vehicle_purchase_date !== undefined
          ? vehicle_purchase_date
          : empData.vehicle_purchase_date;
      let curFahsExpiry =
        fahs_expiry !== undefined ? fahs_expiry : empData.fahs_expiry;
      let curInsExpiry =
        insurance_expiry !== undefined
          ? insurance_expiry
          : empData.insurance_expiry;
      let curVehStatus = empData.vehicle_status || "Active";
      let curSoldDate = vehicle_sold_date || empData.vehicle_sold_date;

      if (vehicle_action === "sold") {
        curVehStatus = "Sold";
        curSoldDate = vehicle_sold_date;
        await pool.query(
          `UPDATE employee_vehicle_history SET status = 'Sold', sold_date = $1 WHERE employee_id = $2 AND plate_no = $3 AND status = 'Active'`,
          [cleanDate(vehicle_sold_date), empId, curPlateNo],
        );
      } else if (vehicle_action === "replaced") {
        await pool.query(
          `UPDATE employee_vehicle_history SET status = 'Sold', sold_date = $1 WHERE employee_id = $2 AND plate_no = $3 AND status = 'Active'`,
          [cleanDate(vehicle_sold_date), empId, curPlateNo],
        );
        curVehModel = new_vehicle_model;
        curPlateNo = new_plate_no;
        curChassisNo = new_chassis_no;
        curSerialNo = new_serial_no;
        curPurchDate = new_vehicle_purchase_date;
        curFahsExpiry = new_fahs_expiry;
        curInsExpiry = new_insurance_expiry;
        curVehStatus = "Active";
        curSoldDate = null;
        await pool.query(
          `INSERT INTO employee_vehicle_history (employee_id, vehicle_model, plate_no, chassis_no, serial_no, purchase_date, fahs_expiry, insurance_expiry, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')`,
          [
            empId,
            curVehModel,
            curPlateNo,
            curChassisNo || null,
            curSerialNo || null,
            cleanDate(curPurchDate),
            cleanDate(curFahsExpiry),
            cleanDate(curInsExpiry),
          ],
        );
      } else if (vehicle_action === "new_purchase") {
        curVehModel = new_vehicle_model;
        curPlateNo = new_plate_no;
        curChassisNo = new_chassis_no;
        curSerialNo = new_serial_no;
        curPurchDate = new_vehicle_purchase_date;
        curFahsExpiry = new_fahs_expiry;
        curInsExpiry = new_insurance_expiry;
        curVehStatus = "Active";
        curSoldDate = null;
        await pool.query(
          `INSERT INTO employee_vehicle_history (employee_id, vehicle_model, plate_no, chassis_no, serial_no, purchase_date, fahs_expiry, insurance_expiry, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')`,
          [
            empId,
            curVehModel,
            curPlateNo,
            curChassisNo || null,
            curSerialNo || null,
            cleanDate(curPurchDate),
            cleanDate(curFahsExpiry),
            cleanDate(curInsExpiry),
          ],
        );
      } else {
        // Update active vehicle history details if changed
        if (curPlateNo) {
          await pool.query(
            `UPDATE employee_vehicle_history SET vehicle_model = $1, chassis_no = $2, serial_no = $3, purchase_date = $4, fahs_expiry = $5, insurance_expiry = $6 WHERE employee_id = $7 AND plate_no = $8 AND status = 'Active'`,
            [
              curVehModel || null,
              curChassisNo || null,
              curSerialNo || null,
              cleanDate(curPurchDate),
              cleanDate(curFahsExpiry),
              cleanDate(curInsExpiry),
              empId,
              curPlateNo,
            ],
          );
        }
      }

      // If employee was 'Pending' (PEN-xxx) and is now assigned a real category, generate official ID from First Designation
      let finalUniqueId = empData.unique_id;
      if (
        prevCat === "Pending" &&
        category &&
        category !== "Pending" &&
        category !== "Released"
      ) {
        const firstHistRes = await pool.query(
          `SELECT previous_category FROM employee_history
                 WHERE employee_id = $1
                 ORDER BY start_date ASC NULLS LAST, id ASC
                 LIMIT 1`,
          [empId],
        );
        const firstCatForId =
          firstHistRes.rows.length > 0 && firstHistRes.rows[0].previous_category
            ? firstHistRes.rows[0].previous_category
            : category;
        finalUniqueId = await generateNextEmployeeId(firstCatForId);
      }

      let query = `UPDATE employees SET unique_id = $1, name = $2, department = $3, designation = $4, joining_date = $5, category = $6, site_name = $7, vehicle_model = $8, plate_no = $9, chassis_no = $10, serial_no = $11, vehicle_purchase_date = $12, fahs_expiry = $13, insurance_expiry = $14, vehicle_status = $15, vehicle_sold_date = $16, mobile = $17, alt_mobile = $18, address = $19, passport_no = $20, passport_expiry = $21, notes = $22, emergency_name = $23, emergency_mobile = $24, emergency_alt = $25, emergency_relation = $26, released_date = $27, country = $28, iqama_no = $29, iqama_expiry = $30, licence_expiry = $31, health_insurance_expiry = $32, sponsor_name = $33`;
      let params = [
        finalUniqueId,
        name,
        department || null,
        designation,
        cleanDate(activeJoiningDate),
        category,
        site_name || null,
        curVehModel || null,
        curPlateNo || null,
        curChassisNo || null,
        curSerialNo || null,
        cleanDate(curPurchDate),
        cleanDate(curFahsExpiry),
        cleanDate(curInsExpiry),
        curVehStatus,
        cleanDate(curSoldDate),
        mobile || null,
        alt_mobile || null,
        address || null,
        passport_no || null,
        cleanDate(passport_expiry),
        notes || null,
        emergency_name || null,
        emergency_mobile || null,
        emergency_alt || null,
        emergency_relation || null,
        cleanDate(released_date),
        country || "Kingdom of Saudi Arabia",
        iqama_no || null,
        cleanDate(iqama_expiry),
        cleanDate(licence_expiry),
        cleanDate(health_insurance_expiry),
        sponsor_name || null,
      ];

      if (req.files && req.files["image"] && req.files["image"][0]) {
        // 🟢 പഴയ ഫോട്ടോ സെർവറിൽ ഉണ്ടെങ്കിൽ അത് ഡിലീറ്റ് ചെയ്യുന്നു
        const prevImgRes = await pool.query(
          "SELECT image_path FROM employees WHERE id = $1",
          [empId],
        );
        if (prevImgRes.rows.length > 0 && prevImgRes.rows[0].image_path) {
          const oldImagePath = path.join(
            __dirname,
            "../public",
            prevImgRes.rows[0].image_path,
          );
          if (fs.existsSync(oldImagePath)) {
            try {
              fs.unlinkSync(oldImagePath);
            } catch (e) {
              console.error("Error deleting old profile image:", e);
            }
          }
        }

        const imgFile = req.files["image"][0];
        const timestamp = Date.now();
        const imgName = `${empData.unique_id}_profile_${timestamp}${path.extname(imgFile.originalname)}`;
        const imgDir = path.join(
          __dirname,
          "../public/uploads/employee_images/",
        );
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        const imgFullPath = path.join(imgDir, imgName);
        fs.writeFileSync(imgFullPath, imgFile.buffer);
        query += `, image_path = $${params.length + 1}`;
        params.push(`/uploads/employee_images/${imgName}`);
      }
      query += ` WHERE id = $${params.length + 1}`;
      params.push(empId);
      await pool.query(query, params);

      if (doc_action === "add_new" || doc_action === "replace") {
        if (req.files && req.files["documents"]) {
          const docs = req.files["documents"];
          let docNames = req.body.doc_names || [];
          if (!Array.isArray(docNames)) docNames = [docNames];

          if (doc_action === "replace" && replace_doc_id) {
            await pool.query(`DELETE FROM employee_documents WHERE id = $1`, [
              replace_doc_id,
            ]);
          }

          const maxDocRes = await pool.query(
            `SELECT COALESCE(MAX(CAST(substring(file_path FROM '-([0-9]+)\\.[^/]+$') AS INTEGER)), 0) AS max_number FROM employee_documents WHERE employee_id = $1`,
            [empId],
          );
          let docCount = parseInt(maxDocRes.rows[0].max_number, 10) || 0;

          for (let i = 0; i < docs.length; i++) {
            docCount++;
            const fileExt = path.extname(docs[i].originalname);
            const customFileName = `${empData.unique_id}-${docCount}${fileExt}`;
            const docFullPath = path.join(
              __dirname,
              "../public/uploads/employee_docs/",
              customFileName,
            );
            fs.writeFileSync(docFullPath, docs[i].buffer);
            const docPath = `/uploads/employee_docs/${customFileName}`;
            const customDocName = docNames[i] || docs[i].originalname;
            await pool.query(
              `INSERT INTO employee_documents (employee_id, doc_name, file_path) VALUES ($1, $2, $3)`,
              [empId, customDocName, docPath],
            );
          }
        }
      }
      res.json({ success: true, message: "Employee updated successfully!" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// 4. Get Employee Details, History, Vehicle History & Documents
router.get("/details/:id", async (req, res) => {
  try {
    const empId = req.params.id;
    const emp = await pool.query("SELECT * FROM employees WHERE id = $1", [
      empId,
    ]);
    const history = await pool.query(
      "SELECT * FROM employee_history WHERE employee_id = $1 ORDER BY start_date ASC",
      [empId],
    );
    const vehHistory = await pool.query(
      "SELECT * FROM employee_vehicle_history WHERE employee_id = $1 ORDER BY purchase_date ASC, id ASC",
      [empId],
    );
    const docs = await pool.query(
      "SELECT * FROM employee_documents WHERE employee_id = $1",
      [empId],
    );

    res.json({
      success: true,
      employee: emp.rows[0],
      history: history.rows,
      vehicle_history: vehHistory.rows,
      documents: docs.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/delete/:id", async (req, res) => {
  try {
    const { deleteSecret } = req.body;
    if (
      !process.env.DELETE_SECRET ||
      deleteSecret !== process.env.DELETE_SECRET
    ) {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Invalid Delete Security Key.",
      });
    }

    const empId = req.params.id;

    // 1. Fetch profile image path before deleting employee record
    const empRes = await pool.query(
      "SELECT image_path FROM employees WHERE id = $1",
      [empId],
    );
    if (empRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found." });
    }

    // 2. Fetch all attached document file paths for this employee
    const docsRes = await pool.query(
      "SELECT file_path FROM employee_documents WHERE employee_id = $1",
      [empId],
    );

    // 3. Delete physical profile image file from server disk
    const imgRelPath = empRes.rows[0].image_path;
    if (imgRelPath) {
      const imgFullPath = path.join(__dirname, "../public", imgRelPath);
      if (fs.existsSync(imgFullPath)) {
        try {
          fs.unlinkSync(imgFullPath);
        } catch (e) {
          console.error("Error deleting employee profile image:", e);
        }
      }
    }

    // 4. Delete all physical document files from server disk
    for (const doc of docsRes.rows) {
      if (doc.file_path) {
        const docFullPath = path.join(__dirname, "../public", doc.file_path);
        if (fs.existsSync(docFullPath)) {
          try {
            fs.unlinkSync(docFullPath);
          } catch (e) {
            console.error("Error deleting employee document file:", e);
          }
        }
      }
    }

    // 5. Delete related DB rows and the employee record
    await pool.query("DELETE FROM employee_documents WHERE employee_id = $1", [
      empId,
    ]);
    await pool.query("DELETE FROM employee_history WHERE employee_id = $1", [
      empId,
    ]);
    await pool.query(
      "DELETE FROM employee_vehicle_history WHERE employee_id = $1",
      [empId],
    );
    await pool.query("DELETE FROM employees WHERE id = $1", [empId]);

    res.json({
      success: true,
      message: "Staff and all uploaded files deleted permanently!",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/document/:docId", async (req, res) => {
  try {
    const { docId } = req.params;
    const docRes = await pool.query(
      `SELECT ed.id, ed.employee_id, ed.file_path, e.unique_id FROM employee_documents ed JOIN employees e ON e.id = ed.employee_id WHERE ed.id = $1`,
      [docId],
    );
    if (docRes.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Document not found." });

    const deletedDoc = docRes.rows[0];
    const employeeId = deletedDoc.employee_id;
    const uniqueId = deletedDoc.unique_id;

    const docsRes = await pool.query(
      `SELECT id, file_path, doc_name FROM employee_documents WHERE employee_id = $1 ORDER BY CAST(substring(file_path FROM '-([0-9]+)\\.[^/]+$') AS INTEGER) ASC`,
      [employeeId],
    );
    const docs = docsRes.rows;

    const deletedFileName = path.basename(deletedDoc.file_path || "");
    const deletedMatch = deletedFileName.match(/-(\d+)\.[^.]+$/);
    if (!deletedMatch)
      return res
        .status(400)
        .json({ success: false, message: "Invalid document format." });

    const deletedNumber = parseInt(deletedMatch[1], 10);
    const deletedPhysicalPath = path.join(
      __dirname,
      "../public",
      deletedDoc.file_path,
    );
    if (fs.existsSync(deletedPhysicalPath)) fs.unlinkSync(deletedPhysicalPath);

    await pool.query(`DELETE FROM employee_documents WHERE id = $1`, [docId]);

    for (const doc of docs) {
      if (doc.id === parseInt(docId, 10)) continue;
      const oldFileName = path.basename(doc.file_path || "");
      const match = oldFileName.match(/-(\d+)(\.[^.]+)$/);
      if (!match) continue;

      const currentNumber = parseInt(match[1], 10);
      const extension = match[2];
      if (currentNumber > deletedNumber) {
        const newNumber = currentNumber - 1;
        const newFileName = `${uniqueId}-${newNumber}${extension}`;
        const oldPhysicalPath = path.join(
          __dirname,
          "../public/uploads/employee_docs/",
          oldFileName,
        );
        const newPhysicalPath = path.join(
          __dirname,
          "../public/uploads/employee_docs/",
          newFileName,
        );

        if (fs.existsSync(oldPhysicalPath))
          fs.renameSync(oldPhysicalPath, newPhysicalPath);
        const newFilePath = `/uploads/employee_docs/${newFileName}`;
        await pool.query(
          `UPDATE employee_documents SET file_path = $1 WHERE id = $2`,
          [newFilePath, doc.id],
        );
      }
    }
    res.json({
      success: true,
      message: "Document removed and renumbered successfully!",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/upload-doc/:id", upload.single("document"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded." });
    const empRes = await pool.query(
      "SELECT unique_id FROM employees WHERE id = $1",
      [req.params.id],
    );
    if (empRes.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Employee not found." });

    const uniqueId = empRes.rows[0].unique_id;
    const maxDocRes = await pool.query(
      `SELECT COALESCE(MAX(CAST(substring(file_path FROM '-([0-9]+)\\.[^/]+$') AS INTEGER)), 0) AS max_number FROM employee_documents WHERE employee_id = $1`,
      [req.params.id],
    );
    const lastDocNumber = parseInt(maxDocRes.rows[0].max_number, 10) || 0;
    const docCount = lastDocNumber + 1;

    const fileExt = path.extname(req.file.originalname);
    const customFileName = `${uniqueId}-${docCount}${fileExt}`;
    const docFullPath = path.join(
      __dirname,
      "../public/uploads/employee_docs/",
      customFileName,
    );

    fs.writeFileSync(docFullPath, req.file.buffer);
    const docPath = `/uploads/employee_docs/${customFileName}`;
    const docName = (req.body.doc_name || req.file.originalname).trim();

    await pool.query(
      `INSERT INTO employee_documents (employee_id, doc_name, file_path) VALUES ($1, $2, $3)`,
      [req.params.id, docName, docPath],
    );
    res.json({ success: true, message: "Document uploaded successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Safe Direct Expiry Date Update (By Exact Employee ID & Unique ID)
router.post("/update-expiry", async (req, res) => {
  try {
    const { emp_id, unique_id, field, new_date } = req.body;
    const allowedFields = new Set([
      "iqama_expiry",
      "passport_expiry",
      "licence_expiry",
      "health_insurance_expiry",
      "fahs_expiry",
      "insurance_expiry",
    ]);

    if (!emp_id || !unique_id || !allowedFields.has(field) || !new_date) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid update parameters." });
    }

    const updateRes = await pool.query(
      `UPDATE employees
             SET ${field} = $1
             WHERE id = $2 AND TRIM(unique_id) = TRIM($3)
             RETURNING id, unique_id, plate_no`,
      [new_date, parseInt(emp_id, 10), String(unique_id).trim()],
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exact employee record not found or ID mismatch.",
      });
    }

    // Sync active vehicle history if vehicle expiry was updated
    const updatedEmp = updateRes.rows[0];
    if (
      (field === "fahs_expiry" || field === "insurance_expiry") &&
      updatedEmp.plate_no
    ) {
      await pool.query(
        `UPDATE employee_vehicle_history
                 SET ${field} = $1
                 WHERE employee_id = $2 AND TRIM(plate_no) = TRIM($3) AND status = 'Active'`,
        [new_date, updatedEmp.id, updatedEmp.plate_no],
      );
    }

    res.json({ success: true, message: "Expiry date updated successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Replace Specific Document File Safely (Deletes old physical file & saves new one)
router.post(
  "/replace-doc/:docId",
  upload.single("document"),
  async (req, res) => {
    try {
      const { docId } = req.params;
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No replacement file selected." });
      }

      const docRes = await pool.query(
        `SELECT ed.id, ed.employee_id, ed.doc_name, ed.file_path, e.unique_id
             FROM employee_documents ed
             JOIN employees e ON e.id = ed.employee_id
             WHERE ed.id = $1`,
        [docId],
      );
      if (docRes.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Document not found." });
      }

      const oldDoc = docRes.rows[0];
      const oldFileName = path.basename(oldDoc.file_path || "");
      const match = oldFileName.match(/-(\d+)\.[^.]+$/);
      const docNumber = match ? match[1] : Date.now();

      const newExt = path.extname(req.file.originalname);
      const newFileName = `${oldDoc.unique_id}-${docNumber}${newExt}`;
      const docDir = path.join(__dirname, "../public/uploads/employee_docs/");
      if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });

      // Remove old physical file from server disk first
      const oldPhysicalPath = path.join(
        __dirname,
        "../public",
        oldDoc.file_path,
      );
      if (fs.existsSync(oldPhysicalPath)) {
        fs.unlinkSync(oldPhysicalPath);
      }

      const newFullPath = path.join(docDir, newFileName);
      fs.writeFileSync(newFullPath, req.file.buffer);
      const newFilePath = `/uploads/employee_docs/${newFileName}`;

      // Double-check old file does not remain if filename/extension changed
      if (oldPhysicalPath !== newFullPath && fs.existsSync(oldPhysicalPath)) {
        fs.unlinkSync(oldPhysicalPath);
      }

      await pool.query(
        `UPDATE employee_documents SET file_path = $1 WHERE id = $2`,
        [newFilePath, docId],
      );

      res.json({
        success: true,
        message: `${oldDoc.doc_name} replaced successfully!`,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// 7. Public Self-Registration Endpoint (No Login Required -> Saves as 'Pending' for Admin Review)
router.post(
  "/public-add",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "documents", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        joining_date,
        mobile,
        alt_mobile,
        address,
        passport_no,
        passport_expiry,
        emergency_name,
        emergency_mobile,
        emergency_alt,
        emergency_relation,
        country,
        iqama_no,
        iqama_expiry,
        licence_expiry,
        health_insurance_expiry,
        sponsor_name,
        vehicle_model,
        plate_no,
        chassis_no,
        serial_no,
        vehicle_purchase_date,
        fahs_expiry,
        insurance_expiry,
      } = req.body;

      if (!name || !String(name).trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Full Name is required." });
      }

      const cleanDate = (val) =>
        val && String(val).trim() !== "" ? val : null;
      const category = "Pending";

      const countRes = await pool.query(
        "SELECT COUNT(*) FROM employees WHERE category = $1",
        [category],
      );
      const nextIdNum = parseInt(countRes.rows[0].count, 10) + 1;
      const unique_id = `PEN-${String(nextIdNum).padStart(3, "0")}`;

      let imagePath = null;
      if (req.files && req.files["image"] && req.files["image"][0]) {
        const imgFile = req.files["image"][0];
        const imgName = `${unique_id}_profile${path.extname(imgFile.originalname)}`;
        const imgDir = path.join(
          __dirname,
          "../public/uploads/employee_images/",
        );
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        fs.writeFileSync(path.join(imgDir, imgName), imgFile.buffer);
        imagePath = `/uploads/employee_images/${imgName}`;
      }

      const vehicle_status = vehicle_model || plate_no ? "Active" : null;

      const newEmp = await pool.query(
        `INSERT INTO employees (unique_id, name, joining_date, category, vehicle_model, plate_no, chassis_no, serial_no, vehicle_purchase_date, fahs_expiry, insurance_expiry, vehicle_status, image_path, mobile, alt_mobile, address, passport_no, passport_expiry, emergency_name, emergency_mobile, emergency_alt, emergency_relation, country, iqama_no, iqama_expiry, licence_expiry, health_insurance_expiry, sponsor_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) RETURNING *`,
        [
          unique_id,
          String(name).trim(),
          cleanDate(joining_date),
          category,
          vehicle_model || null,
          plate_no || null,
          chassis_no || null,
          serial_no || null,
          cleanDate(vehicle_purchase_date),
          cleanDate(fahs_expiry),
          cleanDate(insurance_expiry),
          vehicle_status,
          imagePath,
          mobile || null,
          alt_mobile || null,
          address || null,
          passport_no || null,
          cleanDate(passport_expiry),
          emergency_name || null,
          emergency_mobile || null,
          emergency_alt || null,
          emergency_relation || null,
          country || "Kingdom of Saudi Arabia",
          iqama_no || null,
          cleanDate(iqama_expiry),
          cleanDate(licence_expiry),
          cleanDate(health_insurance_expiry),
          sponsor_name || null,
        ],
      );

      const targetEmpId = newEmp.rows[0].id;

      // Save Past Designations if provided
      if (req.body.past_designations) {
        try {
          const pastDesigs = JSON.parse(req.body.past_designations);
          if (Array.isArray(pastDesigs)) {
            for (const pd of pastDesigs) {
              await pool.query(
                `INSERT INTO employee_history (employee_id, previous_category, previous_department, previous_designation, previous_site, start_date, end_date)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  targetEmpId,
                  pd.previous_category || null,
                  pd.previous_department || null,
                  pd.previous_designation || null,
                  pd.previous_site || null,
                  cleanDate(pd.start_date),
                  cleanDate(pd.end_date),
                ],
              );
            }
          }
        } catch (e) {
          console.error("Error parsing public past_designations:", e);
        }
      }

      // Save Past Vehicles if provided
      if (req.body.past_vehicles) {
        try {
          const pastVehs = JSON.parse(req.body.past_vehicles);
          if (Array.isArray(pastVehs)) {
            for (const pv of pastVehs) {
              await pool.query(
                `INSERT INTO employee_vehicle_history (employee_id, vehicle_model, plate_no, chassis_no, serial_no, purchase_date, sold_date, fahs_expiry, insurance_expiry, status)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Sold')`,
                [
                  targetEmpId,
                  pv.vehicle_model || null,
                  pv.plate_no || null,
                  pv.chassis_no || null,
                  pv.serial_no || null,
                  cleanDate(pv.purchase_date),
                  cleanDate(pv.sold_date),
                  cleanDate(pv.fahs_expiry),
                  cleanDate(pv.insurance_expiry),
                ],
              );
            }
          }
        } catch (e) {
          console.error("Error parsing public past_vehicles:", e);
        }
      }

      // Save Active Vehicle if provided
      if (plate_no || vehicle_model || chassis_no || serial_no) {
        await pool.query(
          `INSERT INTO employee_vehicle_history (employee_id, vehicle_model, plate_no, chassis_no, serial_no, purchase_date, fahs_expiry, insurance_expiry, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')`,
          [
            targetEmpId,
            vehicle_model || null,
            plate_no || null,
            chassis_no || null,
            serial_no || null,
            cleanDate(vehicle_purchase_date),
            cleanDate(fahs_expiry),
            cleanDate(insurance_expiry),
          ],
        );
      }

      // Handle Uploaded Documents
      const uploadedDocs = req.files && req.files["documents"];
      if (uploadedDocs) {
        const docs = Array.isArray(uploadedDocs)
          ? uploadedDocs
          : [uploadedDocs];
        let docNames = req.body.doc_names || [];
        if (!Array.isArray(docNames)) docNames = [docNames];

        const docDir = path.join(__dirname, "../public/uploads/employee_docs/");
        if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });

        for (let i = 0; i < docs.length; i++) {
          const docCount = i + 1;
          const fileExt = path.extname(docs[i].originalname);
          const customFileName = `${unique_id}-${docCount}${fileExt}`;
          fs.writeFileSync(path.join(docDir, customFileName), docs[i].buffer);
          const docPath = `/uploads/employee_docs/${customFileName}`;
          const customDocName = docNames[i] || docs[i].originalname;

          await pool.query(
            `INSERT INTO employee_documents (employee_id, doc_name, file_path) VALUES ($1, $2, $3)`,
            [targetEmpId, customDocName, docPath],
          );
        }
      }

      res.json({
        success: true,
        message: "Your details have been submitted successfully!",
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

module.exports = router;
