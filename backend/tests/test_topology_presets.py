"""Preset switching + multi-lane routing (multipath Phase 2).

Covers the pure graph layer (``all_paths``), the preset registry and
``set_preset``, the new snapshot fields (``preset``/``presets``/``paths``),
the ``POST /api/topology/preset`` endpoint, and a real byte-identical
transfer over the tri-path preset where all three lanes are configured
but the client still drives lane A (Phase 3 adds source-side spreading).
"""

import os
import sys
import time

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient  # noqa: E402

import main as main_mod  # noqa: E402
from transfer.manager import manager  # noqa: E402
from transfer.topology.graph import (  # noqa: E402
    PRESET_EXTENDED_STAR, PRESET_TRI_PATH, all_paths,
)


@pytest.fixture(scope="module")
def client():
    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture
def restored_preset():
    """Yield the topology manager from a normalized state (star preset,
    default picks, receiver stopped) and restore that state afterwards."""
    old_testing = dict(manager.testing)
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    if manager.server_status == "running":
        manager.stop_server()
    if manager.topology.preset_name != "star":
        manager.topology.set_preset("star")
    manager.topology.source_id = "l1"
    manager.topology.dest_id = "hub"
    yield manager.topology
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    if manager.server_status == "running":
        manager.stop_server()
    manager.config["topology_enabled"] = False
    manager.config["topology_latency_ms"] = 10
    manager.apply_testing_config(
        old_testing["loss_enabled"], old_testing["loss_probability"],
        old_testing.get("corrupt_enabled", False),
        old_testing.get("corrupt_probability", 0.0))
    if manager.topology.preset_name != "star":
        manager.topology.set_preset("star")
    manager.topology.source_id = "l1"
    manager.topology.dest_id = "hub"


@pytest.fixture
def tri_env(restored_preset, tmp_path, monkeypatch):
    """Tri-path preset + topology on (fast links) + temp receive dir."""
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    assert restored_preset.set_preset("tri")["ok"] is True
    manager.config["topology_enabled"] = True
    manager.config["topology_latency_ms"] = 2
    manager.apply_testing_config(False, 0.1, False, 0.1)
    (tmp_path / "src").mkdir()
    yield tmp_path


def _wait_finished(timeout=60.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if manager.transfer_status != "transferring":
            return manager.transfer_status
        time.sleep(0.05)
    return manager.transfer_status


# ------------------------------------------------------------- graph layer


def test_all_paths_star_yields_the_single_bfs_lane():
    assert all_paths(PRESET_EXTENDED_STAR, "l1", "l3") == [
        ["l1", "ch1", "hub", "ch2", "l3"]]
    assert all_paths(PRESET_EXTENDED_STAR, "l1", "ch1") == [["l1", "ch1"]]
    assert all_paths(PRESET_EXTENDED_STAR, "l1", "l1") == []
    with pytest.raises(KeyError):
        all_paths(PRESET_EXTENDED_STAR, "nope", "l3")


def test_all_paths_tri_yields_three_node_disjoint_lanes():
    paths = all_paths(PRESET_TRI_PATH, "src", "dst")
    assert len(paths) == 3
    assert all(len(p) == 4 for p in paths)
    assert paths[0][1].startswith("a")     # deterministic A, B, C order
    assert paths[1][1].startswith("b")
    assert paths[2][1].startswith("c")
    interiors = [{n for n in p[1:-1]} for p in paths]
    for i in range(3):
        for j in range(i + 1, 3):
            assert not interiors[i] & interiors[j], "lanes must be disjoint"
    # lane metadata for the UI/client
    assert paths[0] == ["src", "a1", "a2", "dst"]
    assert paths[2] == ["src", "c1", "c2", "dst"]


# ------------------------------------------------------------ preset state


def test_default_preset_is_tri_path():
    """A fresh controller boots on the tri-path preset (the flagship
    topology); the extended star stays one ``set_preset`` away."""
    from transfer.topology.manager import (  # noqa: E402
        DEFAULT_DEST, DEFAULT_SOURCE, TopologyManager,
    )

    class StubTM:
        config = {"topology_isolated": False}
        transfer_status = "idle"

    fresh = TopologyManager(StubTM())
    try:
        assert fresh.preset_name == "tri"
        assert fresh.source_id == "src" and fresh.dest_id == "dst"
        assert (DEFAULT_SOURCE, DEFAULT_DEST) == ("src", "dst")
        assert len(fresh.topology.nodes) == 8
        assert sorted(n.port for n in fresh.topology.nodes) == \
            list(range(6201, 6209))
        # the catalog still offers both graphs, star first
        assert [p["id"] for p in fresh.preset_catalog()] == ["star", "tri"]
    finally:
        fresh.stop_all()


def test_set_preset_switches_graph_defaults_and_handles(restored_preset):
    star_nodes = [n.id for n in restored_preset.topology.nodes]
    old_handles = dict(restored_preset._forwarders)

    result = restored_preset.set_preset("tri")
    assert result["ok"] is True
    assert restored_preset.preset_name == "tri"
    assert [n.id for n in restored_preset.topology.nodes] == [
        "src", "a1", "a2", "b1", "b2", "c1", "c2", "dst"]
    assert sorted(n.port for n in restored_preset.topology.nodes) == \
        list(range(6201, 6209))
    assert restored_preset.source_id == "src"
    assert restored_preset.dest_id == "dst"
    assert restored_preset.route is None
    # handles were rebuilt for the new graph (old ones discarded)
    assert set(restored_preset._forwarders) == {
        "src", "a1", "a2", "b1", "b2", "c1", "c2", "dst"}
    assert set(old_handles) == set(star_nodes)

    with pytest.raises(KeyError, match="unknown topology preset"):
        restored_preset.set_preset("nope")

    restored_preset.set_preset("star")
    assert restored_preset.preset_name == "star"
    assert restored_preset.source_id == "l1"
    assert restored_preset.dest_id == "hub"


def test_set_preset_refused_while_transfer_runs(restored_preset):
    old_status = manager.transfer_status
    manager.transfer_status = "transferring"
    try:
        with pytest.raises(ValueError, match="transfer is running"):
            restored_preset.set_preset("tri")
    finally:
        manager.transfer_status = old_status
    assert restored_preset.preset_name == "star"     # nothing changed


def test_preset_switch_stops_previous_handles(restored_preset):
    assert restored_preset.start_all() == []
    old = restored_preset._forwarders["hub"]
    assert old.running is True

    restored_preset.set_preset("tri")
    assert old.running is False                       # stopped, not leaked
    assert "hub" not in restored_preset._forwarders
    restored_preset.set_preset("star")


# ---------------------------------------------------------------- snapshot


def test_snapshot_exposes_preset_catalog_and_paths(client, restored_preset):
    snap = client.get("/api/topology").json()
    assert snap["preset"] == "star"
    assert [p["id"] for p in snap["presets"]] == ["star", "tri"]
    assert all({"id", "label", "source", "dest"} <= set(p)
               for p in snap["presets"])
    assert snap["paths"] == [["l1", "ch1", "hub"]]

    restored_preset.set_preset("tri")
    snap = client.get("/api/topology").json()
    assert snap["preset"] == "tri"
    assert len(snap["paths"]) == 3
    assert all(p[0] == "src" and p[-1] == "dst" for p in snap["paths"])
    assert {n["id"] for n in snap["nodes"]} == {
        "src", "a1", "a2", "b1", "b2", "c1", "c2", "dst"}
    assert {n["role"] for n in snap["nodes"]} == {"source", "router", "dest"}

    restored_preset.set_preset("star")


def test_preset_endpoint_switches_and_validates(client, restored_preset):
    resp = client.post("/api/topology/preset", json={"name": "tri"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "preset": "tri", "source": "src",
                           "dest": "dst",
                           "nodes": ["src", "a1", "a2", "b1", "b2",
                                     "c1", "c2", "dst"]}
    bad = client.post("/api/topology/preset", json={"name": "nope"})
    assert bad.status_code == 400
    assert "unknown topology preset" in bad.json()["detail"]
    restored_preset.set_preset("star")


# ------------------------------------------------------------------- tri E2E


def test_tri_transfer_configures_every_lane_and_is_byte_identical(tri_env):
    assert manager.start_server()["ok"] is True
    payload = os.urandom(8 * 1024)
    src = tri_env / "src" / "tri.bin"
    src.write_bytes(payload)

    result = manager.start_transfer(str(src), "tri.bin", resume=False,
                                    source="src", dest="dst")
    assert result["ok"] is True
    assert _wait_finished() == "completed", manager.transfer_error

    # primary lane picked deterministically (A), receiver on the dst node
    assert manager.topology.route == ["src", "a1", "a2", "dst"]
    assert manager.status_snapshot()["server_port"] == 6208       # dst
    files = [p for p in tri_env.iterdir()
             if p.is_file() and not p.name.endswith(".meta")]
    assert len(files) == 1, files
    assert files[0].read_bytes() == payload

    # all three lanes were configured up front (Phase 3 spreads traffic)
    handles = manager.topology._forwarders
    for node_id in ("a1", "a2", "b1", "b2", "c1", "c2"):
        assert handles[node_id].route_addr is not None, node_id

    snap = manager.topology_snapshot()
    assert len(snap["paths"]) == 3
    # multipath is on by default: the scheduler explores every lane
    # (round-robin from the first attempt), so all three carried traffic
    stats = snap["link_stats"]
    for link_id in ("src-a1", "a1-a2", "a2-dst",
                    "src-b1", "b1-b2", "b2-dst",
                    "src-c1", "c1-c2", "c2-dst"):
        assert stats[link_id]["data_packets"] > 0, link_id
        assert stats[link_id]["ack_packets"] > 0, link_id
