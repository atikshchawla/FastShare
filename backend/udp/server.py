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

import os
import random
import socket
import threading
import time

from . import protocol
from .packet import ChecksumError, corrupt_datagram, parse_packet
# .part/.meta helpers are shared with the controller (transfer/manager.py)
from .resume_fs import discard_partial, find_partial, resume_point, write_meta


class UDPServer:
    """Reliable file receiver over UDP. One transfer at a time."""

    def __init__(self, port, loss_probability=0.0,
                 corrupt_probability=0.0,
                 receive_dir=None,
                 on_duplicate=None, on_checksum_error=None,
                 on_transfer_complete=None, message=None):
        self.port = port
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
            try:
                self._handle(seq, ptype, payload, addr)
            except OSError as exc:
                # A disk error (full/locked/permission) on this one packet
                # must NOT kill the listener and leave a zombie "running"
                # receiver. Log it and keep serving: the sender's timeout +
                # retry (and the END completeness guard) handle the rest.
                self.message(f"receiver error on packet #{seq}: {exc}")
        self.reset_session()
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
                if session["expected_seq"] <= session["total_packets"]:
                    # Incomplete: a real sender only sends END after every
                    # DATA was ACKed, so this is a forged/stale END. Ignoring
                    # it stops a truncated file being finalized as success.
                    self.message(
                        f"END for incomplete transfer "
                        f"(#{session['expected_seq'] - 1}/"
                        f"{session['total_packets']}) -- ignored")
                    return
                self.message(f"SERVER <- END packet received, sending final ACK #{seq}")
                self._finalize(session)
                self._send_ack(seq, addr)
                self.reset_session()
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
            self.reset_session()

            # Is there an interrupted copy of THIS file waiting to resume?
            if resume_ok:
                candidate = find_partial(self.receive_dir, name, size, pk_size)
            else:
                # "start over": wipe EVERY leftover of this file (also clears
                # partials written under a different packet size, which could
                # otherwise poison a later resume).
                candidate = find_partial(self.receive_dir, name, size, None)
                while candidate:
                    if not discard_partial(candidate):
                        # locked (e.g. Windows) -> find_partial returns the
                        # same candidate forever; stop instead of spinning
                        self.message(f"WARNING: could not remove stale "
                                     f"partial {candidate['part_path']} "
                                     f"(in use?) -- keeping it")
                        break
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
                mode, expected = "ab", resumed_seq + 1
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
                write_meta(part_path, {
                    "name": name, "size": size, "packet_size": pk_size,
                    "total_packets": total, "final_path": final_path,
                })
                mode, expected, resumed_seq = "wb", 1, 0
                resume_payload = b""
                self.message(f"Transfer started: {name} ({size} bytes, "
                             f"{total} packets, {pk_size}B)")

            self._session = {
                "name": name,
                "final_path": final_path,
                "part_path": part_path,
                "size": size,
                "total_packets": total,
                "start_seq": expected,       # duplicate-START guard reference
                "expected_seq": expected,
                "resume_payload": resume_payload,
                "out": open(part_path, mode),
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

    def reset_session(self):
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