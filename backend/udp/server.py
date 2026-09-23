"""UDP file transfer receiver / server.

Responsibilities (per the project plan):

1. Bind a UDP socket and keep listening for transfers.
2. Wait for START, prepare the destination file.
3. Receive DATA packets, read the sequence number, validate order.
4. Write each payload exactly once and send back ACK <seq>.
5. Detect duplicate packets (retransmissions) and re-ACK without writing.
6. Handle END, close/rename the file, reset for the next transfer.

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
from .packet import parse_packet


class UDPServer:
    """Reliable file receiver over UDP. One transfer at a time."""

    def __init__(self, port, packet_size=protocol.DEFAULT_PACKET_SIZE,
                 loss_probability=0.0,
                 receive_dir=None,
                 on_duplicate=None, on_transfer_complete=None, message=None):
        self.port = port
        self.packet_size = packet_size
        # Testing/debug hook: probability [0..1] of "dropping" an incoming
        # packet in the simulated network. Dropped packets get no ACK, so the
        # sender times out and retransmits.
        self.loss_probability = loss_probability
        self.receive_dir = receive_dir or os.path.join(
            os.getcwd(), "transfers", "received")
        self.on_duplicate = on_duplicate or (lambda seq: None)
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
            try:
                seq, ptype, payload = parse_packet(data)
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
            try:
                name, size, total, pk_size = protocol.parse_start_meta(payload)
            except ValueError:
                self._send_ack(protocol.SEQ_START, addr)
                return
            if self._session is not None and \
                    self._session["name"] == name and self._session["size"] == size and \
                    self._session["expected_seq"] == 1:
                # Duplicate START (handshake ACK was lost, sender retried before data).
                # Re-ACK without destroying the running session.
                self._send_ack(protocol.SEQ_START, addr)
                return
            self._reset_session()
            run_id = time.strftime("%Y%m%d-%H%M%S")
            base = protocol.safe_filename(name)
            final_path = os.path.join(self.receive_dir, f"{run_id}_{base}")
            part_path = final_path + ".part"
            os.makedirs(os.path.dirname(final_path), exist_ok=True)
            self._session = {
                "name": name,
                "final_path": final_path,
                "part_path": part_path,
                "size": size,
                "total_packets": total,
                "packet_size": pk_size,
                "expected_seq": 1,
                "out": open(part_path, "wb"),
                "addr": addr,
                "written": 0,
                "verbose": (total <= 500),
            }
            self.message(f"Transfer started: {name} ({size} bytes, "
                         f"{total} packets, {pk_size}B)")
            self._send_ack(protocol.SEQ_START, addr)
            return

        session = self._session

        if ptype == protocol.PACKET_TYPE_DATA:
            if session is None:
                return  # stray DATA with no active transfer: ignore
            with self._lock:
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
    def _finalize(self, session):
        session["out"].flush()
        session["out"].close()
        os.replace(session["part_path"], session["final_path"])
        self.message(f"Transfer complete -> {session['final_path']}")
        self.on_transfer_complete(session["final_path"])

    def _reset_session(self):
        session = self._session
        self._session = None
        if session and not session["out"].closed:
            session["out"].close()
            try:
                os.remove(session["part_path"])
            except OSError:
                pass

    def _send_ack(self, seq, addr):
        """Send ACK <seq> to the sender (per plan: DATA #N <-> ACK #N)."""
        try:
            self._sock.sendto(protocol.build_packet(
                seq, protocol.PACKET_TYPE_ACK, b""), addr)
        except OSError:
            pass