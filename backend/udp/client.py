"""UDP file transfer client.

Responsibilities (per the project plan):

1. Open a UDP socket (connected to the receiver).
2. Send a START handshake carrying file metadata.
3. Packetize the file into fixed-size chunks.
4. Assign monotonically increasing sequence numbers (1..N).
5. For every packet: send it, then WAIT for the matching ACK.
   -> This is Stop-and-Wait ARQ: the next packet is only sent
       after the current one is acknowledged.
6. On timeout: retransmit (up to ``max_retries``).
7. Send END, finalize, and report completion.

The client never writes the file: it is purely a sender + ACK tracker.
All protocol progress is reported through the ``emit`` callback so the
API/controller can feed the live UI.
"""

import math
import os
import random
import socket
import threading
import time

from . import protocol
from .packet import build_packet, parse_packet

# Statuses used in the UI packet monitor
STATUS_SENT = "SENT"
STATUS_WAITING = "WAITING"
STATUS_ACKED = "ACKED"
STATUS_TIMEOUT = "TIMEOUT"
STATUS_RETRANSMITTED = "RETRANSMITTED"
STATUS_FAILED = "FAILED"


class UDPClient:
    """Stop-and-Wait reliable sender over UDP."""

    def __init__(self, host, port, packet_size=protocol.DEFAULT_PACKET_SIZE,
                 timeout=protocol.DEFAULT_TIMEOUT,
                 max_retries=protocol.DEFAULT_MAX_RETRIES,
                 ack_loss_probability=0.0,
                 emit=None, message=None, finished=None,
                 verbose=None):
        self.host = host
        self.port = port
        self.packet_size = packet_size
        self.timeout = timeout
        self.max_retries = max_retries
        # Testing/debug hook: probability [0..1] of "dropping" an incoming
        # ACK in the simulated network layer. When an ACK is dropped the
        # sender times out and retransmits -> the receiver sees a duplicate.
        self.ack_loss_probability = ack_loss_probability
        self.emit = emit or (lambda entry: None)
        self.message = message or (lambda text: None)
        # finished(success: bool, detail: str) -> None
        self.finished = finished or (lambda ok, detail: None)
        self._verbose = verbose
        self.verbose = False
        self.total_packets = 0

        self.sock = None
        self._stop = threading.Event()

    # ------------------------------------------------------------------
    def cancel(self):
        """Ask the sender to abort as soon as possible (checked per packet)."""
        self._stop.set()

    def close(self):
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass

    # ------------------------------------------------------------------
    def send_file(self, file_path: str, destination_name: str) -> None:
        """Run the whole Stop-and-Wait transfer. Blocking; call in a thread.

        Returns nothing; completion is delivered through the ``finished``
        callback. Raises on total failure instead -- the caller's thread
        wrapper turns that into a "failed" state.
        """
        self._stop.clear()
        file_size = os.path.getsize(file_path)
        total_packets = math.ceil(file_size / self.packet_size)
        self.total_packets = total_packets
        self.verbose = (total_packets <= 500) if self._verbose is None else bool(self._verbose)
        if not self.verbose:
            self.message(f"Large transfer ({total_packets} packets) -- logging sampled every 50 packets")

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect((self.host, self.port))

        started = time.monotonic()
        try:
            ok = self._send_control(protocol.PACKET_TYPE_START, protocol.SEQ_START,
                                    protocol.build_start_meta(destination_name,
                                                              file_size,
                                                              total_packets,
                                                              self.packet_size))
            if not ok:
                self._bail("handshake failed: START not acknowledged after "
                           f"{self.max_retries} retries")
                return

            with open(file_path, "rb") as fh:
                seq = 1
                while seq <= total_packets:
                    if self._stop.is_set():
                        self._bail("cancelled by user")
                        return
                    chunk = fh.read(self.packet_size)
                    if not chunk:
                        break
                    ok = self._send_data_packet(seq, chunk)
                    if not ok:
                        self._bail(f"packet #{seq} failed after "
                                   f"{self.max_retries + 1} attempts")
                        return
                    seq += 1

            ok = self._send_control(protocol.PACKET_TYPE_END,
                                    total_packets + protocol.SEQ_END_OFFSET)
            if not ok:
                self._bail("finalization failed: END not acknowledged")
                return

            elapsed = time.monotonic() - started
            self.message(f"Transfer finished in {elapsed:.2f}s")
            self.finished(True, "ok")
        finally:
            self.close()

    # ------------------------------------------------------------------
    def _send_control(self, ptype, seq, payload=b""):
        """Send a START/END packet and wait for its ACK (Stop-and-Wait)."""
        label = protocol.type_name(ptype)
        packet = build_packet(seq, ptype, payload)
        for attempt in range(self.max_retries + 1):
            if attempt > 0:
                self._mark(seq, label, len(packet), STATUS_TIMEOUT, attempt)
                self._mark(seq, label, len(packet), STATUS_RETRANSMITTED, attempt)
                self.message(f"CLIENT -> {label} #{seq} RETRANSMIT (attempt {attempt + 1})")
            else:
                self.message(f"CLIENT -> {label} #{seq} sent")
            self._mark(seq, label, len(packet), STATUS_SENT, attempt)
            try:
                self.sock.send(packet)
            except OSError as exc:
                self.message(f"send error: {exc}")
                return False
            self._mark(seq, label, len(packet), STATUS_WAITING, attempt)
            if self._wait_ack(seq):
                self._mark(seq, label, len(packet), STATUS_ACKED, attempt)
                self.message(f"CLIENT <- {label} ACK #{seq} received")
                return True
        self._mark(seq, label, len(packet), STATUS_FAILED, self.max_retries)
        return False

    def _send_data_packet(self, seq, chunk):
        """Send one DATA packet and wait for ACK <seq>."""
        packet = build_packet(seq, protocol.PACKET_TYPE_DATA, chunk)
        for attempt in range(self.max_retries + 1):
            if attempt > 0:
                self._mark(seq, "DATA", len(packet), STATUS_TIMEOUT, attempt)
                self._mark(seq, "DATA", len(packet), STATUS_RETRANSMITTED, attempt)
                self.message(f"CLIENT -> DATA #{seq}/{self.total_packets} RETRANSMIT (attempt {attempt + 1})")
            else:
                self._mark(seq, "DATA", len(packet), STATUS_SENT, attempt)
                if self.verbose or seq == 1 or seq == self.total_packets or seq % 50 == 0:
                    self.message(f"CLIENT -> DATA #{seq}/{self.total_packets} sent ({len(chunk)}B)")
            try:
                self.sock.send(packet)
            except OSError as exc:
                self.message(f"send error: {exc}")
                return False
            self._mark(seq, "DATA", len(packet), STATUS_WAITING, attempt)
            if self._wait_ack(seq):
                self._mark(seq, "DATA", len(packet), STATUS_ACKED, attempt)
                if self.verbose or seq == 1 or seq == self.total_packets or seq % 50 == 0:
                    self.message(f"CLIENT <- ACK #{seq} received")
                return True
            self.message(f"DATA #{seq} lost -> timeout ({attempt + 1})")
        self._mark(seq, "DATA", len(packet), STATUS_FAILED, self.max_retries)
        return False

    # ------------------------------------------------------------------
    def _wait_ack(self, expected_seq) -> bool:
        """Block until an ACK for ``expected_seq`` arrives, or timeout.

        Testing sieve: with ``ack_loss_probability`` the ACK is silently
        discarded so the caller observes a timeout (duplicate at receiver).
        """
        while not self._stop.is_set():
            try:
                data = self.sock.recv(65536)
            except socket.timeout:
                return False
            except OSError:
                return False
            try:
                seq, ptype, _payload = parse_packet(data)
            except ValueError:
                continue
            if ptype == protocol.PACKET_TYPE_ACK and seq == expected_seq:
                if self.ack_loss_probability > 0 and \
                        random.random() < self.ack_loss_probability:
                    self.message(f"ACK #{expected_seq} lost (simulated)")
                    return False
                return True
        return False

    # ------------------------------------------------------------------
    def _mark(self, seq, ptype_label, size, status, retries):
        entry = {
            "seq": seq,
            "type": ptype_label,
            "size": size,
            "status": status,
            "retries": retries,
        }
        self.emit(entry)

    def _bail(self, detail):
        self.message(detail)
        self.finished(False, detail)