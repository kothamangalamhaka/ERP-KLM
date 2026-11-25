import os
import io
import re
import base64
import hashlib
import hmac
import secrets
from datetime import datetime, date, timedelta
from typing import Optional
import jwt
import psycopg2
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, Header, Depends
from fastapi.responses import Response
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(
    prefix="/py/mubarak-vat-customers",
    tags=["Mubarak VAT Customers Verification"],
)

JWT_SECRET = os.getenv("JWT_SECRET", "mubarak-vat-secret-key-change-me")
JWT_ALGO = "HS256"

PUBLIC_ROOT = "/home/fefei/ERP_System/public"
UPLOAD_BASE = "/home/fefei/ERP_System/public/uploads/Customer_Docs/VAT_Customer_Docs"
os.makedirs(UPLOAD_BASE, exist_ok=True)

DOC_COL_MAP = {
    "agreement": ("agreement_doc", "Agath"),
    "rfq": ("rfq_doc", "RFQ"),
    "po": ("po_doc", "PO"),
    "conf_letter": ("conf_letter_doc", "VAT Conf"),
    "last": ("last_doc", "Final Conf"),
}


def _sanitize_name(val: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\- ]", "", str(val or "")).strip()
    return cleaned.replace(" ", "_") or "Unknown"


def _check_public_file_exists(rel_url: Optional[str]) -> Optional[str]:
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
        port=os.getenv("DB_PORT", "5432"),
    )


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return f"{salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, expected_hex = stored.split("$", 1)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
        return hmac.compare_digest(dk.hex(), expected_hex)
    except Exception:
        return False


def _decode_token(raw_token: str) -> dict:
    try:
        return jwt.decode(raw_token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
):
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.split(" ", 1)[1].strip()
    elif token:
        raw_token = token.strip()
    if not raw_token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    payload = _decode_token(raw_token)
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT id, username, full_name, role, is_verified FROM mubarak_vat_users WHERE id = %s",
            (payload.get("user_id"),),
        )
        user = cur.fetchone()
        if not user or not user["is_verified"]:
            raise HTTPException(status_code=403, detail="Account not verified by Admin.")
        return user
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def require_admin(user: dict = Depends(get_current_user)):
    if user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


class SignupPayload(BaseModel):
    username: str
    full_name: Optional[str] = ""
    password: str


class LoginPayload(BaseModel):
    username: str
    password: str


class VerifyUserPayload(BaseModel):
    user_id: int
    is_verified: bool


class UpdateRolePayload(BaseModel):
    user_id: int
    role: str


class VerificationPayload(BaseModel):
    record_id: int
    final_status: str
    notes: Optional[str] = ""


class DocUploadPayload(BaseModel):
    record_id: int
    doc_type: str
    file_name: str
    file_base64: str


class DocDeletePayload(BaseModel):
    record_id: int
    doc_type: str


def _fetch_filtered_records(start_date: str, end_date: str, search: str = ""):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT
                v.id AS record_id,
                v.sn,
                COALESCE(v.customer_code, '') AS customer_code,
                COALESCE(v.customer_name, '') AS customer_name,
                COALESCE(v.vat_no, '') AS vat_no,
                COALESCE(v.cr_no, '') AS cr_no,
                COALESCE(v.site, '') AS site,
                COALESCE(v.company, '') AS company,
                to_char(v.joining_date, 'YYYY-MM-DD') AS start_period,
                to_char(v.release_date, 'YYYY-MM-DD') AS release_date,
                COALESCE(v.status, 'Active') AS status,
                v.agreement_doc,
                v.rfq_doc,
                v.po_doc,
                v.conf_letter_doc,
                v.last_doc,
                COALESCE(v.remark, '') AS vat_remark,
                v.updated_at AS vat_updated_at,
                COALESCE(m.final_status, 'Pending') AS final_status,
                COALESCE(m.notes, '') AS notes,
                m.updated_at AS mubarak_updated_at,
                to_char(m.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
            FROM vat_customer_records v
            LEFT JOIN mubarak_vat_verification m
                ON m.record_id = v.id
            WHERE COALESCE(v.joining_date, DATE '1900-01-01') <= %s::date
              AND (v.release_date IS NULL OR v.release_date >= %s::date)
            ORDER BY LOWER(TRIM(COALESCE(v.customer_name, ''))) ASC, LOWER(TRIM(COALESCE(v.site, ''))) ASC, v.id ASC
            """,
            (end_date, start_date),
        )
        rows = cur.fetchall()

        cur.execute(
            """
            SELECT
                record_id,
                changed_by,
                action_summary,
                to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            ORDER BY id DESC
            """
        )
        audit_rows = cur.fetchall()
        audit_map = {}
        for a in audit_rows:
            audit_map.setdefault(a["record_id"], []).append(
                {
                    "changed_by": a["changed_by"],
                    "action_summary": a["action_summary"],
                    "created_at": a["created_at"],
                }
            )

        q = (search or "").strip().lower()
        results = []
        for idx, r in enumerate(rows, start=1):
            end_period_display = r["release_date"] if r["release_date"] else "Running"
            status_val = r["status"] or ("Released" if r["release_date"] else "Active")
            m_notes = (r["notes"] or "").strip()
            v_remark = (r["vat_remark"] or "").strip()
            if v_remark and v_remark != m_notes and (
                r["mubarak_updated_at"] is None
                or (r["vat_updated_at"] and r["vat_updated_at"] > r["mubarak_updated_at"])
            ):
                effective_notes = v_remark
            else:
                effective_notes = m_notes or v_remark

            item = {
                "sn": idx,
                "record_id": r["record_id"],
                "customer_code": r["customer_code"],
                "customer_name": r["customer_name"],
                "vat_no": r["vat_no"],
                "cr_no": r["cr_no"],
                "site": r["site"],
                "company": r["company"],
                "start_period": r["start_period"] or "",
                "end_period": end_period_display,
                "status": status_val,
                "agreement_doc": _check_public_file_exists(r.get("agreement_doc")),
                "rfq_doc": _check_public_file_exists(r.get("rfq_doc")),
                "po_doc": _check_public_file_exists(r.get("po_doc")),
                "conf_letter_doc": _check_public_file_exists(r.get("conf_letter_doc")),
                "last_doc": _check_public_file_exists(r.get("last_doc")),
                "final_status": r["final_status"] if r["final_status"] in ("Pending", "Verified") else "Pending",
                "notes": effective_notes,
                "updated_at": r["updated_at"] or "",
                "audit_trail": audit_map.get(r["record_id"], []),
            }
            if q:
                haystack = " ".join(
                    [
                        item["customer_code"],
                        item["customer_name"],
                        item["vat_no"],
                        item["cr_no"],
                        item["site"],
                        item["company"],
                        item["status"],
                        item["final_status"],
                        item["notes"],
                    ]
                ).lower()
                if q not in haystack:
                    continue
            results.append(item)

        for i, item in enumerate(results, start=1):
            item["sn"] = i

        return results
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/auth/signup")
def signup_user(payload: SignupPayload):
    uname = (payload.username or "").strip().lower()
    fname = (payload.full_name or "").strip() or uname
    pwd = payload.password or ""
    if len(uname) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters.")
    if len(pwd) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT id FROM mubarak_vat_users WHERE LOWER(username) = %s", (uname,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Username already exists.")

        pwd_hash = _hash_password(pwd)
        cur.execute(
            """
            INSERT INTO mubarak_vat_users (username, full_name, password_hash, role, is_verified)
            VALUES (%s, %s, %s, 'user', FALSE)
            RETURNING id, username, full_name, role, is_verified
            """,
            (uname, fname, pwd_hash),
        )
        created = cur.fetchone()
        conn.commit()
        return {
            "status": "success",
            "message": "Signup successful. Waiting for Admin verification.",
            "user": created,
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/auth/login")
def login_user(payload: LoginPayload):
    uname = (payload.username or "").strip().lower()
    pwd = payload.password or ""
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT id, username, full_name, password_hash, role, is_verified FROM mubarak_vat_users WHERE LOWER(username) = %s",
            (uname,),
        )
        user = cur.fetchone()
        if not user or not _verify_password(pwd, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        if not user["is_verified"]:
            raise HTTPException(status_code=403, detail="Account pending Admin verification.")

        token = jwt.encode(
            {
                "user_id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "exp": datetime.utcnow() + timedelta(hours=24),
            },
            JWT_SECRET,
            algorithm=JWT_ALGO,
        )
        return {
            "status": "success",
            "token": token,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "full_name": user["full_name"],
                "role": user["role"],
            },
        }
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/auth/me")
def get_me(user: dict = Depends(get_current_user)):
    return {"status": "success", "user": user}


@router.get("/admin/users")
def list_users(admin: dict = Depends(require_admin)):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT
                id, username, full_name, role, is_verified,
                to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_users
            ORDER BY id ASC
            """
        )
        return {"status": "success", "users": cur.fetchall()}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/admin/verify-user")
def verify_user(payload: VerifyUserPayload, admin: dict = Depends(require_admin)):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT id, role FROM mubarak_vat_users WHERE id = %s", (payload.user_id,))
        target = cur.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        if target["role"] == "super_admin" and not payload.is_verified:
            raise HTTPException(status_code=400, detail="Cannot revoke Super Admin.")

        cur.execute(
            "UPDATE mubarak_vat_users SET is_verified = %s WHERE id = %s RETURNING id, username, role, is_verified",
            (payload.is_verified, payload.user_id),
        )
        updated = cur.fetchone()
        conn.commit()
        return {"status": "success", "user": updated}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/admin/update-role")
def update_user_role(payload: UpdateRolePayload, admin: dict = Depends(require_admin)):
    if admin.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only Super Admin can change roles.")
    if payload.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'.")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT id, role FROM mubarak_vat_users WHERE id = %s", (payload.user_id,))
        target = cur.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        if target["role"] == "super_admin":
            raise HTTPException(status_code=400, detail="Cannot change Super Admin role.")

        cur.execute(
            "UPDATE mubarak_vat_users SET role = %s WHERE id = %s RETURNING id, username, role, is_verified",
            (payload.role, payload.user_id),
        )
        updated = cur.fetchone()
        conn.commit()
        return {"status": "success", "user": updated}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/records")
def get_mubarak_vat_records(
    start_date: str = Query(default="2025-06-01"),
    end_date: Optional[str] = Query(default=None),
    search: str = Query(default=""),
    user: dict = Depends(get_current_user),
):
    resolved_end = end_date or date.today().strftime("%Y-%m-%d")
    try:
        datetime.strptime(start_date, "%Y-%m-%d")
        datetime.strptime(resolved_end, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    if start_date > resolved_end:
        raise HTTPException(status_code=400, detail="Start period cannot be after End period.")

    try:
        records = _fetch_filtered_records(start_date, resolved_end, search)
        return {
            "status": "success",
            "start_date": start_date,
            "end_date": resolved_end,
            "count": len(records),
            "records": records,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/save-verification")
def save_verification(payload: VerificationPayload, user: dict = Depends(get_current_user)):
    status_clean = (payload.final_status or "").strip()
    if status_clean not in ("Pending", "Verified"):
        raise HTTPException(status_code=400, detail="Final Status must be 'Pending' or 'Verified'.")

    notes_clean = (payload.notes or "").strip()
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(
            "SELECT final_status, notes FROM mubarak_vat_verification WHERE record_id = %s",
            (payload.record_id,),
        )
        prev = cur.fetchone()
        prev_status = prev["final_status"] if prev else "Pending"
        prev_notes = (prev["notes"] or "").strip() if prev else ""

        changes = []
        if prev_status != status_clean:
            changes.append(f"Status: {prev_status} -> {status_clean}")
        if prev_notes != notes_clean:
            changes.append(f"Notes: '{notes_clean}'" if notes_clean else "Notes cleared")

        cur.execute(
            """
            INSERT INTO mubarak_vat_verification (record_id, final_status, notes, updated_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (record_id)
            DO UPDATE SET
                final_status = EXCLUDED.final_status,
                notes = EXCLUDED.notes,
                updated_at = CURRENT_TIMESTAMP
            RETURNING record_id, final_status, notes, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
            """,
            (payload.record_id, status_clean, notes_clean),
        )
        saved = cur.fetchone()

        cur.execute(
            "UPDATE vat_customer_records SET remark = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (notes_clean, payload.record_id),
        )

        if changes:
            summary = " | ".join(changes)
            cur.execute(
                """
                INSERT INTO mubarak_vat_audit_log (record_id, changed_by, action_summary, created_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                """,
                (payload.record_id, user["username"], summary),
            )

        cur.execute(
            """
            SELECT changed_by, action_summary, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            WHERE record_id = %s
            ORDER BY id DESC
            """,
            (payload.record_id,),
        )
        audit_trail = cur.fetchall()

        conn.commit()
        return {"status": "success", "data": saved, "audit_trail": audit_trail}
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/upload-doc")
def upload_mubarak_doc(payload: DocUploadPayload, user: dict = Depends(get_current_user)):
    doc_info = DOC_COL_MAP.get((payload.doc_type or "").lower())
    if not doc_info:
        raise HTTPException(status_code=400, detail="Invalid document type.")
    col_name, doc_label = doc_info

    ext = os.path.splitext(payload.file_name)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".pdf"):
        raise HTTPException(status_code=400, detail="Only PNG, JPG, PDF allowed.")

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT customer_name, site, company, {col_name} AS existing_url FROM vat_customer_records WHERE id = %s",
            (payload.record_id,),
        )
        rec = cur.fetchone()
        if not rec:
            raise HTTPException(status_code=404, detail="Customer record not found.")

        cust_folder = _sanitize_name(rec["customer_name"])
        target_dir = os.path.join(UPLOAD_BASE, cust_folder)
        os.makedirs(target_dir, exist_ok=True)

        old_url = rec.get("existing_url")
        is_replace = bool(old_url)
        if old_url:
            old_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(old_url).lstrip("/")))
            if old_path.startswith(os.path.normpath(UPLOAD_BASE)) and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        raw_b64 = payload.file_base64.split(",", 1)[1] if "," in payload.file_base64 else payload.file_base64
        file_bytes = base64.b64decode(raw_b64)

        site_san = _sanitize_name(rec["site"] or "Main")
        comp_san = _sanitize_name(rec["company"] or "Haka")
        doc_san = _sanitize_name(payload.doc_type)
        saved_filename = f"{cust_folder}_{site_san}_{comp_san}_{doc_san}{ext}"
        dest_path = os.path.join(target_dir, saved_filename)
        with open(dest_path, "wb") as f:
            f.write(file_bytes)

        rel_url = f"/uploads/Customer_Docs/VAT_Customer_Docs/{cust_folder}/{saved_filename}"
        cur.execute(
            f"UPDATE vat_customer_records SET {col_name} = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (rel_url, payload.record_id),
        )

        action_text = f"Doc Replaced: {doc_label}" if is_replace else f"Doc Uploaded: {doc_label}"
        cur.execute(
            """
            INSERT INTO mubarak_vat_audit_log (record_id, changed_by, action_summary, created_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            """,
            (payload.record_id, user["username"], action_text),
        )
        cur.execute(
            """
            SELECT changed_by, action_summary, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            WHERE record_id = %s
            ORDER BY id DESC
            """,
            (payload.record_id,),
        )
        audit_trail = cur.fetchall()
        conn.commit()
        return {"status": "success", "file_url": rel_url, "col_name": col_name, "audit_trail": audit_trail}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.post("/delete-doc")
def delete_mubarak_doc(payload: DocDeletePayload, user: dict = Depends(get_current_user)):
    doc_info = DOC_COL_MAP.get((payload.doc_type or "").lower())
    if not doc_info:
        raise HTTPException(status_code=400, detail="Invalid document type.")
    col_name, doc_label = doc_info

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT {col_name} AS existing_url FROM vat_customer_records WHERE id = %s",
            (payload.record_id,),
        )
        rec = cur.fetchone()
        if not rec:
            raise HTTPException(status_code=404, detail="Customer record not found.")

        old_url = rec.get("existing_url")
        if old_url:
            old_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(old_url).lstrip("/")))
            if old_path.startswith(os.path.normpath(UPLOAD_BASE)) and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        cur.execute(
            f"UPDATE vat_customer_records SET {col_name} = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (payload.record_id,),
        )
        cur.execute(
            """
            INSERT INTO mubarak_vat_audit_log (record_id, changed_by, action_summary, created_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            """,
            (payload.record_id, user["username"], f"Doc Deleted: {doc_label}"),
        )
        cur.execute(
            """
            SELECT changed_by, action_summary, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            WHERE record_id = %s
            ORDER BY id DESC
            """,
            (payload.record_id,),
        )
        audit_trail = cur.fetchall()
        conn.commit()
        return {"status": "success", "col_name": col_name, "audit_trail": audit_trail}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@router.get("/export-excel")
def export_mubarak_vat_excel(
    start_date: str = Query(default="2025-06-01"),
    end_date: Optional[str] = Query(default=None),
    search: str = Query(default=""),
    view: str = Query(default="compact"),
    user: dict = Depends(get_current_user),
):
    resolved_end = end_date or date.today().strftime("%Y-%m-%d")
    try:
        datetime.strptime(start_date, "%Y-%m-%d")
        datetime.strptime(resolved_end, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    try:
        records = _fetch_filtered_records(start_date, resolved_end, search)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "VAT Customers Verification"
        ws.views.sheetView[0].showGridLines = True

        navy_fill = PatternFill("solid", fgColor="0F172A")
        sub_fill = PatternFill("solid", fgColor="E2E8F0")
        verified_fill = PatternFill("solid", fgColor="FEF9C3")
        zebra_fill = PatternFill("solid", fgColor="F8FAFC")
        white_fill = PatternFill("solid", fgColor="FFFFFF")

        thin_side = Side(style="thin", color="CBD5E1")
        cell_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

        is_detailed = (view or "").lower() == "detailed"
        headers = [
            "SN",
            "Vendor Code",
            "Vendor Name",
            "VAT No",
            "CR No",
            "Site Name",
            "Company",
            "Start Period",
            "End Period",
            "Status",
        ]
        if is_detailed:
            headers.extend(["Agath", "RFQ", "PO", "VAT Conf", "Final Conf"])
        headers.extend(["Final Status", "Notes", "Audit Trail"])

        # Title Row
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
        title_cell = ws.cell(
            row=1,
            column=1,
            value=f"VAT Customers Verification ({start_date} to {resolved_end})",
        )
        title_cell.font = Font(name="Calibri", size=13, bold=True, color="FFFFFF")
        title_cell.fill = navy_fill
        title_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[1].height = 28

        # Subtitle / Count Row
        verified_count = sum(1 for r in records if r["final_status"] == "Verified")
        pending_count = len(records) - verified_count
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(headers))
        sub_cell = ws.cell(
            row=2,
            column=1,
            value=f"Total Active Records: {len(records)}   |   Verified: {verified_count}   |   Pending: {pending_count}",
        )
        sub_cell.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
        sub_cell.fill = sub_fill
        sub_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[2].height = 22

        # Header Row
        ws.row_dimensions[3].height = 24
        for col_idx, h in enumerate(headers, start=1):
            c = ws.cell(row=3, column=col_idx, value=h)
            c.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
            c.fill = navy_fill
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            c.border = cell_border

        # Data Rows (with vertical merge for repeated vendor columns)
        vendor_sn = 0
        prev_vkey = None
        group_start_row = 4

        for idx_rec, item in enumerate(records):
            r_idx = idx_rec + 4
            vkey = (item["customer_name"] or "").strip().lower()
            if vkey != prev_vkey:
                if prev_vkey is not None and r_idx - 1 > group_start_row:
                    for m_col in (1, 2, 3, 4, 5):
                        ws.merge_cells(start_row=group_start_row, start_column=m_col, end_row=r_idx - 1, end_column=m_col)
                vendor_sn += 1
                group_start_row = r_idx
                prev_vkey = vkey

            is_verified = item["final_status"] == "Verified"
            row_fill = verified_fill if is_verified else (zebra_fill if r_idx % 2 == 1 else white_fill)

            audit_text = "\n".join(
                f"{a['created_at']} | {a['changed_by']} | {a['action_summary']}"
                for a in item.get("audit_trail", [])
            )
            start_dt_val = (
                datetime.strptime(item["start_period"], "%Y-%m-%d").date()
                if item["start_period"]
                else ""
            )
            end_dt_val = (
                datetime.strptime(item["end_period"], "%Y-%m-%d").date()
                if item["end_period"] and item["end_period"] != "Running"
                else "Running"
            )

            vals = [
                vendor_sn,
                item["customer_code"],
                item["customer_name"],
                item["vat_no"],
                item["cr_no"],
                item["site"],
                item["company"],
                start_dt_val,
                end_dt_val,
                item["status"],
            ]
            if is_detailed:
                vals.extend([
                    "Uploaded" if item.get("agreement_doc") else "Pending",
                    "Uploaded" if item.get("rfq_doc") else "Pending",
                    "Uploaded" if item.get("po_doc") else "Pending",
                    "Uploaded" if item.get("conf_letter_doc") else "Pending",
                    "Uploaded" if item.get("last_doc") else "Pending",
                ])
            vals.extend([item["final_status"], item["notes"], audit_text])

            ws.row_dimensions[r_idx].height = 24
            center_cols = {1, 2, 4, 5, 8, 9, 10}
            if is_detailed:
                center_cols.update({11, 12, 13, 14, 15, 16})
            else:
                center_cols.add(11)

            for col_idx, val in enumerate(vals, start=1):
                c = ws.cell(row=r_idx, column=col_idx, value=val)
                c.font = Font(name="Calibri", size=10, color="0F172A")
                c.fill = white_fill if col_idx in (1, 2, 3, 4, 5) else row_fill
                c.border = cell_border
                if col_idx in (8, 9) and isinstance(val, date):
                    c.number_format = "yyyy-mm-dd"
                c.alignment = (
                    Alignment(horizontal="center", vertical="center")
                    if col_idx in center_cols
                    else Alignment(horizontal="left", vertical="center", wrap_text=True)
                )

        if records and (len(records) + 3) > group_start_row:
            for m_col in (1, 2, 3, 4, 5):
                ws.merge_cells(start_row=group_start_row, start_column=m_col, end_row=len(records) + 3, end_column=m_col)

        col_widths = [7, 15, 32, 20, 18, 22, 18, 14, 14, 13]
        if is_detailed:
            col_widths.extend([12, 12, 12, 12, 12])
        col_widths.extend([14, 34, 44])

        for idx, width in enumerate(col_widths, start=1):
            ws.column_dimensions[get_column_letter(idx)].width = width

        ws.auto_filter.ref = f"A3:{get_column_letter(len(headers))}{len(records) + 3}"
        ws.freeze_panes = "A4"

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        fname = f"Mubarak_VAT_Customers_{start_date}_to_{resolved_end}.xlsx"
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))