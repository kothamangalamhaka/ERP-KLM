import os
import base64
import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from imap_tools import MailBox, AND
from dotenv import load_dotenv

load_dotenv()
router = APIRouter()

VENDORS = {
    "HAKA": {"label": "Haka Contracting Establishment", "email": "hakacontractingest", "prefix": "HAK-INV"},
    "ALJODA": {"label": "AL-JODA SARAA EQUIPMENT RENTAL Establishment", "email": "evotech", "prefix": "INV-25"},
    "MASAR": {"label": "Etijah Al Masar General Contracting Establishment", "email": "klm haka", "prefix": "INV-MW"},
    "WE1": {"label": "We1 Track Company", "email": "we1trackco", "prefix": "INV-WE1"}
}

class InvoiceRequest(BaseModel):
    vendorKey: str

@router.get("/api/invoice-vendors")
def get_vendors():
    return VENDORS

@router.post("/api/invoice-download")
def download_invoices(payload: InvoiceRequest):
    vendor_key = payload.vendorKey

    if vendor_key not in VENDORS:
        raise HTTPException(status_code=400, detail="Invalid Vendor Selected")

    vendor = VENDORS[vendor_key]
    today = datetime.date.today()
    files = []
    processed_filenames = set()

    email_user = os.getenv("EMAIL_USER")
    email_pass = os.getenv("EMAIL_PASS")

    if not email_user or not email_pass:
        raise HTTPException(status_code=500, detail="Server Email Configuration Missing")

    try:
        with MailBox('imap.gmail.com').login(email_user, email_pass, initial_folder='INBOX') as mailbox:
            for msg in mailbox.fetch(AND(date_gte=today, from_=vendor["email"])):
                if msg.date.date() == today:
                    for att in msg.attachments:
                        filename = att.filename
                        if (
                            filename and 
                            filename.upper().startswith(vendor["prefix"].upper()) and 
                            filename.lower().endswith(".pdf") and 
                            filename not in processed_filenames
                        ):
                            processed_filenames.add(filename)
                            files.append({
                                "name": filename,
                                "mimeType": att.content_type,
                                "data": base64.b64encode(att.payload).decode('utf-8')
                            })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IMAP Fetch Error: {str(e)}")

    if not files:
        return JSONResponse(content={"count": 0, "files": []})

    return JSONResponse(content={"count": len(files), "files": files})