"""TransferManager: the single source of truth the API reads.

Responsibilities are deliberately thin -- the math, the bounded event log
and the on-disk resume store live in their own modules:
    transfer/constants.py   status values + size limits
    transfer/stats.py       RttSampler + derive_metrics (pure math)
    transfer/event_log.py   bounded feed + per-packet table
    udp/resume_fs.py        .part/.meta store (shared with the receiver)

What stays here: controller configuration, UDP server lifecycle, the
transfer lifecycle (client thread, state machine, cancel/resume), event
ingestion (every counter derives from emit_packet) and the thread-safe
status_snapshot() the HTTP layer serialises.
"""

import math
import os
import threading
import time

from udp import protocol
from udp.client import STATUS_ACKED, STATUS_FAILED, UDPClient
from udp.resume_fs import discard_partial, find_partial, resume_point
from udp.server import UDPServer

from .constants import (SS_ERROR, SS_RUNNING, SS_STOPPED, TS_CANCELLED,
                        TS_COMPLETED, TS_FAILED, TS_IDLE, TS_TRANSFERRING)
from .event_log import EventLog
from .stats import RttSampler, derive_metrics
from .topology import TopologyManager

__all__ = [
    "TransferManager", "manager",
    "TS_IDLE", "TS_TRANSFERRING", "TS_COMPLETED", "TS_FAILED", "TS_CANCELLED",
    "SS_STOPPED", "SS_RUNNING", "SS_ERROR",
]

# Above this many resumed packets, _on_resume records a single summary
# instead of replaying one ACK event per packet (which would stall the
# manager lock for ~100k iterations and flood the canvas event stream on a
# large resume). Small resumes still replay so the packet monitor looks right.
_RESUME_REPLAY_LIMIT = 1000


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
            # multi-server topology (FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md)
            "topology_enabled": False,
            "topology_latency_ms": 10,
            # per-PC isolation: every node runs in its own OS process with
            # per-node logs (tests flip this off for in-process speed)
            "topology_isolated": True,
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
        self.wire_bytes = 0            # every byte the sender put on the wire
        self.rtt = RttSampler()        # current/min/max/srtt (see stats.py)
        # resume state
        self.resumed_from_seq = 0      # first packet re-sent this session
        self.resumed_bytes = 0         # ... and how many bytes were reused
        self.started_at = None
        self.finished_at = None
        self.elapsed_seconds = 0.0
        self.received_path = None
        self.events = EventLog()       # feed + packet table for the UI
        self._cancel_requested = False
        # preset node graph + forwarder lifecycle (topology/manager.py)
        self.topology = TopologyManager(self)

    # ================================================================== events
    def _log(self, text):
        """Human-readable feed line (also the UDP client/server message sink)."""
        with self._lock:
            self.events.log(text)

    def emit_packet(self, entry):
        """Record a packet activity event coming from the UDP client/server.

        All transfer statistics are derived from these events (single source
        of truth), so nothing is double-counted:
          SENT           -> packets_sent += 1, bytes_sent += packet size
          RETRANSMITTED  -> retransmissions += 1, wire bytes += packet size
          TIMEOUT        -> packets_lost += 1
          ACKED (DATA)   -> packets_acked += 1, confirmed bytes += size,
                            RTT sample -> RttSampler
          FAILED         -> mark the failed sequence
        """
        with self._lock:
            prev = self.events.record(entry)
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
                    self.rtt.record(rtt)
            elif status == STATUS_FAILED:
                if entry["seq"] > self.current_sequence:
                    self.current_sequence = entry["seq"]

    # ================================================================== server
    def start_server(self):
        with self._lock:
            if self.server_status == SS_RUNNING:
                return {"ok": True, "message": "server already running"}
            topology_on = self.topology.enabled
            try:
                port = int(self.config["udp_port"])
            except (TypeError, ValueError):
                return {"ok": False, "error": "invalid server port"}
            if topology_on:
                # the receiver parks on the destination node (default hub);
                # start_transfer re-binds it when the pick changes
                port = self.topology.dest_port()

            loss_p = self.testing["loss_probability"] if self.testing["loss_enabled"] else 0.0
            corrupt_p = self.testing["corrupt_probability"] \
                if self.testing["corrupt_enabled"] else 0.0
            server = UDPServer(
                port=port,
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

        # Boot the topology forwarders OUTSIDE the manager lock: with
        # isolated (per-PC) nodes this blocks for seconds joining child
        # processes, and holding the lock would freeze the 500 ms status
        # poll right when a demo starts. Forwarders never call back into the
        # manager, so this ordering is deadlock-free.
        if topology_on:
            failed = self.topology.start_all(exclude_port=server.bound_port)
            if self.server is not server:
                # stop_server raced the boot: do not leave ghost forwarders
                self.topology.stop_all()
                return {"ok": False,
                        "error": "receiver was stopped during topology setup"}
            with self._lock:
                for node_id in failed:
                    self._log(f"WARNING: topology node '{node_id}' could not "
                              f"bind its port")
                if not failed:
                    hops = len(self.topology.topology.nodes) - 1
                    self._log(f"Topology online: {hops} forwarders + receiver "
                              f"on {self.topology.dest_id} ({port})")
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
        # Stopping the topology forwarders (and their isolated child
        # processes) can block for seconds; do it OUTSIDE the lock so the
        # status poll keeps responding while a demo shuts down. Forwarders
        # never call back, so there is no deadlock risk here.
        self.topology.stop_all()
        self.topology.clear_route()
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
            self.topology.patch_testing(loss_p, corrupt_p)
            self._log(
                f"Packet loss simulation {'ON' if loss_enabled else 'OFF'}"
                f" ({int(loss_p * 100)}%) | "
                f"corruption {'ON' if corrupt_enabled else 'OFF'}"
                f" ({int(corrupt_p * 100)}%)")
            return {"ok": True}

    # ================================================================== transfer
    def start_transfer(self, upload_path, file_name, resume=True,
                       source=None, dest=None):
        """Kick off a Stop-and-Wait transfer in a background thread.

        ``resume=True`` lets the START handshake continue an interrupted
        transfer's partial file; ``resume=False`` discards it and starts at
        packet 1. The server decides at handshake time, so no session reset
        happens here (the leftover partial must stay visible to START).

        With ``config["topology_enabled"]``, ``source``/``dest`` pick preset
        nodes (defaults: l1 -> hub): the receiver is re-bound to the
        destination node's port, the interior forwarders get their route,
        and the client targets ``route[1]`` — the source node's identity IS
        the client socket (spec §3). Ignored while the flag is off.
        """
        with self._lock:
            if self.transfer_status == TS_TRANSFERRING:
                return {"ok": False, "error": "a transfer is already running"}
            if self.server_status != SS_RUNNING or self.server is None:
                return {"ok": False,
                        "error": "UDP server is not running -- start the "
                                 "receiver first"}
            server = self.server
            topology_on = bool(self.config.get("topology_enabled"))

        # Topology preparation re-binds the receiver, so it must happen
        # OUTSIDE the manager lock (the receiver thread logs through us).
        route = None
        target_port = None
        lanes = None
        if topology_on:
            prep = self.topology.prepare_transfer(server, source, dest)
            if not prep["ok"]:
                return {"ok": False, "error": prep["error"]}
            route = prep["route"]
            target_port = prep["target_port"]
            lanes = prep.get("lanes")

        with self._lock:
            # re-check: the topology prep above yielded the lock
            if self.transfer_status == TS_TRANSFERRING:
                return {"ok": False, "error": "a transfer is already running"}
            if self.server_status != SS_RUNNING or self.server is None:
                return {"ok": False,
                        "error": "UDP server is not running -- start the "
                                 "receiver first"}
            if target_port is None:
                target_port = int(self.config["udp_port"])
            self._reset_transfer_state()
            self.file_name = file_name
            self.file_size = os.path.getsize(upload_path)
            self.total_packets = math.ceil(self.file_size / int(self.config["packet_size"]))
            self.transfer_status = TS_TRANSFERRING
            self._cancel_requested = False
            self.started_at = time.time()
            self._log(f"Starting transfer of '{file_name}' -> "
                      f"{self.config['server_ip']}:{target_port}"
                      f"{' (resume allowed)' if resume else ' (fresh)'}")
            if route:
                self._log(f"Route: {' -> '.join(route)} "
                          f"({len(route) - 1} hops)")

            loss_p = self.testing["loss_probability"] if self.testing["loss_enabled"] else 0.0
            corrupt_p = self.testing["corrupt_probability"] \
                if self.testing["corrupt_enabled"] else 0.0
            client = UDPClient(
                host=self.config["server_ip"],
                port=target_port,
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
                lanes=lanes,
                multipath=self.topology.multipath,
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
            if resumed_seq > _RESUME_REPLAY_LIMIT:
                # Large resume: replaying one ACK event per packet would spin
                # the manager lock for ~N iterations (stalling status polls)
                # and flood the canvas event stream. Record a summary that
                # lands the counters in the same place instead.
                self.confirmed_bytes += self.resumed_bytes
                self.packets_acked += resumed_seq
                if resumed_seq > self.current_sequence:
                    self.current_sequence = resumed_seq
                self._log(
                    f"Session resumed at packet #{resumed_seq + 1}: "
                    f"{self.resumed_bytes}B reused from disk "
                    f"({resumed_seq} packets, summary)")
                return
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
            server.reset_session()
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
        self.rtt.reset()
        self.resumed_from_seq = 0
        self.resumed_bytes = 0
        self.started_at = None
        self.finished_at = None
        self.elapsed_seconds = 0.0
        self.received_path = None
        self.events.reset()
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

            metrics = derive_metrics(
                elapsed_seconds=self.elapsed_seconds,
                confirmed_bytes=self.confirmed_bytes,
                resumed_bytes=self.resumed_bytes,
                file_size=self.file_size,
                wire_bytes=self.wire_bytes,
                packets_sent=self.packets_sent,
                retransmissions=self.retransmissions,
                total_packets=self.total_packets,
                packets_acked=self.packets_acked,
                is_completed=self.transfer_status == TS_COMPLETED,
            )

            return {
                # server
                "server_status": self.server_status,
                "server_error": self.server_error,
                "server_sessions": self.server_sessions,
                "server_port": (self.server.bound_port if self.server
                                else self.config["udp_port"]),
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
                "elapsed_seconds": round(self.elapsed_seconds, 2),
                "received_path": self.received_path,
                # performance statistics (see transfer/stats.py)
                "wire_bytes": self.wire_bytes,
                **self.rtt.as_dict(),
                **metrics,
                # feature scoping
                "checksum": "enabled",
                "resume": "enabled",
                "resumed_from_seq": self.resumed_from_seq,
                "resumed_bytes": self.resumed_bytes,
                # source-side multipath scheduler (live lane health)
                "scheduler": (self.client.scheduler.state()
                              if self.client is not None
                              and getattr(self.client, "scheduler", None)
                              is not None else None),
            }

    def packet_log(self, limit=150):
        """Most recent packet log entries (ordered by send time)."""
        with self._lock:
            return self.events.packet_log(limit)

    def packet_events(self, since=-1, limit=500):
        """Append-only packet transition stream for the animated canvas.

        Returns ``(events, cursor, gap)``; see ``EventLog.packet_events``.
        """
        with self._lock:
            return self.events.packet_events(since, limit)

    def recent_feed(self, limit=500):
        with self._lock:
            return self.events.recent_feed(limit)

    # ---------------------------------------------------------------- topology
    def topology_snapshot(self):
        """``GET /api/topology``: preset graph, active route, live link stats."""
        with self._lock:
            return self.topology.snapshot(
                server_port=self.server.bound_port if self.server else None,
                server_running=self.server_status == SS_RUNNING,
                fallback={
                    "packets_sent": self.packets_sent,
                    "retransmissions": self.retransmissions,
                    "packets_acked": self.packets_acked,
                    "packets_lost": self.packets_lost,
                },
            )

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
        # repo root = three levels up from transfer/manager.py
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(root, "transfers", "received")


manager = TransferManager()
