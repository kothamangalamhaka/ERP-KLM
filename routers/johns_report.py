import os
import io
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(prefix="/py/johns-report", tags=["Johns Report"])

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432")
    )

class MonthItem(BaseModel):
    m: str
    y: int

class FetchBatchPayload(BaseModel):
    months: list[MonthItem]

class ExcelSheetPayload(BaseModel):
    sheet_name: str
    rows: list[list]

class ExportPayload(BaseModel):
    file_name: str
    sheets: list[ExcelSheetPayload]

@router.post("/fetch-data")
def fetch_report_data(payload: FetchBatchPayload):
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        full_months = [f"{item.m} {item.y}" for item in payload.months]

        cur.execute("SELECT plate_no, owner_name, site_name, vehicle_type, vat FROM timesheet_vehicles")
        vehicles = cur.fetchall()

        cur.execute("SELECT plate_no, site_name, work_start_date, work_end_date, rate, field_co, site_co, vehicle_type, status FROM vehicle_site_log")
        sites = cur.fetchall()

        cur.execute("SELECT plate_no, driver_name, work_start_date, work_end_date FROM vehicle_driver_log")
        drivers = cur.fetchall()

        cur.execute("SELECT plate_no, record_date, calc_time, bd, month, year FROM timesheet_daily_records WHERE (month, year::int) IN %s", (tuple((item.m, item.y) for item in payload.months),))
        timesheets = cur.fetchall()

        cur.execute("SELECT * FROM invoice_records WHERE month = ANY(%s)", (full_months,))
        invoices = cur.fetchall()

        cur.execute("SELECT * FROM billing_records WHERE billing_month = ANY(%s)", (full_months,))
        billing = cur.fetchall()

        cur.execute("SELECT plate_no, owner_name, vat, work_start_date, work_end_date, status FROM vehicle_owner_log")
        owners = cur.fetchall()

        cur.execute("SELECT plate_no, site_name, rate, work_start_date, work_end_date, status FROM vehicle_rate_log")
        rates = cur.fetchall()

        cur.execute("SELECT old_plate_no, new_plate_no, TO_CHAR(change_date, 'YYYY-MM-DD') as change_date FROM vehicle_plate_log ORDER BY change_date ASC")
        plate_changes = cur.fetchall()

        cur.close()
        conn.close()

        return {
            "success": True,
            "vehicles": vehicles,
            "sites": sites,
            "drivers": drivers,
            "timesheets": timesheets,
            "invoices": invoices,
            "billing": billing,
            "owners": owners,
            "rates": rates,
            "plateChanges": plate_changes
        }
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.post("/export-excel")
def export_johns_excel(payload: ExportPayload):
    try:
        output = io.BytesIO()
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )
        hdr_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        cell_font = Font(name="Calibri", size=10)
        
        dark_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        calc_fill = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")

        diff_fill = PatternFill(start_color="BE123C", end_color="BE123C", fill_type="solid")
        pos_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
        neg_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")

        amt_fill = PatternFill(start_color="059669", end_color="059669", fill_type="solid")
        inv_fill = PatternFill(start_color="B91C1C", end_color="B91C1C", fill_type="solid")
        pl_fill = PatternFill(start_color="4338CA", end_color="4338CA", fill_type="solid")

        top_headers = [
            ("VEHICLE INFO", 1, 10, dark_fill),
            ("Logsheet Collected", 11, 12, dark_fill),
            ("Bill Summary", 13, 14, dark_fill),
            ("Supplier", 15, 16, dark_fill),
            ("For Driver", 17, 18, dark_fill),
            ("CALCULATIONS", 19, 21, calc_fill),
            ("DIFFERENCE", 22, 26, diff_fill),
            ("SUPPLIER PAYMENTS", 27, 32, amt_fill),
            ("INVOICE AMOUNT", 33, 39, inv_fill),
            ("P&L", 40, 40, pl_fill)
        ]

        sub_headers = [
            "SN", "Site", "Rate", "VAT", "Owner Name", "Driver Name",
            "Site Co", "Field Co", "Vehicle Type", "Plate No",
            "NR", "OT", "NR", "OT", "NR", "OT", "OT", "AMT",
            "Logsheet CF", "Bill Summary CF", "Supplier CF",
            "Log - Supplier", "Bill - Supplier", "Net CF", "Bill - Log", "Notes",
            "NR Rate", "OT Rate", "Rent", "VAT", "Total", "Net Total",
            "Subtotal", "Deductions", "Total", "Reason", "CRN No", "Invoice No", "Bill No",
            "Profit / Loss"
        ]

        for s_idx, sheet_data in enumerate(payload.sheets):
            ws = wb.create_sheet(title=sheet_data.sheet_name[:31])
            ws.views.sheetView[0].showGridLines = True

            for title, sc, ec, fill in top_headers:
                ws.merge_cells(start_row=1, start_column=sc, end_row=1, end_column=ec)
                for col in range(sc, ec + 1):
                    cell = ws.cell(row=1, column=col)
                    cell.fill = fill
                    cell.border = thin_border
                    if col == sc:
                        cell.value = title
                        cell.font = hdr_font
                        cell.alignment = Alignment(horizontal="center", vertical="center")

            for col_idx, col_name in enumerate(sub_headers, 1):
                cell = ws.cell(row=2, column=col_idx, value=col_name)
                if col_idx in [19, 20, 21]:
                    cell.fill = calc_fill
                elif 22 <= col_idx <= 26:
                    cell.fill = diff_fill
                elif 27 <= col_idx <= 32:
                    cell.fill = amt_fill
                elif 33 <= col_idx <= 39:
                    cell.fill = inv_fill
                elif col_idx == 40:
                    cell.fill = pl_fill
                else:
                    cell.fill = dark_fill
                cell.font = hdr_font
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = thin_border

            ws.row_dimensions[1].height = 24
            ws.row_dimensions[2].height = 22

            for r_idx, row_values in enumerate(sheet_data.rows, 3):
                for c_idx, val in enumerate(row_values, 1):
                    cell = ws.cell(row=r_idx, column=c_idx, value=val)
                    cell.font = cell_font
                    cell.border = thin_border
                    if c_idx in [22, 23, 24, 25] and val not in [None, "", "-"]:
                        try:
                            num_val = float(val)
                            if num_val > 0:
                                cell.fill = pos_fill
                            elif num_val < 0:
                                cell.fill = neg_fill
                        except (ValueError, TypeError):
                            pass
                    if c_idx in [1, 3, 4, 10]:
                        cell.alignment = Alignment(horizontal="center", vertical="center")
                    elif c_idx in [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]:
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    else:
                        cell.alignment = Alignment(horizontal="left", vertical="center")

            for col in ws.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = max(max_len + 3, 9)

        wb.save(output)
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={payload.file_name}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))