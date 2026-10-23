import os
import io
import csv
from datetime import datetime, date
import psycopg2
from psycopg2.extras import execute_values
from fastapi import APIRouter, Request, Query, UploadFile, File
import openpyxl

router = APIRouter(prefix="/api/ltass", tags=["LandT Asset"])

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432")
    )

# 1. 50,000 Rows Bulk Import (TSV Paste direct from Excel)
@router.post("/bulk-upload")
async def bulk_upload(request: Request):
    try:
        body = await request.body()
        raw_tsv = body.decode("utf-8", errors="ignore")
        if not raw_tsv.strip():
            return {"success": False, "message": "Data labhyamalla"}

        lines = raw_tsv.splitlines()
        rows_to_insert = []

        date_formats = [
            '%d-%b-%Y', '%d-%b-%y', '%d/%b/%Y', '%d/%b/%y',
            '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%Y/%m/%d',
            '%b-%d-%Y', '%m-%d-%Y', '%m/%d/%Y'
        ]

        for line in lines:
            if not line.strip():
                continue
            
            row = line.split('\t')
            cleaned_row = [val.strip() for val in row] + [''] * max(0, 12 - len(row))
            cleaned_row = cleaned_row[:12]

            asset_code = cleaned_row[0].strip()
            
            if not asset_code or asset_code.upper() in ["ASSET CODE", "ASSET_CODE", "ASSET", "SN", "D"]:
                continue

            raw_date = cleaned_row[2].strip()
            if " " in raw_date:
                raw_date = raw_date.split(" ")[0]

            date_val = None
            if raw_date:
                for fmt in date_formats:
                    try:
                        date_val = datetime.strptime(raw_date, fmt).date()
                        break
                    except ValueError:
                        pass

            rows_to_insert.append((
                asset_code,
                date_val,
                cleaned_row[1], 
                cleaned_row[3], cleaned_row[4], cleaned_row[5],
                cleaned_row[6], cleaned_row[7], cleaned_row[8], cleaned_row[9],
                cleaned_row[10], cleaned_row[11]
            ))

        if not rows_to_insert:
            return {"success": False, "message": "Valid aaya rows kandethiyilla"}

        conn = get_db_connection()
        cur = conn.cursor()

        insert_query = """
            INSERT INTO landtasset (
                asset_code, log_date, col3, col4, col5, col6,
                col7, col8, col9, col10, col11, col12
            ) VALUES %s
        """
        execute_values(cur, insert_query, rows_to_insert, page_size=10000)
        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "count": len(rows_to_insert), "message": f"{len(rows_to_insert)} records saved successfully!"}

    except Exception as e:
        return {"success": False, "error": str(e)}

# 2. 78,000+ Rows Excel File Direct Upload
@router.post("/upload-file")
async def upload_excel_file(file: UploadFile = File(...)):
    try:
        content = await file.read()
        wb = openpyxl.load_workbook(filename=io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active

        rows_to_insert = []
        date_formats = [
            '%d-%b-%Y', '%d-%b-%y', '%d/%b/%Y', '%d/%b/%y',
            '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%Y/%m/%d',
            '%b-%d-%Y', '%m-%d-%Y', '%m/%d/%Y'
        ]

        for row in ws.iter_rows(values_only=True):
            if not row or not any(row):
                continue
            
            # Handling 12 columns (Col D to O directly saved in Excel) or Full sheet (Col A to O)
            if len(row) >= 15:
                asset_code_raw = row[3]
                desc_raw = row[4]
                date_raw = row[5]
                other_cols = list(row[6:15]) + [''] * max(0, 9 - len(row[6:15]))
            elif len(row) >= 12:
                asset_code_raw = row[0]
                desc_raw = row[1]
                date_raw = row[2]
                other_cols = list(row[3:12]) + [''] * max(0, 9 - len(row[3:12]))
            else:
                continue

            if not asset_code_raw:
                continue

            asset_code = str(asset_code_raw).strip()
            
            if asset_code.upper() in ["ASSET CODE", "ASSET_CODE", "ASSET", "SN", "D"]:
                continue

            date_val = None
            if isinstance(date_raw, (datetime, date)):
                date_val = date_raw if isinstance(date_raw, date) else date_raw.date()
            elif date_raw:
                clean_dt_str = str(date_raw).strip().split(" ")[0]
                for fmt in date_formats:
                    try:
                        date_val = datetime.strptime(clean_dt_str, fmt).date()
                        break
                    except ValueError:
                        pass

            col_vals = [str(v).strip() if v is not None else '' for v in other_cols[:9]]

            rows_to_insert.append((
                asset_code,
                date_val,
                str(desc_raw).strip() if desc_raw is not None else '',
                col_vals[0], col_vals[1], col_vals[2],
                col_vals[3], col_vals[4], col_vals[5],
                col_vals[6], col_vals[7], col_vals[8]
            ))

        wb.close()

        if not rows_to_insert:
            return {"success": False, "message": "Valid aaya data kandethiyilla"}

        conn = get_db_connection()
        cur = conn.cursor()

        insert_query = """
            INSERT INTO landtasset (
                asset_code, log_date, col3, col4, col5, col6,
                col7, col8, col9, col10, col11, col12
            ) VALUES %s
        """
        execute_values(cur, insert_query, rows_to_insert, page_size=10000)
        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "count": len(rows_to_insert), "message": f"{len(rows_to_insert)} records saved successfully!"}

    except Exception as e:
        return {"success": False, "error": str(e)}

# 3. Asset Code Suggestions
@router.get("/suggestions")
async def get_asset_suggestions(q: str = Query("", min_length=1)):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT asset_code FROM landtasset WHERE asset_code ILIKE %s ORDER BY asset_code LIMIT 10",
            (f"{q}%",)
        )
        results = [r[0] for r in cur.fetchall()]
        cur.close()
        conn.close()
        return results
    except Exception as e:
        return []

# 4. Monthly Filter Data Retrieval
@router.get("/filter")
async def get_filtered_data(asset_code: str, month_year: str):
    try:
        year, month = map(int, month_year.split('-'))
        start_date = f"{year:04d}-{month:02d}-01"
        end_date = f"{year + 1 if month == 12 else year:04d}-{1 if month == 12 else month + 1:02d}-01"

        conn = get_db_connection()
        cur = conn.cursor()
        query = """
            SELECT asset_code, COALESCE(TO_CHAR(log_date, 'DD-Mon-YYYY'), ''), col3, col4, col5, col6,
                   col7, col8, col9, col10, col11, col12
            FROM landtasset
            WHERE TRIM(UPPER(asset_code)) = TRIM(UPPER(%s))
              AND log_date >= %s::date
              AND log_date < %s::date
            ORDER BY log_date ASC
        """
        cur.execute(query, (asset_code, start_date, end_date))
        rows = cur.fetchall()
        cur.close()
        conn.close()

        return {"success": True, "data": rows}
    except Exception as e:
        return {"success": False, "error": str(e)}