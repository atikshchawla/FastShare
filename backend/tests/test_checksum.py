"""Integration tests for checksum verification (CRC-32) over loopback UDP.

Covers the third network fault in the project: packet corruption (bit flips).
Unlike packet loss (no packet at all), a corrupted packet REACHES the
receiver -- only the CRC-32 check can catch it. The receiver drops it without
an ACK, so the sender's timeout retransmits a clean copy.
"""

import hashlib
import threading

from conftest import received_bytes, run_transfer

MSG = "CHECKSUM MISMATCH"


def _sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def test_no_checksum_errors_without_simulation(random_file):
    """A clean transfer never trips CRC validation."""
    src = random_file(8 * 1024)
    probe = run_transfer(src)
    assert probe.success is True
    assert probe.checksum_errors == []
    assert not any(MSG in m for m in probe.messages)


def test_corrupted_data_is_dropped_then_retransferred(random_file):
    """30% of inbound DATA datagrams get a bit flip -> CRC-32 drops them
    without ACK -> timeout -> retransmission -> file still byte-identical."""
    src = random_file(6 * 1024)
    probe = run_transfer(src, corrupt=0.3, max_retries=6)

    assert probe.success is True, "transfer should survive simulated corruption"
    assert probe.checksum_errors, "receiver must detect corrupted packets"
    assert any(MSG in m for m in probe.messages), \
        "a CHECKSUM MISMATCH log line must be visible"
    # retransmission path really kicked in (retries counted > 0 somewhere)
    assert any(e["retries"] > 0 for e in probe.events if e["type"] == "DATA")
    # integrity: the written file is the original, not the corrupted one
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())


def test_corrupted_acks_trigger_retransmission_and_duplicates(random_file):
    """30% of returning ACKs get a bit flip -> the CLIENT rejects them with
    CRC-32 -> it retransmits -> the receiver logs duplicates."""
    src = random_file(6 * 1024)
    probe = run_transfer(src, ack_corrupt=0.3, max_retries=6)

    assert probe.success is True
    assert probe.checksum_errors, "client must detect corrupted ACKs"
    assert any("ACK" in m and MSG in m for m in probe.messages), \
        "the client should log a corrupted ACK specifically"
    assert any(e["retries"] > 0 for e in probe.events if e["type"] == "DATA")
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())


def test_corruption_both_directions_with_loss(random_file):
    """All three simulations at once: loss + data corruption + ack corruption.
    Stop-and-Wait must still deliver the exact bytes."""
    src = random_file(10 * 1024)
    probe = run_transfer(src, loss=0.1, corrupt=0.2, ack_corrupt=0.2,
                         max_retries=7)

    assert probe.success is True
    assert probe.checksum_errors, "corruption must be caught by CRC-32"
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())


def test_corrupted_start_handshake_is_recovered(random_file):
    """Corruption also hits the START handshake; the client retries it."""
    src = random_file(2 * 1024)
    probe = run_transfer(src, corrupt=0.4, max_retries=7)
    assert probe.success is True
    assert probe.received_path is not None
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())
