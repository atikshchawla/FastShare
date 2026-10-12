"""Source-side multipath scheduler + client spreading (multi-path Phase 3).

Unit tests drive PathScheduler directly (deterministic, seeded); the E2E
tests run a real transfer over the tri-path preset with a crippled lane A
and assert the scheduler flags it and shifts traffic to lanes B/C while
the file stays byte-identical.
"""

import os
import random
import sys
import time

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient  # noqa: E402

import main as main_mod  # noqa: E402
from transfer.manager import manager  # noqa: E402
from udp.scheduler import PathScheduler  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture
def tri_env(tmp_path, monkeypatch):
    """Tri-path preset, topology on, temp receive dir; restores everything
    (preset, picks, node overrides, multipath policy, config, testing)."""
    old_config = dict(manager.config)
    old_testing = dict(manager.testing)
    old_multipath = dict(manager.topology.multipath)
    old_overrides = {k: dict(v)
                     for k, v in manager.topology._node_overrides.items()}
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    if manager.server_status == "running":
        manager.stop_server()
    if manager.topology.preset_name != "tri":
        manager.topology.set_preset("tri")
    manager.config["topology_enabled"] = True
    manager.config["topology_latency_ms"] = 2
    manager.apply_testing_config(False, 0.1, False, 0.1)
    (tmp_path / "src").mkdir()
    yield tmp_path
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    if manager.server_status == "running":
        manager.stop_server()
    for node_id in list(manager.topology._node_overrides):
        manager.topology.node_config(node_id, reset=True)
    manager.topology._node_overrides.clear()
    manager.topology._node_overrides.update(old_overrides)
    manager.topology.multipath.clear()
    manager.topology.multipath.update(old_multipath)
    for fwd in manager.topology._forwarders.values():
        fwd.reset_stats()      # later tests assert an idle snapshot
    manager.config.clear()
    manager.config.update(old_config)
    manager.apply_testing_config(
        old_testing["loss_enabled"], old_testing["loss_probability"],
        old_testing.get("corrupt_enabled", False),
        old_testing.get("corrupt_probability", 0.0))
    if manager.topology.preset_name != "star":
        manager.topology.set_preset("star")
    manager.topology.source_id = "l1"
    manager.topology.dest_id = "hub"


def _wait_finished(timeout=60.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if manager.transfer_status != "transferring":
            return manager.transfer_status
        time.sleep(0.05)
    return manager.transfer_status


def _received_bytes(receive_dir):
    files = [p for p in receive_dir.iterdir()
             if p.is_file() and not p.name.endswith(".meta")]
    assert len(files) == 1, f"expected one received file, got {files}"
    return files[0].read_bytes()


# ------------------------------------------------------- scheduler unit tests


def test_explore_phase_round_robins_every_lane():
    sched = PathScheduler(3, explore_per_lane=2)
    picks = [sched.pick() for _ in range(6)]
    assert picks == [0, 1, 2, 0, 1, 2]
    assert sched.state()["mode"] == "explore"


def test_round_robin_after_explore_when_nothing_is_flagged():
    sched = PathScheduler(3, explore_per_lane=1)
    picks = [sched.pick() for _ in range(6)]
    assert picks == [0, 1, 2, 0, 1, 2]
    assert sched.state()["mode"] == "round_robin"
    assert all(not lane["flagged"] for lane in sched.state()["lanes"])


def test_lossy_lane_is_flagged_and_traffic_shifts():
    random.seed(7)
    events = []
    sched = PathScheduler(3, window=10, min_samples=4, flag_loss=0.25,
                          recover_loss=0.10, probe_share=0.10,
                          explore_per_lane=1, on_event=events.append)

    # lane A keeps failing; lanes B/C are healthy
    for _ in range(12):
        sched.pick()                      # keep picks moving (not asserted)
        sched.record(0, False)
        sched.record(1, True)
        sched.record(2, True)

    state = sched.state()
    assert state["lanes"][0]["flagged"] is True
    assert state["lanes"][1]["flagged"] is False
    assert any("PATH A flagged" in e for e in events)
    # weighted: A keeps only the probe share, healthy lanes split the rest
    assert state["lanes"][0]["weight"] == pytest.approx(0.10, abs=0.001)
    assert state["lanes"][1]["weight"] + state["lanes"][2]["weight"] == \
        pytest.approx(0.90, abs=0.001)

    # distribution: over many picks A is barely used
    picks = [sched.pick() for _ in range(300)]
    assert sched.state()["mode"] == "weighted"
    assert picks.count(0) < 60           # ~10% expected (seeded)
    assert picks.count(1) > 60 and picks.count(2) > 60


def test_flagged_lane_recovers_only_below_hysteresis():
    random.seed(11)
    events = []
    sched = PathScheduler(2, window=8, min_samples=4, flag_loss=0.25,
                          recover_loss=0.10, explore_per_lane=1,
                          on_event=events.append)
    for _ in range(6):
        sched.record(0, False)
    assert sched.state()["lanes"][0]["flagged"] is True

    # one good attempt is NOT enough: window loss 7/8 = 12.5% > 10%
    sched.record(0, True)
    assert sched.state()["lanes"][0]["flagged"] is True

    # flush the window with successes -> loss 0 < 10% -> recovered
    for _ in range(8):
        sched.record(0, True)
    assert sched.state()["lanes"][0]["flagged"] is False
    assert any("PATH A recovered" in e for e in events)


def test_single_lane_and_disabled_modes():
    single = PathScheduler(1)
    assert single.pick() == 0
    assert single.record(0, True) is None
    assert single.state()["mode"] == "single"
    assert single.state()["enabled"] is False

    off = PathScheduler(3, enabled=False)
    assert [off.pick() for _ in range(5)] == [0, 0, 0, 0, 0]
    assert off.state()["mode"] == "disabled"
    assert off.state()["enabled"] is False


def test_state_reports_window_loss_and_counts():
    sched = PathScheduler(2, window=5, min_samples=2, explore_per_lane=1)
    sched.record(0, True)
    sched.record(0, False)
    lane = sched.state()["lanes"][0]
    assert lane["sent"] == 2 and lane["lost"] == 1
    assert lane["attempts"] == 2
    assert lane["window_loss"] == pytest.approx(0.5)
    assert set(lane) >= {"lane", "name", "flagged", "weight"}


# ----------------------------------------------------------------- endpoint


def test_multipath_config_endpoint_roundtrip(client):
    before = dict(manager.topology.multipath)
    try:
        resp = client.post("/api/topology/multipath/config", json={
            "window": 40, "flag_loss": 0.35, "enabled": True,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body["config"]["window"] == 40
        assert body["config"]["flag_loss"] == 0.35
        # untouched options keep their values
        assert body["config"]["probe_share"] == before["probe_share"]

        # bounds enforced by the model
        assert client.post("/api/topology/multipath/config",
                           json={"window": 2}).status_code == 422
        assert client.post("/api/topology/multipath/config",
                           json={"probe_share": 0.9}).status_code == 422
    finally:
        manager.topology.multipath.clear()
        manager.topology.multipath.update(before)


# ---------------------------------------------------------------------- E2E


def test_lossy_lane_is_flagged_and_traffic_shifts_e2e(tri_env):
    assert manager.start_server()["ok"] is True
    # cripple lane A: both of its routers drop 85% of what they forward
    for node_id in ("a1", "a2"):
        assert manager.topology.node_config(
            node_id, loss_enabled=True, loss_probability=0.85,
        )["enabled"] is True
    # snappy policy for a small test file
    manager.topology.multipath_config(
        window=10, min_samples=4, flag_loss=0.30, explore_per_lane=1,
        probe_share=0.10)

    payload = os.urandom(32 * 1024)
    src = tri_env / "src" / "shift.bin"
    src.write_bytes(payload)
    result = manager.start_transfer(str(src), "shift.bin", resume=False,
                                    source="src", dest="dst")
    assert result["ok"] is True
    assert _wait_finished() == "completed", manager.transfer_error
    assert _received_bytes(tri_env) == payload

    # the scheduler flagged lane A and spent the transfer on B/C
    state = manager.status_snapshot()["scheduler"]
    assert state is not None and state["enabled"] is True
    assert state["lanes"][0]["flagged"] is True
    assert state["lanes"][0]["weight"] <= 0.10 + 1e-6
    assert state["mode"] == "weighted"

    stats = manager.topology_snapshot()["link_stats"]
    # lane A's drop counter proves the loss happened where we put it
    assert stats["src-a1"]["dropped"] > 0
    # B/C carried the bulk; A carried almost nothing
    assert stats["src-b1"]["data_packets"] > stats["src-a1"]["data_packets"]
    assert stats["src-c1"]["data_packets"] > stats["src-a1"]["data_packets"]
    assert stats["src-b1"]["data_packets"] > 0
    assert stats["src-c1"]["data_packets"] > 0


def test_multipath_disabled_keeps_traffic_on_lane_a(tri_env):
    assert manager.start_server()["ok"] is True
    manager.topology.multipath_config(enabled=False)

    payload = os.urandom(8 * 1024)
    src = tri_env / "src" / "single_lane.bin"
    src.write_bytes(payload)
    assert manager.start_transfer(str(src), "single_lane.bin",
                                  resume=False, source="src",
                                  dest="dst")["ok"] is True
    assert _wait_finished() == "completed", manager.transfer_error
    assert _received_bytes(tri_env) == payload

    stats = manager.topology_snapshot()["link_stats"]
    assert stats["src-a1"]["data_packets"] > 0
    assert stats["src-b1"]["data_packets"] == 0
    assert stats["src-c1"]["data_packets"] == 0

    state = manager.status_snapshot()["scheduler"]
    assert state["mode"] == "disabled"
    assert state["enabled"] is False


def test_single_lane_scheduler_reported_on_star_preset(tmp_path,
                                                       monkeypatch):
    """Star has one lane: a transfer reports scheduler mode 'single'
    (no spreading) instead of None."""
    if manager.server_status == "running":
        manager.stop_server()
    if manager.topology.preset_name != "star":
        manager.topology.set_preset("star")
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    old_config = dict(manager.config)
    manager.config["topology_enabled"] = True
    manager.config["topology_latency_ms"] = 2
    try:
        assert manager.start_server()["ok"] is True
        payload = os.urandom(4 * 1024)
        src = tmp_path / "star_single.bin"
        src.write_bytes(payload)
        assert manager.start_transfer(str(src), "star_single.bin",
                                      resume=False, source="l1",
                                      dest="hub")["ok"] is True
        assert _wait_finished() == "completed", manager.transfer_error

        state = manager.status_snapshot()["scheduler"]
        assert state is not None
        assert state["mode"] == "single"
        assert len(state["lanes"]) == 1
        assert state["enabled"] is False
        assert manager.topology.route == ["l1", "ch1", "hub"]
    finally:
        if manager.server_status == "running":
            manager.stop_server()
        for fwd in manager.topology._forwarders.values():
            fwd.reset_stats()  # test_topology_api asserts an idle snapshot
        manager.config.clear()
        manager.config.update(old_config)
