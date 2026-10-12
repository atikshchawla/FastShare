"""Per-PC isolation: every topology node runs in its own OS process with
its own log console (multipath Phase 1).

The suite default is in-process forwarders (conftest flips
``topology_isolated`` off); the ``isolated_nodes`` fixture opts a test into
child-process mode and always restores the default afterwards.

Covered:
* spawn + per-node log rings (spawned pid, bound port lines),
* live config push observable in the node's own log,
* ``GET /api/topology/node/{id}/logs`` (200 / 400),
* a killed child is logged, reported down, and self-heals via start_all(),
* a full loopback transfer across isolated hops stays byte-identical.
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
from transfer.topology.process_node import ProcessHandle  # noqa: E402


def _texts(node_id):
    return [entry["text"] for entry in manager.topology.node_logs(node_id)]


def _wait_for(predicate, timeout=8.0, step=0.1):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return predicate()


@pytest.fixture
def isolated_nodes():
    """Flip the controller into per-PC mode and rebuild the handles.

    Teardown stops every child, restores the full config + testing state
    (the way ``topo_env`` does) and rebuilds the in-process handles, so the
    rest of the suite never sees a stray child process.
    """
    old_config = dict(manager.config)
    old_testing = dict(manager.testing)
    if manager.server_status == "running":
        manager.stop_server()
    old_preset = manager.topology.preset_name
    if old_preset != "star":
        manager.topology.set_preset("star")   # this suite exercises the star
    manager.config["topology_isolated"] = True
    manager.topology._ensure_handles()
    yield manager.topology
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    if manager.server_status == "running":
        manager.stop_server()
    manager.topology.stop_all()
    manager.config.clear()
    manager.config.update(old_config)
    manager.config["topology_isolated"] = False
    manager.apply_testing_config(
        old_testing["loss_enabled"], old_testing["loss_probability"],
        old_testing.get("corrupt_enabled", False),
        old_testing.get("corrupt_probability", 0.0))
    if manager.topology.preset_name != old_preset:
        manager.topology.set_preset(old_preset)
    manager.topology._ensure_handles()


def test_isolated_nodes_spawn_as_processes_with_own_logs(isolated_nodes):
    failed = isolated_nodes.start_all()
    assert failed == []
    for node_id, fwd in isolated_nodes._forwarders.items():
        assert isinstance(fwd, ProcessHandle), node_id
        assert fwd.running is True, node_id

    ch1 = _texts("ch1")
    assert any("isolated node 'ch1' spawned (pid" in t for t in ch1)
    assert any("bound 127.0.0.1:6103" in t for t in ch1)
    # children self-identify in their own console
    assert any("isolated node 'ch1' up (pid" in t for t in ch1)


def test_isolated_config_change_is_observable_in_node_logs(isolated_nodes):
    assert isolated_nodes.start_all() == []
    assert _wait_for(lambda: any("bound " in t for t in _texts("ch1")))

    isolated_nodes.node_config("ch1", latency_ms=77)
    assert _wait_for(lambda: any("latency=77ms" in t for t in _texts("ch1")))
    assert isolated_nodes._forwarders["ch1"].latency_ms == 77


def test_node_logs_endpoint(isolated_nodes):
    with TestClient(main_mod.app) as client:
        missing = client.get("/api/topology/node/nope/logs")
        assert missing.status_code == 400
        assert "unknown topology node" in missing.json()["detail"]

        assert isolated_nodes.start_all() == []
        assert _wait_for(lambda: any(
            "spawned (pid" in t for t in _texts("ch1")))

        resp = client.get("/api/topology/node/ch1/logs?limit=5")
        assert resp.status_code == 200
        body = resp.json()
        assert body["node"] == "ch1"
        assert 1 <= len(body["lines"]) <= 5
        assert all({"t", "text"} <= set(entry) for entry in body["lines"])


def test_killed_child_is_logged_and_self_heals(isolated_nodes):
    assert isolated_nodes.start_all() == []
    fwd = isolated_nodes._forwarders["ch1"]
    before = len(_texts("ch1"))

    fwd._proc.kill()
    assert _wait_for(lambda: fwd.running is False, timeout=5.0)
    after = _texts("ch1")[before:]
    assert any("isolated node 'ch1' exited (code" in t for t in after)

    # the snapshot reports the node down while it is dead
    up = {n["id"]: n["up"] for n in isolated_nodes.snapshot()["nodes"]}
    assert up["ch1"] is False

    # self-heal: start_all() re-spawns the dead child on the same handle
    assert isolated_nodes.start_all() == []
    assert _wait_for(lambda: fwd.running is True, timeout=8.0)
    texts = _texts("ch1")
    assert sum("spawned (pid" in t for t in texts) >= 2
    assert len(texts) > before


def test_isolated_end_to_end_transfer_is_byte_identical(isolated_nodes,
                                                        tmp_path, monkeypatch):
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    manager.config["topology_enabled"] = True
    manager.config["topology_latency_ms"] = 2
    manager.apply_testing_config(False, 0.1, False, 0.1)   # deterministic
    (tmp_path / "src").mkdir()

    assert manager.start_server()["ok"] is True
    payload = os.urandom(8 * 1024)
    src = tmp_path / "src" / "iso.bin"
    src.write_bytes(payload)

    result = manager.start_transfer(str(src), "iso.bin", resume=False,
                                    source="l1", dest="l3")
    assert result["ok"] is True
    deadline = time.time() + 60
    while manager.transfer_status == "transferring" and time.time() < deadline:
        time.sleep(0.05)
    assert manager.transfer_status == "completed", manager.transfer_error

    assert manager.topology.route == ["l1", "ch1", "hub", "ch2", "l3"]
    files = [p for p in tmp_path.iterdir()
             if p.is_file() and not p.name.endswith(".meta")]
    assert len(files) == 1, files
    assert files[0].read_bytes() == payload

    link_stats = manager.topology_snapshot()["link_stats"]
    for link_id in ("l1-ch1", "ch1-hub", "hub-ch2", "l3-ch2"):
        assert link_stats[link_id]["data_packets"] > 0, link_id
        assert link_stats[link_id]["ack_packets"] > 0, link_id
    for link_id in ("l2-ch1", "l4-ch2"):
        assert link_stats[link_id]["data_packets"] == 0, link_id

    # the interior PCs logged real forwarding in their own consoles
    assert any(t.startswith("fwd ") for t in _texts("ch1"))
    assert any("route set:" in t for t in _texts("hub"))
