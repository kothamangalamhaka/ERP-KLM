# new code - routers/payment_py.py

import os
import psycopg2
from psycopg2.extras import execute_batch
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/py/payment", tags=["Payment Report"])

from typing import List, Optional, Any

class InvoiceEditRecord(BaseModel):
    month: str
    plate: str
    site: str
    inv_nr: Optional[Any] = None
    inv_ot: Optional[Any] = None 
    inv_amount: Optional[Any] = None
    inv_no: Optional[str] = ""
    bill_no: Optional[str] = ""

class BulkInvoiceRequest(BaseModel):
    records: List[InvoiceEditRecord]

@router.post("/bulk-save-invoices")
async def bulk_save_invoices(payload: BulkInvoiceRequest):
    try:
        conn = psycopg2.connect(
            dbname=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASS"),
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=os.getenv("DB_PORT", "5432")
        )
        cur = conn.cursor()

        query = """
            INSERT INTO invoice_records (
                plate_no, month, site_name, invoice_no, bill_no, 
                bill_nr, bill_ot, invoice_amount, zoho
            )
            VALUES (
                %(plate)s, %(month)s, %(site)s, %(inv_no)s, %(bill_no)s, 
                %(inv_nr)s, %(inv_ot)s, %(inv_amount)s, 'No'
            )
            ON CONFLICT (plate_no, month, site_name)
            DO UPDATE SET 
                invoice_no = EXCLUDED.invoice_no,
                bill_no = EXCLUDED.bill_no,
                bill_nr = EXCLUDED.bill_nr,
                bill_ot = EXCLUDED.bill_ot,
                invoice_amount = EXCLUDED.invoice_amount,
                updated_at = CURRENT_TIMESTAMP;
        """

        record_dicts = [r.dict() for r in payload.records]
        # 🟢 ഒറ്റയടിക്ക് അതിവേഗം ഡാറ്റ അപ്ഡേറ്റ് ചെയ്യുന്നു
        execute_batch(cur, query, record_dicts, page_size=100)

        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "message": f"Successfully updated {len(record_dicts)} records via Python Engine!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))