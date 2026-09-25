"""Shared protocol constants and metadata helpers for the reliable UDP file transfer.

Packet format (custom, binary -- no JSON on the wire):

    +------------------+
    | Sequence Number  |  4 bytes  (unsigned int, big endian)
    +------------------+
    | Packet Type      |  1 byte   (see PACKET_TYPE_* below)
    +------------------+
    | Payload Length   |  4 bytes  (unsigned int, big endian)
    +------------------+
    | Checksum (CRC32) |  4 bytes  (zlib.crc32 of the payload)
    +------------------+
    | Payload          |  variable (<= MAX_PAYLOAD_LENGTH)
    +------------------+

The receiver recomputes CRC-32 over the payload; if it does not match the
header the packet is dropped WITHOUT an ACK, so the sender's timeout logic
retransmits it (data integrity via retransmission).
"""

import random
import struct
import zlib

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
MAX_PAYLOAD_LENGTH = 64512  # 65507 - 13 header - margin
MIN_PAYLOAD_LENGTH = 16

# START packet payload layout: name_len + file_size + total_packets + packet_size
# + resume_flag (1 = sender is willing to resume) + raw name
START_META = struct.Struct(">I Q I I B")  # 21 bytes + variable name

# Resume-ACK payload: which sequence the receiver already has + bytes on disk.
# Sent as the payload of the START ACK when (and only when) resuming.
RESUME_META = struct.Struct(">I Q")  # resumed_seq + received_bytes

_HEADER = struct.Struct(">I B I I")  # seq (4) + type (1) + length (4) + crc32 (4)
HEADER_SIZE = _HEADER.size          # 13


class ChecksumError(Exception):
    """Raised when the CRC-32 in the header does not match the payload.

    Carries enough context for a useful log line on either side of the wire.
    """

    def __init__(self, seq, ptype, expected, computed):
        self.seq = seq
        self.ptype = ptype
        self.expected = expected
        self.computed = computed
        super().__init__(
            f"checksum mismatch on seq {seq}: header={expected} computed={computed}")


def checksum(payload: bytes) -> int:
    """CRC-32 of the payload (0 for empty payloads)."""
    return zlib.crc32(payload) & 0xFFFFFFFF


def build_packet(seq: int, ptype: int, payload: bytes = b"",
                 crc: int | None = None) -> bytes:
    """Serialize a packet: 13-byte header followed by the raw payload."""
    payload = bytes(payload or b"")
    plen = len(payload)
    if plen > MAX_PAYLOAD_LENGTH:
        raise ValueError(f"payload too large: {plen} > {MAX_PAYLOAD_LENGTH}")
    if crc is None:
        crc = checksum(payload)
    return _HEADER.pack(seq, ptype, plen, crc) + payload


def parse_packet(data: bytes):
    """Deserialize a packet back into (seq, ptype, payload).

    Raises ChecksumError when the payload fails CRC-32 validation and
    ValueError for structurally malformed packets.
    """
    if len(data) < HEADER_SIZE:
        raise ValueError(f"packet too short: {len(data)} bytes")
    seq, ptype, plen, crc = _HEADER.unpack_from(data, 0)
    payload = data[HEADER_SIZE:HEADER_SIZE + plen]
    if len(payload) != plen:
        raise ValueError("truncated packet payload")
    computed = checksum(payload)
    if computed != crc:
        raise ChecksumError(seq, ptype, crc, computed)
    return seq, ptype, payload


def corrupt_datagram(data: bytes) -> bytes:
    """Simulate a bit flip on the wire (testing only).

    Flips one random bit inside the payload when there is one, otherwise
    inside the checksum field -- both cases are caught by CRC-32 validation
    and produce a visible CHECKSUM MISMATCH drop.
    """
    if not data:
        return data
    if len(data) > HEADER_SIZE:
        pos = HEADER_SIZE + random.randrange(len(data) - HEADER_SIZE)
    else:
        pos = HEADER_SIZE - 1 - random.randrange(4)  # a checksum byte
    buf = bytearray(data)
    buf[pos] ^= 1 << random.randrange(8)
    return bytes(buf)


def build_start_meta(filename: str, file_size: int,
                     total_packets: int, packet_size: int,
                     resume: bool = True) -> bytes:
    """Encode the START payload that describes the incoming transfer."""
    name = filename.encode("utf-8", "replace")
    return (START_META.pack(len(name), file_size, total_packets,
                            packet_size, 1 if resume else 0) + name)


def parse_start_meta(payload: bytes):
    """Decode START payload -> (filename, file_size, total_packets,
    packet_size, resume_requested)."""
    if len(payload) < START_META.size:
        raise ValueError("START metadata too short")
    name_len, file_size, total_packets, packet_size, resume = \
        START_META.unpack_from(payload, 0)
    name = payload[START_META.size:START_META.size + name_len].decode(
        "utf-8", "replace")
    return name, file_size, total_packets, packet_size, bool(resume)


def build_resume_meta(resumed_seq: int, received_bytes: int) -> bytes:
    """Encode the START-ACK payload telling the sender where to continue."""
    return RESUME_META.pack(resumed_seq, received_bytes)


def parse_resume_meta(payload: bytes):
    """Decode a resume START-ACK payload -> (resumed_seq, received_bytes)."""
    if len(payload) < RESUME_META.size:
        raise ValueError("resume metadata too short")
    resumed_seq, received_bytes = RESUME_META.unpack_from(payload, 0)
    return resumed_seq, received_bytes


def safe_filename(name: str) -> str:
    """Strip anything dangerous from a filename before it touches the disk."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"/\\|?*').strip(" .") or "transfer.bin"