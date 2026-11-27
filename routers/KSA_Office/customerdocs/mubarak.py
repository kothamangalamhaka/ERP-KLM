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
NON_VAT_UPLOAD_BASE = "/home/fefei/ERP_System/public/uploads/Customer_Docs/Non_VAT_Customer_Docs"
os.makedirs(UPLOAD_BASE, exist_ok=True)
os.makedirs(NON_VAT_UPLOAD_BASE, exist_ok=True)

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
    customer_type: str = "vat"
    record_id: int
    payment_status: str = "Pending"
    final_status: str
    notes: Optional[str] = ""


class DocUploadPayload(BaseModel):
    customer_type: str = "vat"
    record_id: int
    doc_type: str
    file_name: str
    file_base64: str


class DocDeletePayload(BaseModel):
    customer_type: str = "vat"
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
                'vat' AS customer_type,
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
                COALESCE(v.ishtimara_docs, '[]'::jsonb) AS ishtimara_docs,
                COALESCE(v.site_ishtimara, '[]'::jsonb) AS site_ishtimara,
                COALESCE(v.remark, '') AS vat_remark,
                v.updated_at AS vat_updated_at,
                COALESCE(m.payment_status, 'Pending') AS payment_status,
                COALESCE(m.final_status, 'Not Verified') AS final_status,
                COALESCE(m.notes, '') AS notes,
                m.updated_at AS mubarak_updated_at,
                to_char(m.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
            FROM vat_customer_records v
            LEFT JOIN mubarak_vat_verification m
                ON m.record_id = v.id AND m.customer_type = 'vat'
            WHERE COALESCE(v.joining_date, DATE '1900-01-01') <= %s::date
              AND (v.release_date IS NULL OR v.release_date >= %s::date)
            """,
            (end_date, start_date),
        )
        vat_rows = cur.fetchall()

        cur.execute(
            """
            SELECT
                'non_vat' AS customer_type,
                nv.id AS record_id,
                nv.sn,
                COALESCE(nv.customer_code, '') AS customer_code,
                COALESCE(nv.customer_name, '') AS customer_name,
                COALESCE(nv.vat_no, '') AS vat_no,
                COALESCE(nv.cr_no, '') AS cr_no,
                COALESCE(nv.site, '') AS site,
                COALESCE(nv.company, '') AS company,
                to_char(nv.joining_date, 'YYYY-MM-DD') AS start_period,
                to_char(nv.release_date, 'YYYY-MM-DD') AS release_date,
                COALESCE(nv.status, 'Active') AS status,
                nv.agreement_doc,
                NULL AS rfq_doc,
                NULL AS po_doc,
                NULL AS conf_letter_doc,
                nv.last_doc,
                COALESCE(nv.ishtimara_docs, '[]'::jsonb) AS ishtimara_docs,
                COALESCE(nv.site_ishtimara, '[]'::jsonb) AS site_ishtimara,
                COALESCE(nv.remark, '') AS vat_remark,
                nv.updated_at AS vat_updated_at,
                COALESCE(m.payment_status, 'Pending') AS payment_status,
                COALESCE(m.final_status, 'Not Verified') AS final_status,
                COALESCE(m.notes, '') AS notes,
                m.updated_at AS mubarak_updated_at,
                to_char(m.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
            FROM non_vat_customer_records nv
            LEFT JOIN mubarak_vat_verification m
                ON m.record_id = nv.id AND m.customer_type = 'non_vat'
            WHERE COALESCE(nv.joining_date, DATE '1900-01-01') <= %s::date
              AND (nv.release_date IS NULL OR nv.release_date >= %s::date)
            """,
            (end_date, start_date),
        )
        non_vat_rows = cur.fetchall()

        rows = vat_rows + non_vat_rows
        rows.sort(
            key=lambda x: (
                (x["customer_name"] or "").strip().lower(),
                0 if x["customer_type"] == "vat" else 1,
                (x["site"] or "").strip().lower(),
                x["record_id"],
            )
        )

        # Build customer-level ishtimara lookup { (customer_type, customer_name_lower): { doc_id: title } }
        ish_cust_map = {}
        for r in rows:
            ckey = (r["customer_type"], (r["customer_name"] or "").strip().lower())
            docs = r.get("ishtimara_docs") or []
            if isinstance(docs, list):
                existing = ish_cust_map.get(ckey, [])
                if len(docs) > len(existing):
                    ish_cust_map[ckey] = docs
        ish_title_lookup = {
            ckey: {str(d.get("id")): (d.get("title") or "").strip() for d in docs if d.get("id") is not None}
            for ckey, docs in ish_cust_map.items()
        }

        cur.execute(
            """
            SELECT
                COALESCE(customer_type, 'vat') AS customer_type,
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
            akey = (a["customer_type"], a["record_id"])
            audit_map.setdefault(akey, []).append(
                {
                    "changed_by": a["changed_by"],
                    "action_summary": a["action_summary"],
                    "created_at": a["created_at"],
                }
            )

        q = (search or "").strip().lower()
        results = []
        valid_payments = ("Paid", "Pending", "Partially Paid", "Not Paid")
        for idx, r in enumerate(rows, start=1):
            ctype = r["customer_type"]
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

            ckey = (ctype, (r["customer_name"] or "").strip().lower())
            title_map = ish_title_lookup.get(ckey, {})
            linked_ish = r.get("site_ishtimara") or []
            plate_nos = []
            if isinstance(linked_ish, list):
                for link in linked_ish:
                    if isinstance(link, dict):
                        t = title_map.get(str(link.get("doc_id")))
                        if t:
                            plate_nos.append(t)

            final_ver = "Verified" if r["final_status"] == "Verified" else "Not Verified"
            pay_stat = r["payment_status"] if r["payment_status"] in valid_payments else "Pending"

            item = {
                "sn": idx,
                "customer_type": ctype,
                "is_vat": "Yes" if ctype == "vat" else "No",
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
                "rfq_doc": _check_public_file_exists(r.get("rfq_doc")) if ctype == "vat" else None,
                "po_doc": _check_public_file_exists(r.get("po_doc")) if ctype == "vat" else None,
                "conf_letter_doc": _check_public_file_exists(r.get("conf_letter_doc")) if ctype == "vat" else None,
                "last_doc": _check_public_file_exists(r.get("last_doc")),
                "payment_status": pay_stat,
                "final_status": final_ver,
                "notes": effective_notes,
                "plate_nos": plate_nos,
                "updated_at": r["updated_at"] or "",
                "audit_trail": audit_map.get((ctype, r["record_id"]), []),
            }
            if q:
                haystack = " ".join(
                    [
                        item["customer_code"],
                        item["customer_name"],
                        item["is_vat"],
                        item["vat_no"],
                        item["cr_no"],
                        item["site"],
                        item["company"],
                        item["status"],
                        item["payment_status"],
                        item["final_status"],
                        item["notes"],
                        " ".join(plate_nos),
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
    ctype = (payload.customer_type or "vat").strip().lower()
    if ctype not in ("vat", "non_vat"):
        raise HTTPException(status_code=400, detail="Invalid customer_type.")

    payment_clean = (payload.payment_status or "Pending").strip()
    if payment_clean not in ("Paid", "Pending", "Partially Paid", "Not Paid"):
        raise HTTPException(status_code=400, detail="Invalid Payment Status.")

    status_clean = (payload.final_status or "").strip()
    if status_clean not in ("Verified", "Not Verified"):
        raise HTTPException(status_code=400, detail="Final Verification must be 'Verified' or 'Not Verified'.")

    notes_clean = (payload.notes or "").strip()
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute(
            "SELECT payment_status, final_status, notes FROM mubarak_vat_verification WHERE customer_type = %s AND record_id = %s",
            (ctype, payload.record_id),
        )
        prev = cur.fetchone()
        prev_payment = (prev.get("payment_status") or "Pending") if prev else "Pending"
        prev_status = ("Verified" if prev["final_status"] == "Verified" else "Not Verified") if prev else "Not Verified"
        prev_notes = (prev["notes"] or "").strip() if prev else ""

        changes = []
        if prev_payment != payment_clean:
            changes.append(f"Payment: {prev_payment} -> {payment_clean}")
        if prev_status != status_clean:
            changes.append(f"Verification: {prev_status} -> {status_clean}")
        if prev_notes != notes_clean:
            changes.append(f"Notes: '{notes_clean}'" if notes_clean else "Notes cleared")

        cur.execute(
            """
            INSERT INTO mubarak_vat_verification (customer_type, record_id, payment_status, final_status, notes, updated_at)
            VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (customer_type, record_id)
            DO UPDATE SET
                payment_status = EXCLUDED.payment_status,
                final_status = EXCLUDED.final_status,
                notes = EXCLUDED.notes,
                updated_at = CURRENT_TIMESTAMP
            RETURNING customer_type, record_id, payment_status, final_status, notes, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
            """,
            (ctype, payload.record_id, payment_clean, status_clean, notes_clean),
        )
        saved = cur.fetchone()

        target_table = "vat_customer_records" if ctype == "vat" else "non_vat_customer_records"
        cur.execute(
            f"UPDATE {target_table} SET remark = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (notes_clean, payload.record_id),
        )

        if changes:
            summary = " | ".join(changes)
            cur.execute(
                """
                INSERT INTO mubarak_vat_audit_log (customer_type, record_id, changed_by, action_summary, created_at)
                VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
                """,
                (ctype, payload.record_id, user["username"], summary),
            )

        cur.execute(
            """
            SELECT changed_by, action_summary, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            WHERE customer_type = %s AND record_id = %s
            ORDER BY id DESC
            """,
            (ctype, payload.record_id),
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
    ctype = (payload.customer_type or "vat").strip().lower()
    if ctype not in ("vat", "non_vat"):
        raise HTTPException(status_code=400, detail="Invalid customer_type.")
    dtype = (payload.doc_type or "").lower()
    if ctype == "non_vat" and dtype not in ("agreement", "last"):
        raise HTTPException(status_code=400, detail="Document type not applicable for Non-VAT customer.")

    doc_info = DOC_COL_MAP.get(dtype)
    if not doc_info:
        raise HTTPException(status_code=400, detail="Invalid document type.")
    col_name, doc_label = doc_info

    ext = os.path.splitext(payload.file_name)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".pdf"):
        raise HTTPException(status_code=400, detail="Only PNG, JPG, PDF allowed.")

    target_table = "vat_customer_records" if ctype == "vat" else "non_vat_customer_records"
    base_dir = UPLOAD_BASE if ctype == "vat" else NON_VAT_UPLOAD_BASE
    url_prefix = "/uploads/Customer_Docs/VAT_Customer_Docs" if ctype == "vat" else "/uploads/Customer_Docs/Non_VAT_Customer_Docs"

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT customer_name, site, company, {col_name} AS existing_url FROM {target_table} WHERE id = %s",
            (payload.record_id,),
        )
        rec = cur.fetchone()
        if not rec:
            raise HTTPException(status_code=404, detail="Customer record not found.")

        cust_folder = _sanitize_name(rec["customer_name"])
        target_dir = os.path.join(base_dir, cust_folder)
        os.makedirs(target_dir, exist_ok=True)

        old_url = rec.get("existing_url")
        is_replace = bool(old_url)
        if old_url:
            old_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(old_url).lstrip("/")))
            if old_path.startswith(os.path.normpath(base_dir)) and os.path.exists(old_path):
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

        rel_url = f"{url_prefix}/{cust_folder}/{saved_filename}"
        cur.execute(
            f"UPDATE {target_table} SET {col_name} = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (rel_url, payload.record_id),
        )

        action_text = f"Doc Replaced: {doc_label}" if is_replace else f"Doc Uploaded: {doc_label}"
        cur.execute(
            """
            INSERT INTO mubarak_vat_audit_log (customer_type, record_id, changed_by, action_summary, created_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            """,
            (ctype, payload.record_id, user["username"], action_text),
        )
        cur.execute(
            """
            SELECT changed_by, action_summary, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            WHERE customer_type = %s AND record_id = %s
            ORDER BY id DESC
            """,
            (ctype, payload.record_id),
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
    ctype = (payload.customer_type or "vat").strip().lower()
    if ctype not in ("vat", "non_vat"):
        raise HTTPException(status_code=400, detail="Invalid customer_type.")
    dtype = (payload.doc_type or "").lower()
    if ctype == "non_vat" and dtype not in ("agreement", "last"):
        raise HTTPException(status_code=400, detail="Document type not applicable for Non-VAT customer.")

    doc_info = DOC_COL_MAP.get(dtype)
    if not doc_info:
        raise HTTPException(status_code=400, detail="Invalid document type.")
    col_name, doc_label = doc_info

    target_table = "vat_customer_records" if ctype == "vat" else "non_vat_customer_records"
    base_dir = UPLOAD_BASE if ctype == "vat" else NON_VAT_UPLOAD_BASE

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"SELECT {col_name} AS existing_url FROM {target_table} WHERE id = %s",
            (payload.record_id,),
        )
        rec = cur.fetchone()
        if not rec:
            raise HTTPException(status_code=404, detail="Customer record not found.")

        old_url = rec.get("existing_url")
        if old_url:
            old_path = os.path.normpath(os.path.join(PUBLIC_ROOT, str(old_url).lstrip("/")))
            if old_path.startswith(os.path.normpath(base_dir)) and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        cur.execute(
            f"UPDATE {target_table} SET {col_name} = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (payload.record_id,),
        )
        cur.execute(
            """
            INSERT INTO mubarak_vat_audit_log (customer_type, record_id, changed_by, action_summary, created_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            """,
            (ctype, payload.record_id, user["username"], f"Doc Deleted: {doc_label}"),
        )
        cur.execute(
            """
            SELECT changed_by, action_summary, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
            FROM mubarak_vat_audit_log
            WHERE customer_type = %s AND record_id = %s
            ORDER BY id DESC
            """,
            (ctype, payload.record_id),
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
        summary_ws = wb.active
        summary_ws.title = "Summary"
        summary_ws.views.sheetView[0].showGridLines = True

        navy_fill = PatternFill("solid", fgColor="0F172A")
        accent_fill = PatternFill("solid", fgColor="1E3A8A")
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
            "VAT",
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
        headers.extend(["Payment Status", "Final Verification", "Notes", "Plate No", "Audit Trail"])

        col_widths = [7, 15, 32, 8, 20, 18, 22, 18, 14, 14, 13]
        if is_detailed:
            col_widths.extend([12, 12, 12, 12, 12])
        col_widths.extend([16, 18, 34, 24, 44])

        def _populate_data_sheet(target_ws, sheet_records, title_text):
            target_ws.views.sheetView[0].showGridLines = True

            # Title Row
            target_ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
            t_cell = target_ws.cell(row=1, column=1, value=title_text)
            t_cell.font = Font(name="Calibri", size=13, bold=True, color="FFFFFF")
            t_cell.fill = navy_fill
            t_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            target_ws.row_dimensions[1].height = 28

            # Subtitle / Count Row
            v_cnt = sum(1 for r in sheet_records if r["final_status"] == "Verified")
            nv_cnt = len(sheet_records) - v_cnt
            target_ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(headers))
            s_cell = target_ws.cell(
                row=2,
                column=1,
                value=f"Total Records: {len(sheet_records)}   |   Verified: {v_cnt}   |   Not Verified: {nv_cnt}",
            )
            s_cell.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            s_cell.fill = sub_fill
            s_cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            target_ws.row_dimensions[2].height = 22

            # Header Row
            target_ws.row_dimensions[3].height = 24
            for col_idx, h in enumerate(headers, start=1):
                c = target_ws.cell(row=3, column=col_idx, value=h)
                c.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
                c.fill = navy_fill
                c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                c.border = cell_border

            # Data Rows (unmerged — vendor columns repeated per row)
            vendor_sn = 0
            prev_vkey = None
            center_cols = {1, 2, 4, 5, 6, 9, 10, 11}
            if is_detailed:
                center_cols.update({12, 13, 14, 15, 16, 17, 18})
            else:
                center_cols.update({12, 13})

            for idx_rec, item in enumerate(sheet_records):
                r_idx = idx_rec + 4
                vkey = (item["customer_type"], (item["customer_name"] or "").strip().lower())
                if vkey != prev_vkey:
                    vendor_sn += 1
                    prev_vkey = vkey

                is_verified = item["final_status"] == "Verified"
                row_fill = verified_fill if is_verified else (zebra_fill if r_idx % 2 == 1 else white_fill)

                plate_text = "\n".join(item.get("plate_nos") or [])
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
                    item["is_vat"],
                    item["vat_no"],
                    item["cr_no"],
                    item["site"],
                    item["company"],
                    start_dt_val,
                    end_dt_val,
                    item["status"],
                ]
                if is_detailed:
                    is_vat = item["customer_type"] == "vat"
                    vals.extend([
                        "Uploaded" if item.get("agreement_doc") else "Pending",
                        ("Uploaded" if item.get("rfq_doc") else "Pending") if is_vat else "",
                        ("Uploaded" if item.get("po_doc") else "Pending") if is_vat else "",
                        ("Uploaded" if item.get("conf_letter_doc") else "Pending") if is_vat else "",
                        "Uploaded" if item.get("last_doc") else "Pending",
                    ])
                vals.extend([item["payment_status"], item["final_status"], item["notes"], plate_text, audit_text])

                line_count = max(
                    len(item.get("plate_nos") or []),
                    len(item.get("audit_trail") or []),
                    1,
                )
                target_ws.row_dimensions[r_idx].height = max(24, min(140, line_count * 15 + 6))

                for col_idx, val in enumerate(vals, start=1):
                    c = target_ws.cell(row=r_idx, column=col_idx, value=val)
                    c.font = Font(name="Calibri", size=10, color="0F172A")
                    c.fill = row_fill
                    c.border = cell_border
                    if col_idx in (9, 10) and isinstance(val, date):
                        c.number_format = "yyyy-mm-dd"
                    c.alignment = (
                        Alignment(horizontal="center", vertical="center")
                        if col_idx in center_cols
                        else Alignment(horizontal="left", vertical="center", wrap_text=True)
                    )

            for idx, width in enumerate(col_widths, start=1):
                target_ws.column_dimensions[get_column_letter(idx)].width = width

            last_row = max(3, len(sheet_records) + 3)
            target_ws.auto_filter.ref = f"A3:{get_column_letter(len(headers))}{last_row}"
            target_ws.freeze_panes = "A4"

        # Group records by Company
        company_groups = {}
        for item in records:
            comp_label = (item.get("company") or "").strip() or "Unassigned"
            company_groups.setdefault(comp_label, []).append(item)

        sorted_companies = sorted(
            company_groups.keys(),
            key=lambda x: (1 if x == "Unassigned" else 0, x.lower()),
        )

        # 2. Master Data Sheet
        master_ws = wb.create_sheet(title="Master Data")
        _populate_data_sheet(
            master_ws,
            records,
            f"Master Data — Customers Verification ({start_date} to {resolved_end})",
        )

        # 3. Individual Company Sheets
        used_sheet_names = {"summary", "master data"}
        company_tab_map = []
        for comp_name in sorted_companies:
            cleaned_tab = re.sub(r'[\\/*?:\[\]]', "_", comp_name).strip().strip("'") or "Unassigned"
            base_tab = cleaned_tab[:31]
            tab_name = base_tab
            suffix_num = 2
            while tab_name.lower() in used_sheet_names:
                suf = f"_{suffix_num}"
                tab_name = f"{base_tab[:31 - len(suf)]}{suf}"
                suffix_num += 1
            used_sheet_names.add(tab_name.lower())

            comp_ws = wb.create_sheet(title=tab_name)
            _populate_data_sheet(
                comp_ws,
                company_groups[comp_name],
                f"{comp_name} — Customers Verification ({start_date} to {resolved_end})",
            )
            company_tab_map.append((comp_name, tab_name, company_groups[comp_name]))

        # 1. Populate Summary & Documentation Sheet
        summary_ws.merge_cells("A1:K1")
        s_title = summary_ws.cell(
            row=1,
            column=1,
            value="Customers Verification — Summary & Documentation",
        )
        s_title.font = Font(name="Calibri", size=14, bold=True, color="FFFFFF")
        s_title.fill = navy_fill
        s_title.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        summary_ws.row_dimensions[1].height = 30

        meta_rows = [
            ("Report Period", f"{start_date} to {resolved_end}"),
            ("View Mode", "Detailed View" if is_detailed else "Compact View"),
            ("Generated On", datetime.now().strftime("%Y-%m-%d %H:%M")),
            ("Search Filter", search.strip() if search.strip() else "None (All Records)"),
            ("Total Companies", len(sorted_companies)),
        ]
        for idx_m, (m_key, m_val) in enumerate(meta_rows, start=3):
            summary_ws.row_dimensions[idx_m].height = 20
            c1 = summary_ws.cell(row=idx_m, column=1, value=m_key)
            c1.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            c1.fill = sub_fill
            c1.border = cell_border
            summary_ws.merge_cells(start_row=idx_m, start_column=2, end_row=idx_m, end_column=4)
            for bc in range(2, 5):
                summary_ws.cell(row=idx_m, column=bc).border = cell_border
                summary_ws.cell(row=idx_m, column=bc).fill = white_fill
            c2 = summary_ws.cell(row=idx_m, column=2, value=m_val)
            c2.font = Font(name="Calibri", size=10, color="0F172A")
            c2.alignment = Alignment(horizontal="left", vertical="center")

        # Overall KPIs Section
        kpi_start = 9
        summary_ws.merge_cells(start_row=kpi_start, start_column=1, end_row=kpi_start, end_column=4)
        k_hdr = summary_ws.cell(row=kpi_start, column=1, value="Overall Verification & Payment Summary")
        k_hdr.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        k_hdr.fill = accent_fill
        k_hdr.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        summary_ws.row_dimensions[kpi_start].height = 24

        unique_vendors_all = len({(r["customer_type"], (r["customer_name"] or "").strip().lower()) for r in records})
        vat_cnt = sum(1 for r in records if r["customer_type"] == "vat")
        nvat_cnt = len(records) - vat_cnt
        ver_cnt = sum(1 for r in records if r["final_status"] == "Verified")
        nver_cnt = len(records) - ver_cnt
        act_cnt = sum(1 for r in records if str(r["status"]).lower() != "released")
        rel_cnt = len(records) - act_cnt

        kpi_items = [
            ("Total Records", len(records)),
            ("Unique Vendors", unique_vendors_all),
            ("VAT Customers", vat_cnt),
            ("Non-VAT Customers", nvat_cnt),
            ("Active Sites", act_cnt),
            ("Released Sites", rel_cnt),
            ("Verified", ver_cnt),
            ("Not Verified", nver_cnt),
            ("Payment — Paid", sum(1 for r in records if r["payment_status"] == "Paid")),
            ("Payment — Pending", sum(1 for r in records if r["payment_status"] == "Pending")),
            ("Payment — Partially Paid", sum(1 for r in records if r["payment_status"] == "Partially Paid")),
            ("Payment — Not Paid", sum(1 for r in records if r["payment_status"] == "Not Paid")),
        ]
        for idx_k, (k_lbl, k_val) in enumerate(kpi_items, start=kpi_start + 1):
            summary_ws.row_dimensions[idx_k].height = 20
            r_fill = zebra_fill if idx_k % 2 == 1 else white_fill
            summary_ws.merge_cells(start_row=idx_k, start_column=1, end_row=idx_k, end_column=2)
            for cc in (1, 2):
                summary_ws.cell(row=idx_k, column=cc).border = cell_border
                summary_ws.cell(row=idx_k, column=cc).fill = r_fill
            c_l = summary_ws.cell(row=idx_k, column=1, value=k_lbl)
            c_l.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            summary_ws.merge_cells(start_row=idx_k, start_column=3, end_row=idx_k, end_column=4)
            for cc in (3, 4):
                summary_ws.cell(row=idx_k, column=cc).border = cell_border
                summary_ws.cell(row=idx_k, column=cc).fill = r_fill
            c_v = summary_ws.cell(row=idx_k, column=3, value=k_val)
            c_v.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            c_v.alignment = Alignment(horizontal="center", vertical="center")

        # Legend / Documentation Box (Columns F-K alongside KPIs)
        summary_ws.merge_cells("F9:K9")
        doc_hdr = summary_ws.cell(row=9, column=6, value="Workbook Documentation & Color Legend")
        doc_hdr.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        doc_hdr.fill = accent_fill
        doc_hdr.alignment = Alignment(horizontal="left", vertical="center", indent=1)

        doc_notes = [
            ("Summary Tab", "Executive overview, company-wise counts, and tab guide."),
            ("Master Data Tab", "All VAT and Non-VAT customer site records combined (unmerged rows)."),
            ("Company Tabs", "Separate sheet per company with identical columns and filters."),
            ("VAT Column", "'Yes' = VAT Customer, 'No' = Non-VAT Customer (blank for N/A docs)."),
            ("Plate No Column", "All Ishtimaras linked to each site listed line-by-line."),
            ("Yellow Row Highlight", "Indicates Final Verification is marked as 'Verified'."),
        ]
        for idx_d, (d_key, d_desc) in enumerate(doc_notes, start=10):
            summary_ws.merge_cells(start_row=idx_d, start_column=7, end_row=idx_d, end_column=11)
            c_dk = summary_ws.cell(row=idx_d, column=6, value=d_key)
            c_dk.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            c_dk.fill = verified_fill if d_key == "Yellow Row Highlight" else sub_fill
            c_dk.border = cell_border
            for cc in range(7, 12):
                summary_ws.cell(row=idx_d, column=cc).border = cell_border
                summary_ws.cell(row=idx_d, column=cc).fill = white_fill
            c_dd = summary_ws.cell(row=idx_d, column=7, value=d_desc)
            c_dd.font = Font(name="Calibri", size=10, color="0F172A")
            c_dd.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

        # Company-Wise Breakdown Table
        comp_start = kpi_start + len(kpi_items) + 2
        summary_ws.merge_cells(start_row=comp_start, start_column=1, end_row=comp_start, end_column=11)
        ct_hdr = summary_ws.cell(row=comp_start, column=1, value="Company-Wise Breakdown")
        ct_hdr.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        ct_hdr.fill = navy_fill
        ct_hdr.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        summary_ws.row_dimensions[comp_start].height = 24

        comp_headers = [
            "Company",
            "Sheet Tab",
            "Total Records",
            "Unique Vendors",
            "VAT",
            "Non-VAT",
            "Verified",
            "Not Verified",
            "Paid",
            "Pending",
            "Partially Paid / Not Paid",
        ]
        hdr_row = comp_start + 1
        summary_ws.row_dimensions[hdr_row].height = 24
        for ci, ch in enumerate(comp_headers, start=1):
            c = summary_ws.cell(row=hdr_row, column=ci, value=ch)
            c.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
            c.fill = accent_fill
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            c.border = cell_border

        data_start_row = hdr_row + 1
        for idx_c, (comp_name, tab_name, c_recs) in enumerate(company_tab_map):
            r_num = data_start_row + idx_c
            summary_ws.row_dimensions[r_num].height = 21
            r_fill = zebra_fill if r_num % 2 == 1 else white_fill
            u_vends = len({(x["customer_type"], (x["customer_name"] or "").strip().lower()) for x in c_recs})
            c_vat = sum(1 for x in c_recs if x["customer_type"] == "vat")
            c_nvat = len(c_recs) - c_vat
            c_ver = sum(1 for x in c_recs if x["final_status"] == "Verified")
            c_nver = len(c_recs) - c_ver
            c_paid = sum(1 for x in c_recs if x["payment_status"] == "Paid")
            c_pend = sum(1 for x in c_recs if x["payment_status"] == "Pending")
            c_other_pay = sum(1 for x in c_recs if x["payment_status"] in ("Partially Paid", "Not Paid"))

            row_vals = [comp_name, tab_name, len(c_recs), u_vends, c_vat, c_nvat, c_ver, c_nver, c_paid, c_pend, c_other_pay]
            for ci, val in enumerate(row_vals, start=1):
                c = summary_ws.cell(row=r_num, column=ci, value=val)
                c.font = Font(name="Calibri", size=10, bold=(ci == 1), color="0F172A")
                c.fill = r_fill
                c.border = cell_border
                c.alignment = (
                    Alignment(horizontal="left", vertical="center")
                    if ci in (1, 2)
                    else Alignment(horizontal="center", vertical="center")
                )

        if company_tab_map:
            tot_row = data_start_row + len(company_tab_map)
            summary_ws.row_dimensions[tot_row].height = 22
            c_tot = summary_ws.cell(row=tot_row, column=1, value="TOTAL")
            c_tot.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            c_tot.fill = sub_fill
            c_tot.border = cell_border
            c_blank = summary_ws.cell(row=tot_row, column=2, value="")
            c_blank.fill = sub_fill
            c_blank.border = cell_border
            for ci in range(3, 12):
                col_ltr = get_column_letter(ci)
                c = summary_ws.cell(
                    row=tot_row,
                    column=ci,
                    value=f"=SUM({col_ltr}{data_start_row}:{col_ltr}{tot_row - 1})",
                )
                c.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
                c.fill = sub_fill
                c.border = cell_border
                c.alignment = Alignment(horizontal="center", vertical="center")

        summary_widths = [24, 24, 14, 15, 10, 11, 12, 13, 10, 11, 22]
        for idx_w, w in enumerate(summary_widths, start=1):
            summary_ws.column_dimensions[get_column_letter(idx_w)].width = w

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        fname = f"Mubarak_Customers_{start_date}_to_{resolved_end}.xlsx"
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))