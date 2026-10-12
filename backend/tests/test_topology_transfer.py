"""End-to-end topology transfers: real forwarders on loopback UDP (spec §10.3).

Drives the TransferManager exactly like the controller does: receiver parked
on preset ports 6101-6107, interior Forwarder sockets relaying with a 2 ms
simulated link delay, Stop-and-Wait unchanged end-to-end.
"""

import os
import time

import pytest

from transfer.manager import manager


@pytest.fixture
def topo_env(tmp_path, monkeypatch):
    """Temp receive dir + topology on (fast links); restores all state.

    Sources live in ``<tmp>/src`` so the receive dir only ever holds the
    files the receiver actually wrote.
    """
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    old_config = dict(manager.config)
    old_testing = dict(manager.testing)
    old_preset = manager.topology.preset_name
    if old_preset != "star":
        manager.topology.set_preset("star")   # this suite exercises the star
    manager.config["topology_enabled"] = True
    manager.config["topology_latency_ms"] = 2
    manager.apply_testing_config(False, 0.1, False, 0.1)   # deterministic runs
    (tmp_path / "src").mkdir()
    yield tmp_path
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    manager.stop_server()
    manager.config.clear()
    manager.config.update(old_config)
    manager.apply_testing_config(
        old_testing["loss_enabled"], old_testing["loss_probability"],
        old_testing.get("corrupt_enabled", False),
        old_testing.get("corrupt_probability", 0.0))
    if manager.topology.preset_name != old_preset:
        manager.topology.set_preset(old_preset)


def _wait_finished(timeout=60.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if manager.transfer_status != "transferring":
            return manager.transfer_status
        time.sleep(0.05)
    return manager.transfer_status


def _received_bytes(receive_dir):
    """The single completed file (partials are renamed away on success)."""
    files = [p for p in receive_dir.iterdir()
             if p.is_file() and not p.name.endswith(".meta")]
    assert len(files) == 1, f"expected one received file, got {files}"
    return files[0].read_bytes()


def test_transfer_across_four_hops_is_byte_identical(topo_env):
    assert manager.start_server()["ok"] is True
    payload = os.urandom(8 * 1024)
    src = topo_env / "src" / "hops.bin"
    src.write_bytes(payload)

    result = manager.start_transfer(str(src), "hops.bin", resume=False,
                                    source="l1", dest="l3")
    assert result["ok"] is True
    assert _wait_finished() == "completed", manager.transfer_error

    # route pushed end-to-end, receiver re-bound to the destination node
    assert manager.topology.route == ["l1", "ch1", "hub", "ch2", "l3"]
    assert manager.status_snapshot()["server_port"] == 6106       # l3
    assert _received_bytes(topo_env) == payload

    # every route link carried data AND acks; off-route links stayed quiet
    # (canonical link ids come from the preset: e.g. "l3-ch2", not "ch2-l3")
    link_stats = manager.topology_snapshot()["link_stats"]
    for link_id in ("l1-ch1", "ch1-hub", "hub-ch2", "l3-ch2"):
        assert link_stats[link_id]["data_packets"] > 0, link_id
        assert link_stats[link_id]["ack_packets"] > 0, link_id
    for link_id in ("l2-ch1", "l4-ch2"):
        assert link_stats[link_id]["data_packets"] == 0, link_id
        assert link_stats[link_id]["ack_packets"] == 0, link_id

    # the telemetry panel keeps working alongside (end-to-end, spec §5)
    snap = manager.status_snapshot()
    assert snap["packets_acked"] == snap["total_packets"]
    assert snap["retransmissions"] == 0
    assert snap["rtt_ms"] is not None and snap["rtt_ms"] >= 0


def test_cancel_and_resume_across_hops(topo_env):
    assert manager.start_server()["ok"] is True
    payload = os.urandom(256 * 1024)          # 256 packets -> seconds of runway
    src = topo_env / "src" / "resume_hops.bin"
    src.write_bytes(payload)

    assert manager.start_transfer(str(src), "resume_hops.bin", resume=True,
                                  source="l1", dest="l3")["ok"] is True
    # wait until a meaningful partial is on disk, then pull the plug
    deadline = time.time() + 45
    while time.time() < deadline:
        if manager.confirmed_bytes >= 48 * 1024:
            break
        if manager.transfer_status != "transferring":
            break
        time.sleep(0.02)
    assert manager.transfer_status == "transferring", \
        "transfer finished before it could be cancelled"
    assert manager.cancel_transfer()["ok"] is True
    assert _wait_finished(15) == "cancelled", manager.transfer_error
    assert list(topo_env.glob("*.part")), "cancel must leave a resumable partial"

    # second run: the handshake continues instead of restarting
    assert manager.start_transfer(str(src), "resume_hops.bin", resume=True,
                                  source="l1", dest="l3")["ok"] is True
    assert _wait_finished(60) == "completed", manager.transfer_error
    assert manager.resumed_from_seq > 0
    assert manager.resumed_bytes >= 48 * 1024
    assert _received_bytes(topo_env) == payload
    assert not list(topo_env.glob("*.part")), \
        "a completed transfer must clean up its partial"


def test_direct_route_falls_back_to_controller_counters(topo_env):
    """l1 -> ch1: client talks straight to the receiver; no forwarder is on
    duty for the single link, so its stats come from the controller (§5)."""
    assert manager.start_server()["ok"] is True
    payload = os.urandom(4 * 1024)
    src = topo_env / "src" / "direct.bin"
    src.write_bytes(payload)

    assert manager.start_transfer(str(src), "direct.bin", resume=False,
                                  source="l1", dest="ch1")["ok"] is True
    assert _wait_finished() == "completed", manager.transfer_error

    assert manager.topology.route == ["l1", "ch1"]
    assert manager.status_snapshot()["server_port"] == 6103       # ch1
    assert _received_bytes(topo_env) == payload
    stats = manager.topology_snapshot()["link_stats"]["l1-ch1"]
    assert stats["data_packets"] > 0
    assert stats["ack_packets"] > 0


def test_invalid_route_picks_are_rejected(topo_env):
    assert manager.start_server()["ok"] is True
    src = topo_env / "src" / "tiny.bin"
    src.write_bytes(b"tiny")
    status_before = manager.transfer_status
    parked_before = manager.status_snapshot()["server_port"]

    unknown = manager.start_transfer(str(src), "tiny.bin",
                                     source="nope", dest="l3")
    assert unknown["ok"] is False
    assert "unknown topology node" in unknown["error"]

    same = manager.start_transfer(str(src), "tiny.bin",
                                  source="l2", dest="l2")
    assert same["ok"] is False
    assert "differ" in same["error"]

    # a rejected pick must not disturb anything: no transfer started and
    # the receiver never moved off the port it was parked on
    assert manager.transfer_status == status_before
    assert manager.status_snapshot()["server_port"] == parked_before


def test_topology_off_keeps_single_link_behaviour(topo_env):
    """Flag off: byte-for-byte today's demo (spec §9.4)."""
    manager.config["topology_enabled"] = False
    manager.config["udp_port"] = 55019
    assert manager.start_server()["ok"] is True
    payload = os.urandom(4 * 1024)
    src = topo_env / "src" / "plain.bin"
    src.write_bytes(payload)

    # source/dest params are ignored while the flag is off
    assert manager.start_transfer(str(src), "plain.bin", resume=False,
                                  source="l1", dest="l3")["ok"] is True
    assert _wait_finished() == "completed", manager.transfer_error
    assert manager.status_snapshot()["server_port"] == 55019
    assert manager.topology.route is None
    assert _received_bytes(topo_env) == payload
