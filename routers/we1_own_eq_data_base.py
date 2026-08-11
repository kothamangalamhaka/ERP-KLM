from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
import io
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter
import os
import psycopg2
from psycopg2.extras import RealDictCursor

router = APIRouter()

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

@router.get("/py/api/we1-own-eq/export")
def export_we1_own_eq_excel():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
        
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM we1_own_eq_master ORDER BY id ASC")
        data = cursor.fetchall()
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "We1_Own_EQ"

        headers = ["SN", "Mobilisation Date", "Vehicle Type", "Plate No", "Driver Name", 
                   "Mobile", "Joining Date", "Site Name", "Vehicle Owner", "Santhook", 
                   "Salary", "Status", "Note"]
        
        ws.append(headers)

        # 🟢 1. Header Styling (Black BG, White Text, Bold)
        header_fill = PatternFill(start_color="000000", end_color="000000", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True)
        header_alignment = Alignment(horizontal="center", vertical="center")

        for col_num, cell in enumerate(ws[1], 1):
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_alignment

        # 🟢 2. Append Data & Format
        for i, row in enumerate(data, start=1):
            salary_val = float(row['salary']) if row['salary'] else None
            
            ws.append([
                i,
                row['mob_date'],
                row['vehicle_type'],
                row['plate_no'],
                row['driver_name'],
                row['driver_mobile'],
                row['joining_date'],
                row['site_name'],
                row['vehicle_owner'],
                row['santhook'],
                salary_val,
                row['status'] or "Running",
                row['note']
            ])

        # 🟢 3. Apply Styles to Data Rows (Dates and Multiline Notes)
        for row in ws.iter_rows(min_row=2, max_col=13, max_row=len(data) + 1):
            # Mob Date (Col 2) & Joining Date (Col 7) -> dd-MMM-yy
            if row[1].value:
                row[1].number_format = 'DD-MMM-YY'
                row[1].alignment = Alignment(horizontal="center")
            if row[6].value:
                row[6].number_format = 'DD-MMM-YY'
                row[6].alignment = Alignment(horizontal="center")
            
            # Note (Col 13) -> Wrap Text for multiline
            if row[12].value:
                row[12].alignment = Alignment(wrap_text=True, vertical="top")

        # 🟢 4. AutoFilter & Freeze Panes
        ws.auto_filter.ref = f"A1:M{len(data) + 1}"
        ws.freeze_panes = "A2"

        # 🟢 5. Adjust Column Widths
        column_widths = {
            'A': 5, 'B': 16, 'C': 16, 'D': 14, 'E': 22, 
            'F': 16, 'G': 16, 'H': 22, 'I': 22, 'J': 16, 
            'K': 12, 'L': 12, 'M': 45
        }
        for col, width in column_widths.items():
            ws.column_dimensions[col].width = width

        # Save to BytesIO stream
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        headers = {
            'Content-Disposition': 'attachment; filename="We1_Own_EQ_Report.xlsx"'
        }
        
        return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            cursor.close()
            conn.close()