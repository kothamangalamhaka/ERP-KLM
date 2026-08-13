# Haka Rentals (P) Ltd - Enterprise Resource Planning (ERP) System

## 1. Project Executive Summary
This repository contains the full source code for the **Haka Rentals (P) Ltd ERP System**, a highly scalable, hybrid-architecture web application tailored for enterprise resource management, logistics tracking, and financial operations. The system is designed to handle high-volume data processing with low latency by leveraging a dual-backend architecture: a **Node.js (Express)** core for business logic and routing, paired with a **Python (FastAPI)** engine dedicated to intensive data manipulation and I/O operations (like bulk Excel processing).

## 2. System Architecture

The application employs a proxy-based hybrid architecture:
*   **Primary Server (Node.js on Port 5000):** Acts as the main entry point, handling JWT-based authentication, Role-Based Access Control (RBAC), API routing, cron scheduling, and serving the frontend static files.
*   **Data Engine (Python FastAPI on Port 8001):** Intercepts requests proxied from Node.js (via the `/py/` route namespace) for heavy lifting, utilizing libraries like `pandas` and `openpyxl` to process thousands of records instantly without blocking the Node event loop.
*   **Database (PostgreSQL):** A unified relational database utilizing advanced JSONB columns for dynamic master data handling alongside strict schema tables for transactional data (ledgers, timesheets).

## 3. Technology Stack

### Backend Technologies
*   **Node.js & Express.js:** Primary server framework.
*   **Python 3 & FastAPI:** Microservice for high-speed data export/import.
*   **PostgreSQL:** Relational database management.
*   **node-cron:** Task scheduling and automation.
*   **JWT & bcrypt:** Authentication and payload encryption.
*   **Nodemailer & Telegram Bot API:** Automated communication and alerts.

### Frontend Technologies
*   **HTML5, CSS3, Vanilla JavaScript:** Lightweight, framework-less frontend for maximum speed and offline PWA capabilities.
*   **Service Workers:** For caching and offline availability.

## 4. Comprehensive File Structure

```text
📦 ERP_System
 ┣ 📜 main.py                     # Python FastAPI Engine entry point (Port 8001)
 ┣ 📜 server.js                   # Main Node.js Express Server entry point (Port 5000)
 ┣ 📜 .env                        # Environment configurations (hidden)
 ┣ 📜 erp-cert.pem / erp-key.pem  # SSL/TLS Certificates for HTTPS
 ┣ 📂 backups                     # Temporary storage for automated DB dumps
 ┣ 📂 config
 ┃ ┗ 📜 db.js                     # PostgreSQL connection pool configuration
 ┣ 📂 middlewares
 ┃ ┗ 📜 auth.js                   # JWT verification and RBAC middlewares
 ┣ 📂 public                      # Frontend assets (PWA enabled)
 ┃ ┣ 📜 index.html                # Main Dashboard UI
 ┃ ┣ 📜 manifest.json / sw.js     # PWA Configuration and Service Worker
 ┃ ┣ 📂 style                     # Global CSS stylesheets
 ┃ ┗ 📂 ...                       # Various module specific UI folders (Billing, Timesheet, etc.)
 ┣ 📂 routers                     # Python FastAPI modular routers
 ┃ ┣ 📜 own_equipment_py.py       # Python logic for own equipment bulk updates
 ┃ ┣ 📜 payment_export_py.py      # High-speed Excel generator for payments
 ┃ ┣ 📜 payment_py.py             # Bulk invoice saving logic
 ┃ ┗ 📜 we1_own_eq_data_base.py   # Specialized equipment data export module
 ┗ 📂 routes                      # Node.js Express route controllers
   ┣ 📜 backup.js                 # Automated daily pg_dump, Email & Telegram dispatch
   ┣ 📜 billing.js                # Invoice and vendor billing logic
   ┣ 📜 break_rules.js            # Management of site-specific operational rules
   ┣ 📜 employee.js               # Employee onboarding and attendance logs
   ┣ 📜 master_database.js        # Core DB operations, proxy to Python engine, and cell-locking
   ┣ 📜 oeledger.js               # Full accounting ledger system (Tally-style multi-line vouchers)
   ┣ 📜 Timesheet.js              # Comprehensive timesheet, driver/site logging, and OT calculation
   ┣ 📜 vatbill.js                # VAT tracking, invoice matching, and financial reconciliation
   ┗ 📜 ...                       # Other supporting modules
```

## 5. Core Modules & Features

### 5.1. Authentication & RBAC
*   **Multi-Tier Roles:** Super Admin, Admin, Site Coordinator, Editor, and Viewer.
*   **Secure Access:** JWT implementation with strict expiry. Passcodes and PIN verifications are used for sensitive actions (e.g., deleting entries, viewing specific ledgers).

### 5.2. Master Database Management
*   **Dynamic Columns:** Super Admins can add columns dynamically relative to existing ones.
*   **Concurrency Control:** In-memory cell locking mechanism to prevent data overwriting when multiple users edit the grid simultaneously.
*   **Live Broadcasts:** Real-time Telegram alerts triggered upon cell modifications detailing the exact 'Before' and 'After' states.

### 5.3. Timesheet & Payroll Engine
*   **Automated Rules:** Applies specific calculation rules (e.g., Friday OT, penalty deductions, special days) dynamically based on the assigned site.
*   **Driver & Site Logs:** Maintains historical timelines of vehicle assignments to drivers and sites, ensuring accurate billing over changing periods.

### 5.4. Accounting & VAT Management (oeledger & vatbill)
*   **Double-Entry Ledger:** Tally-style voucher system allowing multi-line debit/credit entries, maintaining strict balance checks.
*   **Financial Reporting:** Real-time generation of Trial Balance, Profit & Loss, and Balance Sheet.
*   **VAT Tracking:** Cross-references supplier invoices with timesheet records to flag discrepancies.

### 5.5. Automation & Background Jobs (Cron)
*   **Database Backup (2:00 AM IST):** Executes `pg_dump`, attaches the `.sql` or `.xlsx` file, and securely dispatches it to configured Admin Emails and Telegram groups.
*   **Expiry Alerts (8:00 AM IST):** Scans the Master DB for expiring documents (Iqama, Insurance, MVPI) within a 30-day window and dispatches formatted HTML alerts via Telegram.

## 6. Setup & Deployment Guidelines

### 6.1. Prerequisites
*   Node.js (v18+ recommended)
*   Python (3.9+)
*   PostgreSQL (v13+)
*   Valid SSL Certificates (`erp-key.pem`, `erp-cert.pem`)

### 6.2. Environment Variables (.env)
Required configurations include:
```properties
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASS=your_db_password
DB_NAME=erp_database
JWT_SECRET=your_secure_jwt_secret
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_LOG_CHAT_ID=your_log_chat_id
```

### 6.3. Execution
1.  **Install Node Dependencies:** `npm install`
2.  **Install Python Dependencies:** `pip install -r requirements.txt` *(assuming dependencies are listed)*
3.  **Start Python Engine:** `uvicorn main:app --port 8001 --host 127.0.0.1`
4.  **Start Node Server:** `node server.js` (or `pm2 start server.js` for production)

## 7. Security Considerations
*   **HTTPS Only:** The Node server strictly utilizes the `https` module.
*   **SQL Injection Prevention:** Parameterized queries are universally enforced in both Node (`pg`) and Python (`psycopg2`).
*   **Data Protection:** Sensitive routes are guarded by environment-specific PINs and passcodes in addition to JWT.
