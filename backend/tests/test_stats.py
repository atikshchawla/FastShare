"""Advanced transfer statistics tests (RTT, goodput, throughput, loss, ETA).

Runs a real transfer through the TransferManager over loopback UDP and
asserts the numbers exposed by /api/status are actually being measured
(not placeholders).
"""

import os
import time

import pytest

from transfer.manager import manager


@pytest.fixture
def stats_env(tmp_path, monkeypatch):
    """Manager with a temp receive dir + dedicated port; restores state."""
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    old_config = dict(manager.config)
    old_testing = dict(manager.testing)
    manager.config["udp_port"] = 55017
    manager.config["max_retries"] = 7  # keep probabilistic tests reliable
    yield tmp_path
    manager.stop_server()
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    manager.config.clear()
    manager.config.update(old_config)
    manager.apply_testing_config(
        old_testing["loss_enabled"], old_testing["loss_probability"],
        old_testing.get("corrupt_enabled", False),
        old_testing.get("corrupt_probability", 0.0))


def _wait_finished(timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if manager.transfer_status != "transferring":
            return manager.transfer_status
        time.sleep(0.05)
    return manager.transfer_status


def test_clean_transfer_produces_real_statistics(stats_env):
    assert manager.start_server()["ok"] is True

    src = stats_env / "stats_src.bin"
    src.write_bytes(os.urandom(8 * 1024))
    assert manager.start_transfer(str(src), "stats_src.bin")["ok"] is True
    assert _wait_finished() == "completed"

    snap = manager.status_snapshot()
    # RTT: measured per DATA packet from send -> matching ACK
    assert snap["rtt_ms"] is not None and snap["rtt_ms"] >= 0
    assert snap["rtt_min_ms"] is not None and snap["rtt_max_ms"] is not None
    assert snap["rtt_min_ms"] <= snap["rtt_max_ms"]
    assert snap["srtt_ms"] is not None
    assert snap["rtt_samples"] == snap["total_packets"]
    # goodput (file bytes) vs wire throughput (headers + payload)
    assert snap["goodput_kbps"] > 0
    assert snap["throughput_kbps"] >= snap["goodput_kbps"]
    assert snap["wire_bytes"] > snap["confirmed_bytes"] > 0
    # clean run: no losses, ETA finished
    assert snap["loss_percent"] == 0.0
    assert snap["eta_seconds"] == 0.0
    assert snap["checksum_errors"] == 0


def test_lossy_transfer_reports_nonzero_loss_and_rtt(stats_env):
    assert manager.start_server()["ok"] is True
    manager.apply_testing_config(True, 0.3, False, 0.0)

    src = stats_env / "lossy_src.bin"
    src.write_bytes(os.urandom(6 * 1024))
    assert manager.start_transfer(str(src), "lossy_src.bin")["ok"] is True
    assert _wait_finished() == "completed"

    snap = manager.status_snapshot()
    assert snap["retransmissions"] > 0
    assert snap["loss_percent"] > 0
    # SRTT stays within the observed min/max envelope
    assert snap["rtt_min_ms"] <= snap["srtt_ms"] <= snap["rtt_max_ms"]
    # retried packets inflate wire bytes beyond goodput
    assert snap["wire_bytes"] > snap["confirmed_bytes"]
    manager.apply_testing_config(False, 0.1, False, 0.0)
