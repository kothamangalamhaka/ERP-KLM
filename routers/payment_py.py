# new code - routers/payment_py.py

import os
import psycopg2
from psycopg2.extras import execute_batch
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/py/payment", tags=["Payment Report"])

from typing import List, Optional, Any

import re

class InvoiceEditRecord(BaseModel):
    month: str
    plate: str
    site: str
    inv_nr: Optional[Any] = None
    inv_ot: Optional[Any] = None 
    inv_nr_rate: Optional[Any] = None
    inv_ot_rate: Optional[Any] = None
    inv_amount: Optional[Any] = None
    inv_deduct: Optional[Any] = None
    deduct_reason: Optional[str] = ""
    crn_no: Optional[str] = ""
    inv_no: Optional[str] = ""
    bill_no: Optional[str] = ""

class BulkInvoiceRequest(BaseModel):
    records: List[InvoiceEditRecord]

def _strip_rate_diff_tag(reason_str: str) -> str:
    cleaned = re.sub(r"\s*\|\s*Inv Rate Diff:\s*[+-]?\d+(?:\.\d+)?", "", reason_str or "")
    cleaned = re.sub(r"Inv Rate Diff:\s*[+-]?\d+(?:\.\d+)?\s*\|\s*", "", cleaned)
    cleaned = re.sub(r"Inv Rate Diff:\s*[+-]?\d+(?:\.\d+)?", "", cleaned)
    return cleaned.strip()

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
                bill_nr, bill_ot, inv_nr_rate, inv_ot_rate, invoice_amount, inv_deduct, deduct_reason, crn_no, zoho
            )
            VALUES (
                %(plate)s, %(month)s, %(site)s, COALESCE(%(inv_no)s, ''), COALESCE(%(bill_no)s, ''), 
                %(inv_nr)s, %(inv_ot)s, %(inv_nr_rate)s, %(inv_ot_rate)s, %(inv_amount)s, COALESCE(%(inv_deduct)s, 0), COALESCE(%(deduct_reason)s, ''), COALESCE(%(crn_no)s, ''), 'No'
            )
            ON CONFLICT (plate_no, month, site_name)
            DO UPDATE SET 
                invoice_no = CASE WHEN %(has_inv_no)s THEN EXCLUDED.invoice_no ELSE invoice_records.invoice_no END,
                bill_no = CASE WHEN %(has_bill_no)s THEN EXCLUDED.bill_no ELSE invoice_records.bill_no END,
                bill_nr = CASE WHEN %(has_inv_nr)s THEN EXCLUDED.bill_nr ELSE invoice_records.bill_nr END,
                bill_ot = CASE WHEN %(has_inv_ot)s THEN EXCLUDED.bill_ot ELSE invoice_records.bill_ot END,
                inv_nr_rate = CASE WHEN %(has_inv_nr_rate)s THEN EXCLUDED.inv_nr_rate ELSE invoice_records.inv_nr_rate END,
                inv_ot_rate = CASE WHEN %(has_inv_ot_rate)s THEN EXCLUDED.inv_ot_rate ELSE invoice_records.inv_ot_rate END,
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
            d["has_inv_nr_rate"] = "inv_nr_rate" in provided
            d["has_inv_ot_rate"] = "inv_ot_rate" in provided
            d["has_inv_amount"] = "inv_amount" in provided
            d["has_inv_deduct"] = "inv_deduct" in provided
            d["has_deduct_reason"] = "deduct_reason" in provided
            d["has_crn_no"] = "crn_no" in provided

            if d["has_inv_nr_rate"] or d["has_inv_ot_rate"] or d["has_inv_amount"] or d["has_inv_nr"] or d["has_inv_ot"]:
                cur.execute(
                    "SELECT bill_nr, bill_ot, inv_nr_rate, inv_ot_rate, invoice_amount, deduct_reason FROM invoice_records WHERE plate_no=%s AND month=%s AND site_name=%s",
                    (d["plate"], d["month"], d["site"]),
                )
                ex = cur.fetchone()
                ex_nr, ex_ot, ex_nr_rate, ex_ot_rate, ex_amt, ex_reason = ex if ex else (None, None, None, None, None, "")

                eff_nr = float(d["inv_nr"] if d["has_inv_nr"] else (ex_nr or 0))
                eff_ot = float(d["inv_ot"] if d["has_inv_ot"] else (ex_ot or 0))
                eff_nr_rate = d["inv_nr_rate"] if d["has_inv_nr_rate"] else ex_nr_rate
                eff_ot_rate = d["inv_ot_rate"] if d["has_inv_ot_rate"] else ex_ot_rate
                eff_amt = d["inv_amount"] if d["has_inv_amount"] else ex_amt
                eff_reason = d["deduct_reason"] if d["has_deduct_reason"] else (ex_reason or "")

                if eff_nr_rate is not None or eff_ot_rate is not None:
                    expected_sub = round((eff_nr * float(eff_nr_rate or 0)) + (eff_ot * float(eff_ot_rate or 0)), 2)
                    if eff_amt is None or (float(eff_amt) == 0 and not d["has_inv_amount"]):
                        d["inv_amount"] = expected_sub
                        d["has_inv_amount"] = True
                    else:
                        diff = round(float(eff_amt) - expected_sub, 2)
                        base_reason = _strip_rate_diff_tag(eff_reason)
                        if abs(diff) >= 0.01:
                            sign = "+" if diff > 0 else ""
                            tag = f"Inv Rate Diff: {sign}{diff:.2f}"
                            d["deduct_reason"] = f"{base_reason} | {tag}" if base_reason else tag
                            d["has_deduct_reason"] = True
                        elif base_reason != (eff_reason or "").strip():
                            d["deduct_reason"] = base_reason
                            d["has_deduct_reason"] = True

            record_dicts.append(d)
        saved_dicts = []
        failed_rows = []
        for idx_r, d in enumerate(record_dicts):
            sp_name = f"sp_inv_{idx_r}"
            try:
                cur.execute(f"SAVEPOINT {sp_name}")
                cur.execute(query, d)
                cur.execute(f"RELEASE SAVEPOINT {sp_name}")
                saved_dicts.append(d)
            except Exception as row_err:
                cur.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
                failed_rows.append({
                    "plate": d.get("plate"),
                    "month": d.get("month"),
                    "site": d.get("site"),
                    "column": "Database",
                    "reason": str(row_err),
                })

        conn.commit()
        cur.close()
        conn.close()

        # 🟢 Notify Node.js SSE Stream to push live sync to all browser clients
        if saved_dicts:
            try:
                import urllib.request
                import json
                node_port = os.getenv("PORT", "5000")
                req_data = json.dumps({"eventType": "INLINE_EDITS_SAVED", "records": saved_dicts}).encode('utf-8')
                req = urllib.request.Request(
                    f"http://127.0.0.1:{node_port}/payment/notify-sync",
                    data=req_data,
                    headers={"Content-Type": "application/json"}
                )
                urllib.request.urlopen(req, timeout=2)
            except Exception as notify_err:
                print("Sync notify failed:", notify_err)

        return {
            "success": True,
            "saved_count": len(saved_dicts),
            "failed_rows": failed_rows,
            "message": f"Updated {len(saved_dicts)} records" + (f", {len(failed_rows)} failed" if failed_rows else ""),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))