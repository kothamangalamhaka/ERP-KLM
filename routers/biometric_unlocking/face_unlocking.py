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
JWT_SECRET = os.getenv("JWT_SECRET", "fallback_secret")


class FaceRequest(BaseModel):
    image: str


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


@router.post("/face-login")
async def face_login(payload: FaceRequest):
    try:
        current = image_to_encoding(payload.image)
        if current is None:
            return {"success": False, "message": "No face detected in the image."}

        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT id, username, role, email, display_name, face_descriptor, status
               FROM invoicedatauser
               WHERE face_descriptor IS NOT NULL"""
        )
        users = cur.fetchall()
        cur.close()
        conn.close()

        best_user, best_dist = None, 1.0
        for db_id, username, role, email, display_name, desc, status in users:
            try:
                stored = np.array(json.loads(desc), dtype=float)
                if stored.shape != (128,):
                    continue  # pazhaya/invalid data skip
            except Exception:
                continue
            dist = face_recognition.face_distance([stored], current)[0]
            if dist < best_dist:
                best_dist = dist
                best_user = (db_id, username, role, email, display_name, status)

        if not best_user or best_dist > 0.5:
            return {"success": False, "code": "NOT_RECOGNIZED", "message": "Face not recognized."}

        db_id, username, role, email, display_name, status = best_user

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