import os
import json
import base64
import io
import time
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import numpy as np
import psycopg2
import jwt
import face_recognition
from PIL import Image
from dotenv import load_dotenv
from fastapi import APIRouter, Request
from pydantic import BaseModel

load_dotenv()

logger = logging.getLogger("face_login")

router = APIRouter(prefix="/py", tags=["Biometric Face Login"])
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET or JWT_SECRET == "fallback_secret":
    raise RuntimeError("CRITICAL SECURITY ERROR: JWT_SECRET must be explicitly set in .env and cannot be 'fallback_secret'.")

# ---------------- Settings ----------------
MAX_FAILED_ATTEMPTS = 4          # 4 തവണ തെറ്റിയാൽ
LOCKOUT_SECONDS = 20 * 60        # 20 മിനിറ്റ് ലോക്ക്
MAX_IMAGE_CHARS = 400_000        # base64 ഇമേജ് പരമാവധി വലിപ്പം (~300 KB)
MATCH_THRESHOLD = 0.5
CACHE_TTL = 300.0                # 5 മിനിറ്റ്
MAX_PARALLEL_FACE_JOBS = 2       # ഒരേ സമയം പരമാവധി 2 face job
JOB_WAIT_SECONDS = 10


class FaceRequest(BaseModel):
    image: Optional[str] = None
    frames: Optional[List[str]] = None


def get_conn():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
    )


def image_to_encoding(data_url: str):
    encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
    img = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
    encs = face_recognition.face_encodings(np.array(img))
    return encs[0] if encs else None


# ---------------- Client IP ----------------
def get_client_ip(request: Request) -> str:
    # Nginx/Node proxy വഴിയാണ് വരുന്നതെങ്കിൽ ആ proxy ശരിയായ X-Forwarded-For
    # സെറ്റ് ചെയ്യുന്നുണ്ടെന്ന് ഉറപ്പാക്കുക. Proxy ഇല്ലെങ്കിൽ ഈ header വിശ്വസിക്കരുത്
    # (attacker-ന് വ്യാജമായി മാറ്റി lockout ഒഴിവാക്കാം).
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------------- Lockout tracker ----------------
_attempts_lock = threading.Lock()
_attempts = {}  # ip -> {"fails": int, "locked_until": float, "last": float}


def check_locked(ip: str) -> int:
    """ലോക്ക് ആണെങ്കിൽ ബാക്കി സെക്കൻഡ് തിരിച്ചു നൽകും, അല്ലെങ്കിൽ 0."""
    now = time.time()
    with _attempts_lock:
        rec = _attempts.get(ip)
        if not rec:
            return 0
        if rec["locked_until"] > now:
            return int(rec["locked_until"] - now)
        if rec["locked_until"] and rec["locked_until"] <= now:
            # ലോക്ക് കഴിഞ്ഞു, പുതുതായി തുടങ്ങുന്നു
            del _attempts[ip]
        return 0


def record_failure(ip: str) -> int:
    """പരാജയം രേഖപ്പെടുത്തുന്നു. ബാക്കിയുള്ള ശ്രമങ്ങളുടെ എണ്ണം തിരിച്ചു നൽകും."""
    now = time.time()
    with _attempts_lock:
        rec = _attempts.setdefault(ip, {"fails": 0, "locked_until": 0.0, "last": now})
        rec["fails"] += 1
        rec["last"] = now
        if rec["fails"] >= MAX_FAILED_ATTEMPTS:
            rec["locked_until"] = now + LOCKOUT_SECONDS
            logger.warning("Face login LOCKED for ip=%s", ip)
            return 0
        # memory വൃത്തിയാക്കൽ (പഴയ എൻട്രികൾ)
        if len(_attempts) > 5000:
            for k in [k for k, v in _attempts.items() if now - v["last"] > LOCKOUT_SECONDS * 2]:
                _attempts.pop(k, None)
        return MAX_FAILED_ATTEMPTS - rec["fails"]


def record_success(ip: str):
    with _attempts_lock:
        _attempts.pop(ip, None)


def locked_response(remaining_sec: int):
    mins = max(1, (remaining_sec + 59) // 60)
    return {
        "success": False,
        "code": "LOCKED",
        "message": f"Too many failed face attempts. Face login is locked. Try again after {mins} minute(s) or use password login.",
        "retry_after": remaining_sec,
    }


# ---------------- Face cache (atomic swap + lock) ----------------
_cache_lock = threading.Lock()
FACE_CACHE = {"users": [], "encodings": [], "last_updated": 0.0}


def get_cache_snapshot():
    global FACE_CACHE
    now = time.time()
    snap = FACE_CACHE
    if snap["users"] and now - snap["last_updated"] <= CACHE_TTL:
        return snap

    with _cache_lock:
        snap = FACE_CACHE
        # lock കിട്ടുന്നതിനിടെ മറ്റൊരു request refresh ചെയ്തിട്ടുണ്ടോ എന്ന് നോക്കുന്നു
        if snap["users"] and now - snap["last_updated"] <= CACHE_TTL:
            return snap

        conn = get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT id, username, role, email, display_name, face_descriptor
                   FROM invoicedatauser
                   WHERE face_descriptor IS NOT NULL"""
            )
            raw_users = cur.fetchall()
            cur.close()
        finally:
            conn.close()

        valid_users, valid_encodings = [], []
        for user in raw_users:
            try:
                stored = np.array(json.loads(user[5]), dtype=float)
                if stored.shape == (128,):
                    valid_users.append(user)
                    valid_encodings.append(stored)
            except Exception:
                continue

        # users-ഉം encodings-ഉം ഒരുമിച്ച് ഒറ്റ dict ആയി swap ചെയ്യുന്നു (index mismatch ഇല്ല)
        FACE_CACHE = {
            "users": valid_users,
            "encodings": valid_encodings,
            "last_updated": time.time(),
        }
        return FACE_CACHE


def get_fresh_user_status(user_id: int):
    """Cache-ലെ status വിശ്വസിക്കാതെ DB-യിൽ നിന്ന് പുതിയത് എടുക്കുന്നു."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT username, role, email, display_name, status FROM invoicedatauser WHERE id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        cur.close()
        return row
    finally:
        conn.close()


_face_jobs = threading.BoundedSemaphore(MAX_PARALLEL_FACE_JOBS)


# Signup-ൽ നിന്ന് ഇമേജ് വന്നാൽ 128-d encoding return ചെയ്യും
@router.post("/face-encode")
def face_encode(payload: FaceRequest, request: Request):
    if not payload.image or len(payload.image) > MAX_IMAGE_CHARS:
        return {"success": False, "message": "Invalid image."}

    if not _face_jobs.acquire(timeout=JOB_WAIT_SECONDS):
        return {"success": False, "message": "Server busy. Try again."}
    try:
        enc = image_to_encoding(payload.image)
        if enc is None:
            return {"success": False, "message": "No face detected. Try again with better light."}
        return {"success": True, "descriptor": enc.tolist()}
    except Exception:
        logger.exception("face-encode error")
        return {"success": False, "message": "Could not process image."}
    finally:
        _face_jobs.release()


# 'def' (async അല്ല): FastAPI ഇത് thread pool-ൽ ഓടിക്കും, ബാക്കി ERP block ആകില്ല
@router.post("/face-login")
def face_login(payload: FaceRequest, request: Request):
    ip = get_client_ip(request)

    # 1. ആദ്യം ലോക്ക് പരിശോധന: ലോക്ക് ആണെങ്കിൽ face processing ചെയ്യില്ല
    remaining = check_locked(ip)
    if remaining > 0:
        return locked_response(remaining)

    # 2. Input validation
    if not payload.image or len(payload.image) > MAX_IMAGE_CHARS:
        left = record_failure(ip)
        return {"success": False, "message": "Invalid image."}

    # 3. ഒരേ സമയത്തെ face job-കൾ പരിമിതപ്പെടുത്തുന്നു
    if not _face_jobs.acquire(timeout=JOB_WAIT_SECONDS):
        return {"success": False, "code": "BUSY", "message": "Server busy. Please try again."}

    try:
        current = image_to_encoding(payload.image)
        if current is None:
            left = record_failure(ip)
            if left == 0:
                return locked_response(LOCKOUT_SECONDS)
            return {"success": False, "message": f"No face detected in the image. {left} attempt(s) left."}

        snap = get_cache_snapshot()
        if not snap["encodings"]:
            return {"success": False, "code": "NOT_RECOGNIZED", "message": "No valid face data in database."}

        distances = face_recognition.face_distance(snap["encodings"], current)
        best_idx = int(np.argmin(distances))
        best_dist = float(distances[best_idx])

        # Margin check: രണ്ടാമത്തെ ഏറ്റവും അടുത്ത ആളുമായി വ്യത്യാസം കുറവാണെങ്കിൽ നിരസിക്കുന്നു
        ambiguous = False
        if len(distances) > 1:
            second = float(np.partition(distances, 1)[1])
            if second - best_dist < 0.03:
                ambiguous = True

        if best_dist > MATCH_THRESHOLD or ambiguous:
            left = record_failure(ip)
            logger.info("Face NOT recognized ip=%s dist=%.3f ambiguous=%s", ip, best_dist, ambiguous)
            if left == 0:
                return locked_response(LOCKOUT_SECONDS)
            return {
                "success": False,
                "code": "NOT_RECOGNIZED",
                "message": f"Face not recognized. {left} attempt(s) left.",
            }

        db_id = snap["users"][best_idx][0]

        # Status DB-യിൽ നിന്ന് പുതുതായി എടുക്കുന്നു (cache stale ആകാതിരിക്കാൻ)
        fresh = get_fresh_user_status(db_id)
        if not fresh:
            record_failure(ip)
            return {"success": False, "code": "NOT_RECOGNIZED", "message": "Face not recognized."}

        username, role, email, display_name, status = fresh

        if status != "Approved":
            return {
                "success": False,
                "code": "NOT_APPROVED",
                "message": f"Hello {display_name}, your account is {status}. Access denied. Contact admin for approval.",
            }

        token = jwt.encode(
            {
                "id": db_id,
                "username": username,
                "role": role,
                "email": email,
                "exp": datetime.now(timezone.utc) + timedelta(hours=24),
            },
            JWT_SECRET,
            algorithm="HS256",
        )

        record_success(ip)
        logger.info("Face login success user=%s ip=%s dist=%.3f", username, ip, best_dist)
        return {
            "success": True,
            "token": token,
            "user": {"id": db_id, "username": username, "role": role,
                     "email": email, "displayName": display_name},
            "message": "Face login successful!",
        }
    except Exception:
        logger.exception("Face login error")
        return {"success": False, "message": "Server error. Please try again."}
    finally:
        _face_jobs.release()