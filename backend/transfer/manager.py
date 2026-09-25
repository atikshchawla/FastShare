"""TransferManager: the single source of truth the API reads.

Holds:
- controller configuration (server IP/port, packet size, timeout, window)
- the UDP server lifecycle (start/stop, packet-loss simulation)
- the active transfer lifecycle (client thread, state, statistics)
- the packet activity log that feeds the live UI packet monitor

Nothing network-specific lives here; the manager merely wires the
UDP client/server to shared state and exposes thread-safe snapshots.
"""

import math
import os
import threading
import time

from udp import protocol
from udp.client import UDPClient, STATUS_ACKED, STATUS_FAILED
from udp.server import UDPServer, discard_partial, find_partial, resume_point

# transfer_status values
TS_IDLE = "idle"
TS_TRANSFERRING = "transferring"
TS_COMPLETED = "completed"
TS_FAILED = "failed"
TS_CANCELLED = "cancelled"

# server_status values
SS_STOPPED = "stopped"
SS_RUNNING = "running"
SS_ERROR = "error"

MAX_FEED = 3000      # max event feed lines kept
MAX_LOG_ENTRIES = 4000  # cap packet log size (UI asks for a window anyway)


class TransferManager:
    def __init__(self):
        self._lock = threading.RLock()
        # ---- controller configuration -------------------------------------
        self.config = {
            "server_ip": "127.0.0.1",
            "udp_port": 5001,
            "packet_size": protocol.DEFAULT_PACKET_SIZE,
            "timeout_ms": 500,
            "window_size": 1,          # Stop-and-Wait (sliding window later)
            "max_retries": 5,
        }
        self.testing = {
            "loss_enabled": False,
            "loss_probability": 0.10,
            "corrupt_enabled": False,
            "corrupt_probability": 0.10,
        }
        # ---- server lifecycle ---------------------------------------------
        self.server: UDPServer | None = None
        self.server_status = SS_STOPPED
        self.server_error = None
        self.server_sessions = 0
        # ---- transfer lifecycle -------------------------------------------
        self.client: UDPClient | None = None
        self.transfer_status = TS_IDLE
        self.transfer_error = None
        self.file_name = None
        self.file_size = 0
        self.total_packets = 0
        self.packets_sent = 0
        self.packets_acked = 0
        self.retransmissions = 0
        self.packets_lost = 0
        self.bytes_sent = 0
        self.confirmed_bytes = 0
        self.current_sequence = 0
        self.duplicate_packets = 0
        self.checksum_errors = 0
        self.last_duplicate_seq = None
        self.last_loss_seq = None
        self.last_checksum_seq = None
        # wire + timing statistics
        self.wire_bytes = 0            # every byte the sender put on the wire
        self.rtt_current = None        # latest RTT sample (ms)
        self.rtt_min = None
        self.rtt_max = None
        self.srtt = None               # RFC 6298 EWMA (0.875/0.125)
        self.rtt_samples = 0
        # resume state
        self.resumed_from_seq = 0      # first packet re-sent this session
        self.resumed_bytes = 0         # ... and how many bytes were reused
        self.started_at = None
        self.finished_at = None
        self.elapsed_seconds = 0.0
        self.received_path = None
        self.upload_path = None
        # packet log: keyed by seq -> last entry; list maintains order
        self._packet_order = []
        self.packets = dict()
        self.feed = []          # human readable event feed for the UI
        self._cancel_requested = False

        self._finalize_callback = lambda: None

    # ================================================================== util
    def _log(self, text):
        entry = {"t": time.time(), "text": text}
        with self._lock:
            self.feed.append(entry)
            if len(self.feed) > MAX_FEED:
                self.feed = self.feed[-MAX_FEED:]

    def emit_packet(self, entry):
        """Record a packet activity event coming from the UDP client/server.

        All transfer statistics are derived from these events (single source
        of truth), so nothing is double-counted:
          SENT           -> packets_sent += 1, bytes_sent += packet size
          RETRANSMITTED  -> retransmissions += 1, wire bytes += packet size
          TIMEOUT        -> packets_lost += 1
          ACKED (DATA)   -> packets_acked += 1, confirmed bytes += size,
                            RTT sample -> current/min/max/SRTT
          FAILED         -> mark the failed sequence
        """
        with self._lock:
            key = entry["seq"]
            prev = self.packets.get(key)
            if entry["type"] in ("START", "DATA", "END"):
                self.packets[key] = entry
                if prev is None:
                    self._packet_order.append(key)
                if len(self._packet_order) > MAX_LOG_ENTRIES:
                    drop = self._packet_order.pop(0)
                    self.packets.pop(drop, None)

            status = entry["status"]
            entry_size = entry.get("size", 0)
            if status == "SENT":
                self.packets_sent += 1
                self.bytes_sent += entry_size
                self.wire_bytes += entry_size
            elif status == "RETRANSMITTED":
                self.retransmissions += 1
                self.wire_bytes += entry_size
            elif status == "TIMEOUT":
                self.packets_lost += 1
                self.last_loss_seq = entry["seq"]
            elif status == STATUS_ACKED and entry["type"] == "DATA":
                self.packets_acked += 1
                raw = (prev.get("size", 0) if prev else entry_size)
                # strip the header: confirmed bytes track FILE progress
                self.confirmed_bytes += max(0, raw - protocol.HEADER_SIZE)
                if entry["seq"] > self.current_sequence:
                    self.current_sequence = entry["seq"]
                rtt = entry.get("rtt_ms")
                if rtt is not None and rtt >= 0:
                    self._record_rtt(rtt)
            elif status == STATUS_FAILED:
                if entry["seq"] > self.current_sequence:
                    self.current_sequence = entry["seq"]

    def _record_rtt(self, rtt_ms):
        """Update current/min/max and the RFC 6298 smoothed RTT."""
        self.rtt_current = rtt_ms
        self.rtt_min = rtt_ms if self.rtt_min is None else min(self.rtt_min, rtt_ms)
        self.rtt_max = rtt_ms if self.rtt_max is None else max(self.rtt_max, rtt_ms)
        if self.srtt is None:
            self.srtt = rtt_ms
        else:
            self.srtt = 0.875 * self.srtt + 0.125 * rtt_ms
        self.rtt_samples += 1

    # ================================================================== server
    def start_server(self):
        with self._lock:
            if self.server_status == SS_RUNNING:
                return {"ok": True, "message": "server already running"}
            try:
                port = int(self.config["udp_port"])
                packet_size = int(self.config["packet_size"])
            except (TypeError, ValueError):
                return {"ok": False, "error": "invalid server port or packet size"}

            loss_p = self.testing["loss_probability"] if self.testing["loss_enabled"] else 0.0
            corrupt_p = self.testing["corrupt_probability"] \
                if self.testing["corrupt_enabled"] else 0.0
            server = UDPServer(
                port=port,
                packet_size=packet_size,
                loss_probability=loss_p,
                corrupt_probability=corrupt_p,
                receive_dir=self._received_dir(),
                on_duplicate=self._on_duplicate,
                on_checksum_error=self._on_checksum_error,
                on_transfer_complete=self._on_received_path,
                message=self._log,
            )
            try:
                server.start()
            except OSError as exc:
                self.server_status = SS_ERROR
                self.server_error = str(exc)
                return {"ok": False, "error": f"could not bind port {port}: {exc}"}
            self.server = server
            self.server_status = SS_RUNNING
            self.server_error = None
            self._log(f"UDP server started on port {port}")
            return {"ok": True, "message": "server started"}

    def stop_server(self):
        # Never call into the server while holding the manager lock: the
        # server thread may itself want the manager lock for its callbacks
        # (message/duplicate/complete) -> that ordering deadlocks.
        with self._lock:
            server = self.server
            self.server = None
            self.server_status = SS_STOPPED
            self.server_error = None
        if server:
            server.stop()   # partial files survive: they power resume
        with self._lock:
            self._log("UDP server stopped")
        return {"ok": True, "message": "server stopped"}

    def _on_duplicate(self, seq):
        with self._lock:
            self.duplicate_packets += 1
            self.last_duplicate_seq = seq

    def _on_checksum_error(self, seq):
        with self._lock:
            self.checksum_errors += 1
            self.last_checksum_seq = seq

    def _on_received_path(self, received_path):
        with self._lock:
            self.received_path = received_path
            self.server_sessions += 1

    def apply_testing_config(self, loss_enabled, loss_probability,
                             corrupt_enabled=False, corrupt_probability=0.0):
        """Update the packet-loss and corruption simulations.

        Live server/client objects are patched in place so a running demo
        reacts immediately; otherwise the values are picked up on start.
        """
        with self._lock:
            self.testing["loss_enabled"] = bool(loss_enabled)
            self.testing["loss_probability"] = round(float(loss_probability), 3)
            self.testing["corrupt_enabled"] = bool(corrupt_enabled)
            self.testing["corrupt_probability"] = round(float(corrupt_probability), 3)
            loss_p = self.testing["loss_probability"] if loss_enabled else 0.0
            corrupt_p = self.testing["corrupt_probability"] if corrupt_enabled else 0.0
            if self.server:
                self.server.loss_probability = loss_p
                self.server.corrupt_probability = corrupt_p
            if self.client:
                self.client.ack_loss_probability = loss_p
                self.client.ack_corrupt_probability = corrupt_p
            self._log(
                f"Packet loss simulation {'ON' if loss_enabled else 'OFF'}"
                f" ({int(loss_p * 100)}%) | "
                f"corruption {'ON' if corrupt_enabled else 'OFF'}"
                f" ({int(corrupt_p * 100)}%)")
            return {"ok": True}

    # kept for compatibility with older callers/tests
    def apply_loss_config(self, enabled, probability):
        return self.apply_testing_config(enabled, probability,
                                         self.testing["corrupt_enabled"],
                                         self.testing["corrupt_probability"])

    # ================================================================== transfer
    def start_transfer(self, upload_path, file_name, callback=None, resume=True):
        """Kick off a Stop-and-Wait transfer in a background thread.

        ``resume=True`` lets the START handshake continue an interrupted
        transfer's partial file; ``resume=False`` discards it and starts at
        packet 1. The server decides at handshake time, so no session reset
        happens here (the leftover partial must stay visible to START).
        """
        with self._lock:
            if self.transfer_status == TS_TRANSFERRING:
                return {"ok": False, "error": "a transfer is already running"}
            if self.server_status != SS_RUNNING or self.server is None:
                return {"ok": False,
                        "error": "UDP server is not running -- start the "
                                 "receiver first"}
            self._reset_transfer_state()
            self.file_name = file_name
            self.upload_path = upload_path
            self.file_size = os.path.getsize(upload_path)
            self.total_packets = math.ceil(self.file_size / int(self.config["packet_size"]))
            self.transfer_status = TS_TRANSFERRING
            self._cancel_requested = False
            self.started_at = time.time()
            self._log(f"Starting transfer of '{file_name}' -> "
                      f"{self.config['server_ip']}:{self.config['udp_port']}"
                      f"{' (resume allowed)' if resume else ' (fresh)'}")
            self._finalize_callback = callback or (lambda *_: None)

            loss_p = self.testing["loss_probability"] if self.testing["loss_enabled"] else 0.0
            corrupt_p = self.testing["corrupt_probability"] \
                if self.testing["corrupt_enabled"] else 0.0
            client = UDPClient(
                host=self.config["server_ip"],
                port=int(self.config["udp_port"]),
                packet_size=int(self.config["packet_size"]),
                timeout=max(0.05, int(self.config["timeout_ms"]) / 1000.0),
                max_retries=int(self.config["max_retries"]),
                ack_loss_probability=loss_p,
                ack_corrupt_probability=corrupt_p,
                emit=self.emit_packet,
                message=self._log,
                finished=self._on_transfer_finished,
                on_checksum_error=self._on_checksum_error,
                on_resume=self._on_resume,
            )
            self.client = client
            threading.Thread(
                target=self._run_client,
                args=(client, upload_path, file_name, resume),
                daemon=True).start()
            return {"ok": True, "message": "transfer started"}

    def _run_client(self, client, upload_path, file_name, resume=True):
        try:
            client.send_file(upload_path, file_name, resume=resume)
        except Exception as exc:  # noqa: BLE001 - report any failure
            self._log(f"transfer crashed: {exc}")
            self._set_transfer_state(TS_FAILED, str(exc))
            self._finalize_callback()
        finally:
            client.close()

    def _on_resume(self, resumed_seq, received_bytes):
        """The receiver already holds ``resumed_seq`` whole packets.

        Replay them through the normal ACK path (without RTT) so the packet
        monitor, progress %, confirmed bytes and ETA all jump to the right
        place instead of restarting from zero.
        """
        with self._lock:
            size = self.file_size
            ps = int(self.config["packet_size"])
            if size <= 0 or ps <= 0 or resumed_seq <= 0:
                return
            self.resumed_from_seq = resumed_seq
            self.resumed_bytes = min(received_bytes, size)
            for s in range(1, resumed_seq + 1):
                payload_len = min(ps, size - (s - 1) * ps)
                self.emit_packet({
                    "seq": s, "type": "DATA",
                    "size": payload_len + protocol.HEADER_SIZE,
                    "status": STATUS_ACKED, "retries": 0,
                })
            self._log(
                f"Session resumed at packet #{resumed_seq + 1}: "
                f"{self.resumed_bytes}B reused from disk")

    def _on_transfer_finished(self, success, detail):
        with self._lock:
            self.finished_at = time.time()
            self.elapsed_seconds = self.finished_at - (self.started_at or self.finished_at)
            if self._cancel_requested:
                self.transfer_status = TS_CANCELLED
                self.transfer_error = "cancelled by user"
            elif success:
                self.transfer_status = TS_COMPLETED
                self.transfer_error = None
            else:
                self.transfer_status = TS_FAILED
                self.transfer_error = detail
        self._finalize_callback()

    def cancel_transfer(self):
        # Client/server calls happen outside the manager lock (same deadlock
        # reasoning as stop_server).
        with self._lock:
            if self.transfer_status != TS_TRANSFERRING:
                return {"ok": False, "error": "no active transfer"}
            self._cancel_requested = True
            client, server = self.client, self.server
            self._log("Cancellation requested")
        if client:
            client.cancel()
        if server:
            # Close the handle so the bytes flush; the partial file + meta
            # are kept on disk so the transfer can be resumed afterwards.
            server._reset_session()
        return {"ok": True, "message": "cancelling..."}

    def _reset_transfer_state(self):
        self.transfer_status = TS_IDLE
        self.transfer_error = None
        self.file_name = None
        self.file_size = 0
        self.total_packets = 0
        self.packets_sent = 0
        self.packets_acked = 0
        self.retransmissions = 0
        self.packets_lost = 0
        self.bytes_sent = 0
        self.confirmed_bytes = 0
        self.current_sequence = 0
        self.duplicate_packets = 0
        self.checksum_errors = 0
        self.last_duplicate_seq = None
        self.last_loss_seq = None
        self.last_checksum_seq = None
        self.wire_bytes = 0
        self.rtt_current = None
        self.rtt_min = None
        self.rtt_max = None
        self.srtt = None
        self.rtt_samples = 0
        self.resumed_from_seq = 0
        self.resumed_bytes = 0
        self.started_at = None
        self.finished_at = None
        self.elapsed_seconds = 0.0
        self.received_path = None
        self.upload_path = None
        self._packet_order = []
        self.packets = dict()
        self.feed = []
        self._cancel_requested = False

    def _set_transfer_state(self, status, error=None):
        with self._lock:
            self.transfer_status = status
            self.transfer_error = error

    # ================================================================== snapshot
    def status_snapshot(self):
        """Full state dict returned to the Next.js controller."""
        with self._lock:
            if self.transfer_status == TS_TRANSFERRING and self.started_at:
                self.elapsed_seconds = time.time() - self.started_at

            total = max(self.total_packets, 1)
            progress = round(min(100.0, (self.packets_acked / total) * 100), 1)

            # ---- derived performance metrics ------------------------------
            # goodput/ETA measure bytes actually moved THIS session, so a
            # resumed run (reused bytes counted in confirmed_bytes) doesn't
            # fake an instant transfer rate.
            session_bytes = max(0, self.confirmed_bytes - self.resumed_bytes)
            elapsed = self.elapsed_seconds
            if elapsed > 0 and session_bytes > 0:
                goodput_bps = session_bytes / elapsed
                eta = max(0.0, self.file_size - self.confirmed_bytes) / goodput_bps
            else:
                goodput_bps = 0.0
                eta = None
            if self.transfer_status == TS_COMPLETED:
                eta = 0.0
            throughput_bps = (self.wire_bytes / elapsed) if elapsed > 0 else 0.0
            loss_percent = (self.retransmissions / max(self.packets_sent, 1)) * 100.0

            return {
                # server
                "server_status": self.server_status,
                "server_error": self.server_error,
                "server_sessions": self.server_sessions,
                "server_port": self.config["udp_port"],
                # config
                "config": dict(self.config),
                "testing": dict(self.testing),
                # transfer
                "transfer_status": self.transfer_status,
                "transfer_error": self.transfer_error,
                "file_name": self.file_name,
                "file_size": self.file_size,
                "total_packets": self.total_packets,
                "packets_sent": self.packets_sent,
                "packets_acked": self.packets_acked,
                "packets_lost": self.packets_lost,
                "retransmissions": self.retransmissions,
                "bytes_sent": self.bytes_sent,
                "confirmed_bytes": self.confirmed_bytes,
                "current_sequence": self.current_sequence,
                "duplicate_packets": self.duplicate_packets,
                "checksum_errors": self.checksum_errors,
                "last_duplicate_seq": self.last_duplicate_seq,
                "last_loss_seq": self.last_loss_seq,
                "last_checksum_seq": self.last_checksum_seq,
                "progress_percent": progress,
                "elapsed_seconds": round(self.elapsed_seconds, 2),
                "received_path": self.received_path,
                # performance statistics
                "wire_bytes": self.wire_bytes,
                "rtt_ms": round(self.rtt_current, 2)
                if self.rtt_current is not None else None,
                "rtt_min_ms": round(self.rtt_min, 2)
                if self.rtt_min is not None else None,
                "rtt_max_ms": round(self.rtt_max, 2)
                if self.rtt_max is not None else None,
                "srtt_ms": round(self.srtt, 2) if self.srtt is not None else None,
                "rtt_samples": self.rtt_samples,
                "goodput_kbps": round(goodput_bps / 1024, 2),
                "throughput_kbps": round(throughput_bps / 1024, 2),
                "loss_percent": round(loss_percent, 2),
                "eta_seconds": round(eta, 1) if eta is not None else None,
                # feature scoping
                "checksum": "enabled",
                "resume": "enabled",
                "resumed_from_seq": self.resumed_from_seq,
                "resumed_bytes": self.resumed_bytes,
            }

    def packet_log(self, limit=150):
        """Most recent packet log entries (ordered by send time)."""
        with self._lock:
            seqs = self._packet_order[-limit:]
            return [self.packets[s] for s in seqs]

    def recent_feed(self, limit=500):
        with self._lock:
            return list(self.feed[-limit:])

    # ------------------------------------------------------------------ resume
    def resume_check(self, name, size):
        """Is an interrupted copy of (name, size) waiting in receive dir?

        Works even when the server is stopped: the partial file + its sidecar
        meta live on disk and survive a full receiver restart.
        """
        with self._lock:
            ps = int(self.config["packet_size"])
            cand = find_partial(self._received_dir(), protocol.safe_filename(name),
                                size, ps)
            if not cand:
                return {"available": False, "resumed_seq": 0,
                        "received_bytes": 0, "total_packets": 0,
                        "file_size": size, "percent": 0.0}
            total = math.ceil(size / ps) if ps > 0 else 0
            seq, aligned = resume_point(cand["received"], size, ps, total)
            return {
                "available": seq > 0,
                "resumed_seq": seq,
                "received_bytes": aligned,
                "total_packets": total,
                "file_size": size,
                "percent": round((aligned / size) * 100, 1) if size else 0.0,
            }

    def resume_discard(self, name, size):
        """Delete a pending partial (the 'start over' path)."""
        with self._lock:
            cand = find_partial(self._received_dir(), protocol.safe_filename(name),
                                size, None)
            if not cand:
                return {"ok": False, "error": "no partial transfer found"}
            discard_partial(cand)
            self._log(f"Discarded partial transfer for '{name}' "
                      f"({cand['received']}B removed)")
            return {"ok": True, "message": "partial transfer discarded"}

    # ------------------------------------------------------------------
    @staticmethod
    def _received_dir():
        import os
        # repo root = three levels up from transfer/manager.py
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(root, "transfers", "received")


manager = TransferManager()