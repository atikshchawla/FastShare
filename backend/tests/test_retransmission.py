"""Retransmission tests: packet-loss simulation and the retry limit."""

import hashlib

from conftest import received_bytes, run_transfer


def _sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def test_loss_causes_timeout_and_retransmission(random_file):
    """10% sender->receiver loss must trigger TIMEOUT + RETRANSMITTED events
    and the transfer must still succeed byte-for-byte."""
    src = random_file(40 * 1024)  # 40 packets gives plenty of loss chances
    probe = run_transfer(src, packet_size=1024, timeout=0.1,
                         max_retries=8, loss=0.10)

    assert probe.success is True
    statuses = {e["status"] for e in probe.events}
    assert "TIMEOUT" in statuses
    assert "RETRANSMITTED" in statuses
    assert any(" lost -> timeout " in m for m in probe.messages)
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())


def test_moderate_loss_recovers_without_failure(random_file):
    src = random_file(20 * 1024)
    probe = run_transfer(src, packet_size=1024, timeout=0.15,
                         max_retries=8, loss=0.3)

    assert probe.success is True
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())
    retransmitted = [e for e in probe.events if e["status"] == "RETRANSMITTED"]
    assert len(retransmitted) > 0


def test_high_loss_eventually_succeeds_with_enough_retries(random_file):
    """50% loss is survivable with a generous retry budget."""
    src = random_file(10 * 1024)
    probe = run_transfer(src, packet_size=1024, timeout=0.1,
                         max_retries=15, loss=0.5)

    assert probe.success is True
    assert _sha256(received_bytes(probe)) == _sha256(src.read_bytes())


def test_retry_limit_exceeded_marks_failed_packet(random_file):
    """100% loss means the START handshake can never complete, so the
    client must give up cleanly instead of hanging."""
    src = random_file(10 * 1024)
    probe = run_transfer(src, packet_size=1024, timeout=0.05,
                         max_retries=2, loss=1.0)

    assert probe.success is False
    failed = [e for e in probe.events if e["status"] == "FAILED"]
    assert failed, "a FAILED packet event must be emitted"


def test_partial_loss_does_not_produce_missing_bytes(random_file):
    """Even with loss, the final byte count must equal the source's size."""
    src = random_file(33 * 1024)
    probe = run_transfer(src, packet_size=1024, timeout=0.1,
                         max_retries=10, loss=0.2)

    assert probe.success is True
    assert len(received_bytes(probe)) == src.stat().st_size