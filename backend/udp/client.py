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
8. Every incoming ACK is CRC-32 validated; corrupted ACKs are discarded
   (they look exactly like lost ACKs to the retransmission logic).

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
from .packet import ChecksumError, build_packet, corrupt_datagram, parse_packet

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
                 ack_corrupt_probability=0.0,
                 emit=None, message=None, finished=None,
                 on_checksum_error=None, on_resume=None,
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
        # Testing/debug hook: probability [0..1] of a bit flip corrupting an
        # inbound ACK. CRC-32 catches it -> ACK discarded -> timeout ->
        # retransmission (the duplicate at the receiver proves the loop).
        self.ack_corrupt_probability = ack_corrupt_probability
        self.emit = emit or (lambda entry: None)
        self.message = message or (lambda text: None)
        # finished(success: bool, detail: str) -> None
        self.finished = finished or (lambda ok, detail: None)
        # on_checksum_error(seq) -> None (counted by the controller)
        self.on_checksum_error = on_checksum_error or (lambda seq: None)
        # on_resume(resumed_seq, received_bytes) -> None
        self.on_resume = on_resume or (lambda seq, received: None)
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
    def send_file(self, file_path: str, destination_name: str,
                  resume: bool = True) -> None:
        """Run the whole Stop-and-Wait transfer. Blocking; call in a thread.

        With ``resume=True`` the START handshake advertises that the sender
        can continue from a partial file; if the receiver reports one in its
        ACK payload we seek straight to the first missing packet.
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
            payload = self._send_control(
                protocol.PACKET_TYPE_START, protocol.SEQ_START,
                protocol.build_start_meta(destination_name, file_size,
                                          total_packets, self.packet_size,
                                          resume=resume))
            if payload is None:
                self._bail("handshake failed: START not acknowledged after "
                           f"{self.max_retries} retries")
                return

            # Resume negotiation: the START ACK carries how much the receiver
            # already has (empty payload = fresh transfer).
            resumed_seq, resumed_bytes = 0, 0
            if payload:
                try:
                    resumed_seq, resumed_bytes = protocol.parse_resume_meta(payload)
                except ValueError:
                    resumed_seq = 0
            if resumed_seq > total_packets:
                resumed_seq = total_packets

            with open(file_path, "rb") as fh:
                seq = 1
                if resumed_seq > 0:
                    fh.seek(resumed_seq * self.packet_size)
                    seq = resumed_seq + 1
                    self.on_resume(resumed_seq, resumed_bytes)
                    self.message(
                        f"RESUME -> {resumed_bytes}B already at the receiver, "
                        f"sending packets #{seq}..{total_packets}")
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
            if ok is None:
                self._bail("finalization failed: END not acknowledged")
                return

            elapsed = time.monotonic() - started
            self.message(f"Transfer finished in {elapsed:.2f}s")
            self.finished(True, "ok")
        finally:
            self.close()

    # ------------------------------------------------------------------
    def _send_control(self, ptype, seq, payload=b""):
        """Send a START/END packet and wait for its ACK (Stop-and-Wait).

        Returns the ACK payload (possibly b"") on success, None on failure.
        The START ACK payload carries resume metadata when resuming.
        """
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
                return None
            self._mark(seq, label, len(packet), STATUS_WAITING, attempt)
            ack_payload = self._wait_ack(seq)
            if ack_payload is not None:
                self._mark(seq, label, len(packet), STATUS_ACKED, attempt)
                self.message(f"CLIENT <- {label} ACK #{seq} received")
                return ack_payload
        self._mark(seq, label, len(packet), STATUS_FAILED, self.max_retries)
        return None

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
                sent_at = time.monotonic()
                self.sock.send(packet)
            except OSError as exc:
                self.message(f"send error: {exc}")
                return False
            self._mark(seq, "DATA", len(packet), STATUS_WAITING, attempt)
            if self._wait_ack(seq) is not None:
                # RTT = send -> matching ACK, per RFC-style sampling
                rtt_ms = (time.monotonic() - sent_at) * 1000.0
                self._mark(seq, "DATA", len(packet), STATUS_ACKED, attempt,
                           rtt_ms=rtt_ms)
                if self.verbose or seq == 1 or seq == self.total_packets or seq % 50 == 0:
                    self.message(f"CLIENT <- ACK #{seq} received")
                return True
            self.message(f"DATA #{seq} lost -> timeout ({attempt + 1})")
        self._mark(seq, "DATA", len(packet), STATUS_FAILED, self.max_retries)
        return False

    # ------------------------------------------------------------------
    def _wait_ack(self, expected_seq):
        """Block until an ACK for ``expected_seq`` arrives, or timeout.

        Returns the ACK payload (possibly b"") when the matching ACK was
        received, None on timeout/stop -- callers use ``is not None`` so an
        empty payload still counts as success.

        Testing sieves (both modeled as network faults):
        - ``ack_loss_probability`` silently discards the ACK -> timeout
          -> retransmission -> duplicate at the receiver.
        - ``ack_corrupt_probability`` flips a bit in the ACK -> CRC-32
          rejects it with a visible CHECKSUM MISMATCH -> same outcome.
        """
        while not self._stop.is_set():
            try:
                data = self.sock.recv(65536)
            except socket.timeout:
                return None
            except OSError:
                return None
            # simulated bit flip on the returning ACK
            if self.ack_corrupt_probability > 0 and \
                    random.random() < self.ack_corrupt_probability:
                data = corrupt_datagram(data)
            try:
                seq, ptype, payload = parse_packet(data)
            except ChecksumError as exc:
                # corrupted ACK -> ignore it; the timeout below retransmits
                self.message(
                    f"CHECKSUM MISMATCH on ACK #{exc.seq} "
                    f"(expected {exc.expected}, computed {exc.computed}) -- dropped")
                self.on_checksum_error(exc.seq)
                continue
            except ValueError:
                continue
            if ptype == protocol.PACKET_TYPE_ACK and seq == expected_seq:
                if self.ack_loss_probability > 0 and \
                        random.random() < self.ack_loss_probability:
                    self.message(f"ACK #{expected_seq} lost (simulated)")
                    return None
                return payload
        return None

    # ------------------------------------------------------------------
    def _mark(self, seq, ptype_label, size, status, retries, rtt_ms=None):
        entry = {
            "seq": seq,
            "type": ptype_label,
            "size": size,
            "status": status,
            "retries": retries,
        }
        if rtt_ms is not None:
            entry["rtt_ms"] = round(rtt_ms, 3)
        self.emit(entry)

    def _bail(self, detail):
        self.message(detail)
        self.finished(False, detail)
