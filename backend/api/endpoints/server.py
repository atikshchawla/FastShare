"""Server lifecycle endpoints: start / stop / config."""

from fastapi import APIRouter, HTTPException

from api.models import ApiResponse, ServerConfig
from transfer.manager import manager

router = APIRouter()


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
    update = {
        "server_ip": cfg.server_ip,
        "udp_port": cfg.udp_port,
        "packet_size": cfg.packet_size,
        "timeout_ms": cfg.timeout_ms,
        "window_size": cfg.window_size,
        "max_retries": cfg.max_retries,
    }
    # None = "not mentioned" -> preserve the stored topology flags
    if cfg.topology_enabled is not None:
        update["topology_enabled"] = cfg.topology_enabled
    if cfg.topology_latency_ms is not None:
        update["topology_latency_ms"] = cfg.topology_latency_ms
    manager.config.update(update)
    return {"ok": True, "message": "configuration updated",
            "config": manager.config}
