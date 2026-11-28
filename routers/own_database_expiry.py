from fastapi import APIRouter, HTTPException, Body
from fastapi.responses import StreamingResponse
import io
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime

router = APIRouter()

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


@router.get("/py/api/we1-own-eq/expiry-tracker")
def get_we1_own_eq_expiry_data():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = """
            SELECT
                m.id,
                m.plate_no,
                m.vehicle_type,
                m.driver_name,
                m.vehicle_owner,
                m.driver_mobile,
                m.site_name,
                m.status,
                m.chassis_no,
                m.serial_no,
                m.eq_insurance_exp,
                m.fahs_mvpi_exp,
                m.op_card_exp,
                m.isthimaara_exp
            FROM we1_own_eq_master m
            ORDER BY m.id ASC
        """
        cursor.execute(query)
        master_rows = cursor.fetchall()

        cursor.execute("""
            SELECT
                id AS driver_log_id,
                UPPER(TRIM(plate_no)) AS plate_key,
                driver_name,
                driver_mobile,
                work_end_date,
                iqama_no,
                iqama_expiry,
                licence_expiry,
                passport_no,
                passport_expiry
            FROM we1_driver_log
            WHERE plate_no IS NOT NULL AND TRIM(plate_no) <> ''
            ORDER BY COALESCE(join_date, '1970-01-01'::date) DESC, id DESC
        """)
        all_driver_logs = cursor.fetchall()

        active_drivers_map = {}
        latest_driver_map = {}
        for dl in all_driver_logs:
            pk = dl["plate_key"]
            if pk not in latest_driver_map:
                latest_driver_map[pk] = dl
            if dl["work_end_date"] is None:
                active_drivers_map.setdefault(pk, []).append(dl)

        today = datetime.now().date()
        formatted_rows = []

        expiry_fields = [
            "iqama_expiry",
            "licence_expiry",
            "passport_expiry",
            "eq_insurance_exp",
            "fahs_mvpi_exp",
            "op_card_exp",
            "isthimaara_exp",
        ]

        def format_expiry_item(item_dict):
            for field in expiry_fields:
                val = item_dict.get(field)
                if val:
                    val_date = val.date() if isinstance(val, datetime) else val
                    item_dict[field] = val_date.isoformat()
                    item_dict[f"{field}_days"] = (val_date - today).days
                else:
                    item_dict[field] = None
                    item_dict[f"{field}_days"] = None
            return item_dict

        for r in master_rows:
            pk = str(r.get("plate_no") or "").strip().upper()
            active_list = active_drivers_map.get(pk, [])

            if len(active_list) <= 1:
                d = active_list[0] if active_list else latest_driver_map.get(pk)
                item = dict(r)
                item["driver_log_id"] = d["driver_log_id"] if d else None
                item["iqama_no"] = d["iqama_no"] if d else None
                item["iqama_expiry"] = d["iqama_expiry"] if d else None
                item["licence_expiry"] = d["licence_expiry"] if d else None
                item["passport_no"] = d["passport_no"] if d else None
                item["passport_expiry"] = d["passport_expiry"] if d else None
                formatted_rows.append(format_expiry_item(item))
            else:
                # 1) Equipment-level expiries (single row with joined driver names)
                eq_item = dict(r)
                eq_item["driver_name"] = " / ".join(
                    [str(d["driver_name"]).strip() for d in active_list if d.get("driver_name")]
                ) or r.get("driver_name")
                eq_item["driver_log_id"] = None
                eq_item["iqama_no"] = None
                eq_item["iqama_expiry"] = None
                eq_item["licence_expiry"] = None
                eq_item["passport_no"] = None
                eq_item["passport_expiry"] = None
                formatted_rows.append(format_expiry_item(eq_item))

                # 2) Driver-level expiries (one row per active driver)
                for d in active_list:
                    drv_item = dict(r)
                    drv_item["driver_name"] = d.get("driver_name") or r.get("driver_name")
                    drv_item["driver_mobile"] = d.get("driver_mobile") or r.get("driver_mobile")
                    drv_item["driver_log_id"] = d["driver_log_id"]
                    drv_item["iqama_no"] = d.get("iqama_no")
                    drv_item["iqama_expiry"] = d.get("iqama_expiry")
                    drv_item["licence_expiry"] = d.get("licence_expiry")
                    drv_item["passport_no"] = d.get("passport_no")
                    drv_item["passport_expiry"] = d.get("passport_expiry")
                    drv_item["eq_insurance_exp"] = None
                    drv_item["fahs_mvpi_exp"] = None
                    drv_item["op_card_exp"] = None
                    drv_item["isthimaara_exp"] = None
                    formatted_rows.append(format_expiry_item(drv_item))

        return {"success": True, "data": formatted_rows}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()


@router.post("/py/api/we1-own-eq/expiry-tracker/update-date")
def update_we1_own_eq_expiry_date(payload: dict = Body(...)):
    master_id = payload.get("master_id")
    driver_log_id = payload.get("driver_log_id")
    plate_no = str(payload.get("plate_no") or "").strip().upper()
    field = str(payload.get("field") or "").strip()
    new_date = str(payload.get("new_date") or "").strip()

    driver_fields = {"iqama_expiry", "licence_expiry", "passport_expiry"}
    master_fields = {"eq_insurance_exp", "fahs_mvpi_exp", "op_card_exp", "isthimaara_exp"}

    if field not in driver_fields and field not in master_fields:
        raise HTTPException(status_code=400, detail="Invalid expiry field specified.")

    if not plate_no or not new_date:
        raise HTTPException(status_code=400, detail="Plate No and New Expiry Date are required.")

    try:
        parsed_date = datetime.strptime(new_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        if field in master_fields:
            if not master_id:
                raise HTTPException(status_code=400, detail="Missing Equipment Master ID.")
            # Verify both master_id and plate_no match the exact same row before updating
            cursor.execute(
                f"""
                UPDATE we1_own_eq_master
                SET {field} = %s
                WHERE id = %s AND UPPER(TRIM(plate_no)) = %s
                RETURNING id, plate_no
                """,
                (parsed_date, int(master_id), plate_no),
            )
            updated = cursor.fetchone()
            if not updated:
                conn.rollback()
                raise HTTPException(status_code=404, detail="Exact Equipment row not found or Plate mismatch.")
        else:
            if not driver_log_id:
                raise HTTPException(status_code=400, detail="No Driver Log record found for this vehicle to update.")
            # Verify both driver_log_id and plate_no match the exact same driver log row
            cursor.execute(
                f"""
                UPDATE we1_driver_log
                SET {field} = %s
                WHERE id = %s AND UPPER(TRIM(plate_no)) = %s
                RETURNING id, plate_no
                """,
                (parsed_date, int(driver_log_id), plate_no),
            )
            updated = cursor.fetchone()
            if not updated:
                conn.rollback()
                raise HTTPException(status_code=404, detail="Exact Driver Log row not found or Plate mismatch.")

        conn.commit()
        return {"success": True, "message": f"Updated {field} for {plate_no} successfully."}

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()


@router.get("/py/api/we1-own-eq/expiry-tracker/export")
def export_we1_own_eq_expiry_excel():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = """
            SELECT
                m.id,
                m.plate_no,
                m.vehicle_type,
                m.driver_name,
                m.vehicle_owner,
                m.site_name,
                m.chassis_no,
                m.serial_no,
                m.eq_insurance_exp,
                m.fahs_mvpi_exp,
                m.op_card_exp,
                m.isthimaara_exp
            FROM we1_own_eq_master m
            ORDER BY m.id ASC
        """
        cursor.execute(query)
        master_rows = cursor.fetchall()

        cursor.execute("""
            SELECT
                UPPER(TRIM(plate_no)) AS plate_key,
                driver_name,
                work_end_date,
                iqama_no,
                iqama_expiry,
                licence_expiry,
                passport_no,
                passport_expiry
            FROM we1_driver_log
            WHERE plate_no IS NOT NULL AND TRIM(plate_no) <> ''
            ORDER BY COALESCE(join_date, '1970-01-01'::date) DESC, id DESC
        """)
        all_driver_logs = cursor.fetchall()

        active_drivers_map = {}
        latest_driver_map = {}
        for dl in all_driver_logs:
            pk = dl["plate_key"]
            if pk not in latest_driver_map:
                latest_driver_map[pk] = dl
            if dl["work_end_date"] is None:
                active_drivers_map.setdefault(pk, []).append(dl)

        rows = []
        for r in master_rows:
            pk = str(r.get("plate_no") or "").strip().upper()
            active_list = active_drivers_map.get(pk, [])
            if len(active_list) <= 1:
                d = active_list[0] if active_list else latest_driver_map.get(pk)
                item = dict(r)
                item["iqama_no"] = d["iqama_no"] if d else None
                item["iqama_expiry"] = d["iqama_expiry"] if d else None
                item["licence_expiry"] = d["licence_expiry"] if d else None
                item["passport_no"] = d["passport_no"] if d else None
                item["passport_expiry"] = d["passport_expiry"] if d else None
                rows.append(item)
            else:
                eq_item = dict(r)
                eq_item["driver_name"] = " / ".join(
                    [str(d["driver_name"]).strip() for d in active_list if d.get("driver_name")]
                ) or r.get("driver_name")
                eq_item["iqama_no"] = None
                eq_item["iqama_expiry"] = None
                eq_item["licence_expiry"] = None
                eq_item["passport_no"] = None
                eq_item["passport_expiry"] = None
                rows.append(eq_item)

                for d in active_list:
                    drv_item = dict(r)
                    drv_item["driver_name"] = d.get("driver_name") or r.get("driver_name")
                    drv_item["iqama_no"] = d.get("iqama_no")
                    drv_item["iqama_expiry"] = d.get("iqama_expiry")
                    drv_item["licence_expiry"] = d.get("licence_expiry")
                    drv_item["passport_no"] = d.get("passport_no")
                    drv_item["passport_expiry"] = d.get("passport_expiry")
                    drv_item["eq_insurance_exp"] = None
                    drv_item["fahs_mvpi_exp"] = None
                    drv_item["op_card_exp"] = None
                    drv_item["isthimaara_exp"] = None
                    rows.append(drv_item)
        today = datetime.now().date()

        categories = [
            {
                "tab_name": "IQAMA Expiry",
                "key": "iqama_expiry",
                "doc_cols": [("IQAMA No.", "iqama_no")],
            },
            {
                "tab_name": "Licence Expiry",
                "key": "licence_expiry",
                "doc_cols": [("IQAMA No.", "iqama_no")],
            },
            {
                "tab_name": "Passport Expiry",
                "key": "passport_expiry",
                "doc_cols": [("Passport No.", "passport_no")],
            },
            {
                "tab_name": "EQ Insurance Exp",
                "key": "eq_insurance_exp",
                "doc_cols": [("Chassis No", "chassis_no"), ("Serial No", "serial_no")],
            },
            {
                "tab_name": "FAHS - MVPI Exp",
                "key": "fahs_mvpi_exp",
                "doc_cols": [("Chassis No", "chassis_no"), ("Serial No", "serial_no")],
            },
            {
                "tab_name": "Operation Card Exp",
                "key": "op_card_exp",
                "doc_cols": [
                    ("Owner Name", "vehicle_owner"),
                    ("Chassis No", "chassis_no"),
                    ("Serial No", "serial_no"),
                ],
            },
            {
                "tab_name": "Isthimaara Exp",
                "key": "isthimaara_exp",
                "doc_cols": [("Chassis No", "chassis_no"), ("Serial No", "serial_no")],
            },
        ]

        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True)
        expired_fill = PatternFill(start_color="DC2626", end_color="DC2626", fill_type="solid")
        expired_font = Font(color="FFFFFF", bold=True)
        soon_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
        soon_font = Font(color="B45309", bold=True)
        center_align = Alignment(horizontal="center", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")
        thin_side = Side(style="thin", color="CBD5E1")
        cell_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

        for cat in categories:
            # Filter only Expired (< 0) and Expiring Soon (0..30)
            filtered_items = []
            for r in rows:
                val = r.get(cat["key"])
                if not val:
                    continue
                val_date = val.date() if isinstance(val, datetime) else val
                days = (val_date - today).days
                if days <= 30:
                    filtered_items.append((days, val_date, r))

            # Skip tab if there are no data rows
            if not filtered_items:
                continue

            ws = wb.create_sheet(title=cat["tab_name"])
            doc_headers = [h for h, _ in cat["doc_cols"]]
            headers = ["SN", "Plate No", "Vehicle Type", "Driver Name"] + doc_headers + [
                "Expiry Date",
                "Remaining / Status",
                "Site Name",
            ]
            ws.append(headers)

            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = center_align
                cell.border = cell_border

            filtered_items.sort(key=lambda x: x[0])

            for idx, (days, val_date, r) in enumerate(filtered_items, start=1):
                is_expired = days < 0
                overdue_days = abs(days)
                if is_expired:
                    status_text = f"Expired ({overdue_days} day{'s' if overdue_days != 1 else ''} ago)"
                elif days == 0:
                    status_text = "Expires Today"
                else:
                    status_text = f"In {days} day{'s' if days != 1 else ''}"

                doc_vals = [(r.get(field) or "") for _, field in cat["doc_cols"]]
                row_values = [
                    idx,
                    r.get("plate_no") or "",
                    r.get("vehicle_type") or "",
                    r.get("driver_name") or "",
                ] + doc_vals + [
                    val_date,
                    status_text,
                    r.get("site_name") or "",
                ]
                ws.append(row_values)

                excel_row = ws[idx + 1]
                date_col_idx = 4 + len(doc_headers) + 1
                status_col_idx = date_col_idx + 1

                for c_idx, cell in enumerate(excel_row, start=1):
                    cell.border = cell_border
                    if c_idx == 1:
                        cell.alignment = center_align
                    elif c_idx == date_col_idx:
                        cell.number_format = "DD-MMM-YY"
                        cell.alignment = center_align
                        cell.font = Font(bold=True)
                    elif c_idx == status_col_idx:
                        cell.alignment = center_align
                        if is_expired:
                            cell.fill = expired_fill
                            cell.font = expired_font
                        else:
                            cell.fill = soon_fill
                            cell.font = soon_font
                    else:
                        cell.alignment = left_align

            last_col_letter = openpyxl.utils.get_column_letter(len(headers))
            ws.auto_filter.ref = f"A1:{last_col_letter}{max(len(filtered_items) + 1, 1)}"
            ws.freeze_panes = "A2"
            ws.sheet_view.zoomScale = 80

            # Auto-fit column widths
            for col_cells in ws.columns:
                max_len = 0
                col_letter = col_cells[0].column_letter
                for c in col_cells:
                    val_str = str(c.value or "")
                    if len(val_str) > max_len:
                        max_len = len(val_str)
                ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        # Fallback if all categories have 0 expired/expiring rows
        if len(wb.sheetnames) == 0:
            ws = wb.create_sheet(title="No_Expiry_Data")
            ws.append(["Message"])
            ws.append(["No expired or expiring (<= 30 days) records found."])
            ws.sheet_view.zoomScale = 80

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"We1_Own_EQ_Expiry_Tracker_{today.isoformat()}.xlsx"
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return StreamingResponse(
            output,
            headers=headers,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()