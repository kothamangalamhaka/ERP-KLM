import io
from datetime import datetime
import openpyxl
from fastapi.responses import Response
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from pydantic import BaseModel


class ExportReq(BaseModel):
    headers: list
    rows: list
    date_cols: list = []
    num_cols: list = []
    qty_cols: list = []
    sheet_name: str = "Sheet1"


def _to_date(v):
    try:
        return datetime.strptime(str(v).strip()[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def xlsx_response(req: ExportReq, filename: str):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = req.sheet_name[:31]

    head_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    head_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Calibri", size=11)
    side = Side(style="thin", color="CBD5E1")
    border = Border(left=side, right=side, top=side, bottom=side)

    widths = []
    for ci, h in enumerate(req.headers, 1):
        c = ws.cell(row=1, column=ci, value=str(h).upper())
        c.fill = head_fill
        c.font = head_font
        c.border = border
        c.alignment = Alignment(horizontal="center", vertical="center")
        widths.append(len(str(h)) + 3)
    ws.row_dimensions[1].height = 28

    for ri, row in enumerate(req.rows, 2):
        for ci, v in enumerate(row, 1):
            idx = ci - 1
            if idx in req.date_cols:
                d = _to_date(v)
                c = ws.cell(row=ri, column=ci, value=d)
                if d:
                    c.number_format = "dd-mmm-yyyy"
                c.alignment = Alignment(horizontal="center", vertical="center")
                shown = 11
            elif idx in req.num_cols or idx in req.qty_cols:
                try:
                    num = float(v or 0)
                except Exception:
                    num = 0
                c = ws.cell(row=ri, column=ci, value=num)
                if idx in req.num_cols:
                    c.number_format = "#,##0.00"
                c.alignment = Alignment(horizontal="right", vertical="center")
                shown = len(f"{num:,.2f}")
            else:
                txt = "" if v is None else str(v)
                c = ws.cell(row=ri, column=ci, value=txt)
                c.alignment = Alignment(horizontal="left", vertical="center")
                shown = len(txt)
            c.font = data_font
            c.border = border
            if shown + 3 > widths[idx]:
                widths[idx] = shown + 3

    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(w, 10), 45)

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    ws.sheet_view.zoomScale = 80

    out = io.BytesIO()
    wb.save(out)
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )