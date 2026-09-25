"""Unit tests for packet serialization / deserialization (udp/packet.py)."""

import struct

import pytest

from udp import protocol
from udp.packet import (ChecksumError, PacketTooShort, build_packet,
                        parse_packet)


def test_header_size_is_thirteen_bytes():
    # 4 (seq) + 1 (type) + 4 (length) + 4 (crc32) = 13 bytes
    assert protocol.HEADER_SIZE == 13
    assert len(build_packet(1, protocol.PACKET_TYPE_DATA, b"")) == 13


def test_build_parse_roundtrip_empty_payload():
    seq, ptype, payload = parse_packet(build_packet(127, protocol.PACKET_TYPE_ACK))
    assert seq == 127
    assert ptype == protocol.PACKET_TYPE_ACK
    assert payload == b""


def test_build_parse_roundtrip_with_payload():
    payload = bytes(range(256)) * 4  # 1024 bytes
    seq, ptype, parsed = parse_packet(
        build_packet(42, protocol.PACKET_TYPE_DATA, payload))
    assert seq == 42
    assert ptype == protocol.PACKET_TYPE_DATA
    assert parsed == payload


def test_header_carries_crc32_of_payload():
    payload = b"fastshare"
    packet = build_packet(7, protocol.PACKET_TYPE_DATA, payload)
    # last 4 header bytes = big-endian CRC-32 of the payload
    stored = struct.unpack_from(">I", packet, protocol.HEADER_SIZE - 4)[0]
    assert stored == protocol.checksum(payload)
    assert protocol.checksum(b"") == 0


def test_corrupted_payload_raises_checksum_error():
    packet = bytearray(build_packet(9, protocol.PACKET_TYPE_DATA, b"hello world"))
    packet[protocol.HEADER_SIZE + 1] ^= 0x08  # flip a payload bit
    with pytest.raises(ChecksumError) as exc:
        parse_packet(bytes(packet))
    assert exc.value.seq == 9
    assert exc.value.expected != exc.value.computed


def test_corrupted_checksum_field_raises_checksum_error():
    packet = bytearray(build_packet(3, protocol.PACKET_TYPE_ACK, b""))
    packet[protocol.HEADER_SIZE - 1] ^= 0x01  # flip a checksum byte
    with pytest.raises(ChecksumError):
        parse_packet(bytes(packet))


def test_corrupt_datagram_always_triggers_checksum_error():
    packet = build_packet(1, protocol.PACKET_TYPE_DATA, b"x" * 64)
    corrupted = protocol.corrupt_datagram(packet)
    assert corrupted != packet
    with pytest.raises(ChecksumError):
        parse_packet(corrupted)
    # empty payload: corruption lands in the checksum field instead
    ack = build_packet(1, protocol.PACKET_TYPE_ACK, b"")
    bad_ack = protocol.corrupt_datagram(ack)
    with pytest.raises(ChecksumError):
        parse_packet(bad_ack)


def test_max_payload_boundary():
    big = b"x" * protocol.MAX_PAYLOAD_LENGTH
    seq, ptype, parsed = parse_packet(build_packet(0, protocol.PACKET_TYPE_START, big))
    assert parsed == big


def test_payload_too_large_raises():
    with pytest.raises(ValueError):
        build_packet(0, protocol.PACKET_TYPE_DATA, b"x" * (protocol.MAX_PAYLOAD_LENGTH + 1))


def test_truncated_packet_raises():
    data = build_packet(1, protocol.PACKET_TYPE_DATA, b"hello")
    with pytest.raises(PacketTooShort):
        parse_packet(data[:5])


def test_start_metadata_roundtrip():
    payload = protocol.build_start_meta("report.pdf", 123456, 121, 1024)
    name, size, total, pk, resume = protocol.parse_start_meta(payload)
    assert name == "report.pdf"
    assert size == 123456
    assert total == 121
    assert pk == 1024
    assert resume is True


def test_start_metadata_resume_flag_roundtrip():
    payload = protocol.build_start_meta("a.bin", 10, 1, 512, resume=False)
    assert protocol.parse_start_meta(payload)[4] is False


def test_resume_metadata_roundtrip():
    payload = protocol.build_resume_meta(7, 7168)
    assert protocol.parse_resume_meta(payload) == (7, 7168)
    with pytest.raises(ValueError):
        protocol.parse_resume_meta(b"\x00")


def test_start_metadata_with_unicode_and_spaces():
    payload = protocol.build_start_meta("naïve 文件.bin", 999, 1, 512)
    name, size, total, pk, resume = protocol.parse_start_meta(payload)
    assert name == "naïve 文件.bin"


def test_safe_filename_strips_paths():
    assert protocol.safe_filename("../../etc/passwd") == "passwd"
    assert protocol.safe_filename("C:\\Windows\\evil.exe") == "evil.exe"
    # forbidden filename characters are removed, the rest survives
    assert protocol.safe_filename('bad<>:"|?*.txt') == "bad.txt"


def test_type_names():
    assert protocol.type_name(protocol.PACKET_TYPE_DATA) == "DATA"
    assert protocol.type_name(protocol.PACKET_TYPE_ACK) == "ACK"
    assert protocol.type_name(99) == "?"