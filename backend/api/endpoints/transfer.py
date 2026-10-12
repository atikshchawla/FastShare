"""Transfer lifecycle: upload + start, cancel, status, packet log."""

import os

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.models import ApiResponse
from api.uploads import save_upload
from transfer.manager import manager

router = APIRouter()


@router.post("/transfer/start")
def transfer_start(file: UploadFile = File(...), resume: bool = True,
                   source: str | None = None, dest: str | None = None):
    """Upload a file, then launch the UDP Stop-and-Wait transfer.

    ``resume`` is a QUERY param (multipart bodies can't carry JSON): when
    true (default) an interrupted copy of the same file continues from
    where it stopped; ``false`` wipes it and starts at packet 1.
    ``source``/``dest`` pick topology nodes when the topology flag is on
    (ignored otherwise; defaults l1 -> hub).
    """
    upload_path, base, size = save_upload(file)

    result = manager.start_transfer(upload_path, base, resume=resume,
                                    source=source, dest=dest)
    if not result["ok"]:
        try:
            os.remove(upload_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail=result["error"])
    return {"ok": True, "message": result["message"], "file_name": base,
            "file_size": size, "resume": resume}


@router.post("/transfer/cancel", response_model=ApiResponse)
def transfer_cancel():
    result = manager.cancel_transfer()
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/transfer/status")
def transfer_status():
    return manager.status_snapshot()


@router.get("/transfer/packets")
def transfer_packets(limit: int = 150):
    limit = max(1, min(limit, 500))
    return {"packets": manager.packet_log(limit),
            "feed": manager.recent_feed(500)}
