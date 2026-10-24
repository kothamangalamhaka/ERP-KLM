# new code - routers/payment_export_py.py
 
import io
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Any
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
 
router = APIRouter(prefix="/py/payment-export", tags=["Payment Excel Export"])
 
class SheetData(BaseModel):
    sheet_name: str
    aoa: List[List[Any]]
    merges: List[dict]
    is_analysis: bool = False
    is_vbv: bool = False
 
class ExportRequest(BaseModel):
    file_name: str
    sheets: List[SheetData]
 
@router.post("/generate-excel")
async def generate_excel(payload: ExportRequest):
    try:
        output = io.BytesIO()
        wb = openpyxl.Workbook()
        wb.remove(wb.active)  # Remove default sheet
 
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        data_font = Font(name="Calibri", size=11)
        bold_data_font = Font(name="Calibri", size=11, bold=True)
        
        thin_border = Border(
            left=Side(style="thin", color="000000"),
            right=Side(style="thin", color="000000"),
            top=Side(style="thin", color="000000"),
            bottom=Side(style="thin", color="000000")
        )
 
        for sheet_data in payload.sheets:
            ws = wb.create_sheet(title=sheet_data.sheet_name[:31])
            
            # 1. അതിവേഗം ഡാറ്റ വരിവരിയായി ചേർക്കുന്നു (Optimized Append)
            for row in sheet_data.aoa:
                ws.append([val if (val is not None and str(val).strip() != "") else "" for val in row])
 
            # 2. മെർജ് ചെയ്യുന്നു (Merge Top Headers)
            for m in sheet_data.merges:
                s = m["s"]
                e = m["e"]
                ws.merge_cells(
                    start_row=s["r"] + 1,
                    start_column=s["c"] + 1,
                    end_row=e["r"] + 1,
                    end_column=e["c"] + 1
                )
 
            # 3. ഹെഡ്ഡർ നിറങ്ങൾ (Exact Colors matching screen)
            if sheet_data.is_vbv:
                # VBV Layout (41 columns):
                # 0..6 (7 cols) VEHICLE: 1E293B
                # 7..8 (2 cols) TS: 166534
                # 9..10 (2 cols) INV: 1E40AF
                # 11..12 (2 cols) BILL: 6B21A8
                # 13..14 (2 cols) DRIVER: A16207
                # 15..19 (5 cols) DIFF: BE123C
                # 20..24 (5 cols) AMT: 059669
                # 25..31 (7 cols) INVOICE: B91C1C
                # 32..35 (4 cols) EXTRA: 334155
                # 36..38 (3 cols) GEN VEHICLE: 1E293B
                # 39..40 (2 cols) 31 NR: 166534
                col_colors = (
                    ["1E293B"] * 7 +
                    ["166534"] * 2 +
                    ["1E40AF"] * 2 +
                    ["6B21A8"] * 2 +
                    ["A16207"] * 2 +
                    ["BE123C"] * 5 +
                    ["059669"] * 5 +
                    ["B91C1C"] * 7 +
                    ["334155"] * 4 +
                    ["1E293B"] * 3 +
                    ["166534"] * 2
                )
            else:
                # Report / Analysis Layout (Total 41 columns)
                # 0..9 (10 cols): VEHICLE INFO
                # 10..11 (2 cols): Logsheet Collected
                # 12..13 (2 cols): Bill Summary
                # 14..15 (2 cols): To Supplier
                # 16..17 (2 cols): For Driver
                # 18..22 (5 cols): DIFFERENCE
                # 23..27 (5 cols): AMOUNT
                # 28..34 (7 cols): INVOICE (Subtotal, Deductions, Total, Reason, CRN No, Inv No, Bill No)
                # 35..38 (4 cols): EXTRA DETAILS
                # 39..40 (2 cols): 31 Considered as NR
                col_colors = (
                    ["1E293B"] * 10 +
                    ["166534"] * 2 +
                    ["1E40AF"] * 2 +
                    ["6B21A8"] * 2 +
                    ["A16207"] * 2 +
                    ["BE123C"] * 5 +
                    ["059669"] * 5 +
                    ["B91C1C"] * 7 +
                    ["334155"] * 4 +
                    ["166534"] * 2
                )
                if sheet_data.is_analysis:
                    col_colors.insert(0, "0F2027")

            max_cols = max((len(row) for row in sheet_data.aoa), default=len(col_colors))

            # 4. ഹെഡ്ഡർ സ്റ്റൈൽ (Rows 1 & 2)
            ws.row_dimensions[1].height = 28
            ws.row_dimensions[2].height = 24
            
            for r_idx in [1, 2]:
                for c_idx in range(1, max_cols + 1):
                    cell = ws.cell(row=r_idx, column=c_idx)
                    cell.font = header_font
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                    cell.border = thin_border
                    color_hex = col_colors[c_idx - 1] if c_idx - 1 < len(col_colors) else "1E293B"
                    cell.fill = PatternFill(start_color=color_hex, end_color=color_hex, fill_type="solid")

            # 5. ഡാറ്റാ സ്റ്റൈൽ & കളർ ഹൈലൈറ്റുകൾ (Fast Row-wise Styling)
            fill_nr = PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid")
            fill_ot = PatternFill(start_color="E6B8B7", end_color="E6B8B7", fill_type="solid")
            fill_bill = PatternFill(start_color="D8E4BC", end_color="D8E4BC", fill_type="solid")
            fill_diff_black = PatternFill(start_color="00B0F0", end_color="00B0F0", fill_type="solid")

            if sheet_data.is_vbv:
                # 1-based column indices in Excel for VBV:
                # TS NR/OT: cols 8, 9
                # INV NR/OT: cols 10, 11
                # BILL NR/OT: cols 12, 13
                # DRIVER OT/AMT: cols 14, 15
                target_nr_cols = [8, 9]
                target_ot_cols = [10, 11]
                target_bill_cols = [12, 13]
                target_diff_cols = [14, 15]
            else:
                offset = 1 if sheet_data.is_analysis else 0
                target_nr_cols = [11 + offset, 12 + offset]
                target_ot_cols = [13 + offset, 14 + offset]
                target_bill_cols = [15 + offset, 16 + offset]
                target_diff_cols = [17 + offset, 18 + offset]

            for row in ws.iter_rows(min_row=3, max_row=ws.max_row, min_col=1, max_col=max_cols):
                for cell in row:
                    c_idx = cell.column
                    cell.font = data_font
                    cell.border = thin_border
                    cell.alignment = Alignment(horizontal="center", vertical="center")

                    if c_idx in target_nr_cols:
                        cell.fill = fill_nr
                    elif c_idx in target_ot_cols:
                        cell.fill = fill_ot
                    elif c_idx in target_bill_cols:
                        cell.fill = fill_bill
                    elif c_idx in target_diff_cols and cell.value:
                        cell.fill = fill_diff_black
                        cell.font = bold_data_font
 
            # 6. AutoFilter, Freeze Panes & Zoom Level
            last_col_letter = get_column_letter(max_cols)
            ws.auto_filter.ref = f"A2:{last_col_letter}{ws.max_row}"
            ws.freeze_panes = "A3"
            ws.sheet_view.zoomScale = 80
 
            # 7. Column Widths
            for c_idx in range(1, max_cols + 1):
                ws.column_dimensions[get_column_letter(c_idx)].width = 16
 
        wb.save(output)
        output.seek(0)
 
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={payload.file_name}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))