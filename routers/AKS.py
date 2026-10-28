import os
import io
import calendar
from datetime import datetime, date
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List, Any
import psycopg2
from psycopg2.extras import RealDictCursor
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(prefix="/py/aks", tags=["AKS Tracker"])

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", "5432")
    )

def init_aks_table():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS equipment_aks_details (
            equipment_id INT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
            insurance_cost NUMERIC(12, 2) DEFAULT 0,
            off_site_mtc NUMERIC(12, 2) DEFAULT 0,
            work_assign_site VARCHAR(255) DEFAULT '',
            reached_site_date DATE,
            site_first_month_mtc NUMERIC(12, 2) DEFAULT 0,
            site_second_month_mtc NUMERIC(12, 2) DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    cur.close()
    conn.close()

try:
    init_aks_table()
except Exception as e:
    print(f"AKS Table init note: {e}")

class AKSCellUpdate(BaseModel):
    equipment_id: int
    field: str
    value: Any

class AKSSavePayload(BaseModel):
    updates: List[AKSCellUpdate]

ALLOWED_FIELDS = {
    "insurance_cost",
    "off_site_mtc",
    "work_assign_site",
    "reached_site_date",
    "site_first_month_mtc",
    "site_second_month_mtc"
}

def normalize_company_name(raw_site: str) -> str:
    if not raw_site:
        return ""
    s = raw_site.strip().lower()
    if "haka" in s:
        return "Haka"
    if "aljoda" in s or "al joda" in s or "joda" in s:
        return "Al Joda"
    if "masar" in s or "wheel" in s:
        return "Masar Wheels"
    if "we1" in s or "we 1" in s or "we-1" in s:
        return "We1"
    return ""

def clean_site_name(raw_site: str) -> str:
    if not raw_site:
        return ""
    import re
    clean = str(raw_site).strip()
    unwanted = [
        r'\bL\s*&\s*T\s+Solar\b', r'\bL\s*&\s*T\b', r'\bHydro\b',
        r'\brerunning\b', r'\b22\b', r'\bZ\b', r'\bHaka\b',
        r'\bAl\s*Joda\b', r'\bAljoda\b', r'\bMasar\s*Wheels\b',
        r'\bMasar\b', r'\bWe\s*1\b', r'\bWe1\b', r'\bWe-1\b'
    ]
    for p in unwanted:
        clean = re.sub(p, ' ', clean, flags=re.IGNORECASE)
    clean = re.sub(r'[-–—_/\\,|]+', ' ', clean)
    return re.sub(r'\s+', ' ', clean).strip()

@router.get("/data")
def get_aks_data():
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute("""
            SELECT 
                e.id,
                e.plate_no,
                e.purchase_date,
                COALESCE(e.purchase_cost, 0) AS purchase_cost,
                COALESCE(a.insurance_cost, 0) AS insurance_cost
            FROM equipments e
            LEFT JOIN equipment_aks_details a ON e.id = a.equipment_id
            ORDER BY e.purchase_date ASC NULLS LAST, e.id ASC;
        """)
        equipments = cur.fetchall()

        cur.execute("""
            SELECT plate_no, site_name, work_start_date, work_end_date 
            FROM vehicle_site_log 
            ORDER BY work_start_date ASC NULLS LAST, id ASC;
        """)
        site_logs = cur.fetchall()

        cur.execute("""
            SELECT equipment_id, year, month, COALESCE(maintenance_cost, 0) as maintenance_cost 
            FROM equipment_monthly_logs 
            WHERE maintenance_cost > 0;
        """)
        maint_logs = cur.fetchall()

        cur.close()
        conn.close()

        maint_map = {}
        for ml in maint_logs:
            k = f"{ml['equipment_id']}_{ml['year']}_{ml['month']}"
            maint_map[k] = float(ml["maintenance_cost"])

        records = []
        max_months_count = 0

        for eq in equipments:
            eq_id = eq["id"]
            p_clean = (eq["plate_no"] or "").strip().upper()
            matched_sites = [s for s in site_logs if (s["plate_no"] or "").strip().upper() == p_clean]

            site_intervals = []
            for s in matched_sites:
                s_start = s["work_start_date"]
                s_end = s["work_end_date"]
                if s_start:
                    site_intervals.append({
                        "start": s_start,
                        "end": s_end,
                        "raw": s
                    })

            calculated_off_site_mtc = 0.0
            p_date = eq["purchase_date"]

            all_eq_years_months = set()
            for ml in maint_logs:
                if ml["equipment_id"] == eq_id:
                    all_eq_years_months.add((ml["year"], ml["month"]))

            for yr, mn in all_eq_years_months:
                total_mtc = maint_map.get(f"{eq_id}_{yr}_{mn}", 0.0)
                if total_mtc <= 0:
                    continue

                _, num_days = calendar.monthrange(yr, mn)
                daily_cost = total_mtc / num_days

                for day in range(1, num_days + 1):
                    current_d = date(yr, mn, day)
                    if p_date and current_d < p_date:
                        continue

                    is_on_site = False
                    for interval in site_intervals:
                        st = interval["start"]
                        en = interval["end"]
                        if en:
                            if st <= current_d <= en:
                                is_on_site = True
                                break
                        else:
                            if current_d >= st:
                                is_on_site = True
                                break

                    if not is_on_site:
                        calculated_off_site_mtc += daily_cost

            sites_data = []
            for s in matched_sites:
                c_name = normalize_company_name(s["site_name"])
                s_clean = clean_site_name(s["site_name"])
                combined_site = f"{s_clean} - {c_name}" if (s_clean and c_name) else (s_clean or c_name or s["site_name"])
                
                st = s["work_start_date"]
                en = s["work_end_date"]
                monthly_expenses = []

                if st:
                    cur_y = st.year
                    cur_m = st.month
                    target_end = en or date.today()

                    while True:
                        if (cur_y > target_end.year) or (cur_y == target_end.year and cur_m > target_end.month):
                            break

                        total_m_cost = maint_map.get(f"{eq_id}_{cur_y}_{cur_m}", 0.0)
                        _, month_days = calendar.monthrange(cur_y, cur_m)
                        m_start_day = 1
                        m_end_day = month_days

                        if cur_y == st.year and cur_m == st.month:
                            m_start_day = st.day
                        if en and cur_y == en.year and cur_m == en.month:
                            m_end_day = min(m_end_day, en.day)

                        active_days_in_month = max(0, m_end_day - m_start_day + 1)
                        if total_m_cost > 0 and active_days_in_month > 0:
                            portion = (total_m_cost / month_days) * active_days_in_month
                        else:
                            portion = 0.0

                        monthly_expenses.append(round(portion, 2))

                        if cur_m == 12:
                            cur_y += 1
                            cur_m = 1
                        else:
                            cur_m += 1

                if len(monthly_expenses) > max_months_count:
                    max_months_count = len(monthly_expenses)

                sites_data.append({
                    "work_assign_site": combined_site,
                    "reached_site_date": str(st) if st else "",
                    "site_end_date": str(en) if en else "",
                    "monthly_expenses": monthly_expenses
                })

            records.append({
                **eq,
                "off_site_mtc": round(calculated_off_site_mtc, 2),
                "sites": sites_data if len(sites_data) > 0 else [{"work_assign_site": "", "reached_site_date": "", "site_end_date": "", "monthly_expenses": []}]
            })

        return {
            "success": True, 
            "records": records, 
            "max_site_months": max(max_months_count, 2)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
def save_aks_data(payload: AKSSavePayload):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        for item in payload.updates:
            if item.field not in ALLOWED_FIELDS:
                continue
            
            val = item.value
            if item.field in ["insurance_cost", "off_site_mtc", "site_first_month_mtc", "site_second_month_mtc"]:
                val = float(val) if val not in [None, ""] else 0
            elif item.field == "reached_site_date":
                val = val if val not in [None, ""] else None
            elif item.field == "work_assign_site":
                val = str(val).strip() if val is not None else ""

            query = f"""
                INSERT INTO equipment_aks_details (equipment_id, {item.field}, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (equipment_id)
                DO UPDATE SET {item.field} = EXCLUDED.{item.field}, updated_at = CURRENT_TIMESTAMP;
            """
            cur.execute(query, (item.equipment_id, val))
        conn.commit()
        cur.close()
        conn.close()
        return {"success": True, "message": f"{len(payload.updates)} updates saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export-excel")
def export_aks_excel():
    try:
        data_res = get_aks_data()
        records = data_res["records"]
        max_months = data_res["max_site_months"]

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "AKS Tracker"

        ws.row_dimensions[1].height = 30
        head_fill = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
        head_font = Font(name="Segoe UI", size=11, bold=True, color="000000")
        regular_font = Font(name="Segoe UI", size=10)
        center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
        left_align = Alignment(horizontal="left", vertical="center", wrap_text=True)
        thin_border = Border(
            left=Side(style='thin', color='C0C0C0'),
            right=Side(style='thin', color='C0C0C0'),
            top=Side(style='thin', color='C0C0C0'),
            bottom=Side(style='thin', color='C0C0C0')
        )

        headers = [
            "SN", "Plate No / Asset code", "Date Of Purchase", "Purchase Cost",
            "Insurance Cost", "Off Site MTC", "Work assign Site",
            "Reached Site Date", "Site End Date"
        ]
        for m in range(1, max_months + 1):
            suf = "1st" if m == 1 else "2nd" if m == 2 else "3rd" if m == 3 else f"{m}th"
            headers.append(f"Site {suf} Month MTC")

        for c_idx, h_text in enumerate(headers, 1):
            c = ws.cell(row=1, column=c_idx, value=h_text)
            c.fill = head_fill
            c.font = head_font
            c.alignment = center_align
            c.border = thin_border

        curr_row = 2
        for idx, item in enumerate(records, 1):
            sites = item.get("sites", [])
            if not sites:
                sites = [{"work_assign_site": "", "reached_site_date": "", "site_end_date": "", "monthly_expenses": []}]
            
            row_span = len(sites)
            start_row = curr_row

            p_date = item.get("purchase_date")
            p_date_obj = None
            if p_date:
                try:
                    p_date_obj = datetime.strptime(str(p_date)[:10], "%Y-%m-%d").date()
                except Exception:
                    p_date_obj = None

            for s_idx, s in enumerate(sites):
                ws.row_dimensions[curr_row].height = 24
                
                # Base Columns
                ws.cell(row=curr_row, column=1, value=idx).alignment = center_align
                ws.cell(row=curr_row, column=2, value=item.get("plate_no") or "").alignment = center_align
                
                c_date = ws.cell(row=curr_row, column=3, value=p_date_obj)
                c_date.alignment = center_align
                if p_date_obj:
                    c_date.number_format = 'dd-mmm-yy'

                c_pcost = ws.cell(row=curr_row, column=4, value=float(item.get("purchase_cost") or 0))
                c_pcost.alignment = center_align
                c_pcost.number_format = '#,##0.00'

                c_icost = ws.cell(row=curr_row, column=5, value=float(item.get("insurance_cost") or 0))
                c_icost.alignment = center_align
                c_icost.number_format = '#,##0.00'

                # Off Site MTC - Normal Black, Not Bold, Not Red
                c_offmtc = ws.cell(row=curr_row, column=6, value=float(item.get("off_site_mtc") or 0))
                c_offmtc.alignment = center_align
                c_offmtc.font = regular_font
                c_offmtc.number_format = '#,##0.00'

                # Site Specific Columns
                c_site = ws.cell(row=curr_row, column=7, value=s.get("work_assign_site") or "")
                c_site.alignment = left_align
                if s.get("site_end_date"):
                    c_site.fill = PatternFill(start_color="FCE8E6", end_color="FCE8E6", fill_type="solid")

                r_date_str = s.get("reached_site_date")
                r_date_obj = None
                if r_date_str:
                    try:
                        r_date_obj = datetime.strptime(str(r_date_str)[:10], "%Y-%m-%d").date()
                    except Exception:
                        r_date_obj = None
                c_rdate = ws.cell(row=curr_row, column=8, value=r_date_obj)
                c_rdate.alignment = center_align
                if r_date_obj:
                    c_rdate.number_format = 'dd-mmm-yy'

                e_date_str = s.get("site_end_date")
                e_date_obj = None
                if e_date_str:
                    try:
                        e_date_obj = datetime.strptime(str(e_date_str)[:10], "%Y-%m-%d").date()
                    except Exception:
                        e_date_obj = None
                c_edate = ws.cell(row=curr_row, column=9, value=e_date_obj)
                c_edate.alignment = center_align
                if e_date_obj:
                    c_edate.number_format = 'dd-mmm-yy'

                # Monthly Expenses
                exp_list = s.get("monthly_expenses", [])
                for m_idx in range(max_months):
                    col_num = 10 + m_idx
                    val = float(exp_list[m_idx]) if m_idx < len(exp_list) else None
                    c_exp = ws.cell(row=curr_row, column=col_num, value=val)
                    c_exp.alignment = center_align
                    if val is not None:
                        c_exp.number_format = '#,##0.00'

                for c_num in range(1, len(headers) + 1):
                    ws.cell(row=curr_row, column=c_num).border = thin_border
                    if ws.cell(row=curr_row, column=c_num).font == Font():
                        ws.cell(row=curr_row, column=c_num).font = regular_font

                curr_row += 1

            if row_span > 1:
                end_row = curr_row - 1
                for merge_col in [1, 2, 3, 4, 5, 6]:
                    ws.merge_cells(start_row=start_row, start_column=merge_col, end_row=end_row, end_column=merge_col)

        last_col_letter = get_column_letter(len(headers))
        ws.auto_filter.ref = f"A1:{last_col_letter}{curr_row - 1}"
        ws.sheet_view.zoomScale = 85

        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                val = cell.value
                if val:
                    val_str = val.strftime('%d-%b-%y') if isinstance(val, (datetime, date)) else str(val)
                    max_len = max(max_len, len(val_str))
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"Equipment_AKS_Tracker_{date.today().strftime('%Y_%m_%d')}.xlsx"
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))