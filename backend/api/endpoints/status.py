"""GET /status -- the full state snapshot the dashboard polls."""

from fastapi import APIRouter

from transfer.manager import manager

router = APIRouter()


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
