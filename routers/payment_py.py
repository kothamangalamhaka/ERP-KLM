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
    inv_deduct: Optional[Any] = None
    deduct_reason: Optional[str] = ""
    crn_no: Optional[str] = ""
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
                bill_nr, bill_ot, invoice_amount, inv_deduct, deduct_reason, crn_no, zoho
            )
            VALUES (
                %(plate)s, %(month)s, %(site)s, COALESCE(%(inv_no)s, ''), COALESCE(%(bill_no)s, ''), 
                %(inv_nr)s, %(inv_ot)s, %(inv_amount)s, COALESCE(%(inv_deduct)s, 0), COALESCE(%(deduct_reason)s, ''), COALESCE(%(crn_no)s, ''), 'No'
            )
            ON CONFLICT (plate_no, month, site_name)
            DO UPDATE SET 
                invoice_no = CASE WHEN %(has_inv_no)s THEN EXCLUDED.invoice_no ELSE invoice_records.invoice_no END,
                bill_no = CASE WHEN %(has_bill_no)s THEN EXCLUDED.bill_no ELSE invoice_records.bill_no END,
                bill_nr = CASE WHEN %(has_inv_nr)s THEN EXCLUDED.bill_nr ELSE invoice_records.bill_nr END,
                bill_ot = CASE WHEN %(has_inv_ot)s THEN EXCLUDED.bill_ot ELSE invoice_records.bill_ot END,
                invoice_amount = CASE WHEN %(has_inv_amount)s THEN EXCLUDED.invoice_amount ELSE invoice_records.invoice_amount END,
                inv_deduct = CASE WHEN %(has_inv_deduct)s THEN EXCLUDED.inv_deduct ELSE invoice_records.inv_deduct END,
                deduct_reason = CASE WHEN %(has_deduct_reason)s THEN EXCLUDED.deduct_reason ELSE invoice_records.deduct_reason END,
                crn_no = CASE WHEN %(has_crn_no)s THEN EXCLUDED.crn_no ELSE invoice_records.crn_no END,
                updated_at = CURRENT_TIMESTAMP;
        """

        record_dicts = []
        for r in payload.records:
            d = r.dict()
            provided = r.__fields_set__ if hasattr(r, "__fields_set__") else r.model_fields_set
            d["has_inv_no"] = "inv_no" in provided
            d["has_bill_no"] = "bill_no" in provided
            d["has_inv_nr"] = "inv_nr" in provided
            d["has_inv_ot"] = "inv_ot" in provided
            d["has_inv_amount"] = "inv_amount" in provided
            d["has_inv_deduct"] = "inv_deduct" in provided
            d["has_deduct_reason"] = "deduct_reason" in provided
            d["has_crn_no"] = "crn_no" in provided
            record_dicts.append(d)
        # 🟢 ഒറ്റയടിക്ക് അതിവേഗം ഡാറ്റ അപ്ഡേറ്റ് ചെയ്യുന്നു
        execute_batch(cur, query, record_dicts, page_size=100)

        conn.commit()
        cur.close()
        conn.close()

        # 🟢 Notify Node.js SSE Stream to push live sync to all browser clients
        try:
            import urllib.request
            import json
            node_port = os.getenv("PORT", "5000")
            req_data = json.dumps({"eventType": "INLINE_EDITS_SAVED", "records": record_dicts}).encode('utf-8')
            req = urllib.request.Request(
                f"http://127.0.0.1:{node_port}/payment/notify-sync",
                data=req_data,
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception as notify_err:
            print("Sync notify failed:", notify_err)

        return {"success": True, "message": f"Successfully updated {len(record_dicts)} records via Python Engine!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))