import os
import io
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Optional
import base64
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, FileResponse
from PIL import Image
from pypdf import PdfWriter, PdfReader

router = APIRouter(prefix="/py/vat-customers", tags=["VAT Customer Documents"])

UPLOAD_BASE = "/home/fefei/ERP_System/public/uploads/Vat_Customers_docs"
os.makedirs(UPLOAD_BASE, exist_ok=True)

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", "5432")
    )

@router.get("/records")
def get_records():
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT 
                id,
                sn,
                to_char(joining_date, 'YYYY-MM-DD') AS joining_date,
                customer_name,
                vat_no,
                cr_no,
                site,
                company,
                status,
                to_char(release_date, 'YYYY-MM-DD') AS release_date,
                agreement_doc,
                vat_doc,
                crn_doc,
                last_doc,
                remark,
                project_name,
                bills_data,
                created_at,
                updated_at
            FROM vat_customer_records 
            ORDER BY id ASC
        """)
        rows = cur.fetchall()
        return {"success": True, "data": rows}
    except Exception as e:
        return {"success": False, "data": [], "error": str(e)}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@router.get("/companies")
def get_companies():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT company_name FROM vat_companies_list ORDER BY id ASC")
    rows = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return {"success": True, "data": rows}

class CompanyPayload(BaseModel):
    company_name: str

@router.post("/companies")
def add_company(payload: CompanyPayload):
    name = payload.company_name.strip()
    if not name:
        return {"success": False, "error": "Invalid name"}
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("INSERT INTO vat_companies_list (company_name) VALUES (%s) ON CONFLICT DO NOTHING", (name,))
    conn.commit()
    cur.close()
    conn.close()
    return {"success": True, "name": name}

class CustomerUpsertPayload(BaseModel):
    id: Optional[str] = None
    joining_date: Optional[str] = None
    customer_name: Optional[str] = ""
    vat_no: Optional[str] = ""
    cr_no: Optional[str] = ""
    site: Optional[str] = ""
    company: Optional[str] = "Haka"
    status: Optional[str] = "Active"
    release_date: Optional[str] = None
    remark: Optional[str] = ""
    project_name: Optional[str] = ""

@router.post("/upsert-customer")
def upsert_customer(payload: CustomerUpsertPayload):
    conn = None
    cur = None
    try:
        raw_name = str(payload.customer_name or "").strip()
        if not raw_name:
            return {"success": False, "error": "Customer name is required"}

        c_name = " ".join(w.capitalize() for w in raw_name.split())
        v_no = "".join(filter(str.isdigit, str(payload.vat_no or "")))
        c_no = "".join(filter(str.isdigit, str(payload.cr_no or "")))
        s_site = str(payload.site or "").strip()
        s_comp = str(payload.company or "Haka").strip()
        s_stat = str(payload.status or "Active").strip()
        s_rem = str(payload.remark or "").strip()
        p_name = str(payload.project_name or "").strip()

        j_date = str(payload.joining_date).strip() if payload.joining_date and str(payload.joining_date).strip() else None
        r_date = str(payload.release_date).strip() if payload.release_date and str(payload.release_date).strip() else None

        rec_id = None
        if payload.id and str(payload.id).strip() and str(payload.id).strip().isdigit() and int(str(payload.id).strip()) > 0:
            rec_id = int(str(payload.id).strip())

        conn = get_db_connection()
        cur = conn.cursor()

        if rec_id:
            cur.execute("""
                UPDATE vat_customer_records 
                SET joining_date = %s,
                    customer_name = %s,
                    vat_no = %s,
                    cr_no = %s,
                    site = %s,
                    company = %s,
                    status = %s,
                    release_date = %s,
                    remark = %s,
                    project_name = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s RETURNING id;
            """, (j_date, c_name, v_no, c_no, s_site, s_comp, s_stat, r_date, s_rem, p_name, rec_id))
        else:
            cur.execute("""
                INSERT INTO vat_customer_records 
                (joining_date, customer_name, vat_no, cr_no, site, company, status, release_date, remark, project_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id;
            """, (j_date, c_name, v_no, c_no, s_site, s_comp, s_stat, r_date, s_rem, p_name))

        row = cur.fetchone()
        saved_id = row[0] if row else rec_id
        conn.commit()
        return {"success": True, "id": saved_id}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

class DocUploadPayload(BaseModel):
    customer_id: int
    doc_type: str
    file_name: str
    file_base64: str

@router.post("/upload-doc")
def upload_doc(payload: DocUploadPayload):
    valid_cols = {
        "agreement": "agreement_doc",
        "vat": "vat_doc",
        "crn": "crn_doc",
        "last": "last_doc"
    }
    col_name = valid_cols.get(payload.doc_type.lower())
    if not col_name:
        return {"success": False, "error": "Invalid doc type"}

    ext = os.path.splitext(payload.file_name)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".pdf"]:
        return {"success": False, "error": "Only PNG, JPG, PDF allowed"}

    try:
        raw_b64 = payload.file_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        file_bytes = base64.b64decode(raw_b64)

        saved_filename = f"cust_{payload.customer_id}_{payload.doc_type.lower()}_{int(datetime.now().timestamp())}{ext}"
        dest_path = os.path.join(UPLOAD_BASE, saved_filename)

        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        rel_url = f"/uploads/Vat_Customers_docs/{saved_filename}"

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(f"UPDATE vat_customer_records SET {col_name} = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (rel_url, payload.customer_id))
        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "file_url": rel_url}
    except Exception as e:
        return {"success": False, "error": str(e)}

class BillUploadPayload(BaseModel):
    customer_id: int
    month_year: str
    file_name: str
    file_base64: str

@router.post("/upload-bill")
def upload_bill(payload: BillUploadPayload):
    ext = os.path.splitext(payload.file_name)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".pdf"]:
        return {"success": False, "error": "Only PNG, JPG, PDF allowed"}

    try:
        raw_b64 = payload.file_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        file_bytes = base64.b64decode(raw_b64)

        saved_filename = f"bill_{payload.customer_id}_{payload.month_year.replace(' ', '_')}_{int(datetime.now().timestamp())}{ext}"
        dest_path = os.path.join(UPLOAD_BASE, saved_filename)

        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        rel_url = f"/uploads/Vat_Customers_docs/{saved_filename}"

        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT bills_data FROM vat_customer_records WHERE id = %s", (payload.customer_id,))
        res = cur.fetchone()
        bills = res["bills_data"] if res and res["bills_data"] else []

        bills = [b for b in bills if b.get("month") != payload.month_year]
        bills.append({
            "month": payload.month_year,
            "file_path": dest_path,
            "file_url": rel_url,
            "filename": payload.file_name,
            "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

        cur.execute("UPDATE vat_customer_records SET bills_data = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (json.dumps(bills), payload.customer_id))
        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "bills": bills}
    except Exception as e:
        return {"success": False, "error": str(e)}

class BillDeletePayload(BaseModel):
    customer_id: int
    month_year: str

@router.post("/delete-bill")
def delete_bill(payload: BillDeletePayload):
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT bills_data FROM vat_customer_records WHERE id = %s", (payload.customer_id,))
        res = cur.fetchone()
        bills = res["bills_data"] if res and res["bills_data"] else []

        removed = [b for b in bills if b.get("month") == payload.month_year]
        remaining = [b for b in bills if b.get("month") != payload.month_year]

        for r in removed:
            if os.path.exists(r.get("file_path", "")):
                try:
                    os.remove(r.get("file_path"))
                except Exception:
                    pass

        cur.execute("UPDATE vat_customer_records SET bills_data = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (json.dumps(remaining), payload.customer_id))
        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "bills": remaining}
    except Exception as e:
        return {"success": False, "error": str(e)}

def convert_to_pdf_bytes(file_path: str) -> bytes:
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        with open(file_path, "rb") as f:
            return f.read()
    elif ext in [".png", ".jpg", ".jpeg"]:
        img = Image.open(file_path).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="PDF")
        return buf.getvalue()
    return b""

@router.get("/download-bill-combined")
def download_bill_combined(customer_id: int, mode: str = "combine", month_year: Optional[str] = None):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT customer_name, site, company, bills_data FROM vat_customer_records WHERE id = %s", (customer_id,))
    cust = cur.fetchone()
    cur.close()
    conn.close()

    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    bills = cust.get("bills_data") or []
    if not bills:
        raise HTTPException(status_code=400, detail="No bills available")

    c_name = cust.get("customer_name") or "Customer"
    site = cust.get("site") or "Site"
    company = cust.get("company") or "Company"

    if mode == "single" and month_year:
        target = next((b for b in bills if b.get("month") == month_year), None)
        if not target or not os.path.exists(target.get("file_path", "")):
            raise HTTPException(status_code=404, detail="Bill file not found")
        fname = f"{c_name}_{site}_{company}_{month_year}.pdf".replace(" ", "_")
        pdf_bytes = convert_to_pdf_bytes(target.get("file_path"))
        return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    bills_sorted = sorted(bills, key=lambda x: datetime.strptime(x["month"], "%b %y") if " " in x["month"] else datetime.min)

    writer = PdfWriter()
    for b in bills_sorted:
        p = b.get("file_path")
        if p and os.path.exists(p):
            pdf_bytes = convert_to_pdf_bytes(p)
            if pdf_bytes:
                reader = PdfReader(io.BytesIO(pdf_bytes))
                for page in reader.pages:
                    writer.add_page(page)

    out_buf = io.BytesIO()
    writer.write(out_buf)
    out_buf.seek(0)

    download_name = f"{c_name}_{site}_{company}.pdf".replace(" ", "_")
    return Response(content=out_buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{download_name}"'})