import os
import json
import base64
import io
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg2
import jwt
import face_recognition
from PIL import Image
from dotenv import load_dotenv
from fastapi import APIRouter
from pydantic import BaseModel

load_dotenv()

router = APIRouter(prefix="/py", tags=["Biometric Face Login"])
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET or JWT_SECRET == "fallback_secret":
    raise RuntimeError("CRITICAL SECURITY ERROR: JWT_SECRET must be explicitly set in .env and cannot be 'fallback_secret'.")


from typing import Optional, List

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


# Signup-il ninnu image vannaal 128-d encoding return cheyyum
@router.post("/face-encode")
async def face_encode(payload: FaceRequest):
    try:
        enc = image_to_encoding(payload.image)
        if enc is None:
            return {"success": False, "message": "No face detected. Try again with better light."}
        return {"success": True, "descriptor": enc.tolist()}
    except Exception as e:
        return {"success": False, "message": f"Encode error: {e}"}


# In-memory cache optimized with vectorized encodings
FACE_CACHE = {"users": [], "encodings": [], "last_updated": 0.0}
CACHE_TTL = 300.0  # 5 minutes cache validity

@router.post("/face-login")
async def face_login(payload: FaceRequest):
    try:
        # Frontend MediaPipe Face Mesh strictly handles the active liveness check.
        # We only need to securely match the extracted face to our database.
        current = image_to_encoding(payload.image)
        if current is None:
            return {"success": False, "message": "No face detected in the image."}

        global FACE_CACHE
        current_time = datetime.now(timezone.utc).timestamp()
        
        # Fetch from DB and build vectorized encodings only if cache is expired or empty
        if current_time - FACE_CACHE["last_updated"] > CACHE_TTL or not FACE_CACHE["users"]:
            conn = get_conn()
            cur = conn.cursor()
            cur.execute(
                """SELECT id, username, role, email, display_name, face_descriptor, status
                   FROM invoicedatauser
                   WHERE face_descriptor IS NOT NULL"""
            )
            raw_users = cur.fetchall()
            cur.close()
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
            
            FACE_CACHE["users"] = valid_users
            FACE_CACHE["encodings"] = valid_encodings
            FACE_CACHE["last_updated"] = current_time

        if not FACE_CACHE["encodings"]:
            return {"success": False, "code": "NOT_RECOGNIZED", "message": "No valid face data in database."}

        # Vectorized distance calculation (Fast & CPU efficient)
        distances = face_recognition.face_distance(FACE_CACHE["encodings"], current)
        best_match_index = np.argmin(distances)
        best_dist = distances[best_match_index]

        # 0.5 is strict, optimized threshold (adjust to 0.53 if false rejections happen)
        if best_dist > 0.5:
            return {"success": False, "code": "NOT_RECOGNIZED", "message": "Face not recognized."}

        best_user = FACE_CACHE["users"][best_match_index]
        db_id, username, role, email, display_name, _, status = best_user

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
        return {
            "success": True,
            "token": token,
            "user": {"id": db_id, "username": username, "role": role,
                     "email": email, "displayName": display_name},
            "message": "Face login successful!",
        }
    except Exception as e:
        print("Face login error:", e)
        return {"success": False, "message": f"Server error: {e}"}