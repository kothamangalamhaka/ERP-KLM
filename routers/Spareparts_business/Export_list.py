from fastapi import APIRouter, HTTPException
from routers.Spareparts_business.xl_helper import ExportReq, xlsx_response

router = APIRouter(prefix="/py/spare-parts", tags=["SpareParts Export"])


@router.post("/export-list")
def export_list(data: ExportReq):
    try:
        return xlsx_response(data, "SpareParts_Transactions.xlsx")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))