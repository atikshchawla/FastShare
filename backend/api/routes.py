"""HTTP API endpoints that the Next.js dashboard talks to.

The frontend NEVER implements UDP: it asks this controller to start/stop
the server and the client, and reads state snapshots back over HTTP.
"""

import os
import tempfile
import threading
import time

from fastapi import APIRouter, File, HTTPException, UploadFile
from urllib.parse import unquote

from transfer.manager import manager
from udp import protocol
from api.models import ApiResponse, ServerConfig, TestingConfig

router = APIRouter(prefix="/api", tags=["controller"])


def _uploads_dir():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(root, "..", "transfers", "uploads")
    os.makedirs(d, exist_ok=True)
    return os.path.abspath(d)


# ------------------------------------------------------------------ status
@router.get("/status")
def get_status():
    s = manager.status_snapshot()
    s["protocol"] = {
        "transport": "UDP",
        "reliability": "Stop-and-Wait ARQ",
        "packet_size": manager.config["packet_size"],
        "sequence_numbers": "Enabled",
        "acknowledgements": "Enabled",
        "retransmission": "Enabled",
"checksum": "Enabled (CRC-32)",
        "resume": "Enabled (sidecar .meta)",
    }
    return s


# ------------------------------------------------------------------ server
@router.post("/server/start", response_model=ApiResponse)
def server_start():
    result = manager.start_server()
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/server/stop", response_model=ApiResponse)
def server_stop():
    return manager.stop_server()


@router.post("/server/config")
def server_config(cfg: ServerConfig):
    """Update controller settings. Restarting the server applies port etc."""
    manager.config.update({
        "server_ip": cfg.server_ip,
        "udp_port": cfg.udp_port,
        "packet_size": cfg.packet_size,
        "timeout_ms": cfg.timeout_ms,
        "window_size": cfg.window_size,
        "max_retries": cfg.max_retries,
    })
    return {"ok": True, "message": "configuration updated",
            "config": manager.config}


# ------------------------------------------------------------------ transfer
@router.post("/transfer/start")
def transfer_start(file: UploadFile = File(...),
                   dest_filename: str | None = None,
                   resume: bool = True):
    """Upload a file, then launch the UDP Stop-and-Wait transfer.

    ``resume`` is a QUERY param (multipart bodies can't carry JSON): when
    true (default) an interrupted copy of the same file continues from
    where it stopped; ``false`` wipes it and starts at packet 1.
    """
    name = unquote(file.filename or "")
    base = protocol.safe_filename(name)
    dest = protocol.safe_filename(dest_filename or base or "transfer.bin")

    run_id = time.strftime("%H%M%S") + str(threading.get_ident())[-3:]
    upload_path = os.path.join(_uploads_dir(), f"{run_id}_{base}")
    size = 0
    with open(upload_path, "wb") as out:
        while True:
            chunk = file.file.read(65536)
            if not chunk:
                break
            size += len(chunk)
            out.write(chunk)

    if size == 0:
        os.remove(upload_path)
        raise HTTPException(status_code=400, detail="selected file is empty")

    result = manager.start_transfer(upload_path, base, resume=resume)
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


# ------------------------------------------------------------------ resume
@router.get("/resume/check")
def resume_check(name: str, size: int):
    """Does an interrupted copy of this exact file exist on the receiver?"""
    return manager.resume_check(unquote(name), size)


@router.post("/resume/discard", response_model=ApiResponse)
def resume_discard(name: str, size: int):
    """Delete the pending partial so the next transfer starts fresh."""
    result = manager.resume_discard(unquote(name), size)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ------------------------------------------------------------------ testing
@router.post("/testing/config", response_model=ApiResponse)
def testing_config(cfg: TestingConfig):
    return manager.apply_testing_config(
        cfg.loss_enabled, cfg.loss_probability,
        cfg.corrupt_enabled, cfg.corrupt_probability)