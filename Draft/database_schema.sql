-- ==========================================================
-- 1. SYSTEM SETTINGS & MASTER ERP TABLES
-- ==========================================================

CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    backup_emails TEXT DEFAULT '',
    backup_time VARCHAR(10) DEFAULT '23:59',
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata'
);

-- Altering System Settings (If table already exists)
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Kolkata';

-- Default System Setting Entry
INSERT INTO system_settings (backup_emails, backup_time, timezone) 
SELECT '', '23:59', 'Asia/Kolkata' 
WHERE NOT EXISTS (SELECT 1 FROM system_settings);

-- Altering ERP Headers
ALTER TABLE erp_headers ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE erp_headers ADD COLUMN IF NOT EXISTS alignment VARCHAR(20) DEFAULT 'left';
ALTER TABLE erp_headers ADD COLUMN IF NOT EXISTS col_type VARCHAR(20) DEFAULT 'varchar';

-- Migrating Old Headers (Safe to run multiple times)
UPDATE erp_headers SET header_name = 'Old Driver Name' WHERE header_name = 'OD Name';
UPDATE erp_records SET record_data = (record_data - 'OD Name') || jsonb_build_object('Old Driver Name', record_data->'OD Name') WHERE record_data ? 'OD Name';
UPDATE erp_headers SET header_name = 'Equipment Reached at Site' WHERE header_name = 'Mobilization Date';
UPDATE erp_records SET record_data = (record_data - 'Mobilization Date') || jsonb_build_object('Equipment Reached at Site', record_data->'Mobilization Date') WHERE record_data ? 'Mobilization Date';


-- ==========================================================
-- 2. USERS, LOGS & TIMESHEET EXTENSIONS
-- ==========================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS main_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP;

ALTER TABLE timesheet_users ADD COLUMN IF NOT EXISTS reset_otp VARCHAR(10);
ALTER TABLE timesheet_users ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP;

CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    action VARCHAR(100),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS driver_logs (
    id SERIAL PRIMARY KEY,
    plate_number VARCHAR(100),
    driver_name VARCHAR(255),
    mobile VARCHAR(100),
    work_start VARCHAR(50),
    work_end VARCHAR(50),
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY, 
    user_info VARCHAR(255), 
    action_type VARCHAR(100), 
    details TEXT, 
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Altering Timesheet & Vehicle Logs
ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS rate VARCHAR(255);
ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS old_vehicle_no VARCHAR(255);
ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS new_vehicle_no VARCHAR(255);
ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS field_co VARCHAR(255);
ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS site_co VARCHAR(255);
ALTER TABLE vehicle_site_log ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE timesheet_vehicles ADD COLUMN IF NOT EXISTS rate VARCHAR(255);
ALTER TABLE timesheet_vehicles ADD COLUMN IF NOT EXISTS vat VARCHAR(255);
ALTER TABLE timesheet_vehicles ADD COLUMN IF NOT EXISTS field_co VARCHAR(255);
ALTER TABLE timesheet_vehicles ADD COLUMN IF NOT EXISTS site_co VARCHAR(255);

ALTER TABLE vehicle_driver_log ADD COLUMN IF NOT EXISTS reason TEXT;

-- Auto-fill Field/Site CO missing values
UPDATE vehicle_site_log vsl
SET field_co = tv.field_co,
    site_co = tv.site_co
FROM timesheet_vehicles tv
WHERE UPPER(vsl.plate_no) = UPPER(tv.plate_no)
AND vsl.status = 'Running'
AND (vsl.field_co IS NULL OR vsl.site_co IS NULL OR vsl.field_co = '' OR vsl.site_co = '');


-- ==========================================================
-- 3. OE LEDGER (ACCOUNTING SYSTEM)
-- ==========================================================

CREATE TABLE IF NOT EXISTS oeledger (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'User',
    status VARCHAR(20) DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oe_accounts (
    id SERIAL PRIMARY KEY,
    ledger_name VARCHAR(255) NOT NULL,
    main_group VARCHAR(100) NOT NULL,
    sub_group VARCHAR(100),
    account_type VARCHAR(50),
    is_system BOOLEAN DEFAULT FALSE,
    is_employee BOOLEAN DEFAULT FALSE,
    opening_balance DECIMAL(15,2) DEFAULT 0,
    opening_balance_type VARCHAR(10) DEFAULT 'Dr',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_ledger_name UNIQUE (ledger_name)
);

CREATE TABLE IF NOT EXISTS oe_vouchers (
    id SERIAL PRIMARY KEY,
    voucher_no VARCHAR(50),
    voucher_date DATE NOT NULL,
    voucher_type VARCHAR(50) NOT NULL,
    narration TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oe_voucher_lines (
    id SERIAL PRIMARY KEY,
    voucher_id INT REFERENCES oe_vouchers(id) ON DELETE CASCADE,
    account_id INT REFERENCES oe_accounts(id),
    entry_type VARCHAR(5) NOT NULL CHECK (entry_type IN ('Dr','Cr')),
    amount DECIMAL(15,2) NOT NULL,
    line_narration TEXT
);

CREATE TABLE IF NOT EXISTS oe_audit_log (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    action VARCHAR(255),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- 4. SEED ACCOUNTING SYSTEM DEFAULTS
-- ==========================================================

INSERT INTO oe_accounts (ledger_name, main_group, sub_group, account_type, is_system) VALUES 
('Cash in Hand', 'Assets', 'Cash & Bank', 'cash', true),
('Cash at Bank', 'Assets', 'Cash & Bank', 'bank', true),
('Input CGST', 'Assets', 'GST / Tax Receivables', 'gst', true),
('Input SGST', 'Assets', 'GST / Tax Receivables', 'gst', true),
('Input IGST', 'Assets', 'GST / Tax Receivables', 'gst', true),
('TDS Receivable', 'Assets', 'GST / Tax Receivables', 'tax', true),
('Advance Tax Paid', 'Assets', 'GST / Tax Receivables', 'tax', true),
('GST Refund Receivable', 'Assets', 'GST / Tax Receivables', 'gst', true),
('Stock / Inventory', 'Assets', 'Current Assets', 'inventory', true),
('Output CGST', 'Liabilities', 'Duties & Taxes', 'gst', true),
('Output SGST', 'Liabilities', 'Duties & Taxes', 'gst', true),
('Output IGST', 'Liabilities', 'Duties & Taxes', 'gst', true),
('TDS Payable', 'Liabilities', 'Duties & Taxes', 'tax', true),
('Ajils KS Capital A/c', 'Capital & Reserves', 'Capital Accounts', 'capital', true),
('Ajmal Khan O A Capital A/c', 'Capital & Reserves', 'Capital Accounts', 'capital', true),
('Muhammedkutty Ummer Capital A/c', 'Capital & Reserves', 'Capital Accounts', 'capital', true),
('Shelmy Capital A/c', 'Capital & Reserves', 'Capital Accounts', 'capital', true),
('Reserves & Surplus', 'Capital & Reserves', 'Reserves', 'reserve', true),
('Sales', 'Revenue', 'Direct Income', 'sales', true),
('Sales Return', 'Revenue', 'Direct Income', 'sales', true),
('Commission Received', 'Revenue', 'Indirect Income', 'income', true),
('Purchase', 'Expenses', 'Direct Expenses', 'purchase', true),
('Purchase Return', 'Expenses', 'Direct Expenses', 'purchase', true),
('Opening Stock', 'Expenses', 'Direct Expenses', 'stock', true),
('Closing Stock', 'Revenue', 'Direct Income', 'stock', true),
('Office Stationery', 'Expenses', 'Office Expenses', 'expense', true),
('Room Rent', 'Expenses', 'Office Expenses', 'expense', true),
('Electricity Charges', 'Expenses', 'Office Expenses', 'expense', true),
('Office Maintenance', 'Expenses', 'Office Expenses', 'expense', true),
('Kitchen Supplies', 'Expenses', 'Office Expenses', 'expense', true),
('Computer Accessories Purchase', 'Expenses', 'Office Expenses', 'expense', true),
('Salary & Wages', 'Expenses', 'Employee Expenses', 'salary', true),
('Salary Outstanding', 'Liabilities', 'Current Liabilities', 'payable', true),
('Employee Bonus', 'Expenses', 'Employee Expenses', 'salary', true),
('Mobile Allowance', 'Expenses', 'Employee Expenses', 'salary', true),
('Other Allowances', 'Expenses', 'Employee Expenses', 'salary', true),
('Staff Reimbursement', 'Expenses', 'Employee Expenses', 'expense', true),
('Equipment Maintenance', 'Expenses', 'Indirect Expenses', 'expense', true),
('Depreciation', 'Expenses', 'Indirect Expenses', 'expense', true),
('Bad Debt Provision', 'Expenses', 'Indirect Expenses', 'expense', true),
('Commission Paid', 'Expenses', 'Indirect Expenses', 'expense', true),
('Drawings', 'Assets', 'Current Assets', 'drawings', true)
ON CONFLICT (ledger_name) DO NOTHING;