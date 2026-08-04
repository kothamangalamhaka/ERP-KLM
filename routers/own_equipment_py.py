import os
import psycopg2
from psycopg2.extras import execute_batch
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/py/own-equipment", tags=["Own Equipment Tracker"])

class InlineLogEdit(BaseModel):
    equipment_id: int
    year: int
    month: int
    maintenance_cost: float = 0
    basic_salary: float = 0
    overtime: float = 0
    penalty: float = 0
    santook_rent: float = 0
    kafil_comm: float = 0
    owner_comm: float = 0
    investor_comm: float = 0
    debit: float = 0
    pwas: float = 0
    other_expense: float = 0
    op_revenue: float = 0

class BulkLogUpdateRequest(BaseModel):
    logs: List[InlineLogEdit]

@router.post("/bulk-save-logs")
async def bulk_save_logs(payload: BulkLogUpdateRequest):
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
            INSERT INTO equipment_monthly_logs (
                equipment_id, year, month, maintenance_cost, basic_salary, overtime, 
                penalty, santook_rent, kafil_comm, owner_comm, investor_comm, 
                debit, pwas, other_expense, op_revenue
            )
            VALUES (
                %(equipment_id)s, %(year)s, %(month)s, %(maintenance_cost)s, %(basic_salary)s, %(overtime)s,
                %(penalty)s, %(santook_rent)s, %(kafil_comm)s, %(owner_comm)s, %(investor_comm)s,
                %(debit)s, %(pwas)s, %(other_expense)s, %(op_revenue)s
            )
            ON CONFLICT (equipment_id, year, month)
            DO UPDATE SET 
                maintenance_cost = EXCLUDED.maintenance_cost,
                basic_salary = EXCLUDED.basic_salary,
                overtime = EXCLUDED.overtime,
                penalty = EXCLUDED.penalty,
                santook_rent = EXCLUDED.santook_rent,
                kafil_comm = EXCLUDED.kafil_comm,
                owner_comm = EXCLUDED.owner_comm,
                investor_comm = EXCLUDED.investor_comm,
                debit = EXCLUDED.debit,
                pwas = EXCLUDED.pwas,
                other_expense = EXCLUDED.other_expense,
                op_revenue = EXCLUDED.op_revenue;
        """

        log_dicts = [item.dict() for item in payload.logs]
        execute_batch(cur, query, log_dicts, page_size=100)

        conn.commit()
        cur.close()
        conn.close()

        return {"success": True, "message": f"Successfully bulk updated {len(log_dicts)} logs via Python Engine!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))