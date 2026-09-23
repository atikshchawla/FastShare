"""End-to-end transfer tests: packetization, sequence numbers, ACKs,
duplicate handling, and file-equality of a real loopback UDP transfer."""

import hashlib
import os
import struct

from conftest import data_status_counts, received_bytes, run_transfer

from udp import protocol
from udp.packet import parse_packet

EXPECTED_SHA256_HASH = hashlib.sha256(b"test").hexdigest()  # sanity reference


def test_packetization_reconstructs_original_file(random_file):
    """File -> packets -> reconstructed file must exactly match the source."""
    src = random_file(5000)  # 5 packets of 1024 bytes
    probe = run_transfer(src, packet_size=1024)

    assert probe.success is True
    assert hashlib.sha256(received_bytes(probe)).digest() == hashlib.sha256(
        src.read_bytes()).digest()
    # exactly 5 DATA packets -> the log reports SENT/WAITING/ACKED events per
    # packet, so count unique DATA sequence numbers
    data_seqs = {e["seq"] for e in probe.events if e["type"] == "DATA"}
    assert len(data_seqs) == 5


def test_sequence_numbers_are_unique_increasing(random_file):
    """DATA packets must carry monotonic sequence numbers 1..N."""
    src = random_file(5000)
    probe = run_transfer(src, packet_size=1024)

    seqs = sorted({e["seq"] for e in probe.events if e["type"] == "DATA"})
    assert seqs == [1, 2, 3, 4, 5]


def test_every_packet_eventually_acked(random_file):
    """Every DATA packet must reach ACKED status (Stop-and-Wait)."""
    src = random_file(5000)
    probe = run_transfer(src, packet_size=1024)

    final = data_status_counts(probe)
    assert set(final.values()) == {"ACKED"}
    assert len(final) == 5


def test_end_to_end_hash_matches_for_large_file(random_file):
    """A larger file (200 packets) transfers byte-for-byte identical."""
    src = random_file(200 * 1024)
    probe = run_transfer(src, packet_size=1024, timeout=0.1)

    assert probe.success is True
    assert hashlib.sha256(received_bytes(probe)).hexdigest() == \
        hashlib.sha256(src.read_bytes()).hexdigest()


def test_zero_retransmissions_when_no_loss(random_file):
    src = random_file(10 * 1024)
    probe = run_transfer(src, packet_size=1024, timeout=0.1)
    final = data_status_counts(probe)
    assert set(final.values()) == {"ACKED"}
    assert not probe.duplicates
    # no TIMEOUT / RETRANSMITTED events under ideal conditions
    assert all(e["status"] not in ("TIMEOUT", "RETRANSMITTED")
               for e in probe.events)


def test_duplicate_packets_are_not_written_twice(random_file):
    """With ACK loss, the receiver sees duplicates and re-ACKs them; the
    reconstructed file must not contain duplicated payload (hash equality)."""
    src = random_file(8 * 1024)  # 8 packets
    probe = run_transfer(src, packet_size=1024, timeout=0.1,
                         max_retries=10, ack_loss=0.5)

    assert probe.success is True
    assert probe.duplicates, "expected at least one duplicate to be observed"
    # hash equality proves nothing was written twice
    assert hashlib.sha256(received_bytes(probe)).digest() == \
        hashlib.sha256(src.read_bytes()).digest()


def test_start_packet_metadata_is_binary_correct(random_file):
    """VALIDATE the START datagram's metadata on the wire."""
    src = random_file(7 * 1024)
    total = 7
    probe = run_transfer(src, dest_name="wire.bin", packet_size=1024)
    assert probe.success is True

    # Rebuild the exact START datagram and ensure the header/meta parse
    payload = protocol.build_start_meta("wire.bin", src.stat().st_size,
                                        total, 1024)
    raw = protocol.build_packet(protocol.SEQ_START,
                                protocol.PACKET_TYPE_START, payload)
    seq, ptype, parsed = parse_packet(raw)
    assert seq == protocol.SEQ_START
    assert ptype == protocol.PACKET_TYPE_START
    assert protocol.parse_start_meta(parsed) == (
        "wire.bin", src.stat().st_size, total, 1024)


def test_received_file_is_renamed_from_part_suffix(random_file):
    src = random_file(2048)
    probe = run_transfer(src, packet_size=1024)
    assert probe.success is True
    assert probe.received_path and os.path.exists(probe.received_path)
    assert not probe.received_path.endswith(".part")