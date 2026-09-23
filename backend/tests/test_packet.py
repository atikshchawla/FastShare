"""Unit tests for packet serialization / deserialization (udp/packet.py)."""

import struct

import pytest

from udp import protocol
from udp.packet import PacketTooShort, build_packet, parse_packet


def test_header_size_is_nine_bytes():
    # 4 (seq) + 1 (type) + 4 (length) = 9 bytes
    assert protocol.HEADER_SIZE == 9
    assert len(build_packet(1, protocol.PACKET_TYPE_DATA, b"")) == 9


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
    name, size, total, pk = protocol.parse_start_meta(payload)
    assert name == "report.pdf"
    assert size == 123456
    assert total == 121
    assert pk == 1024


def test_start_metadata_with_unicode_and_spaces():
    payload = protocol.build_start_meta("naïve 文件.bin", 999, 1, 512)
    name, size, total, pk = protocol.parse_start_meta(payload)
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