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
            off_site_insurance NUMERIC(12, 2) DEFAULT 0,
            on_site_insurance NUMERIC(12, 2) DEFAULT 0,
            off_site_mtc NUMERIC(12, 2) DEFAULT 0,
            work_assign_site VARCHAR(255) DEFAULT '',
            reached_site_date DATE,
            site_first_month_mtc NUMERIC(12, 2) DEFAULT 0,
            site_second_month_mtc NUMERIC(12, 2) DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE equipment_aks_details ADD COLUMN IF NOT EXISTS off_site_insurance NUMERIC(12, 2) DEFAULT 0;
        ALTER TABLE equipment_aks_details ADD COLUMN IF NOT EXISTS on_site_insurance NUMERIC(12, 2) DEFAULT 0;
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'equipment_aks_details' AND column_name = 'insurance_cost'
            ) THEN
                UPDATE equipment_aks_details SET off_site_insurance = insurance_cost WHERE off_site_insurance = 0 OR off_site_insurance IS NULL;
            END IF;
        END $$;
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
    "off_site_insurance",
    "on_site_insurance",
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
        r'\(?\s*re\s*running\s*\)?', r'\brerunning\b', r'\b22\b', r'\bZ\b', r'\bHaka\b',
        r'\bAl\s*Joda\b', r'\bAljoda\b', r'\bMasar\s*Wheels\b',
        r'\bMasar\b', r'\bWe\s*1\b', r'\bWe1\b', r'\bWe-1\b'
    ]
    for p in unwanted:
        clean = re.sub(p, ' ', clean, flags=re.IGNORECASE)
    clean = re.sub(r'[-–—_/\\,|()]+', ' ', clean)
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
                COALESCE(a.asset_type, '') AS asset_type,
                COALESCE(a.model, '') AS model,
                COALESCE(a.make, '') AS make,
                COALESCE(a.owner_name, '') AS owner_name,
                e.purchase_date,
                COALESCE(e.purchase_cost, 0) AS purchase_cost,
                COALESCE(a.off_site_insurance, 0) AS off_site_insurance,
                COALESCE(a.on_site_insurance, 0) AS on_site_insurance
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
            SELECT 
                equipment_id, year, month, 
                COALESCE(maintenance_cost, 0) AS maintenance_cost,
                COALESCE(basic_salary, 0) AS basic_salary,
                COALESCE(overtime, 0) AS overtime,
                COALESCE(allowance, 0) AS allowance,
                COALESCE(penalty, 0) AS penalty,
                COALESCE(santook_rent, 0) AS santook_rent,
                COALESCE(kafil_comm, 0) AS kafil_comm,
                COALESCE(kafil_pct, 0) AS kafil_pct,
                COALESCE(owner_comm, 0) AS owner_comm,
                COALESCE(investor_comm, 0) AS investor_comm,
                COALESCE(debit, 0) AS debit,
                COALESCE(pwas, 0) AS pwas,
                COALESCE(other_expense, 0) AS other_expense,
                COALESCE(op_revenue, 0) AS op_revenue
            FROM equipment_monthly_logs;
        """)
        maint_logs = cur.fetchall()

        cur.close()
        conn.close()

        maint_map = {}
        otc_map = {}
        rev_map = {}
        all_logged_months = set()
        for ml in maint_logs:
            k = f"{ml['equipment_id']}_{ml['year']}_{ml['month']}"
            m_cost = float(ml["maintenance_cost"])
            maint_map[k] = m_cost
            rev_map[k] = float(ml["op_revenue"])

            # Calculate Operational Expenses (OTC)
            rev = float(ml["op_revenue"])
            pct = float(ml["kafil_pct"])
            kaf = rev * (pct / 100.0) if (pct > 0 and rev > 0) else float(ml["kafil_comm"])
            net_sal = float(ml["basic_salary"]) + float(ml["overtime"]) + float(ml["allowance"]) - float(ml["penalty"])
            tot_otc = (
                net_sal + float(ml["santook_rent"]) + kaf + float(ml["owner_comm"]) +
                float(ml["investor_comm"]) + float(ml["debit"]) + float(ml["pwas"]) + float(ml["other_expense"])
            )
            otc_map[k] = tot_otc

            if m_cost > 0 or tot_otc > 0 or rev > 0:
                all_logged_months.add((ml["year"], ml["month"]))

        # Build dynamic month timeline starting from earliest site/expense log up to current month
        for s in site_logs:
            if s["work_start_date"]:
                all_logged_months.add((s["work_start_date"].year, s["work_start_date"].month))

        today = date.today()
        # Purchase date ഉള്ളതിൽ ഏറ്റവും പഴയ തീയതിയിൽ നിന്ന് മാത്രം ടൈംലൈൻ ആരംഭിക്കുന്നു
        valid_p_dates = [eq["purchase_date"] for eq in equipments if eq["purchase_date"]]
        if valid_p_dates:
            earliest_p = min(valid_p_dates)
            min_y, min_m = earliest_p.year, earliest_p.month
        elif all_logged_months:
            min_y, min_m = min(all_logged_months)
        else:
            min_y, min_m = today.year, today.month

        timeline = []
        cur_y, cur_m = min_y, min_m
        while (cur_y < today.year) or (cur_y == today.year and cur_m <= today.month):
            m_abbr = calendar.month_abbr[cur_m]
            timeline.append({
                "year": cur_y,
                "month": cur_m,
                "label": f"{m_abbr} {cur_y}"
            })
            if cur_m == 12:
                cur_y += 1
                cur_m = 1
            else:
                cur_m += 1

        records = []

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
            on_site_maint_map = {}
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
                    else:
                        on_site_maint_map[f"{yr}_{mn}"] = on_site_maint_map.get(f"{yr}_{mn}", 0.0) + daily_cost

            month_columns_data = []
            for tm in timeline:
                yr, mn = tm["year"], tm["month"]
                m_start = date(yr, mn, 1)
                _, last_day = calendar.monthrange(yr, mn)
                m_end = date(yr, mn, last_day)

                # Site assignment matching
                matched_site_names = []
                for s in matched_sites:
                    st = s["work_start_date"]
                    en = s["work_end_date"]
                    if st and ((not en and st <= m_end) or (en and st <= m_end and en >= m_start)):
                        c_name = normalize_company_name(s["site_name"])
                        s_clean = clean_site_name(s["site_name"])
                        c_site = f"{s_clean} - {c_name}" if (s_clean and c_name) else (s_clean or c_name or s["site_name"])
                        c_site = c_site.strip()
                        if c_site and not any(existing.strip().lower() == c_site.lower() for existing in matched_site_names):
                            matched_site_names.append(c_site)

                site_display = " / ".join(matched_site_names) if matched_site_names else ""
                mtc_val = on_site_maint_map.get(f"{yr}_{mn}", 0.0)
                otc_val = otc_map.get(f"{eq_id}_{yr}_{mn}", 0.0)
                tor_val = rev_map.get(f"{eq_id}_{yr}_{mn}", 0.0)

                month_columns_data.append({
                    "site": site_display,
                    "mtc": round(mtc_val, 2),
                    "otc": round(otc_val, 2),
                    "tor": round(tor_val, 2)
                })

            net_off_site_mtc = max(0.0, calculated_off_site_mtc - float(eq.get("off_site_insurance") or 0))
            records.append({
                **eq,
                "off_site_mtc": round(net_off_site_mtc, 2),
                "months_data": month_columns_data
            })

        return {
            "success": True, 
            "records": records, 
            "timeline": timeline
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
            if item.field in ["off_site_insurance", "on_site_insurance", "off_site_mtc", "site_first_month_mtc", "site_second_month_mtc"]:
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
def export_aks_excel(
    mode: str = "single",
    start_year: Optional[int] = None,
    start_month: Optional[int] = None,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None
):
    try:
        data_res = get_aks_data()
        records = data_res["records"]
        timeline = data_res.get("timeline", [])

        wb = openpyxl.Workbook()
        default_sheet = wb.active

        head_fill_main = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
        head_fill_month = PatternFill(start_color="C6D9F1", end_color="C6D9F1", fill_type="solid")
        head_fill_sub = PatternFill(start_color="E9EEF4", end_color="E9EEF4", fill_type="solid")
        otc_data_fill = PatternFill(start_color="FEFCE8", end_color="FEFCE8", fill_type="solid")
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

        base_headers = [
            "SN", "Asset Type", "Model", "Make", "Owner Name", "Plate No / Asset code",
            "Date Of Purchase", "Purchase Cost", "Off Site Insurance",
            "On Site Insurance", "Off Site MTC"
        ]

        def build_tracker_sheet(ws, sheet_timeline):
            ws.row_dimensions[1].height = 25
            ws.row_dimensions[2].height = 25

            single_headers = [
                (1, "SN"),
                (2, "Asset Type"),
                (3, "Model"),
                (4, "Make"),
                (5, "Owner Name"),
                (6, "Plate No / Asset code"),
                (7, "Date Of Purchase"),
                (8, "Purchase Cost"),
                (11, "Off Site MTC")
            ]
            for c_idx, h_text in single_headers:
                ws.merge_cells(start_row=1, start_column=c_idx, end_row=2, end_column=c_idx)
                c = ws.cell(row=1, column=c_idx, value=h_text)
                c.fill = head_fill_main
                c.font = head_font
                c.alignment = center_align

            ws.merge_cells(start_row=1, start_column=9, end_row=1, end_column=10)
            c_ins = ws.cell(row=1, column=9, value="Insurance Cost")
            c_ins.fill = head_fill_main
            c_ins.font = head_font
            c_ins.alignment = center_align

            for sub_c, sub_t in [(9, "Off Site"), (10, "On Site")]:
                c_sub = ws.cell(row=2, column=sub_c, value=sub_t)
                c_sub.fill = head_fill_sub
                c_sub.font = head_font
                c_sub.alignment = center_align

            # Timeline Headers (4 Columns per Month: Site, MTC, OTC, TOR)
            rev_data_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid")
            col_cursor = len(base_headers) + 1
            for tm in sheet_timeline:
                ws.merge_cells(start_row=1, start_column=col_cursor, end_row=1, end_column=col_cursor + 3)
                c_top = ws.cell(row=1, column=col_cursor, value=tm["label"])
                c_top.fill = head_fill_month
                c_top.font = head_font
                c_top.alignment = center_align

                for sub_idx, sub_label in enumerate(["Site", "MTC", "OTC", "TOR"]):
                    c_sub = ws.cell(row=2, column=col_cursor + sub_idx, value=sub_label)
                    c_sub.fill = head_fill_sub
                    c_sub.font = head_font
                    c_sub.alignment = center_align
                col_cursor += 4

            total_cols = col_cursor - 1
            for r in [1, 2]:
                for c in range(1, total_cols + 1):
                    ws.cell(row=r, column=c).border = thin_border

            curr_row = 3
            for idx, item in enumerate(records, 1):
                ws.row_dimensions[curr_row].height = 24
                p_date = item.get("purchase_date")
                p_date_obj = None
                if p_date:
                    try:
                        p_date_obj = datetime.strptime(str(p_date)[:10], "%Y-%m-%d").date()
                    except Exception:
                        p_date_obj = None

                ws.cell(row=curr_row, column=1, value=idx).alignment = center_align
                ws.cell(row=curr_row, column=2, value=item.get("asset_type") or "").alignment = center_align
                ws.cell(row=curr_row, column=3, value=item.get("model") or "").alignment = center_align
                ws.cell(row=curr_row, column=4, value=item.get("make") or "").alignment = center_align
                ws.cell(row=curr_row, column=5, value=item.get("owner_name") or "").alignment = center_align
                ws.cell(row=curr_row, column=6, value=item.get("plate_no") or "").alignment = center_align

                c_date = ws.cell(row=curr_row, column=7, value=p_date_obj)
                c_date.alignment = center_align
                if p_date_obj:
                    c_date.number_format = 'dd-mmm-yy'

                c_pcost = ws.cell(row=curr_row, column=8, value=float(item.get("purchase_cost") or 0))
                c_pcost.alignment = center_align
                c_pcost.number_format = '#,##0.00'

                c_off_ins = ws.cell(row=curr_row, column=9, value=float(item.get("off_site_insurance") or 0))
                c_off_ins.alignment = center_align
                c_off_ins.number_format = '#,##0.00'

                c_on_ins = ws.cell(row=curr_row, column=10, value=float(item.get("on_site_insurance") or 0))
                c_on_ins.alignment = center_align
                c_on_ins.number_format = '#,##0.00'

                c_offmtc = ws.cell(row=curr_row, column=11, value=float(item.get("off_site_mtc") or 0))
                c_offmtc.alignment = center_align
                c_offmtc.font = regular_font
                c_offmtc.number_format = '#,##0.00'

                m_data_list = item.get("months_data", [])
                for t_idx, tm in enumerate(sheet_timeline):
                    orig_t_idx = next((i for i, x in enumerate(timeline) if x["year"] == tm["year"] and x["month"] == tm["month"]), -1)
                    m_info = m_data_list[orig_t_idx] if orig_t_idx != -1 and orig_t_idx < len(m_data_list) else {"site": "", "mtc": 0, "otc": 0, "tor": 0}

                    site_col = 12 + (t_idx * 4)
                    mtc_col = site_col + 1
                    otc_col = site_col + 2
                    tor_col = site_col + 3

                    c_site = ws.cell(row=curr_row, column=site_col, value=m_info.get("site") or "")
                    c_site.alignment = left_align

                    mtc_val = float(m_info.get("mtc") or 0)
                    c_mtc = ws.cell(row=curr_row, column=mtc_col, value=mtc_val if mtc_val > 0 else "")
                    c_mtc.alignment = center_align
                    if mtc_val > 0:
                        c_mtc.number_format = '#,##0.00'

                    otc_val = float(m_info.get("otc") or 0)
                    c_otc = ws.cell(row=curr_row, column=otc_col, value=otc_val if otc_val > 0 else "")
                    c_otc.alignment = center_align
                    c_otc.fill = otc_data_fill
                    if otc_val > 0:
                        c_otc.number_format = '#,##0.00'

                    tor_val = float(m_info.get("tor") or 0)
                    c_tor = ws.cell(row=curr_row, column=tor_col, value=tor_val if tor_val > 0 else "")
                    c_tor.alignment = center_align
                    c_tor.fill = rev_data_fill
                    if tor_val > 0:
                        c_tor.number_format = '#,##0.00'

                for c_num in range(1, total_cols + 1):
                    cell = ws.cell(row=curr_row, column=c_num)
                    cell.border = thin_border
                    if cell.font == Font():
                        cell.font = regular_font
                curr_row += 1

            last_col_letter = get_column_letter(total_cols)
            ws.auto_filter.ref = f"A2:{last_col_letter}{curr_row - 1}"
            ws.sheet_view.zoomScale = 85
            ws.freeze_panes = 'A3'

            for col in ws.columns:
                max_len = 0
                col_letter = get_column_letter(col[0].column)
                for cell in col:
                    val = cell.value
                    if val:
                        val_str = val.strftime('%d-%b-%y') if isinstance(val, (datetime, date)) else str(val)
                        max_len = max(max_len, len(val_str))
                ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        if mode == "yearly":
            years_in_timeline = sorted(list(set(tm["year"] for tm in timeline)))
            if not years_in_timeline:
                years_in_timeline = [date.today().year]

            for y_idx, yr in enumerate(years_in_timeline):
                yr_timeline = [tm for tm in timeline if tm["year"] == yr]
                ws = default_sheet if y_idx == 0 else wb.create_sheet(title=str(yr))
                ws.title = str(yr)
                build_tracker_sheet(ws, yr_timeline)
        elif mode == "period":
            s_y = start_year or (timeline[0]["year"] if timeline else date.today().year)
            s_m = start_month or (timeline[0]["month"] if timeline else 1)
            e_y = end_year or (timeline[-1]["year"] if timeline else date.today().year)
            e_m = end_month or (timeline[-1]["month"] if timeline else 12)

            period_timeline = []
            for tm in timeline:
                t_val = tm["year"] * 100 + tm["month"]
                if (s_y * 100 + s_m) <= t_val <= (e_y * 100 + e_m):
                    period_timeline.append(tm)
            if not period_timeline:
                period_timeline = timeline
            default_sheet.title = "Period Export"
            build_tracker_sheet(default_sheet, period_timeline)
        else:
            default_sheet.title = "AKS Tracker"
            build_tracker_sheet(default_sheet, timeline)

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