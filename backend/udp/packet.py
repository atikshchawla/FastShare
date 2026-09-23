"""Packet construction/parsing helpers built on top of protocol constants.

Kept as a thin wrapper so the rest of the codebase never touches struct
layout directly -- see protocol.py for the documented wire format.
"""

from .protocol import build_packet as _build_packet
from .protocol import parse_packet as _parse_packet
from .protocol import HEADER_SIZE


class PacketTooShort(ValueError):
    pass


def build_packet(seq: int, ptype: int, payload: bytes = b"") -> bytes:
    return _build_packet(seq, ptype, payload)


def parse_packet(data: bytes):
    """-> (seq: int, ptype: int, payload: bytes). Raises PacketTooShort on bad input."""
    try:
        return _parse_packet(data)
    except ValueError as exc:
        raise PacketTooShort(str(exc)) from exc


__all__ = ["build_packet", "parse_packet", "PacketTooShort", "HEADER_SIZE"]