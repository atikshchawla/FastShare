"""UDP file transfer receiver / server.

Responsibilities (per the project plan):

1. Bind a UDP socket and keep listening for transfers.
2. Wait for START, prepare the destination file.
3. Receive DATA packets, read the sequence number, validate order.
4. Validate the CRC-32 checksum -- corrupted packets are dropped (no ACK).
5. Write each payload exactly once and send back ACK <seq>.
6. Detect duplicate packets (retransmissions) and re-ACK without writing.
7. Handle END, close/rename the file, reset for the next transfer.

Duplicate handling is the key reliability feature demonstrated here:
if the sender retransmits a packet whose payload was already written,
the receiver sends the ACK again but MUST NOT write the data twice.
"""

import json
import os
import random
import socket
import threading
import time

from . import protocol
from .packet import ChecksumError, corrupt_datagram, parse_packet


# ---------------------------------------------------------------------------
# Resume helpers (shared with the controller so /api/resume/check can inspect
# the receive directory without a running server).
# ---------------------------------------------------------------------------
def find_partial(receive_dir, name, size, packet_size=None):
    """Locate an interrupted transfer's partial file for this exact file.

    A match requires the sidecar .meta JSON (written at START) to describe
    the same name/size, and -- when ``packet_size`` is given -- the same
    packet size (resume math depends on it). Returns a dict or None.
    """
    try:
        entries = sorted(os.listdir(receive_dir))
    except OSError:
        return None
    for fn in entries:
        if not fn.endswith(".part"):
            continue
        part_path = os.path.join(receive_dir, fn)
        meta_path = part_path + ".meta"
        try:
            with open(meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
            received = os.path.getsize(part_path)
        except (OSError, ValueError):
            continue
        if meta.get("name") != name or meta.get("size") != size:
            continue
        if packet_size is not None and meta.get("packet_size") != packet_size:
            continue
        return {"part_path": part_path, "meta_path": meta_path,
                "meta": meta, "received": received}
    return None


def resume_point(received, size, packet_size, total_packets):
    """Where a resume should continue, given bytes already on disk.

    Stop-and-Wait only ever writes whole packets, so the resume point is
    received // packet_size. Returns (resumed_seq, aligned_bytes):
      - received >= size  -> (total_packets, size): everything is there,
        the sender only needs to re-send END.
      - sub-packet tail   -> (0, 0): unusable, caller should start fresh.
    """
    if received <= 0 or packet_size <= 0:
        return 0, 0
    if received >= size:
        return total_packets, size
    full = received // packet_size
    return full, full * packet_size


def discard_partial(candidate):
    """Delete a partial file + its sidecar meta (used by 'start over')."""
    for path in (candidate["part_path"], candidate["meta_path"]):
        try:
            os.remove(path)
        except OSError:
            pass


def _write_meta(part_path, meta):
    with open(part_path + ".meta", "w", encoding="utf-8") as fh:
        json.dump(meta, fh)


class UDPServer:
    """Reliable file receiver over UDP. One transfer at a time."""

    def __init__(self, port, packet_size=protocol.DEFAULT_PACKET_SIZE,
                 loss_probability=0.0,
                 corrupt_probability=0.0,
                 receive_dir=None,
                 on_duplicate=None, on_checksum_error=None,
                 on_transfer_complete=None, message=None):
        self.port = port
        self.packet_size = packet_size
        # Testing/debug hook: probability [0..1] of "dropping" an incoming
        # packet in the simulated network. Dropped packets get no ACK, so the
        # sender times out and retransmits.
        self.loss_probability = loss_probability
        # Testing/debug hook: probability [0..1] of a bit flip corrupting an
        # inbound datagram. CRC-32 catches it -> packet dropped, no ACK ->
        # sender times out -> retransmission of clean data.
        self.corrupt_probability = corrupt_probability
        self.receive_dir = receive_dir or os.path.join(
            os.getcwd(), "transfers", "received")
        self.on_duplicate = on_duplicate or (lambda seq: None)
        # on_checksum_error(seq) -> None (counted by the controller)
        self.on_checksum_error = on_checksum_error or (lambda seq: None)
        # on_transfer_complete(received_path: str) -> None
        self.on_transfer_complete = on_transfer_complete or (lambda path: None)
        self.message = message or (lambda text: None)

        self._sock = None
        self._thread = None
        self._stop = threading.Event()

        # Per-transfer session state
        self._session = None   # dict or None
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ api
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def bound_port(self) -> int:
        """The actual port the socket is bound to (useful when using port 0)."""
        if self._sock is not None:
            return self._sock.getsockname()[1]
        return self.port

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._setup_socket()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        sock = self._sock
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
        if self._thread is not None:
            self._thread.join(timeout=1.5)
        self._thread = None
        self._sock = None

    # ------------------------------------------------------------------
    def _setup_socket(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.settimeout(0.2)
        self._sock.bind(("0.0.0.0", self.port))  # any interface, UDP port 5001

    # ------------------------------------------------------------------
    def _serve(self):
        self.message(f"Server listening on UDP port {self.port}")
        while not self._stop.is_set():
            try:
                data, addr = self._sock.recvfrom(65536)
            except socket.timeout:
                continue
            except OSError:
                break  # socket closed by stop()
            # simulated bit flip on the wire: CRC-32 must catch it
            if self.corrupt_probability > 0 and \
                    random.random() < self.corrupt_probability:
                data = corrupt_datagram(data)
            try:
                seq, ptype, payload = parse_packet(data)
            except ChecksumError as exc:
                # corrupted payload -> drop, no ACK -> sender retransmits
                self.message(
                    f"CHECKSUM MISMATCH on packet #{exc.seq} "
                    f"(expected {exc.expected}, computed {exc.computed}) -- dropped")
                self.on_checksum_error(exc.seq)
                continue
            except ValueError:
                continue
            self._handle(seq, ptype, payload, addr)
        self._reset_session()
        self.message("Server stopped")

    # ------------------------------------------------------------------
    def _handle(self, seq, ptype, payload, addr):
        # Simulated packet loss: just silently drop, emit nothing.
        if self.loss_probability > 0 and random.random() < self.loss_probability:
            return

        if ptype == protocol.PACKET_TYPE_START:
            self._handle_start(payload, addr)
            return

        if ptype == protocol.PACKET_TYPE_DATA:
            with self._lock:
                session = self._session
                if session is None:
                    return  # stray DATA with no active transfer: ignore
                exp = session["expected_seq"]
                if seq == exp:
                    # Expected sequence number: first time we see it.
                    session["out"].write(payload)
                    session["written"] += len(payload)
                    session["expected_seq"] = exp + 1
                    self._send_ack(seq, addr)
                    if session.get("verbose", False):
                        self.message(f"SERVER <- DATA #{seq} received, sending ACK #{seq}")
                    elif seq == 1 or seq == session.get("total_packets", 0) or seq % 50 == 0:
                        self.message(f"SERVER <- DATA #{seq}/{session.get('total_packets', 0)} received, sending ACK #{seq}")
                elif seq < exp:
                    # DUPLICATE: already written earlier (ACK was lost,
                    # sender retransmitted). Re-ACK, never write twice.
                    self._send_ack(seq, addr)
                    self.on_duplicate(seq)
                    self.message(f"DUPLICATE packet #{seq} ignored (already written)")
                else:  # seq > exp: out-of-order, should not happen with S&W
                    self.message(f"Out-of-order packet #{seq} (expected #{exp}) -- ignored")
            return

        if ptype == protocol.PACKET_TYPE_END:
            with self._lock:
                session = self._session
                if session is None:
                    # Duplicate END (finalize ACK was lost, sender retried).
                    # Session already closed -- just re-ACK to unblock the sender.
                    self._send_ack(seq, addr)
                    return
                self.message(f"SERVER <- END packet received, sending final ACK #{seq}")
                self._finalize(session)
                self._send_ack(seq, addr)
                self._reset_session()
            return

    # ------------------------------------------------------------------
    def _handle_start(self, payload, addr):
        """Handshake: fresh START, or negotiate a resume of a partial file."""
        try:
            name, size, total, pk_size, resume_ok = \
                protocol.parse_start_meta(payload)
        except ValueError:
            self._send_ack(protocol.SEQ_START, addr)
            return

        with self._lock:
            if self._session is not None and \
                    self._session["name"] == name and \
                    self._session["size"] == size and \
                    self._session["expected_seq"] == self._session["start_seq"]:
                # Duplicate START before any DATA arrived (handshake ACK lost):
                # re-ACK with the same resume info, keep the session intact.
                self._send_ack(protocol.SEQ_START, addr,
                               self._session.get("resume_payload", b""))
                return

            # Close any previous session handle; its files stay on disk so an
            # interrupted transfer can still be resumed later.
            self._reset_session()

            # Is there an interrupted copy of THIS file waiting to resume?
            if resume_ok:
                candidate = find_partial(self.receive_dir, name, size, pk_size)
            else:
                # "start over": wipe EVERY leftover of this file (also clears
                # partials written under a different packet size, which could
                # otherwise poison a later resume).
                candidate = find_partial(self.receive_dir, name, size, None)
                while candidate:
                    discard_partial(candidate)
                    candidate = find_partial(self.receive_dir, name, size, None)
            resumed_seq, aligned = 0, 0
            if candidate:
                resumed_seq, aligned = resume_point(
                    candidate["received"], size, pk_size, total)
            if candidate and resumed_seq <= 0:
                discard_partial(candidate)   # nothing usable -> start over
                candidate = None

            if candidate:
                part_path = candidate["part_path"]
                final_path = candidate["meta"].get("final_path") or part_path[:-5]
                if candidate["received"] != aligned:
                    os.truncate(part_path, aligned)  # drop a torn tail
                mode, expected, written = "ab", resumed_seq + 1, aligned
                resume_payload = protocol.build_resume_meta(resumed_seq, aligned)
                self.message(
                    f"RESUME: {aligned}B already on disk "
                    f"({resumed_seq}/{total} packets) -> continuing at "
                    f"packet #{resumed_seq + 1}")
            else:
                run_id = time.strftime("%Y%m%d-%H%M%S")
                base = protocol.safe_filename(name)
                final_path = os.path.join(self.receive_dir, f"{run_id}_{base}")
                part_path = final_path + ".part"
                os.makedirs(os.path.dirname(final_path), exist_ok=True)
                _write_meta(part_path, {
                    "name": name, "size": size, "packet_size": pk_size,
                    "total_packets": total, "final_path": final_path,
                })
                mode, expected, written, resumed_seq = "wb", 1, 0, 0
                resume_payload = b""
                self.message(f"Transfer started: {name} ({size} bytes, "
                             f"{total} packets, {pk_size}B)")

            self._session = {
                "name": name,
                "final_path": final_path,
                "part_path": part_path,
                "size": size,
                "total_packets": total,
                "packet_size": pk_size,
                "start_seq": expected,       # duplicate-START guard reference
                "expected_seq": expected,
                "resume_payload": resume_payload,
                "out": open(part_path, mode),
                "addr": addr,
                "written": written,
                "verbose": (total <= 500),
            }
            self._send_ack(protocol.SEQ_START, addr, resume_payload)

    # ------------------------------------------------------------------
    def _finalize(self, session):
        session["out"].flush()
        session["out"].close()
        os.replace(session["part_path"], session["final_path"])
        try:
            os.remove(session["part_path"] + ".meta")  # transfer is complete
        except OSError:
            pass
        self.message(f"Transfer complete -> {session['final_path']}")
        self.on_transfer_complete(session["final_path"])

    def _reset_session(self):
        """Close the active session's file handle.

        The partial file and its .meta sidecar are intentionally KEPT: they
        are what makes resume possible after a cancel, a crash, or a full
        receiver restart. Completed transfers never reach here with a .part
        left (finalize renames it away).
        """
        with self._lock:
            session = self._session
            self._session = None
            if session and not session["out"].closed:
                try:
                    session["out"].close()
                except OSError:
                    pass

    def _send_ack(self, seq, addr, payload=b""):
        """Send ACK <seq> to the sender (per plan: DATA #N <-> ACK #N).

        The START ACK may carry resume metadata in its payload.
        """
        try:
            self._sock.sendto(protocol.build_packet(
                seq, protocol.PACKET_TYPE_ACK, payload), addr)
        except OSError:
            pass