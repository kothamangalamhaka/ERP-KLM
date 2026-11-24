import os
import io
import json
import re
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Optional
import base64
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image
from pypdf import PdfWriter, PdfReader
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(prefix="/py/vat-customers", tags=["VAT Customer Documents"])

PUBLIC_ROOT = "/home/fefei/ERP_System/public"
UPLOAD_BASE = "/home/fefei/ERP_System/public/uploads/Customer_Docs/VAT_Customer_Docs"
os.makedirs(UPLOAD_BASE, exist_ok=True)


def check_public_file_exists(rel_url: Optional[str]) -> Optional[str]:
    if not rel_url or not str(rel_url).strip():
        return None
    clean_rel = str(rel_url).strip().lstrip("/")
    full_path = os.path.join(PUBLIC_ROOT, clean_rel)
    return rel_url if os.path.exists(full_path) else None

def get_db_connection():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=os.getenv("DB_PORT", "5432")
    )

def sanitize_name(val: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9_\- ]', '', str(val or '')).strip()
    return cleaned.replace(' ', '_') or "Unknown"

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
                rfq_doc,
                po_doc,
                conf_letter_doc,
                vat_doc,
                crn_doc,
                last_doc,
                remark,
                project_name,
                bills_data,
                COALESCE(ishtimara_docs, '[]'::jsonb) AS ishtimara_docs,
                COALESCE(other_docs, '[]'::jsonb) AS other_docs,
                created_at,
                updated_at
            FROM vat_customer_records 
            ORDER BY id ASC
        """)
        rows = cur.fetchall()
        single_doc_cols = [
            "agreement_doc",
            "rfq_doc",
            "po_doc",
            "conf_letter_doc",
            "vat_doc",
            "crn_doc",
            "last_doc",
        ]
        db_cleaned = False

        for r in rows:
            row_updates = {}
            for col in single_doc_cols:
                orig_val = r.get(col)
                valid_val = check_public_file_exists(orig_val)
                if orig_val and not valid_val:
                    r[col] = None
                    row_updates[col] = None

            orig_bills = r.get("bills_data") or []
            if isinstance(orig_bills, list) and len(orig_bills) > 0:
                valid_bills = []
                bills_changed = False
                for b in orig_bills:
                    f_url = b.get("file_url")
                    f_path = b.get("file_path")
                    exists = (f_path and os.path.exists(f_path)) or bool(check_public_file_exists(f_url))
                    if exists:
                        valid_bills.append(b)
                    else:
                        bills_changed = True
                if bills_changed:
                    r["bills_data"] = valid_bills
                    row_updates["bills_data"] = json.dumps(valid_bills)

            for m_col in ["ishtimara_docs", "other_docs"]:
                orig_list = r.get(m_col) or []
                if isinstance(orig_list, list) and len(orig_list) > 0:
                    valid_list = [
                        d for d in orig_list
                        if (d.get("file_path") and os.path.exists(d.get("file_path")))
                        or bool(check_public_file_exists(d.get("file_url")))
                    ]
                    if len(valid_list) != len(orig_list):
                        r[m_col] = valid_list
                        row_updates[m_col] = json.dumps(valid_list)

            if row_updates:
                db_cleaned = True
                set_clauses = []
                params = []
                for k, v in row_updates.items():
                    if k in ["bills_data", "ishtimara_docs", "other_docs"]:
                        set_clauses.append(f"{k} = %s::jsonb")
                    else:
                        set_clauses.append(f"{k} = %s")
                    params.append(v)
                params.append(r["id"])
                cur.execute(
                    f"UPDATE vat_customer_records SET {', '.join(set_clauses)} WHERE id = %s",
                    tuple(params),
                )

        if db_cleaned:
            conn.commit()

        return {"success": True, "data": rows}
    except Exception as e:
        return {"success": False, "data": [], "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

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

class CustomerMasterEditPayload(BaseModel):
    old_customer_name: str
    new_customer_name: str
    vat_no: Optional[str] = ""
    cr_no: Optional[str] = ""

@router.post("/update-customer-master")
def update_customer_master(payload: CustomerMasterEditPayload):
    conn = None
    cur = None
    try:
        old_name = payload.old_customer_name.strip()
        new_name = " ".join(w.capitalize() for w in payload.new_customer_name.strip().split())
        if not new_name:
            return {"success": False, "error": "Customer name cannot be empty"}

        v_no = "".join(filter(str.isdigit, str(payload.vat_no or "")))
        c_no = "".join(filter(str.isdigit, str(payload.cr_no or "")))

        conn = get_db_connection()
        cur = conn.cursor()

        # Update all site rows belonging to this customer
        cur.execute("""
            UPDATE vat_customer_records
            SET customer_name = %s,
                vat_no = %s,
                cr_no = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(customer_name) = LOWER(%s)
        """, (new_name, v_no, c_no, old_name))

        # Rename disk folder if customer name was changed
        old_folder_san = sanitize_name(old_name)
        new_folder_san = sanitize_name(new_name)
        if old_folder_san != new_folder_san:
            old_dir = os.path.join(UPLOAD_BASE, old_folder_san)
            new_dir = os.path.join(UPLOAD_BASE, new_folder_san)
            if os.path.exists(old_dir):
                try:
                    os.rename(old_dir, new_dir)
                    # Update saved doc paths in database
                    cur.execute("""
                        UPDATE vat_customer_records
                        SET agreement_doc = REPLACE(agreement_doc, %s, %s),
                            rfq_doc = REPLACE(rfq_doc, %s, %s),
                            po_doc = REPLACE(po_doc, %s, %s),
                            conf_letter_doc = REPLACE(conf_letter_doc, %s, %s),
                            vat_doc = REPLACE(vat_doc, %s, %s),
                            crn_doc = REPLACE(crn_doc, %s, %s),
                            last_doc = REPLACE(last_doc, %s, %s),
                            bills_data = REPLACE(bills_data::text, %s, %s)::jsonb,
                            ishtimara_docs = REPLACE(COALESCE(ishtimara_docs, '[]'::jsonb)::text, %s, %s)::jsonb,
                            other_docs = REPLACE(COALESCE(other_docs, '[]'::jsonb)::text, %s, %s)::jsonb
                        WHERE LOWER(customer_name) = LOWER(%s)
                    """, (
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        f"/{old_folder_san}/", f"/{new_folder_san}/",
                        new_name
                    ))
                except Exception as ren_err:
                    print("Folder rename error:", ren_err)

        conn.commit()
        return {"success": True, "new_name": new_name}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

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
        if payload.id and str(payload.id).strip().isdigit() and int(str(payload.id).strip()) > 0:
            rec_id = int(str(payload.id).strip())

        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        if rec_id:
            # In update, keep existing vat_no/cr_no if not provided
            cur.execute("""
                UPDATE vat_customer_records 
                SET joining_date = %s,
                    customer_name = %s,
                    vat_no = COALESCE(NULLIF(%s, ''), vat_no),
                    cr_no = COALESCE(NULLIF(%s, ''), cr_no),
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
            # Check if customer already exists (common docs sync)
            cur.execute("""
                SELECT vat_no, cr_no, vat_doc, crn_doc, COALESCE(ishtimara_docs, '[]'::jsonb) AS ishtimara_docs, COALESCE(other_docs, '[]'::jsonb) AS other_docs
                FROM vat_customer_records 
                WHERE LOWER(customer_name) = LOWER(%s)
                ORDER BY id DESC LIMIT 1
            """, (c_name,))
            existing_rec = cur.fetchone()

            final_vat = v_no if v_no else (existing_rec["vat_no"] if existing_rec and existing_rec["vat_no"] else "")
            final_cr = c_no if c_no else (existing_rec["cr_no"] if existing_rec and existing_rec["cr_no"] else "")
            e_vat = existing_rec["vat_doc"] if existing_rec else None
            e_crn = existing_rec["crn_doc"] if existing_rec else None
            e_ish = json.dumps(existing_rec["ishtimara_docs"]) if existing_rec else "[]"
            e_oth = json.dumps(existing_rec["other_docs"]) if existing_rec else "[]"

            cur.execute("""
                INSERT INTO vat_customer_records 
                (joining_date, customer_name, vat_no, cr_no, site, company, status, release_date, remark, project_name, vat_doc, crn_doc, ishtimara_docs, other_docs)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb) RETURNING id;
            """, (j_date, c_name, final_vat, final_cr, s_site, s_comp, s_stat, r_date, s_rem, p_name, e_vat, e_crn, e_ish, e_oth))

        row = cur.fetchone()
        saved_id = row["id"] if row else rec_id
        conn.commit()
        return {"success": True, "id": saved_id}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

class DocUploadPayload(BaseModel):
    customer_id: int
    doc_type: str
    file_name: str
    file_base64: str

@router.post("/upload-doc")
def upload_doc(payload: DocUploadPayload):
    valid_cols = {
        "agreement": "agreement_doc",
        "rfq": "rfq_doc",
        "po": "po_doc",
        "conf_letter": "conf_letter_doc",
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

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f"SELECT customer_name, site, company, {col_name} AS existing_url FROM vat_customer_records WHERE id = %s", (payload.customer_id,))
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Customer record not found"}

        cust_folder_name = sanitize_name(rec["customer_name"])
        target_dir = os.path.join(UPLOAD_BASE, cust_folder_name)
        os.makedirs(target_dir, exist_ok=True)

        # Remove old file if replaced with a different extension
        old_url = rec.get("existing_url")
        if old_url:
            old_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(old_url).lstrip("/")))
            if old_path.startswith(os.path.normpath(UPLOAD_BASE)) and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        raw_b64 = payload.file_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        file_bytes = base64.b64decode(raw_b64)

        # File naming logic:
        # Common docs (VAT & CRN): CustomerName_Vat_Doc.ext
        # Site docs: CustomerName_Site_Company_ColName.ext
        if payload.doc_type.lower() in ["vat", "crn"]:
            saved_filename = f"{cust_folder_name}_{payload.doc_type.upper()}{ext}"
        else:
            site_san = sanitize_name(rec["site"] or "Main")
            comp_san = sanitize_name(rec["company"] or "Haka")
            doc_san = sanitize_name(payload.doc_type)
            saved_filename = f"{cust_folder_name}_{site_san}_{comp_san}_{doc_san}{ext}"

        dest_path = os.path.join(target_dir, saved_filename)
        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        rel_url = f"/uploads/Customer_Docs/VAT_Customer_Docs/{cust_folder_name}/{saved_filename}"

        # If VAT or CRN doc, sync across all rows of the same customer
        if payload.doc_type.lower() in ["vat", "crn"]:
            cur.execute(f"""
                UPDATE vat_customer_records 
                SET {col_name} = %s, updated_at = CURRENT_TIMESTAMP 
                WHERE LOWER(customer_name) = LOWER(%s)
            """, (rel_url, rec["customer_name"]))
        else:
            cur.execute(f"""
                UPDATE vat_customer_records 
                SET {col_name} = %s, updated_at = CURRENT_TIMESTAMP 
                WHERE id = %s
            """, (rel_url, payload.customer_id))

        conn.commit()
        return {"success": True, "file_url": rel_url}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

class DocDeletePayload(BaseModel):
    customer_id: int
    doc_type: str

@router.post("/delete-doc")
def delete_doc(payload: DocDeletePayload):
    valid_cols = {
        "agreement": "agreement_doc",
        "rfq": "rfq_doc",
        "po": "po_doc",
        "conf_letter": "conf_letter_doc",
        "vat": "vat_doc",
        "crn": "crn_doc",
        "last": "last_doc"
    }
    col_name = valid_cols.get(payload.doc_type.lower())
    if not col_name:
        return {"success": False, "error": "Invalid doc type"}

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT customer_name, {col_name} AS existing_url FROM vat_customer_records WHERE id = %s",
            (payload.customer_id,)
        )
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Customer record not found"}

        old_url = rec.get("existing_url")
        if old_url:
            old_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(old_url).lstrip("/")))
            if old_path.startswith(os.path.normpath(UPLOAD_BASE)) and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        if payload.doc_type.lower() in ["vat", "crn"]:
            cur.execute(f"""
                UPDATE vat_customer_records
                SET {col_name} = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(customer_name) = LOWER(%s)
            """, (rec["customer_name"],))
        else:
            cur.execute(f"""
                UPDATE vat_customer_records
                SET {col_name} = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (payload.customer_id,))

        conn.commit()
        return {"success": True}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

class SiteDeletePayload(BaseModel):
    customer_id: int

@router.post("/delete-site")
def delete_site(payload: SiteDeletePayload):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT id, customer_name, agreement_doc, rfq_doc, po_doc, conf_letter_doc, last_doc, bills_data
            FROM vat_customer_records
            WHERE id = %s
        """, (payload.customer_id,))
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Site record not found"}

        upload_root = os.path.normpath(UPLOAD_BASE)

        def _safe_unlink_url(rel_url):
            if not rel_url:
                return
            full_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(rel_url).lstrip("/")))
            if full_path.startswith(upload_root) and os.path.exists(full_path):
                try:
                    os.remove(full_path)
                except Exception:
                    pass

        # 1. Delete ONLY this site's uploaded docs (preserve common VAT/CRN/Ishtimara/Other docs)
        for col in ["agreement_doc", "rfq_doc", "po_doc", "conf_letter_doc", "last_doc"]:
            _safe_unlink_url(rec.get(col))

        # 2. Delete ONLY this site's uploaded bill files
        bills = rec.get("bills_data") or []
        if isinstance(bills, list):
            for b in bills:
                f_path = b.get("file_path")
                if f_path:
                    norm_p = os.path.normpath(f_path)
                    if norm_p.startswith(upload_root) and os.path.exists(norm_p):
                        try:
                            os.remove(norm_p)
                        except Exception:
                            pass
                _safe_unlink_url(b.get("file_url"))

        # 3. Check how many rows exist for this customer
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM vat_customer_records WHERE LOWER(customer_name) = LOWER(%s)",
            (rec["customer_name"],)
        )
        cnt_row = cur.fetchone()
        total_rows = cnt_row["cnt"] if cnt_row else 1

        if total_rows > 1:
            cur.execute("DELETE FROM vat_customer_records WHERE id = %s", (payload.customer_id,))
        else:
            # Keep the customer master row & common docs intact, clear only site-specific fields
            cur.execute("""
                UPDATE vat_customer_records
                SET site = '',
                    company = '',
                    status = 'Active',
                    joining_date = NULL,
                    release_date = NULL,
                    remark = '',
                    project_name = '',
                    agreement_doc = NULL,
                    rfq_doc = NULL,
                    po_doc = NULL,
                    conf_letter_doc = NULL,
                    last_doc = NULL,
                    bills_data = '[]'::jsonb,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (payload.customer_id,))

        conn.commit()
        return {"success": True}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

class BillUploadPayload(BaseModel):
    customer_id: int
    month_year: str
    file_name: str
    file_base64: str
    note: Optional[str] = ""

@router.post("/upload-bill")
def upload_bill(payload: BillUploadPayload):
    ext = os.path.splitext(payload.file_name)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".pdf"]:
        return {"success": False, "error": "Only PNG, JPG, PDF allowed"}

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT customer_name, site, company, bills_data FROM vat_customer_records WHERE id = %s", (payload.customer_id,))
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Record not found"}

        cust_folder_name = sanitize_name(rec["customer_name"])
        target_dir = os.path.join(UPLOAD_BASE, cust_folder_name, "Bills")
        os.makedirs(target_dir, exist_ok=True)

        raw_b64 = payload.file_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        file_bytes = base64.b64decode(raw_b64)

        site_san = sanitize_name(rec["site"] or "Main")
        comp_san = sanitize_name(rec["company"] or "Haka")
        month_san = sanitize_name(payload.month_year)
        saved_filename = f"{cust_folder_name}_{site_san}_{comp_san}_{month_san}{ext}"
        dest_path = os.path.join(target_dir, saved_filename)

        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        rel_url = f"/uploads/Customer_Docs/VAT_Customer_Docs/{cust_folder_name}/Bills/{saved_filename}"

        bills = rec["bills_data"] if rec and rec["bills_data"] else []
        existing_item = next((b for b in bills if b.get("month") == payload.month_year), {})
        old_note = existing_item.get("note", "")
        bills = [b for b in bills if b.get("month") != payload.month_year]
        bills.append({
            "month": payload.month_year,
            "file_path": dest_path,
            "file_url": rel_url,
            "filename": payload.file_name,
            "note": payload.note if payload.note is not None and payload.note.strip() != "" else old_note,
            "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

        cur.execute("UPDATE vat_customer_records SET bills_data = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (json.dumps(bills), payload.customer_id))
        conn.commit()
        return {"success": True, "bills": bills}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

class BillNotePayload(BaseModel):
    customer_id: int
    month_year: str
    note: str

@router.post("/update-bill-note")
def update_bill_note(payload: BillNotePayload):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT bills_data FROM vat_customer_records WHERE id = %s", (payload.customer_id,))
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Record not found"}

        bills = rec["bills_data"] if rec and rec["bills_data"] else []
        found = False
        for b in bills:
            if b.get("month") == payload.month_year:
                b["note"] = payload.note.strip()
                found = True
                break

        if not found:
            bills.append({
                "month": payload.month_year,
                "note": payload.note.strip(),
                "file_path": None,
                "file_url": None,
                "filename": None,
                "uploaded_at": None
            })

        cur.execute("UPDATE vat_customer_records SET bills_data = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (json.dumps(bills), payload.customer_id))
        conn.commit()
        return {"success": True, "bills": bills}
    except Exception as e:
        if conn: conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur: cur.close()
        if conn: conn.close()

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

    c_name = sanitize_name(cust.get("customer_name") or "Customer")
    site = sanitize_name(cust.get("site") or "Site")
    company = sanitize_name(cust.get("company") or "Company")

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

    download_name = f"{c_name}_{site}_{company}_Combined_Bills.pdf".replace(" ", "_")
    return Response(content=out_buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{download_name}"'})


class CommonMultiDocUploadPayload(BaseModel):
    customer_name: str
    category: str  # 'ishtimara' or 'other'
    doc_id: Optional[str] = None
    doc_title: str
    file_name: str
    file_base64: str


@router.post("/upload-common-multi-doc")
def upload_common_multi_doc(payload: CommonMultiDocUploadPayload):
    col_map = {"ishtimara": "ishtimara_docs", "other": "other_docs"}
    col_name = col_map.get(payload.category.lower())
    if not col_name:
        return {"success": False, "error": "Invalid category"}

    ext = os.path.splitext(payload.file_name)[1].lower()
    if ext not in [".png", ".jpg", ".jpeg", ".pdf"]:
        return {"success": False, "error": "Only PNG, JPG, PDF allowed"}

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT COALESCE({col_name}, '[]'::jsonb) AS docs FROM vat_customer_records WHERE LOWER(customer_name) = LOWER(%s) ORDER BY id ASC LIMIT 1",
            (payload.customer_name.strip(),),
        )
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Customer not found"}

        docs = list(rec["docs"] or [])
        cust_folder_name = sanitize_name(payload.customer_name)
        sub_folder = "Ishtimara" if payload.category.lower() == "ishtimara" else "Other_Docs"
        target_dir = os.path.join(UPLOAD_BASE, cust_folder_name, sub_folder)
        os.makedirs(target_dir, exist_ok=True)

        doc_uid = payload.doc_id or str(int(datetime.now().timestamp() * 1000))
        existing_idx = next((i for i, d in enumerate(docs) if str(d.get("id")) == str(doc_uid)), -1)

        if existing_idx != -1:
            old_path = docs[existing_idx].get("file_path", "")
            if old_path and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        raw_b64 = payload.file_base64.split(",", 1)[1] if "," in payload.file_base64 else payload.file_base64
        file_bytes = base64.b64decode(raw_b64)

        title_clean = payload.doc_title.strip() or os.path.splitext(payload.file_name)[0]
        saved_filename = f"{sanitize_name(title_clean)}_{doc_uid}{ext}"
        dest_path = os.path.join(target_dir, saved_filename)
        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        rel_url = f"/uploads/Customer_Docs/VAT_Customer_Docs/{cust_folder_name}/{sub_folder}/{saved_filename}"
        new_entry = {
            "id": doc_uid,
            "title": title_clean,
            "file_path": dest_path,
            "file_url": rel_url,
            "filename": payload.file_name,
            "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        if existing_idx != -1:
            docs[existing_idx] = new_entry
        else:
            docs.append(new_entry)

        cur.execute(
            f"UPDATE vat_customer_records SET {col_name} = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE LOWER(customer_name) = LOWER(%s)",
            (json.dumps(docs), payload.customer_name.strip()),
        )
        conn.commit()
        return {"success": True, "docs": docs}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/export-excel")
def export_vat_customers_excel():
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                id, sn,
                to_char(joining_date, 'DD-Mon-YYYY') AS start_date,
                customer_name, vat_no, cr_no, site, company, status,
                to_char(release_date, 'DD-Mon-YYYY') AS release_date,
                agreement_doc, rfq_doc, po_doc, conf_letter_doc,
                vat_doc, crn_doc, last_doc, remark, project_name, bills_data
            FROM vat_customer_records
            ORDER BY LOWER(customer_name) ASC, joining_date ASC NULLS LAST, id ASC
        """)
        rows = cur.fetchall()

        wb = openpyxl.Workbook()
        ws_sum = wb.active
        ws_sum.title = "Executive Summary"
        ws_data = wb.create_sheet("Customer Documents")

        ws_sum.sheet_view.zoomScale = 80
        ws_data.sheet_view.zoomScale = 80
        ws_sum.views.sheetView[0].showGridLines = True
        ws_data.views.sheetView[0].showGridLines = True

        # Corporate Palette
        navy_fill = PatternFill("solid", fgColor="0F172A")
        slate_fill = PatternFill("solid", fgColor="1E293B")
        sub_fill = PatternFill("solid", fgColor="F1F5F9")
        zebra_fill = PatternFill("solid", fgColor="F8FAFC")
        rec_fill = PatternFill("solid", fgColor="DCFCE7")
        pen_fill = PatternFill("solid", fgColor="FEE2E2")
        act_fill = PatternFill("solid", fgColor="DBEAFE")

        thin_side = Side(style="thin", color="CBD5E1")
        cell_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

        # Compute summary metrics
        customers_set = set()
        cust_vat_map = {}
        cust_crn_map = {}
        active_cnt = 0
        released_cnt = 0
        company_stats = {}
        doc_stats = {
            "VAT Doc": [0, 0],
            "CRN Doc": [0, 0],
            "Agath (Agreement)": [0, 0],
            "RFQ": [0, 0],
            "PO": [0, 0],
            "VAT Conf Letter": [0, 0],
            "Final Conf": [0, 0],
        }

        for r in rows:
            cname = (r.get("customer_name") or "").strip()
            ckey = cname.lower()
            if ckey:
                customers_set.add(ckey)
                if r.get("vat_doc"):
                    cust_vat_map[ckey] = True
                if r.get("crn_doc"):
                    cust_crn_map[ckey] = True

            st = (r.get("status") or "Active").strip()
            if st.lower() == "active":
                active_cnt += 1
            else:
                released_cnt += 1

            comp = (r.get("company") or "Unassigned").strip() or "Unassigned"
            if comp not in company_stats:
                company_stats[comp] = [0, 0]
            if st.lower() == "active":
                company_stats[comp][0] += 1
            else:
                company_stats[comp][1] += 1

            for label, col in [
                ("Agath (Agreement)", "agreement_doc"),
                ("RFQ", "rfq_doc"),
                ("PO", "po_doc"),
                ("VAT Conf Letter", "conf_letter_doc"),
                ("Final Conf", "last_doc"),
            ]:
                if check_public_file_exists(r.get(col)):
                    doc_stats[label][0] += 1
                else:
                    doc_stats[label][1] += 1

        total_cust = len(customers_set)
        total_sites = len(rows)
        vat_rec_cnt = len(cust_vat_map)
        crn_rec_cnt = len(cust_crn_map)
        doc_stats["VAT Doc"] = [vat_rec_cnt, max(0, total_cust - vat_rec_cnt)]
        doc_stats["CRN Doc"] = [crn_rec_cnt, max(0, total_cust - crn_rec_cnt)]

        total_checks = sum(v[0] + v[1] for v in doc_stats.values())
        total_received = sum(v[0] for v in doc_stats.values())
        overall_pct = round((total_received / total_checks) * 100, 1) if total_checks else 0.0

        # ================= TAB 1: EXECUTIVE SUMMARY =================
        ws_sum.merge_cells("A1:F1")
        ws_sum["A1"] = "KLM ERP — VAT CUSTOMERS DOCUMENTS & COMPLIANCE REPORT"
        ws_sum["A1"].font = Font(name="Calibri", size=15, bold=True, color="FFFFFF")
        ws_sum["A1"].fill = navy_fill
        ws_sum["A1"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_sum.row_dimensions[1].height = 34

        ws_sum.merge_cells("A2:F2")
        ws_sum["A2"] = f"Generated On: {datetime.now().strftime('%d %b %Y, %I:%M %p')}  |  Scope: All VAT Customers & Sites"
        ws_sum["A2"].font = Font(name="Calibri", size=10, italic=True, color="475569")
        ws_sum["A2"].fill = sub_fill
        ws_sum["A2"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_sum.row_dimensions[2].height = 22

        ws_sum.merge_cells("A4:F5")
        narration = (
            f"Executive Narrative: This report covers {total_cust} VAT-registered customers across {total_sites} site/project records "
            f"({active_cnt} Active, {released_cnt} Released). Overall document compliance stands at {overall_pct}% "
            f"({total_received} documents received out of {total_checks} required checkpoints). "
            f"Customer-level VAT certificates are on file for {vat_rec_cnt}/{total_cust} customers and CRN certificates for {crn_rec_cnt}/{total_cust} customers. "
            f"Detailed site-by-site status is available in the 'Customer Documents' tab with filter controls."
        )
        ws_sum["A4"] = narration
        ws_sum["A4"].font = Font(name="Calibri", size=10.5, color="0F172A")
        ws_sum["A4"].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
        ws_sum["A4"].fill = zebra_fill
        for r_i in (4, 5):
            for c_i in range(1, 7):
                ws_sum.cell(r_i, c_i).border = cell_border
        ws_sum.row_dimensions[4].height = 28
        ws_sum.row_dimensions[5].height = 28

        # Portfolio KPIs
        ws_sum["A7"] = "1. Portfolio Overview"
        ws_sum["A7"].font = Font(name="Calibri", size=12, bold=True, color="0F172A")
        for idx, (k_lbl, k_val) in enumerate([
            ("Total VAT Customers", total_cust),
            ("Total Site / Project Rows", total_sites),
            ("Active Sites", active_cnt),
            ("Released Sites", released_cnt),
            ("Overall Compliance %", f"{overall_pct}%"),
        ], start=8):
            c1 = ws_sum.cell(idx, 1, k_lbl)
            c2 = ws_sum.cell(idx, 2, k_val)
            c1.font = Font(name="Calibri", size=10.5, bold=True, color="334155")
            c2.font = Font(name="Calibri", size=11, bold=True, color="0F172A")
            c1.fill = sub_fill
            c1.border = cell_border
            c2.border = cell_border
            c2.alignment = Alignment(horizontal="center", vertical="center")

        # Document Compliance Table
        ws_sum["A14"] = "2. Document Compliance Breakdown"
        ws_sum["A14"].font = Font(name="Calibri", size=12, bold=True, color="0F172A")
        for c_idx, h_txt in enumerate(["Document Type", "Received", "Pending", "Completion %"], start=1):
            hc = ws_sum.cell(15, c_idx, h_txt)
            hc.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
            hc.fill = slate_fill
            hc.alignment = Alignment(horizontal="center", vertical="center")
            hc.border = cell_border

        for idx, (d_name, (r_cnt, p_cnt)) in enumerate(doc_stats.items(), start=16):
            tot_d = r_cnt + p_cnt
            pct_d = f"{round((r_cnt / tot_d) * 100, 1)}%" if tot_d else "0%"
            vals = [d_name, r_cnt, p_cnt, pct_d]
            for c_idx, v in enumerate(vals, start=1):
                cell = ws_sum.cell(idx, c_idx, v)
                cell.font = Font(name="Calibri", size=10, bold=(c_idx in (1, 4)))
                cell.border = cell_border
                cell.alignment = Alignment(horizontal="left" if c_idx == 1 else "center", vertical="center")
                if c_idx == 2:
                    cell.fill = rec_fill
                    cell.font = Font(name="Calibri", size=10, bold=True, color="15803D")
                elif c_idx == 3 and p_cnt > 0:
                    cell.fill = pen_fill
                    cell.font = Font(name="Calibri", size=10, bold=True, color="B91C1C")

        # Company Breakdown
        comp_start = 25
        ws_sum.cell(comp_start, 1, "3. Company-Wise Site Distribution").font = Font(name="Calibri", size=12, bold=True, color="0F172A")
        for c_idx, h_txt in enumerate(["Company", "Active Sites", "Released Sites", "Total Sites"], start=1):
            hc = ws_sum.cell(comp_start + 1, c_idx, h_txt)
            hc.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
            hc.fill = slate_fill
            hc.alignment = Alignment(horizontal="center", vertical="center")
            hc.border = cell_border

        for idx, (comp_name, (a_c, rel_c)) in enumerate(sorted(company_stats.items()), start=comp_start + 2):
            for c_idx, v in enumerate([comp_name, a_c, rel_c, a_c + rel_c], start=1):
                cell = ws_sum.cell(idx, c_idx, v)
                cell.font = Font(name="Calibri", size=10, bold=(c_idx in (1, 4)))
                cell.border = cell_border
                cell.alignment = Alignment(horizontal="left" if c_idx == 1 else "center", vertical="center")

        for col_i, w in enumerate([28, 16, 16, 18, 18, 18], start=1):
            ws_sum.column_dimensions[get_column_letter(col_i)].width = w

        # ================= TAB 2: CUSTOMER DOCUMENTS TABLE =================
        headers = [
            "SN", "Customer Name", "VAT No", "CR No", "Site Name", "Company",
            "Status", "Start Date", "Release Date", "VAT Doc", "CRN Doc",
            "Agath", "RFQ", "PO", "VAT Conf", "Final Conf", "Bills",
            "Project Name", "Remark"
        ]
        last_col = get_column_letter(len(headers))

        ws_data.merge_cells(f"A1:{last_col}1")
        ws_data["A1"] = "KLM ERP — VAT CUSTOMERS DOCUMENTS REGISTER"
        ws_data["A1"].font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
        ws_data["A1"].fill = navy_fill
        ws_data["A1"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_data.row_dimensions[1].height = 30

        ws_data.merge_cells(f"A2:{last_col}2")
        ws_data["A2"] = f"Total Records: {total_sites}  |  Green = Received  |  Red = Pending"
        ws_data["A2"].font = Font(name="Calibri", size=10, italic=True, color="475569")
        ws_data["A2"].fill = sub_fill
        ws_data["A2"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_data.row_dimensions[2].height = 20

        header_row_idx = 4
        ws_data.row_dimensions[header_row_idx].height = 26
        for c_idx, h_text in enumerate(headers, start=1):
            hc = ws_data.cell(header_row_idx, c_idx, h_text)
            hc.font = Font(name="Calibri", size=10.5, bold=True, color="FFFFFF")
            hc.fill = slate_fill
            hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            hc.border = cell_border

        for idx, r in enumerate(rows, start=1):
            row_num = header_row_idx + idx
            ws_data.row_dimensions[row_num].height = 22
            bills = r.get("bills_data") or []
            uploaded_bills = sum(1 for b in bills if isinstance(b, dict) and b.get("file_url")) if isinstance(bills, list) else 0

            def _doc_status(col):
                return "Received" if check_public_file_exists(r.get(col)) else "Pending"

            row_vals = [
                idx,
                r.get("customer_name") or "",
                r.get("vat_no") or "-",
                r.get("cr_no") or "-",
                r.get("site") or "-",
                r.get("company") or "-",
                r.get("status") or "Active",
                r.get("start_date") or "-",
                r.get("release_date") or "-",
                _doc_status("vat_doc"),
                _doc_status("crn_doc"),
                _doc_status("agreement_doc"),
                _doc_status("rfq_doc"),
                _doc_status("po_doc"),
                _doc_status("conf_letter_doc"),
                _doc_status("last_doc"),
                f"{uploaded_bills} Uploaded" if uploaded_bills > 0 else "Pending",
                r.get("project_name") or "",
                r.get("remark") or "",
            ]

            for c_idx, val in enumerate(row_vals, start=1):
                cell = ws_data.cell(row_num, c_idx, val)
                cell.border = cell_border
                cell.font = Font(name="Calibri", size=10, color="0F172A")
                cell.alignment = Alignment(
                    horizontal="left" if c_idx in (2, 5, 18, 19) else "center",
                    vertical="center",
                )
                if idx % 2 == 0:
                    cell.fill = zebra_fill

                if c_idx == 7:
                    if str(val).lower() == "active":
                        cell.fill = act_fill
                        cell.font = Font(name="Calibri", size=10, bold=True, color="1D4ED8")
                    else:
                        cell.fill = pen_fill
                        cell.font = Font(name="Calibri", size=10, bold=True, color="B91C1C")
                elif 10 <= c_idx <= 16:
                    if val == "Received":
                        cell.fill = rec_fill
                        cell.font = Font(name="Calibri", size=10, bold=True, color="15803D")
                    else:
                        cell.fill = pen_fill
                        cell.font = Font(name="Calibri", size=10, bold=True, color="B91C1C")

        last_data_row = header_row_idx + max(1, len(rows))
        ws_data.auto_filter.ref = f"A{header_row_idx}:{last_col}{last_data_row}"
        ws_data.freeze_panes = f"A{header_row_idx + 1}"

        max_proj_len = max(
            [len("Project Name")] + [len(str(r.get("project_name") or "")) for r in rows]
        )
        col_widths = [6, 28, 18, 15, 24, 14, 12, 13, 13, 12, 12, 12, 12, 12, 12, 12, 14, max_proj_len + 4, 22]
        for c_idx, w in enumerate(col_widths, start=1):
            ws_data.column_dimensions[get_column_letter(c_idx)].width = w

        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        fname = f"VAT_Customers_Docs_Report_{datetime.now().strftime('%Y%m%d')}.xlsx"
        return Response(
            content=out.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


class CommonMultiDocRenamePayload(BaseModel):
    customer_name: str
    category: str
    doc_id: str
    new_title: str


@router.post("/rename-common-multi-doc")
def rename_common_multi_doc(payload: CommonMultiDocRenamePayload):
    col_map = {"ishtimara": "ishtimara_docs", "other": "other_docs"}
    col_name = col_map.get(payload.category.lower())
    if not col_name:
        return {"success": False, "error": "Invalid category"}

    new_title = payload.new_title.strip()
    if not new_title:
        return {"success": False, "error": "File name cannot be empty"}

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT COALESCE({col_name}, '[]'::jsonb) AS docs FROM vat_customer_records WHERE LOWER(customer_name) = LOWER(%s) ORDER BY id ASC LIMIT 1",
            (payload.customer_name.strip(),),
        )
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Customer not found"}

        docs = list(rec["docs"] or [])
        for d in docs:
            if str(d.get("id")) == str(payload.doc_id):
                d["title"] = new_title
                break

        cur.execute(
            f"UPDATE vat_customer_records SET {col_name} = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE LOWER(customer_name) = LOWER(%s)",
            (json.dumps(docs), payload.customer_name.strip()),
        )
        conn.commit()
        return {"success": True, "docs": docs}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


class CommonMultiDocDeletePayload(BaseModel):
    customer_name: str
    category: str
    doc_id: str


@router.post("/delete-common-multi-doc")
def delete_common_multi_doc(payload: CommonMultiDocDeletePayload):
    col_map = {"ishtimara": "ishtimara_docs", "other": "other_docs"}
    col_name = col_map.get(payload.category.lower())
    if not col_name:
        return {"success": False, "error": "Invalid category"}

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT COALESCE({col_name}, '[]'::jsonb) AS docs FROM vat_customer_records WHERE LOWER(customer_name) = LOWER(%s) ORDER BY id ASC LIMIT 1",
            (payload.customer_name.strip(),),
        )
        rec = cur.fetchone()
        if not rec:
            return {"success": False, "error": "Customer not found"}

        docs = list(rec["docs"] or [])
        remaining = []
        for d in docs:
            if str(d.get("id")) == str(payload.doc_id):
                f_path = d.get("file_path", "")
                if f_path and os.path.exists(f_path):
                    try:
                        os.remove(f_path)
                    except Exception:
                        pass
            else:
                remaining.append(d)

        cur.execute(
            f"UPDATE vat_customer_records SET {col_name} = %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE LOWER(customer_name) = LOWER(%s)",
            (json.dumps(remaining), payload.customer_name.strip()),
        )
        conn.commit()
        return {"success": True, "docs": remaining}
    except Exception as e:
        if conn:
            conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()