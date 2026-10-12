import os
import io
import json
import psycopg2
import re
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(prefix="/py/einvoice", tags=["E-Invoice Export"])

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", "5432")
    )

@router.get("/export-dashboard-excel")
async def export_dashboard_excel():
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Database-ൽ നിന്ന് എല്ലാ ഇന്‍വോയ്സുകളും എടുക്കുന്നു
        cur.execute("""
            SELECT id, invoice_no, company_name, vendor_name, billing_month, 
                   TO_CHAR(invoice_date, 'YYYY-MM-DD') as inv_date, raw_payload
            FROM generated_e_invoices
            ORDER BY id DESC
        """)
        records = cur.fetchall()
        cur.close()
        conn.close()

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Invoices Detailed"

        # 1. Styles & Colors
        header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        data_font = Font(name="Calibri", size=10)
        bold_font = Font(name="Calibri", size=10, bold=True)
        grand_font = Font(name="Calibri", size=10, bold=True, color="002886")

        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )

        headers = [
            "SL NO", "INVOICE NO", "COMPANY NAME", "CUSTOMER NAME", "SUPPLY MONTH", "BILL DATE",
            "SEQ NO", "ITEM / VEHICLE", "QTY", "RATE", "SUBTOTAL", "VAT (15%)", "TOTAL",
            "OT QTY", "OT RATE", "OT SUBTOTAL", "OT VAT", "OT TOTAL", "GRAND TOTAL"
        ]

        # 2. Write Headers
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)
            cell.border = thin_border

        ws.row_dimensions[1].height = 26

        current_row = 2
        sl_no = 1

        for rec in records:
            inv_id, inv_no, comp_name, cust_name, bill_month, inv_date, raw_payload = rec

            payload = raw_payload if isinstance(raw_payload, dict) else {}
            if isinstance(raw_payload, str):
                try:
                    payload = json.loads(raw_payload)
                except Exception:
                    payload = {}

            manual_items = payload.get("manual_items") or []

            # Equipments-ഉം Overtime-ഉം തരംതിരിക്കുന്നു
            equipments = []
            overtimes = []

            for idx, item in enumerate(manual_items):
                vtype = str(item.get("vtype", "")).strip()
                seq = str(item.get("seq", "")).strip() if item.get("seq") is not None and str(item.get("seq", "")).strip() != "" else str(idx + 1)
                qty = float(item.get("qty") or 0)
                rate = float(item.get("rate") or 0)
                vat_pct = float(item.get("vatPercent") if item.get("vatPercent") is not None else 15)

                if not vtype and qty == 0:
                    continue

                v_lower = vtype.lower()
                is_ot = "overtime" in v_lower or "over time" in v_lower or re.search(r'\bot\b', v_lower) is not None

                if is_ot:
                    overtimes.append({
                        "seq": seq,
                        "qty": qty,
                        "rate": rate,
                        "vat_pct": vat_pct
                    })
                else:
                    equipments.append({
                        "seq": seq,
                        "vtype": vtype,
                        "qty": qty,
                        "rate": rate,
                        "vat_pct": vat_pct
                    })

            # എക്യുപ്‌മെന്റ് ഒന്നും ചേർത്തിട്ടില്ലാത്ത ബിൽ ആണെങ്കിൽ ബ്ലാങ്ക് ഐറ്റം ആഡ് ചെയ്യുന്നു
            if not equipments and not overtimes:
                equipments.append({
                    "seq": "-",
                    "vtype": "-",
                    "qty": 0.0,
                    "rate": 0.0,
                    "vat_pct": 15.0
                })

            # ഓരോ എക്യുപ്‌മെന്റിനും ഒപ്പം അതേ SEQ വരുന്ന OT മാച്ച് ചെയ്യുന്നു
            for eq in equipments:
                eq_seq = eq["seq"]
                eq_qty = eq["qty"]
                eq_rate = eq["rate"]
                eq_sub = round(eq_qty * eq_rate, 2)
                eq_vat = round(eq_sub * (eq["vat_pct"] / 100), 2)
                eq_tot = round(eq_sub + eq_vat, 2)

                # Find Matching OT with same SEQ
                matched_ot = None
                for idx, ot in enumerate(overtimes):
                    if ot["seq"] == eq_seq:
                        matched_ot = overtimes.pop(idx)
                        break

                ot_qty = matched_ot["qty"] if matched_ot else 0.0
                ot_rate = matched_ot["rate"] if matched_ot else 0.0
                ot_sub = round(ot_qty * ot_rate, 2) if matched_ot else 0.0
                ot_vat = round(ot_sub * ((matched_ot["vat_pct"] / 100) if matched_ot else 0.15), 2)
                ot_tot = round(ot_sub + ot_vat, 2)

                combined_grand_total = round(eq_tot + ot_tot, 2)

                row_vals = [
                    sl_no,
                    inv_no or "-",
                    comp_name or "-",
                    cust_name or "-",
                    bill_month or "-",
                    inv_date or "-",
                    eq_seq,
                    eq["vtype"],
                    eq_qty,
                    eq_rate,
                    eq_sub,
                    eq_vat,
                    eq_tot,
                    ot_qty if ot_qty > 0 else "-",
                    ot_rate if ot_qty > 0 else "-",
                    ot_sub if ot_qty > 0 else "-",
                    ot_vat if ot_qty > 0 else "-",
                    ot_tot if ot_qty > 0 else "-",
                    combined_grand_total
                ]

                for col_idx, val in enumerate(row_vals, 1):
                    cell = ws.cell(row=current_row, column=col_idx, value=val)
                    cell.font = data_font
                    cell.border = thin_border

                    # Formats & Alignments
                    if col_idx in [1, 5, 6, 7]:
                        cell.alignment = Alignment(horizontal="center", vertical="center")
                    elif col_idx in [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]:
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                        if isinstance(val, (int, float)):
                            cell.number_format = "#,##0.00"
                    elif col_idx == 19:
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                        cell.font = grand_font
                        if isinstance(val, (int, float)):
                            cell.number_format = "#,##0.00"
                    else:
                        cell.alignment = Alignment(horizontal="left", vertical="center")

                ws.row_dimensions[current_row].height = 20
                current_row += 1
                sl_no += 1

            # ഏതെങ്കിലും OT മാച്ച് ആവാതെ അവശേഷിച്ചിട്ടുണ്ടെങ്കിൽ അവയ്ക്കും പ്രത്യേക വരി കൊടുക്കുന്നു
            for ot in overtimes:
                ot_qty = ot["qty"]
                ot_rate = ot["rate"]
                ot_sub = round(ot_qty * ot_rate, 2)
                ot_vat = round(ot_sub * (ot["vat_pct"] / 100), 2)
                ot_tot = round(ot_sub + ot_vat, 2)

                row_vals = [
                    sl_no,
                    inv_no or "-",
                    comp_name or "-",
                    cust_name or "-",
                    bill_month or "-",
                    inv_date or "-",
                    ot["seq"],
                    "Over Time",
                    0, 0, 0, 0, 0,
                    ot_qty, ot_rate, ot_sub, ot_vat, ot_tot,
                    ot_tot
                ]

                for col_idx, val in enumerate(row_vals, 1):
                    cell = ws.cell(row=current_row, column=col_idx, value=val)
                    cell.font = data_font
                    cell.border = thin_border
                    if col_idx in [1, 5, 6, 7]:
                        cell.alignment = Alignment(horizontal="center", vertical="center")
                    elif col_idx >= 9:
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                        if isinstance(val, (int, float)):
                            cell.number_format = "#,##0.00"
                    else:
                        cell.alignment = Alignment(horizontal="left", vertical="center")

                ws.row_dimensions[current_row].height = 20
                current_row += 1
                sl_no += 1

        # 3. Column Widths
        for col in ws.columns:
            max_len = 0
            col_letter = get_column_letter(col[0].column)
            for cell in col:
                if cell.value is not None:
                    max_len = max(max_len, len(str(cell.value)))
            ws.column_dimensions[col_letter].width = max(max_len + 3, 11)

        ws.auto_filter.ref = ws.dimensions
        ws.sheet_view.zoomScale = 85

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"E_Invoices_Master_Report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))