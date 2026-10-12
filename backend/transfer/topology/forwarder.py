"""Forwarder: one real UDP socket per topology node (spec §3 / §5).

A Forwarder is a transparent bridge inside the active route — it runs no
ARQ of its own (end-to-end Stop-and-Wait stays at the client/receiver).
For every datagram it:

1. classifies the direction by sender address (route peers only — anything
   else is ignored),
2. applies the global simulated **loss** (drop counted on the arrival link),
3. applies the simulated **corruption** on arrival — CRC-32 then rejects the
   packet and it is dropped on the arrival link (same convention as
   udp.server/udp.corrupt at receive time),
4. counts the packet on the arrival link (DATA/START/END vs ACK), plus a
   transmit-side count on links whose far end has no counter of its own
   (the destination receiver / the client socket),
5. re-sends it to the other route neighbour after ``latency_ms`` from a
   priority queue, which preserves datagram ordering.

Per-link counters are aggregated by TopologyManager (spec §5); latency for
the *displayed* link comes from the topology graph, while the simulated
delay applied here comes from ``latency_ms`` (config ``topology_latency_ms``).
"""

import itertools
import queue
import random
import socket
import threading
import time
from dataclasses import dataclass, replace

from udp import protocol
from udp.packet import ChecksumError, corrupt_datagram, parse_packet

_RECV_TIMEOUT = 0.2   # seconds; same cadence as udp.server so stop() stays responsive


def _empty_counters() -> dict:
    return {"data_packets": 0, "ack_packets": 0, "dropped": 0}


def _noop_log(text: str) -> None:
    pass


@dataclass(frozen=True)
class RouteHop:
    """This node's position in the active route (forwarding direction)."""

    next_addr: tuple                 # neighbour toward the destination
    prev_addr: tuple | None = None   # None => learn from the first sender (client side)
    prev_is_client: bool = False     # prev endpoint never counts its own rx
    next_is_dest: bool = False       # dest receiver never counts its own rx
    prev_link: str | None = None     # link id prev<->self (None => not counted)
    next_link: str | None = None     # link id self<->next


class Forwarder:
    """Bound UDP socket that relays datagrams between its two route neighbours."""

    def __init__(self, node_id, host="127.0.0.1", port=0, latency_ms=10,
                 log_sink=None):
        self.node_id = node_id
        self.host = host
        self.port = port
        self.latency_ms = max(0, int(latency_ms))
        # Testing hooks — patched by TopologyManager from the global config
        # (same fields the server/client expose).
        self.loss_probability = 0.0
        self.corrupt_probability = 0.0
        # Human-readable per-node log sink (per-PC logs: TopologyManager
        # routes it into a ring buffer, node_main into JSON stdout).
        self._log = log_sink or _noop_log

        self._sock = None
        self._route: RouteHop | None = None
        self._stats: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._recv_thread = None
        self._worker_thread = None
        self._queue: queue.PriorityQueue = queue.PriorityQueue()
        self._seq = itertools.count()

    # ------------------------------------------------------------------ api
    @property
    def running(self) -> bool:
        return self._recv_thread is not None and self._recv_thread.is_alive()

    @property
    def bound_port(self) -> int:
        """Actual bound port (useful with port 0 in tests)."""
        if self._sock is not None:
            return self._sock.getsockname()[1]
        return self.port

    @property
    def route_addr(self) -> tuple | None:
        """Current forward target — ``None`` when no route is configured."""
        with self._lock:
            return None if self._route is None else self._route.next_addr

    def set_route(self, prev_addr, next_addr, *,
                  prev_link=None, next_link=None,
                  prev_is_client=False, next_is_dest=False):
        """Configure forwarding between the two route neighbours.

        ``prev_addr=None`` means "learn the sender address from the first
        packet" (the client socket's ephemeral port is unknown ahead of
        time). Clearing the link ids disables counting on that side while
        still forwarding.
        """
        with self._lock:
            self._route = RouteHop(
                next_addr=tuple(next_addr),
                prev_addr=None if prev_addr is None else tuple(prev_addr),
                prev_is_client=bool(prev_is_client),
                next_is_dest=bool(next_is_dest),
                prev_link=prev_link,
                next_link=next_link,
            )
            for link in (prev_link, next_link):
                if link:
                    self._stats.setdefault(link, _empty_counters())
        prev = "learn-from-first" if prev_addr is None else \
            f"{prev_addr[0]}:{prev_addr[1]}"
        self._log(f"route set: {prev} -> {next_addr[0]}:{next_addr[1]} "
                  f"(links {prev_link or '-'} -> {next_link or '-'})")

    def clear_route(self):
        """Drop the route — the node becomes a black hole (spec: non-route
        nodes drop every datagram)."""
        with self._lock:
            had = self._route is not None
            self._route = None
        if had:
            self._log("route cleared — this node drops every packet")

    def link_stats(self) -> dict:
        """Snapshot ``{link_id: {data_packets, ack_packets, dropped}}``."""
        with self._lock:
            return {link: dict(counts) for link, counts in self._stats.items()}

    def reset_stats(self):
        with self._lock:
            for link in self._stats:
                self._stats[link] = _empty_counters()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._queue = queue.PriorityQueue()   # stale delayed sends die with the old queue
        self._seq = itertools.count()
        self._setup_socket()                  # OSError (port busy) propagates to caller
        self._log(f"bound {self.host}:{self.bound_port}")
        self._recv_thread = threading.Thread(
            target=self._receive, name=f"fwd-{self.node_id}", daemon=True)
        self._worker_thread = threading.Thread(
            target=self._work, name=f"fwd-{self.node_id}-tx", daemon=True)
        self._recv_thread.start()
        self._worker_thread.start()

    def stop(self) -> None:
        was_running = self.running
        self._stop.set()
        sock = self._sock
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        for thread in (self._recv_thread, self._worker_thread):
            if thread is not None:
                thread.join(timeout=1.5)
        self._recv_thread = None
        self._worker_thread = None
        self._sock = None
        if was_running:
            self._log("forwarder stopped")
        # Keep the route/stats: TopologyManager re-reads them for the snapshot.

    # ------------------------------------------------------------- internals
    def _setup_socket(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # No SO_REUSEADDR: a port clash with the receiver must surface.
        self._sock.settimeout(_RECV_TIMEOUT)
        self._sock.bind((self.host, self.port))

    def _receive(self):
        while not self._stop.is_set():
            try:
                data, addr = self._sock.recvfrom(65536)
            except socket.timeout:
                continue
            except OSError:
                break  # socket closed by stop()
            try:
                self._handle(data, addr)
            except OSError:
                break

    def _handle(self, data, addr):
        with self._lock:
            route = self._route
        if route is None:
            self._log(f"drop: no route configured (from {addr[0]}:{addr[1]})")
            return  # no route configured -> drop (spec: non-route nodes drop)

        # Direction from the sender address; the client side is learned.
        if route.prev_addr is None:
            if addr == route.next_addr:
                direction = "out"
            else:
                route = replace(route, prev_addr=tuple(addr))
                with self._lock:
                    self._route = route
                direction = "in"
                self._log(f"learned client {addr[0]}:{addr[1]}")
        elif addr == route.prev_addr:
            direction = "in"
        elif addr == route.next_addr:
            direction = "out"
        else:
            self._log(f"DROP stranger {addr[0]}:{addr[1]}")
            return  # stranger on the socket -> not a route peer, drop

        arrival_link = route.prev_link if direction == "in" else route.next_link
        target = route.next_addr if direction == "in" else route.prev_addr
        if target is None:
            return  # reply side unknown yet (no DATA seen) -> nowhere to send

        # Best-effort header peek purely for the log line — validation of
        # the datagram still happens after the corruption step below, so
        # forwarding behaviour is unchanged.
        try:
            peek_seq, peek_ptype, _ = parse_packet(data)
            peek = f"{protocol.TYPE_NAMES.get(peek_ptype, '?')} #{peek_seq}"
        except Exception:  # noqa: BLE001 - logging only, never drop here
            peek = "malformed"

        if self.loss_probability > 0 and \
                random.random() < self.loss_probability:
            self._count(arrival_link, "dropped")
            self._log(f"DROP loss {peek} on {arrival_link or '?'}")
            return
        if self.corrupt_probability > 0 and \
                random.random() < self.corrupt_probability:
            data = corrupt_datagram(data)
        try:
            seq, ptype, _ = parse_packet(data)
        except (ChecksumError, ValueError):
            # Corrupted or malformed on the wire -> discarded here, counted
            # on the link it arrived over (retransmission heals it end-to-end).
            self._count(arrival_link, "dropped")
            self._log(f"DROP crc {peek} on {arrival_link or '?'}")
            return

        field = "ack_packets" if ptype == protocol.PACKET_TYPE_ACK \
            else "data_packets"
        self._count(arrival_link, field)
        # Transmit-side count only for links whose far end keeps no counter
        # of its own (destination receiver / client socket) — each link is
        # counted exactly once.
        if direction == "in":
            if route.next_is_dest:
                self._count(route.next_link, field)
        elif route.prev_is_client:
            self._count(route.prev_link, field)

        self._log(f"fwd {protocol.TYPE_NAMES.get(ptype, '?')} #{seq} "
                  f"{direction} {len(data)}B on {arrival_link or '?'}")
        due = time.monotonic() + self.latency_ms / 1000.0
        self._queue.put((due, next(self._seq), data, target))

    def _work(self):
        while not self._stop.is_set():
            try:
                due, _, data, addr = self._queue.get(timeout=_RECV_TIMEOUT)
            except queue.Empty:
                continue
            remaining = due - time.monotonic()
            if remaining > 0 and self._stop.wait(remaining):
                break  # stopping: pending datagrams are discarded
            try:
                self._sock.sendto(data, addr)
            except OSError:
                break  # socket closed by stop()

    def _count(self, link_id, field):
        if not link_id:
            return
        with self._lock:
            counts = self._stats.setdefault(link_id, _empty_counters())
            counts[field] += 1


__all__ = ["Forwarder", "RouteHop"]
