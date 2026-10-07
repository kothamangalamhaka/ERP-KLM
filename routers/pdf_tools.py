import io
import os
import json
import gc
import tempfile
import traceback
from typing import List
from fastapi import APIRouter, HTTPException, Response, Request
from pypdf import PdfReader, PdfWriter

router = APIRouter(prefix="/py/pdf", tags=["PDF Tools"])

def cleanup_temp_files(paths: List[str]):
    for p in paths:
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass

@router.post("/merge-custom")
async def merge_custom_pdf(request: Request):
    temp_input_paths = []
    temp_output_path = None
    opened_files = []
    try:
        form = await request.form()
        files = form.getlist("files")
        structure_str = form.get("structure")

        if not files:
            raise ValueError("No PDF files uploaded.")
        if not structure_str:
            raise ValueError("Missing page structure.")

        page_mappings = json.loads(structure_str)
        
        # 1. Direct memory stream without locking OS temp files
        file_readers = []
        for u_file in files:
            if hasattr(u_file, "read"):
                content = await u_file.read()
                file_readers.append(PdfReader(io.BytesIO(content)))
        
        if not file_readers:
            raise ValueError("Files received are not valid PDFs.")
        
        writer = PdfWriter()
        
        # 3. Batch appending pages
        batch_counter = 0
        for item in page_mappings:
            f_idx = int(item["file_index"])
            p_idx = int(item["page_index"])
            
            if 0 <= f_idx < len(file_readers):
                reader = file_readers[f_idx]
                if 0 <= p_idx < len(reader.pages):
                    writer.add_page(reader.pages[p_idx])
                    batch_counter += 1
                    
            if batch_counter % 250 == 0:
                gc.collect()

        if batch_counter == 0:
            raise ValueError("No valid pages were found to merge.")

        # 4. Stream writer to output file
        out_temp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        temp_output_path = out_temp.name
        with open(temp_output_path, "wb") as out_fp:
            writer.write(out_fp)
        out_temp.close()

        # Close all open file descriptors safely
        for fh in opened_files:
            fh.close()
        opened_files.clear()

        with open(temp_output_path, "rb") as out_fp:
            pdf_bytes = out_fp.read()

        all_cleanup_targets = temp_input_paths + [temp_output_path]
        cleanup_temp_files(all_cleanup_targets)

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=Merged_{len(page_mappings)}_Pages.pdf"}
        )
    except Exception as e:
        # Get the exact line of error
        err_line = traceback.format_exc().splitlines()[-2:]
        err_detail = " | ".join(err_line)
        
        for fh in opened_files:
            try:
                fh.close()
            except:
                pass
        cleanup_temp_files(temp_input_paths)
        if temp_output_path and os.path.exists(temp_output_path):
            try:
                os.remove(temp_output_path)
            except:
                pass
        raise HTTPException(status_code=500, detail=f"Python Error: {err_detail}")