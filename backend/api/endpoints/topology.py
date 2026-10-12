"""Topology endpoints: the preset graph, active route, live per-link stats
and the per-node override patch (FEATURE_SPEC §6, plan §3).

Payload contract: FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md §6 (plus ``source``
and ``dest`` so the route pickers can re-sync after a page reload).
"""

from fastapi import APIRouter, HTTPException

from api.models import MultipathConfig, NodeConfig, TopologyPreset
from transfer.manager import manager

router = APIRouter()


@router.get("/topology")
def get_topology():
    return manager.topology_snapshot()


@router.post("/topology/preset")
def post_topology_preset(cfg: TopologyPreset):
    """Switch the active preset graph (star <-> tri-path)."""
    try:
        return manager.topology.set_preset(cfg.name)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc.args[0])) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/topology/multipath/config")
def post_multipath_config(cfg: MultipathConfig):
    """Patch the source-side PathScheduler policy (None fields untouched)."""
    patch = {key: getattr(cfg, key) for key in (
        "enabled", "window", "flag_loss", "recover_loss", "probe_share",
        "explore_per_lane", "min_samples") if getattr(cfg, key) is not None}
    try:
        config = manager.topology.multipath_config(**patch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "config": config}


@router.get("/topology/node/{node_id}/logs")
def get_node_logs(node_id: str, limit: int = 200):
    """Recent per-PC log lines (isolated node console / in-process sink)."""
    try:
        lines = manager.topology.node_logs(node_id, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc.args[0])) from exc
    return {"node": node_id, "lines": lines}


@router.post("/topology/node/config")
def post_node_config(cfg: NodeConfig):
    """Patch one node's latency / loss / corruption / enabled override."""
    try:
        eff = manager.topology.node_config(
            cfg.id,
            reset=cfg.reset,
            latency_ms=cfg.latency_ms,
            loss_enabled=cfg.loss_enabled,
            loss_probability=cfg.loss_probability,
            corrupt_enabled=cfg.corrupt_enabled,
            corrupt_probability=cfg.corrupt_probability,
            enabled=cfg.enabled,
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc.args[0])) from exc
    return {"ok": True, "id": cfg.id, "config": eff}
