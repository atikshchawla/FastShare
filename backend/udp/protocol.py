"""Shared protocol constants and metadata helpers for the reliable UDP file transfer.

Packet format (custom, binary -- no JSON on the wire):

    +------------------+
    | Sequence Number  |  4 bytes  (unsigned int, big endian)
    +------------------+
    | Packet Type      |  1 byte   (see PACKET_TYPE_* below)
    +------------------+
    | Payload Length   |  4 bytes  (unsigned int, big endian)
    +------------------+
    | Payload          |  variable (<= MAX_PAYLOAD_LENGTH)
    +------------------+

Checksum field is intentionally NOT included yet -- future phase.
"""

import struct

# ---------------------------------------------------------------------------
# Packet types
# ---------------------------------------------------------------------------
PACKET_TYPE_START = 0  # handshake: carries file metadata
PACKET_TYPE_DATA = 1   # one chunk of the file (has a sequence number)
PACKET_TYPE_ACK = 2    # acknowledgement of a received packet
PACKET_TYPE_END = 3    # all DATA packets sent -> finalize transfer
PACKET_TYPE_ERROR = 4  # fatal protocol error (reserved)

TYPE_NAMES = {
    PACKET_TYPE_START: "START",
    PACKET_TYPE_DATA: "DATA",
    PACKET_TYPE_ACK: "ACK",
    PACKET_TYPE_END: "END",
    PACKET_TYPE_ERROR: "ERROR",
}


def type_name(ptype: int) -> str:
    """Human readable name for a packet type byte (falls back to '?')."""
    return TYPE_NAMES.get(ptype, "?")


# ---------------------------------------------------------------------------
# Fixed layout constants
# ---------------------------------------------------------------------------
SEQ_START = 0          # sequence number of the START packet
# DATA packets use seq 1..total_packets; an empty file has zero DATA packets.
# The END packet sequence is total_packets + 1 (unique, never collides with DATA).
SEQ_END_OFFSET = 1

# Default tuning values (overridable through the API / UI)
DEFAULT_PACKET_SIZE = 1024
DEFAULT_TIMEOUT = 0.5      # seconds
DEFAULT_MAX_RETRIES = 5    # retransmission limit per packet

# Network safety: UDP payload must fit a single datagram.
MAX_PAYLOAD_LENGTH = 64512  # 65507 - 9 header - margin
MIN_PAYLOAD_LENGTH = 16

# START packet payload layout: name_len + file_size + total_packets + packet_size + raw name
START_META = struct.Struct(">I Q I I")  # 20 bytes + variable name

_HEADER = struct.Struct(">I B I")  # seq (4) + type (1) + length (4) = 9 bytes
HEADER_SIZE = _HEADER.size          # 9


def build_packet(seq: int, ptype: int, payload: bytes = b"") -> bytes:
    """Serialize a packet: 9-byte header followed by the raw payload."""
    payload = bytes(payload or b"")
    plen = len(payload)
    if plen > MAX_PAYLOAD_LENGTH:
        raise ValueError(f"payload too large: {plen} > {MAX_PAYLOAD_LENGTH}")
    return _HEADER.pack(seq, ptype, plen) + payload


def parse_packet(data: bytes):
    """Deserialize a packet back into (seq, ptype, payload)."""
    if len(data) < HEADER_SIZE:
        raise ValueError(f"packet too short: {len(data)} bytes")
    seq, ptype, plen = _HEADER.unpack_from(data, 0)
    payload = data[HEADER_SIZE:HEADER_SIZE + plen]
    if len(payload) != plen:
        raise ValueError("truncated packet payload")
    return seq, ptype, payload


def build_start_meta(filename: str, file_size: int,
                     total_packets: int, packet_size: int) -> bytes:
    """Encode the START payload that describes the incoming transfer."""
    name = filename.encode("utf-8", "replace")
    return START_META.pack(len(name), file_size, total_packets, packet_size) + name


def parse_start_meta(payload: bytes):
    """Decode START payload -> (filename, file_size, total_packets, packet_size)."""
    if len(payload) < START_META.size:
        raise ValueError("START metadata too short")
    name_len, file_size, total_packets, packet_size = START_META.unpack_from(payload, 0)
    name = payload[START_META.size:START_META.size + name_len].decode("utf-8", "replace")
    return name, file_size, total_packets, packet_size


def safe_filename(name: str) -> str:
    """Strip anything dangerous from a filename before it touches the disk."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"/\\|?*').strip(" .") or "transfer.bin"