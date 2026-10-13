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
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Database query - ആവശ്യമായ കോളങ്ങൾ മാത്രം കുറഞ്ഞ മെമ്മറിയിൽ എടുക്കുന്നു
        cur.execute("""
            SELECT id, invoice_no, company_name, vendor_name, billing_month, 
                   TO_CHAR(invoice_date, 'YYYY-MM-DD') as inv_date, raw_payload
            FROM generated_e_invoices
            ORDER BY id DESC
        """)
        records = cur.fetchall()
        cur.close()
        conn.close()
        conn = None

        # സെർവർ മെമ്മറി ലാഭിക്കാൻ വേഗത്തിൽ എക്സൽ ബിൽഡ് ചെയ്യുന്നു
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Invoices Detailed"

        # Styles & Colors (ഒറ്റത്തവണ ഒബ്ജക്റ്റുകൾ ഡിക്ലെയർ ചെയ്യുന്നു)
        header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        data_font = Font(name="Calibri", size=10)
        grand_font = Font(name="Calibri", size=10, bold=True, color="002886")

        thin_side = Side(style='thin', color='CBD5E1')
        thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

        center_align = Alignment(horizontal="center", vertical="center")
        right_align = Alignment(horizontal="right", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")

        headers = [
            "SL NO", "INVOICE NO", "COMPANY NAME", "CUSTOMER NAME", "SUPPLY MONTH", "BILL DATE",
            "SEQ NO", "ITEM / VEHICLE", "NORMAL", "RATE", "OVER TIME", "RATE", "SUBTOTAL", "VAT", "GRAND TOTAL"
        ]

        # Write Headers
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = center_align
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
                    overtimes.append({"seq": seq, "qty": qty, "rate": rate, "vat_pct": vat_pct})
                else:
                    equipments.append({"seq": seq, "vtype": vtype, "qty": qty, "rate": rate, "vat_pct": vat_pct})

            if not equipments and not overtimes:
                equipments.append({"seq": "-", "vtype": "-", "qty": 0.0, "rate": 0.0, "vat_pct": 15.0})

            for eq in equipments:
                eq_seq = eq["seq"]
                eq_qty = eq["qty"]
                eq_rate = eq["rate"]

                matched_ot = None
                for idx, ot in enumerate(overtimes):
                    if ot["seq"] == eq_seq:
                        matched_ot = overtimes.pop(idx)
                        break

                ot_qty = matched_ot["qty"] if matched_ot else 0.0
                ot_rate = matched_ot["rate"] if matched_ot else 0.0

                subtotal = round((eq_qty * eq_rate) + (ot_qty * ot_rate), 2)
                vat_pct = eq.get("vat_pct", 15.0)
                vat_amount = round(subtotal * (vat_pct / 100), 2)
                grand_total = round(subtotal + vat_amount, 2)

                row_vals = [
                    sl_no, inv_no or "-", comp_name or "-", cust_name or "-", bill_month or "-", inv_date or "-",
                    eq_seq, eq["vtype"],
                    eq_qty if eq_qty > 0 else "-", eq_rate if eq_qty > 0 else "-",
                    ot_qty if ot_qty > 0 else "-", ot_rate if ot_qty > 0 else "-",
                    subtotal, vat_amount, grand_total
                ]

                for col_idx, val in enumerate(row_vals, 1):
                    cell = ws.cell(row=current_row, column=col_idx, value=val)
                    cell.font = grand_font if col_idx == 15 else data_font
                    cell.border = thin_border

                    if col_idx in [1, 5, 6, 7]:
                        cell.alignment = center_align
                    elif col_idx in [9, 10, 11, 12, 13, 14, 15]:
                        cell.alignment = right_align
                        if isinstance(val, (int, float)):
                            cell.number_format = "#,##0.00"
                    else:
                        cell.alignment = left_align

                ws.row_dimensions[current_row].height = 20
                current_row += 1
                sl_no += 1

            for ot in overtimes:
                ot_qty = ot["qty"]
                ot_rate = ot["rate"]
                subtotal = round(ot_qty * ot_rate, 2)
                vat_pct = ot.get("vat_pct", 15.0)
                vat_amount = round(subtotal * (vat_pct / 100), 2)
                grand_total = round(subtotal + vat_amount, 2)

                row_vals = [
                    sl_no, inv_no or "-", comp_name or "-", cust_name or "-", bill_month or "-", inv_date or "-",
                    ot["seq"], "Over Time", "-", "-",
                    ot_qty if ot_qty > 0 else "-", ot_rate if ot_qty > 0 else "-",
                    subtotal, vat_amount, grand_total
                ]

                for col_idx, val in enumerate(row_vals, 1):
                    cell = ws.cell(row=current_row, column=col_idx, value=val)
                    cell.font = grand_font if col_idx == 15 else data_font
                    cell.border = thin_border

                    if col_idx in [1, 5, 6, 7]:
                        cell.alignment = center_align
                    elif col_idx in [9, 10, 11, 12, 13, 14, 15]:
                        cell.alignment = right_align
                        if isinstance(val, (int, float)):
                            cell.number_format = "#,##0.00"
                    else:
                        cell.alignment = left_align

                ws.row_dimensions[current_row].height = 20
                current_row += 1
                sl_no += 1

        # Column Widths
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
        
        # Cross-Origin, Tailscale funnel ഫ്രണ്ട്‌ലി ഹെഡറുകൾ നൽകുന്നു
        headers_resp = {
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }

        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers_resp
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur: cur.close()
        if conn: conn.close()