from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import StreamingResponse
from typing import Optional, List
import io
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, date

router = APIRouter()

def parse_excel_date(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s or s in ("-", "null", "None", "undefined"):
        return None
    s_date = s.split("T")[0].strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%y", "%d-%b-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s_date, fmt).date()
        except ValueError:
            continue
    return None

# DB Connection Helper
def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST", "localhost"),
            database=os.getenv("DB_NAME", "erp_database"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASS", "password"),
            port=os.getenv("DB_PORT", "5432")
        )
        return conn
    except Exception as e:
        print(f"Database connection error: {e}")
        return None

@router.api_route("/py/api/we1-own-eq/export", methods=["GET", "POST"])
def export_we1_own_eq_excel(
    mode: str = "compact",
    payload: Optional[dict] = Body(default=None)
):
    filtered_only = False
    plate_nos: List[str] = []
    if payload:
        mode = payload.get("mode", mode)
        filtered_only = bool(payload.get("filtered_only", False))
        plate_nos = [str(p).strip().upper() for p in (payload.get("plate_nos") or []) if str(p).strip()]

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
        
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # 🟢 Fetch Master Data with Full Driver Log (IQAMA, Licence & Passport) Details
        base_query = """
            SELECT 
                m.*,
                d.iqama_no,
                d.iqama_expiry,
                d.licence_expiry,
                d.passport_no,
                d.passport_expiry
            FROM we1_own_eq_master m
            LEFT JOIN LATERAL (
                SELECT iqama_no, iqama_expiry, licence_expiry, passport_no, passport_expiry
                FROM we1_driver_log
                WHERE UPPER(TRIM(plate_no)) = UPPER(TRIM(m.plate_no))
                ORDER BY COALESCE(join_date, '1970-01-01'::date) DESC, id DESC
                LIMIT 1
            ) d ON true
        """
        if filtered_only and plate_nos:
            cursor.execute(
                base_query + " WHERE UPPER(TRIM(m.plate_no)) = ANY(%s) ORDER BY m.id ASC",
                (plate_nos,)
            )
            raw_rows = cursor.fetchall()
            # UI-യിൽ ഫിൽട്ടർ/സോർട്ട് ചെയ്ത അതേ ഓർഡറിൽ തന്നെ ക്രമീകരിക്കുന്നു
            order_map = {p: idx for idx, p in enumerate(plate_nos)}
            data = sorted(
                raw_rows,
                key=lambda r: order_map.get(str(r["plate_no"] or "").strip().upper(), 999999)
            )
        else:
            cursor.execute(base_query + " ORDER BY m.id ASC")
            data = cursor.fetchall()

        # 🟢 Fetch all active drivers (work_end_date IS NULL) per plate
        cursor.execute("""
            SELECT
                UPPER(TRIM(plate_no)) AS plate_key,
                driver_name,
                driver_mobile,
                join_date,
                iqama_no,
                iqama_expiry,
                licence_expiry,
                passport_no,
                passport_expiry
            FROM we1_driver_log
            WHERE work_end_date IS NULL AND plate_no IS NOT NULL AND TRIM(plate_no) <> ''
            ORDER BY COALESCE(join_date, '1970-01-01'::date) DESC, id DESC
        """)
        active_drivers_by_plate = {}
        for dl in cursor.fetchall():
            active_drivers_by_plate.setdefault(dl["plate_key"], []).append(dl)

        def fmt_multi_excel_dates(dates_list):
            parts = []
            for dt in dates_list:
                d_obj = parse_excel_date(dt)
                parts.append(d_obj.strftime("%d-%b-%y") if d_obj else "-")
            return "\n".join(parts)

        def check_multi_expiry_status(dates_list, today_ref):
            has_expired = False
            has_soon = False
            for dt in dates_list:
                d_obj = parse_excel_date(dt)
                if d_obj:
                    diff = (d_obj - today_ref).days
                    if diff < 0:
                        has_expired = True
                    elif diff <= 30:
                        has_soon = True
            if has_expired:
                return "expired"
            if has_soon:
                return "soon"
            return None
        
        wb = openpyxl.Workbook()
        
        header_fill = PatternFill(start_color="000000", end_color="000000", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True)
        center_alignment = Alignment(horizontal="center", vertical="center")
        expired_fill = PatternFill(start_color="DC3545", end_color="DC3545", fill_type="solid")
        expired_font = Font(color="FFFFFF", bold=True)
        expiring_fill = PatternFill(start_color="FFF3CD", end_color="FFF3CD", fill_type="solid")
        expiring_font = Font(color="D97706", bold=True)
        today_date = datetime.now().date()

        if mode == "full":
            # ==========================================
            # 📑 FULL DATA (Entire UI - All 26 Columns)
            # ==========================================
            ws = wb.active
            ws.title = "Full_UI_Data"

            headers_full = [
                "SN", "Mobilisation Date", "Vehicle Type", "Plate No", "Driver Name", 
                "Mobile", "Joining Date", "Site Name", "Vehicle Owner", "Santhook", 
                "Salary", "Status", "Note", "Old EQ", "New EQ", 
                "IQAMA No.", "IQAMA Exp", "Licence Exp", "Passport No.", "Passport Exp",
                "Chassis No", "Serial No", "EQ Insurance Exp", "FAHS/MVPI Exp",
                "Operation Card Exp", "Isthimaara Exp"
            ]
            ws.append(headers_full)

            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = center_alignment

            wrap_center_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            wrap_left_alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            multi_row_expiry_status = {}

            for i, row in enumerate(data, start=1):
                salary_val = float(row['salary']) if row['salary'] else None
                pk = str(row['plate_no'] or "").strip().upper()
                act_drivers = active_drivers_by_plate.get(pk, [])
                is_multi = len(act_drivers) > 1

                if is_multi:
                    drv_name = "\n".join([f"{idx + 1}. {str(d['driver_name']).strip() if d.get('driver_name') else '-'}" for idx, d in enumerate(act_drivers)])
                    drv_mobile = "\n".join([str(d['driver_mobile']).strip() if d.get('driver_mobile') else "-" for d in act_drivers])
                    join_val = fmt_multi_excel_dates([d.get('join_date') for d in act_drivers])
                    iqama_no_val = "\n".join([str(d['iqama_no']).strip() if d.get('iqama_no') else "-" for d in act_drivers])
                    iqama_exp_val = fmt_multi_excel_dates([d.get('iqama_expiry') for d in act_drivers])
                    licence_exp_val = fmt_multi_excel_dates([d.get('licence_expiry') for d in act_drivers])
                    passport_no_val = "\n".join([str(d['passport_no']).strip() if d.get('passport_no') else "-" for d in act_drivers])
                    passport_exp_val = fmt_multi_excel_dates([d.get('passport_expiry') for d in act_drivers])

                    multi_row_expiry_status[i + 1] = {
                        17: check_multi_expiry_status([d.get('iqama_expiry') for d in act_drivers], today_date),
                        18: check_multi_expiry_status([d.get('licence_expiry') for d in act_drivers], today_date),
                        20: check_multi_expiry_status([d.get('passport_expiry') for d in act_drivers], today_date),
                    }
                else:
                    drv_name = row['driver_name'] or ""
                    drv_mobile = row['driver_mobile'] or ""
                    join_val = parse_excel_date(row['joining_date'])
                    iqama_no_val = row['iqama_no'] or ""
                    iqama_exp_val = parse_excel_date(row['iqama_expiry'])
                    licence_exp_val = parse_excel_date(row['licence_expiry'])
                    passport_no_val = row['passport_no'] or ""
                    passport_exp_val = parse_excel_date(row['passport_expiry'])

                ws.append([
                    i,
                    parse_excel_date(row['mob_date']),
                    row['vehicle_type'] or "",
                    row['plate_no'] or "",
                    drv_name,
                    drv_mobile,
                    join_val,
                    row['site_name'] or "",
                    row['vehicle_owner'] or "",
                    row['santhook'] or "",
                    salary_val,
                    ("Ideal" if not row['mob_date'] and (not row['status'] or row['status'] == "Running") else (row['status'] or "Running")),
                    row['note'] or "",
                    row['old_eq'] or "",
                    row['new_eq'] or "",
                    iqama_no_val,
                    iqama_exp_val,
                    licence_exp_val,
                    passport_no_val,
                    passport_exp_val,
                    row['chassis_no'] or "",
                    row['serial_no'] or "",
                    parse_excel_date(row['eq_insurance_exp']),
                    parse_excel_date(row['fahs_mvpi_exp']),
                    parse_excel_date(row['op_card_exp']),
                    parse_excel_date(row['isthimaara_exp'])
                ])

            all_date_cols = [2, 7, 17, 18, 20, 23, 24, 25, 26]
            expiry_date_cols = {17, 18, 20, 23, 24, 25, 26}
            for row_idx, row in enumerate(ws.iter_rows(min_row=2, max_col=26, max_row=len(data) + 1), start=2):
                for col_idx in all_date_cols:
                    cell = row[col_idx - 1]
                    if cell.value:
                        if isinstance(cell.value, str) and "\n" in cell.value:
                            cell.alignment = wrap_center_alignment
                            st = multi_row_expiry_status.get(row_idx, {}).get(col_idx)
                            if st == "expired":
                                cell.fill = expired_fill
                                cell.font = expired_font
                            elif st == "soon":
                                cell.fill = expiring_fill
                                cell.font = expiring_font
                        else:
                            cell.number_format = 'DD-MMM-YY'
                            cell.alignment = center_alignment
                            if col_idx in expiry_date_cols:
                                val_date = cell.value.date() if isinstance(cell.value, datetime) else cell.value
                                if isinstance(val_date, date):
                                    diff_days = (val_date - today_date).days
                                    if diff_days < 0:
                                        cell.fill = expired_fill
                                        cell.font = expired_font
                                    elif diff_days <= 30:
                                        cell.fill = expiring_fill
                                        cell.font = expiring_font
                for c_idx in (5, 6, 16, 19):
                    c_cell = row[c_idx - 1]
                    if isinstance(c_cell.value, str) and "\n" in c_cell.value:
                        c_cell.alignment = wrap_left_alignment if c_idx == 5 else wrap_center_alignment
                max_lines = max(
                    [str(c.value).count("\n") + 1 for c in row if isinstance(c.value, str) and "\n" in c.value],
                    default=1
                )
                if max_lines > 1:
                    ws.row_dimensions[row_idx].height = max_lines * 16
                if row[12].value:
                    row[12].alignment = Alignment(wrap_text=True, vertical="top")

            ws.auto_filter.ref = f"A1:Z{len(data) + 1}"
            ws.freeze_panes = "A2"
            ws.sheet_view.zoomScale = 80

            max_driver_len = max(
                [len(line) for r_cell in ws['E'] if r_cell.value for line in str(r_cell.value).splitlines()],
                default=20
            )
            col_widths_full = {
                'A': 6, 'B': 16, 'C': 18, 'D': 14, 'E': max(max_driver_len + 4, 22), 
                'F': 16, 'G': 16, 'H': 22, 'I': 22, 'J': 16, 
                'K': 12, 'L': 12, 'M': 35, 'N': 14, 'O': 14,
                'P': 16, 'Q': 16, 'R': 16, 'S': 16, 'T': 16,
                'U': 20, 'V': 20, 'W': 18, 'X': 18, 'Y': 18, 'Z': 18
            }
            for col, width in col_widths_full.items():
                ws.column_dimensions[col].width = width

            filename = "We1_Own_EQ_Full_UI_Report.xlsx"
        else:
            # ==========================================
            # 📑 COMPACT SUMMARY (We1_Own_EQ)
            # ==========================================
            ws = wb.active
            ws.title = "We1_Own_EQ"

            headers_compact = [
                "SN", "Mobilisation Date", "Vehicle Type", "Plate No", "Driver Name", 
                "Mobile", "Joining Date", "Site Name", "Vehicle Owner", "Santhook", 
                "Salary", "Status", "Note"
            ]
            ws.append(headers_compact)

            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = center_alignment

            wrap_center_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            wrap_left_alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            for i, row in enumerate(data, start=1):
                salary_val = float(row['salary']) if row['salary'] else None
                pk = str(row['plate_no'] or "").strip().upper()
                act_drivers = active_drivers_by_plate.get(pk, [])
                is_multi = len(act_drivers) > 1

                drv_name = (
                    "\n".join([f"{idx + 1}. {str(d['driver_name']).strip() if d.get('driver_name') else '-'}" for idx, d in enumerate(act_drivers)])
                    if is_multi else (row['driver_name'] or "")
                )
                drv_mobile = (
                    "\n".join([str(d['driver_mobile']).strip() if d.get('driver_mobile') else "-" for d in act_drivers])
                    if is_multi else (row['driver_mobile'] or "")
                )
                join_val = (
                    fmt_multi_excel_dates([d.get('join_date') for d in act_drivers])
                    if is_multi else parse_excel_date(row['joining_date'])
                )

                ws.append([
                    i,
                    parse_excel_date(row['mob_date']),
                    row['vehicle_type'] or "",
                    row['plate_no'] or "",
                    drv_name,
                    drv_mobile,
                    join_val,
                    row['site_name'] or "",
                    row['vehicle_owner'] or "",
                    row['santhook'] or "",
                    salary_val,
                    ("Ideal" if not row['mob_date'] and (not row['status'] or row['status'] == "Running") else (row['status'] or "Running")),
                    row['note'] or ""
                ])

            for row_idx, row in enumerate(ws.iter_rows(min_row=2, max_col=13, max_row=len(data) + 1), start=2):
                if row[1].value:
                    row[1].number_format = 'DD-MMM-YY'
                    row[1].alignment = center_alignment
                if isinstance(row[4].value, str) and "\n" in row[4].value:
                    row[4].alignment = wrap_left_alignment
                if isinstance(row[5].value, str) and "\n" in row[5].value:
                    row[5].alignment = wrap_center_alignment
                if row[6].value:
                    if isinstance(row[6].value, str) and "\n" in row[6].value:
                        row[6].alignment = wrap_center_alignment
                    else:
                        row[6].number_format = 'DD-MMM-YY'
                        row[6].alignment = center_alignment
                max_lines = max(
                    [str(c.value).count("\n") + 1 for c in row if isinstance(c.value, str) and "\n" in c.value],
                    default=1
                )
                if max_lines > 1:
                    ws.row_dimensions[row_idx].height = max_lines * 16
                if row[12].value:
                    row[12].alignment = Alignment(wrap_text=True, vertical="top")

            ws.auto_filter.ref = f"A1:M{len(data) + 1}"
            ws.freeze_panes = "A2"
            ws.sheet_view.zoomScale = 80

            max_driver_len = max(
                [len(line) for r_cell in ws['E'] if r_cell.value for line in str(r_cell.value).splitlines()],
                default=20
            )
            col_widths_compact = {
                'A': 6, 'B': 16, 'C': 18, 'D': 14, 'E': max(max_driver_len + 4, 22), 
                'F': 16, 'G': 16, 'H': 22, 'I': 22, 'J': 16, 
                'K': 12, 'L': 12, 'M': 40
            }
            for col, width in col_widths_compact.items():
                ws.column_dimensions[col].width = width

            filename = "We1_Own_EQ_Compact_Report.xlsx"

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"'
        }
        
        return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()


# Driver Payroll Export Endpoints

@router.get("/py/api/we1-eq-driver-payroll/export-screen")
def export_payroll_screen(month_year: str):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
        
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = """
            SELECT p.plate_no, p.driver_name, p.basic_salary, p.over_time, p.deduction, COALESCE(p.advance_paid, 0) as advance_paid, p.remark
            FROM we1_payroll p WHERE p.month_year = %s
            UNION
            SELECT m.plate_no, m.driver_name, 0 as basic_salary, 0 as over_time, 0 as deduction, 0 as advance_paid, '' as remark
            FROM we1_own_eq_master m WHERE NOT EXISTS (
                SELECT 1 FROM we1_payroll p2 WHERE p2.month_year = %s AND p2.plate_no = m.plate_no AND p2.driver_name = m.driver_name
            ) ORDER BY plate_no ASC, driver_name ASC
        """
        cursor.execute(query, (month_year, month_year))
        data = cursor.fetchall()
        
        wb = openpyxl.Workbook()
        ws = wb.active
        
        tab_name = datetime.strptime(month_year, "%Y-%m").strftime("%b-%y")
        ws.title = tab_name
        
        apply_payroll_excel_formatting(ws, data)
        
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        headers = {'Content-Disposition': f'attachment; filename="We1_Own_EQ_Driver_Payroll_{month_year}.xlsx"'}
        return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()

@router.get("/py/api/we1-eq-driver-payroll/export-batch")
def export_payroll_batch(start_month: str, end_month: str):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
        
    try:
        start_y, start_m = map(int, start_month.split('-'))
        end_y, end_m = map(int, end_month.split('-'))
        months = []
        y, m = start_y, start_m
        while (y < end_y) or (y == end_y and m <= end_m):
            months.append(f"{y}-{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1
                
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        for my in months:
            query = """
                SELECT p.plate_no, p.driver_name, p.basic_salary, p.over_time, p.deduction, COALESCE(p.advance_paid, 0) as advance_paid, p.remark
                FROM we1_payroll p WHERE p.month_year = %s
                UNION
                SELECT m.plate_no, m.driver_name, 0 as basic_salary, 0 as over_time, 0 as deduction, 0 as advance_paid, '' as remark
                FROM we1_own_eq_master m WHERE NOT EXISTS (
                    SELECT 1 FROM we1_payroll p2 WHERE p2.month_year = %s AND p2.plate_no = m.plate_no AND p2.driver_name = m.driver_name
                ) ORDER BY plate_no ASC, driver_name ASC
            """
            cursor.execute(query, (my, my))
            data = cursor.fetchall()
            
            tab_name = datetime.strptime(my, "%Y-%m").strftime("%b-%y")
            ws = wb.create_sheet(title=tab_name)
            
            apply_payroll_excel_formatting(ws, data)
            
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        headers = {'Content-Disposition': f'attachment; filename="We1_Own_EQ_Driver_Payroll_Batch_{start_month}_to_{end_month}.xlsx"'}
        return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()

def apply_payroll_excel_formatting(ws, data):
    headers = ["SN", "Plate No", "Driver Name", "Basic Salary", "Over Time", "Gross Salary", "Deduction", "Total Salary", "Advance / Paid", "Payable", "Status", "Remark"]
    ws.append(headers)
    
    header_fill = PatternFill(start_color="000000", end_color="000000", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    center_align = Alignment(horizontal="center", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    
    for col_num, cell in enumerate(ws[1], 1):
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        
    for i, row in enumerate(data, start=1):
        basic = float(row['basic_salary'] or 0)
        ot = float(row['over_time'] or 0)
        gross = basic + ot
        ded = float(row['deduction'] or 0)
        total = gross - ded
        adv = float(row['advance_paid'] or 0)
        payable = total - adv
        
        status = 'Un Paid'
        if total == payable and total != 0:
            status = 'Un Paid'
        elif total > payable and payable > 0:
            status = 'Partially Paid'
        elif payable == 0 and total > 0:
            status = 'Paid'
        elif payable < 0:
            status = 'Advanced'
        elif total == 0:
            status = 'Un Paid'
            
        ws.append([
            i, row['plate_no'], row['driver_name'], 
            basic if basic != 0 else "", 
            ot if ot != 0 else "", 
            gross if gross != 0 else "", 
            ded if ded != 0 else "", 
            total if total != 0 else "", 
            adv if adv != 0 else "", 
            payable if payable != 0 else "", 
            status, 
            row['remark'] or ''
        ])
        
    ws.freeze_panes = "A2"
    ws.sheet_view.zoomScale = 100
    ws.auto_filter.ref = f"A1:L{len(data)+1}"
    
    for row in ws.iter_rows(min_row=2, max_row=len(data)+1, min_col=4, max_col=11):
        for cell in row:
            cell.alignment = center_align

    col_widths = {'A':6, 'B':15, 'C':25, 'D':15, 'E':15, 'F':15, 'G':15, 'H':15, 'I':15, 'J':15, 'K':15, 'L':35}
    for col, w in col_widths.items():
        ws.column_dimensions[col].width = w