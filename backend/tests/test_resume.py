"""Resume of interrupted transfers (roadmap feature #3).

Every Start writes into `<final>.part` plus a `<final>.part.meta` sidecar, so
a transfer that dies halfway -- client cancelled, receiver stopped, process
killed -- can continue from the first missing packet instead of re-sending
everything. The sidecar is plain JSON on disk, so it also survives a full
receiver restart (a brand-new server process reads it back).
"""

import hashlib
import json
import os
import threading
import time

import pytest

from transfer.manager import manager
from udp import protocol

from conftest import received_bytes, run_transfer

PS = 1024  # packet size used throughout these tests


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parts(directory):
    return [f for f in os.listdir(directory) if f.endswith(".part")]


# ---------------------------------------------------------------- integration
def test_cancel_then_resume_completes_file(random_file, tmp_path):
    """Client cancels after 4 packets; a second run continues at packet #5."""
    src = random_file(8 * PS)
    recv = str(tmp_path / "recv")
    os.makedirs(recv)

    first = run_transfer(src, dest_name="resume.bin", packet_size=PS,
                         receive_dir=recv, cancel_after=4)
    assert first.success is False, "run 1 must stop early"
    assert "cancelled by user" in first.messages
    assert first.resumes == []

    parts = _parts(recv)
    assert len(parts) == 1, "an interrupted run leaves exactly one .part file"
    assert os.path.getsize(os.path.join(recv, parts[0])) == 4 * PS, \
        "the receiver must hold exactly the 4 acknowledged packets"

    # A brand-new server instance on the same directory: the partial lives
    # on disk, not in server memory -> restart survival is covered here.
    second = run_transfer(src, dest_name="resume.bin", packet_size=PS,
                          receive_dir=recv, resume=True)
    assert second.success is True
    assert any("Server listening" in m for m in second.messages), \
        "run 2 must start a fresh receiver"
    assert second.resumes == [(4, 4 * PS)], \
        "the sender must be told to continue at packet #5"
    assert any("RESUME" in m for m in second.messages)

    sent = [e["seq"] for e in second.events if e["type"] == "DATA"]
    assert min(sent) == 5, "packets 1-4 must NOT be re-sent"
    assert _sha(received_bytes(second)) == _sha(src.read_bytes())
    assert not _parts(recv), "completed transfer leaves no .part behind"


def test_resume_disabled_starts_from_scratch(random_file, tmp_path):
    """resume=False wipes the leftover partial and re-sends everything."""
    src = random_file(6 * PS)
    recv = str(tmp_path / "recv")
    os.makedirs(recv)

    first = run_transfer(src, dest_name="fresh.bin", packet_size=PS,
                         receive_dir=recv, cancel_after=2)
    assert first.success is False
    assert _parts(recv), "precondition: a partial file exists"

    second = run_transfer(src, dest_name="fresh.bin", packet_size=PS,
                          receive_dir=recv, resume=False)
    assert second.success is True
    assert second.resumes == [], "resume was disabled: no resume report"
    sent = [e["seq"] for e in second.events if e["type"] == "DATA"]
    assert min(sent) == 1, "transfer must restart from packet #1"
    assert _sha(received_bytes(second)) == _sha(src.read_bytes())
    # the stale partial was discarded at handshake; only the finished file
    # remains after finalize renamed it away
    assert not _parts(recv)


def test_resume_with_complete_partial_skips_all_data(random_file, tmp_path):
    """Receiver already has every byte -> sender only re-sends END."""
    src = random_file(4 * PS)
    recv = str(tmp_path / "recv")
    os.makedirs(recv)
    size = 4 * PS
    final = os.path.join(recv, "done.bin")

    with open(final + ".part", "wb") as fh:
        fh.write(src.read_bytes())
    with open(final + ".part.meta", "w", encoding="utf-8") as fh:
        json.dump({"name": "done.bin", "size": size, "packet_size": PS,
                   "total_packets": 4, "final_path": final}, fh)

    probe = run_transfer(src, dest_name="done.bin", packet_size=PS,
                         receive_dir=recv)
    assert probe.success is True
    assert probe.resumes == [(4, size)]
    assert [e for e in probe.events if e["type"] == "DATA"] == [], \
        "nothing was left to send"
    assert _sha(received_bytes(probe)) == _sha(src.read_bytes())
    assert not os.path.exists(final + ".part")
    assert not os.path.exists(final + ".part.meta"), \
        "finalize must clean up the sidecar"


# ------------------------------------------------------------------- manager
@pytest.fixture
def resume_env(tmp_path, monkeypatch):
    """Manager with a temp receive dir + dedicated port; restores state."""
    monkeypatch.setattr(manager, "_received_dir",
                        staticmethod(lambda: str(tmp_path)))
    old_config = dict(manager.config)
    manager.config["udp_port"] = 55019
    manager.config["max_retries"] = 7
    yield tmp_path
    manager.stop_server()
    if manager.transfer_status == "transferring":
        manager.cancel_transfer()
        time.sleep(0.3)
    manager.config.clear()
    manager.config.update(old_config)


def _wait_not_transferring(timeout=30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if manager.transfer_status != "transferring":
            return manager.transfer_status
        time.sleep(0.02)
    return manager.transfer_status


def test_manager_cancel_then_resume_reports_stats(resume_env, monkeypatch):
    """End-to-end through the controller: cancel at packet #4, resume, and
    verify the snapshot honestly reports where the session started."""
    assert manager.start_server()["ok"] is True
    src = resume_env / "mgr_src.bin"
    src.write_bytes(os.urandom(32 * PS))

    orig_emit = manager.emit_packet
    state = {"acked": 0}

    def emit(entry):
        orig_emit(entry)
        if entry.get("type") == "DATA" and entry.get("status") == "ACKED":
            state["acked"] += 1
            if state["acked"] == 4:
                # Own thread: cancel must not run while emit_packet holds the
                # manager lock (lock-ordering hazard with the server thread).
                threading.Thread(target=manager.cancel_transfer,
                                 daemon=True).start()

    monkeypatch.setattr(manager, "emit_packet", emit)

    assert manager.start_transfer(str(src), "mgr_src.bin",
                                  resume=True)["ok"] is True
    assert _wait_not_transferring() == "cancelled"

    parts = _parts(str(resume_env))
    assert len(parts) == 1, "cancel keeps the partial file for resume"

    ck = manager.resume_check("mgr_src.bin", 32 * PS)
    assert ck["available"] is True
    assert 4 <= ck["resumed_seq"] <= 10, "resume point is past packet #4"
    assert ck["received_bytes"] == ck["resumed_seq"] * PS
    assert ck["total_packets"] == 32

    assert manager.start_transfer(str(src), "mgr_src.bin",
                                  resume=True)["ok"] is True
    assert _wait_not_transferring() == "completed"

    snap = manager.status_snapshot()
    assert snap["resumed_from_seq"] == ck["resumed_seq"]
    assert snap["resumed_bytes"] == ck["received_bytes"]
    assert snap["packets_acked"] == snap["total_packets"] == 32
    # goodput counts only bytes moved THIS session, not the reused prefix
    assert snap["goodput_kbps"] > 0

    with open(snap["received_path"], "rb") as fh:
        assert _sha(fh.read()) == _sha(src.read_bytes())
    assert not _parts(str(resume_env))


def test_resume_check_and_discard(resume_env):
    """Sidecar inspection + 'start over' without running any transfer."""
    size = 3 * PS
    name = "partial file.bin"
    safe = protocol.safe_filename(name)
    part = os.path.join(str(resume_env), "run_" + safe + ".part")
    with open(part, "wb") as fh:
        fh.write(b"\x00" * (2 * PS + 100))   # torn tail: 2 whole + 100 bytes
    with open(part + ".meta", "w", encoding="utf-8") as fh:
        json.dump({"name": safe, "size": size,
                   "packet_size": manager.config["packet_size"],
                   "total_packets": 3, "final_path": part[:-5]}, fh)

    ck = manager.resume_check(name, size)
    assert ck["available"] is True
    assert ck["resumed_seq"] == 2, "torn tail is not counted as a packet"
    assert ck["received_bytes"] == 2 * PS
    assert ck["percent"] == pytest.approx(66.7, abs=0.1)

    # different size -> not the same file
    assert manager.resume_check(name, size + 1)["available"] is False

    result = manager.resume_discard(name, size)
    assert result["ok"] is True
    assert not os.path.exists(part)
    assert not os.path.exists(part + ".meta")
    assert manager.resume_check(name, size)["available"] is False
    assert manager.resume_discard(name, size)["ok"] is False
