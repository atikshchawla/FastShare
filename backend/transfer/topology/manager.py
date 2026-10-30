"""TopologyManager: node lifecycle, route push-down and stats (spec §3/§6).

Owns every preset ``Forwarder``, positions the receiver on the destination
node's port (rebind = stop -> set port -> start; ``.part``/``.meta`` files
survive, so resume keeps working across hops) and aggregates the per-link
counters for ``GET /api/topology``.

It reaches the controller through the ``TransferManager`` instance injected
at construction and MUST NOT import ``transfer.manager`` (that module
imports this package). Locking rules:

* the server is re-bound with NO TopologyManager lock held, so the receiver
  thread can always log through the TransferManager lock without inverting
  the order (TransferManager -> TopologyManager everywhere else),
* forwarders never call back into either manager, so joining their threads
  while holding a lock is safe.
"""

import threading
import time
from collections import deque

from .forwarder import Forwarder
from .graph import PRESETS, all_paths
from .process_node import ProcessHandle

# Tri-path is the flagship topology (multi-path feature); the extended star
# stays available via POST /api/topology/preset.
DEFAULT_SOURCE = "src"
DEFAULT_DEST = "dst"

_ZERO = {"data_packets": 0, "ack_packets": 0, "dropped": 0}
_MAX_NODE_LOG = 1000      # per-node ring (per-packet lines on small files)
# Safety-net ceiling for joining a booting child (its start() is already
# bounded by _READY_TIMEOUT in process_node.py); stops a wedged child from
# hanging start_all() forever.
_BOOT_JOIN_TIMEOUT = 8.0


class TopologyManager:
    def __init__(self, transfer_manager):
        self._tm = transfer_manager
        preset = PRESETS["tri"]      # main topology: 3 node-disjoint lanes
        self.preset_name = preset.id
        self.topology = preset.topology
        self.source_id = preset.source
        self.dest_id = preset.dest
        self.route: list[str] | None = None
        self._lock = threading.RLock()
        # Per-node overrides (latency / loss / corruption / enabled); they
        # persist for the process lifetime and win over the global config.
        self._node_overrides: dict[str, dict] = {}
        # Per-PC log rings ({node_id: deque[{t, text}]}) — fed by in-process
        # forwarder sinks or ProcessHandle reader threads.
        self._logs: dict[str, deque] = {}
        self._logs_lock = threading.Lock()
        # Handles are rebuilt when the execution flavour or preset changes
        # (config["topology_isolated"]: child processes vs local threads).
        self._handles_mode: tuple | None = None
        self._handles_guard = threading.Lock()
        self._forwarders: dict = {}
        # Source-side multipath policy (PathScheduler defaults) — patched via
        # POST /api/topology/multipath/config, handed to each new client.
        self.multipath: dict = {
            "enabled": True,
            "window": 100,
            "flag_loss": 0.20,
            "recover_loss": 0.10,
            "probe_share": 0.10,
            "explore_per_lane": 10,
            "min_samples": 25,
        }
        self._ensure_handles()

    # ------------------------------------------------------------- helpers
    @property
    def enabled(self) -> bool:
        return bool(self._tm.config.get("topology_enabled"))

    def _isolate(self) -> bool:
        # default False: a missing key must never silently spawn children
        # (TransferManager always sets it explicitly; tests clear config)
        return bool(self._tm.config.get("topology_isolated", False))

    def _node_log_sink(self, node_id: str):
        return lambda text: self._append_log(node_id, text)

    def _append_log(self, node_id: str, text: str) -> None:
        entry = {"t": time.time(), "text": str(text)}
        with self._logs_lock:
            ring = self._logs.setdefault(node_id, deque(maxlen=_MAX_NODE_LOG))
            ring.append(entry)

    def node_logs(self, node_id: str, limit: int = 200) -> list[dict]:
        """Recent per-PC log lines, oldest first (``GET .../node/{id}/logs``)."""
        self._ensure_handles()
        with self._lock:
            known = node_id in self._forwarders
        if not known:
            raise KeyError(f"unknown topology node: {node_id}")
        limit = max(1, min(int(limit), _MAX_NODE_LOG))
        with self._logs_lock:
            ring = self._logs.get(node_id)
            lines = list(ring) if ring else []
        return lines[-limit:]

    def _ensure_handles(self):
        """Build/rebuild the node handles for the active flavour + preset."""
        with self._handles_guard:
            want = (id(self.topology), self._isolate())
            if self._handles_mode == want and self._forwarders:
                return
            if self._forwarders:
                self.stop_all()
            if want[1]:
                self._forwarders = {
                    node.id: ProcessHandle(node.id, node.host, node.port,
                                           self._node_log_sink(node.id))
                    for node in self.topology.nodes
                }
            else:
                self._forwarders = {
                    node.id: Forwarder(node.id, node.host, node.port,
                                       log_sink=self._node_log_sink(node.id))
                    for node in self.topology.nodes
                }
            self._handles_mode = want

    # -------------------------------------------------------------- presets
    def set_preset(self, name: str) -> dict:
        """Switch the active graph (default picks follow the preset).

        Stops the current nodes' handles (child processes / threads) and
        rebuilds them for the new graph, clears the active route and resets
        ``source``/``dest`` to the preset defaults. Raises ``KeyError`` for
        an unknown preset, ``ValueError`` while a transfer is running.
        """
        try:
            preset = PRESETS[name]
        except KeyError:
            raise KeyError(f"unknown topology preset: {name}") from None
        if self._tm.transfer_status == "transferring":
            raise ValueError("cannot switch preset while a transfer is running")
        with self._lock:
            if name == self.preset_name:
                return {"ok": True, "preset": name,
                        "source": self.source_id, "dest": self.dest_id}
            self.preset_name = preset.id
            self.topology = preset.topology
            self.source_id = preset.source
            self.dest_id = preset.dest
            self.route = None
        self._ensure_handles()      # stops old handles, builds the new ones
        return {"ok": True, "preset": preset.id, "source": self.source_id,
                "dest": self.dest_id, "nodes": self.topology.node_ids}

    def paths_for(self, source=None, dest=None) -> list[list[str]]:
        """All simple lanes for the picks (``[]`` when unknown/equal)."""
        with self._lock:
            source = source or self.source_id or DEFAULT_SOURCE
            dest = dest or self.dest_id or DEFAULT_DEST
        try:
            return all_paths(self.topology, source, dest)
        except KeyError:
            return []

    @staticmethod
    def preset_catalog() -> list[dict]:
        return [{"id": p.id, "label": p.label, "source": p.source,
                 "dest": p.dest} for p in PRESETS.values()]

    def multipath_config(self, **patch) -> dict:
        """Patch the source-side multipath policy (None fields ignored)."""
        allowed = ("enabled", "window", "flag_loss", "recover_loss",
                   "probe_share", "explore_per_lane", "min_samples")
        with self._lock:
            for key, value in patch.items():
                if key not in allowed:
                    raise ValueError(f"unknown multipath option: {key}")
                if value is not None:
                    self.multipath[key] = value
            return dict(self.multipath)

    def dest_port(self) -> int:
        return self.topology.node(self.dest_id).port

    def _latency_ms(self) -> int:
        try:
            return max(0, int(self._tm.config.get("topology_latency_ms", 10)))
        except (TypeError, ValueError):
            return 10

    def _testing_probs(self):
        testing = self._tm.testing
        loss = testing["loss_probability"] if testing["loss_enabled"] else 0.0
        corrupt = testing["corrupt_probability"] if testing["corrupt_enabled"] else 0.0
        return loss, corrupt

    # ------------------------------------------------------- per-node config
    def _effective_config(self, node_id: str) -> dict:
        """Effective per-node values: the stored override wins over the
        global latency / testing config (this is what ``snapshot()`` and
        ``POST /topology/node/config`` report)."""
        with self._lock:
            override = dict(self._node_overrides.get(node_id) or {})
        testing = self._tm.testing
        return {
            "latency_ms": int(override.get("latency_ms", self._latency_ms())),
            "loss_enabled": bool(
                override.get("loss_enabled", testing["loss_enabled"])),
            "loss_probability": round(float(
                override.get("loss_probability",
                             testing["loss_probability"])), 3),
            "corrupt_enabled": bool(
                override.get("corrupt_enabled", testing["corrupt_enabled"])),
            "corrupt_probability": round(float(
                override.get("corrupt_probability",
                             testing["corrupt_probability"])), 3),
            "enabled": bool(override.get("enabled", True)),
        }

    def _effective_probs(self, node_id: str, global_loss: float,
                         global_corrupt: float) -> tuple[float, float]:
        """Applied forwarder probabilities. No override -> the caller's
        (already global) values; with an override the node's own enable
        flags and probabilities win."""
        with self._lock:
            override = dict(self._node_overrides.get(node_id) or {})
        if not override:
            return global_loss, global_corrupt
        testing = self._tm.testing
        loss_on = bool(override.get("loss_enabled", testing["loss_enabled"]))
        corrupt_on = bool(
            override.get("corrupt_enabled", testing["corrupt_enabled"]))
        loss = float(override.get("loss_probability",
                                  testing["loss_probability"]))
        corrupt = float(override.get("corrupt_probability",
                                     testing["corrupt_probability"]))
        return (loss if loss_on else 0.0), (corrupt if corrupt_on else 0.0)

    def node_config(self, node_id: str, *, reset: bool = False,
                    latency_ms=None, loss_enabled=None, loss_probability=None,
                    corrupt_enabled=None, corrupt_probability=None,
                    enabled=None) -> dict:
        """Store and live-apply a per-node override.

        Only fields that are not ``None`` are patched; ``reset`` drops the
        node's whole override so it follows the global config again.
        Raises ``KeyError`` for an unknown node id.
        """
        self._ensure_handles()
        with self._lock:
            if node_id not in self._forwarders:
                raise KeyError(f"unknown topology node: {node_id}")
            if reset:
                self._node_overrides.pop(node_id, None)
            else:
                updates = {
                    key: value for key, value in {
                        "latency_ms": latency_ms,
                        "loss_enabled": loss_enabled,
                        "loss_probability": loss_probability,
                        "corrupt_enabled": corrupt_enabled,
                        "corrupt_probability": corrupt_probability,
                        "enabled": enabled,
                    }.items() if value is not None
                }
                self._node_overrides.setdefault(node_id, {}).update(updates)
            effective = self._effective_config(node_id)
            self._apply_node_config(node_id, effective)
            return effective

    def _apply_node_config(self, node_id: str, effective: dict):
        """Push the effective values onto the forwarder (live)."""
        forwarder = self._forwarders[node_id]
        forwarder.latency_ms = effective["latency_ms"]
        forwarder.loss_probability = (
            effective["loss_probability"] if effective["loss_enabled"] else 0.0)
        forwarder.corrupt_probability = (
            effective["corrupt_probability"]
            if effective["corrupt_enabled"] else 0.0)
        if not effective["enabled"]:
            # the node acts down: drop its route and stop its socket so the
            # snapshot reports up:false (prepare_transfer surfaces the loss)
            forwarder.clear_route()
            if forwarder.running:
                forwarder.stop()
            return
        server = self._tm.server
        if (server is not None and self._tm.server_status == "running"
                and server.bound_port != forwarder.port
                and not forwarder.running):
            try:
                forwarder.start()
            except OSError:
                pass  # port in use elsewhere -> stays down, snapshot shows it

    # ------------------------------------------------------------ lifecycle
    def start_all(self, exclude_port=None) -> list[str]:
        """Start forwarders on every node except the receiver's port.

        Also re-applies the latency + simulation config — per-node overrides
        win over the global values, and a node disabled by override is never
        (re)started. Returns the ids of nodes whose bind failed (caller
        decides how loud to be).
        """
        self._ensure_handles()
        loss_p, corrupt_p = self._testing_probs()
        failed = []
        pending = []   # (node_id, handle) that still needs a start
        for node in self.topology.nodes:
            if exclude_port is not None and node.port == exclude_port:
                continue
            fwd = self._forwarders[node.id]
            effective = self._effective_config(node.id)
            if not effective["enabled"]:
                if fwd.running:
                    fwd.stop()
                continue
            node_loss, node_corrupt = self._effective_probs(
                node.id, loss_p, corrupt_p)
            fwd.latency_ms = effective["latency_ms"]
            fwd.loss_probability = node_loss
            fwd.corrupt_probability = node_corrupt
            if fwd.running:
                continue
            pending.append((node.id, fwd))
        if not pending:
            return failed
        isolated = any(isinstance(fwd, ProcessHandle) for _, fwd in pending)
        if isolated and len(pending) > 1:
            # boot every child in parallel: python cold start dominates
            errors: dict[str, str] = {}

            def _boot(item):
                node_id, fwd = item
                try:
                    fwd.start()
                except OSError as exc:
                    errors[node_id] = str(exc)

            threads = [threading.Thread(target=_boot, args=(item,),
                                        daemon=True)
                       for item in pending]
            for thread in threads:
                thread.start()
            for thread, (node_id, _) in zip(threads, pending):
                # bounded join: a wedged child must not hang start_all()
                # (and with it the API call) forever
                thread.join(timeout=_BOOT_JOIN_TIMEOUT)
                if thread.is_alive():
                    errors.setdefault(node_id, "node start timed out")
            failed.extend(node_id for node_id, _ in pending
                          if node_id in errors)
        else:
            for node_id, fwd in pending:
                try:
                    fwd.start()
                except OSError:
                    failed.append(node_id)
        return failed

    def stop_all(self):
        for fwd in self._forwarders.values():
            if fwd.running:
                fwd.stop()

    def clear_route(self):
        """Route goes back to ``null`` when the demo is idle (spec §6)."""
        with self._lock:
            self.route = None

    def patch_testing(self, loss_p, corrupt_p):
        """Live-patch the simulated loss/corruption on every forwarder.

        Nodes with their own override keep their probabilities — the global
        patch must not clobber per-node settings.
        """
        self._ensure_handles()
        for node_id, fwd in self._forwarders.items():
            node_loss, node_corrupt = self._effective_probs(
                node_id, loss_p, corrupt_p)
            fwd.loss_probability = node_loss
            fwd.corrupt_probability = node_corrupt

    # -------------------------------------------------------------- routing
    def prepare_transfer(self, server, source=None, dest=None) -> dict:
        """Validate the pick, park the receiver on ``dest`` and push the route.

        Order: validate -> free the destination port -> rebind the receiver
        -> ensure every other node forwards (self-heals a flag toggled after
        ``start_server``) -> configure the interior hops -> reset per-link
        stats. Returns ``{"ok", "route", "target_port", "lanes"}`` or
        ``{"ok": False, "error"}``. The client targets ``route[1]``: the
        source node's identity IS the client socket (spec §3), so the first
        hop is ``route[1]`` (which equals ``dest`` on a direct two-node
        route).

        Every simple lane between the picks gets its interior hops
        configured (multipath Phase 2): on the star preset that is exactly
        one lane (unchanged behaviour), on the tri-path preset all three
        lanes are live at once. ``lanes`` describes each one for the
        client/UI: ``{"nodes", "entry_host", "entry_port"}``.
        """
        self._ensure_handles()
        if server is None:
            return {"ok": False,
                    "error": "UDP server is not running -- start the receiver first"}
        with self._lock:
            source = source or self.source_id or DEFAULT_SOURCE
            dest = dest or self.dest_id or DEFAULT_DEST
        try:
            paths = all_paths(self.topology, source, dest)
        except KeyError as exc:
            return {"ok": False,
                    "error": f"unknown topology node: {exc.args[0]}"}
        if not paths:
            return {"ok": False, "error": "source and destination must differ"}
        route = paths[0]

        dest_node = self.topology.node(dest)

        # 1) the destination node's port must be free for the receiver
        dest_fwd = self._forwarders[dest]
        dest_was_running = dest_fwd.running
        if dest_was_running:
            dest_fwd.stop()

        # 2) rebind the receiver BEFORE starting forwarders: the previous
        #    destination node's port only becomes a forwarder port once the
        #    receiver has released it (outside any TopologyManager lock:
        #    the server thread may log through the TransferManager lock)
        if server.port != dest_node.port:
            old_port = server.port
            server.stop()
            server.port = dest_node.port
            try:
                server.start()
            except OSError as exc:
                server.port = old_port
                try:
                    server.start()
                except OSError:
                    pass
                if dest_was_running:
                    try:
                        dest_fwd.start()
                    except OSError:
                        pass
                return {"ok": False,
                        "error": f"could not bind destination port "
                                 f"{dest_node.port}: {exc}"}
            if self._tm.server is not server:
                # stop_server raced the rebind: do not leave a ghost receiver
                server.stop()
                return {"ok": False,
                        "error": "receiver was stopped during topology setup"}

        # 3) every other node must forward (self-heals a flag toggled after
        #    start_server); the receiver now owns the destination port
        failed = self.start_all(exclude_port=dest_node.port)
        if failed:
            with self._lock:
                self.route = None
            return {"ok": False,
                    "error": "could not bind node port(s): " + ", ".join(failed)}

        # 4) interior hops of EVERY lane forward; everyone else (incl. each
        #    lane's client side and the receiver) gets no route -> drops
        with self._lock:
            for fwd in self._forwarders.values():
                fwd.clear_route()
            for path in paths:
                count = len(path)
                for i in range(1, count - 1):
                    prev_node = self.topology.node(path[i - 1])
                    next_node = self.topology.node(path[i + 1])
                    self._forwarders[path[i]].set_route(
                        prev_addr=None if i == 1 else (prev_node.host, prev_node.port),
                        next_addr=(next_node.host, next_node.port),
                        prev_is_client=(i == 1),
                        next_is_dest=(i + 1 == count - 1),
                        prev_link=self.topology.link_between(path[i - 1], path[i]).id,
                        next_link=self.topology.link_between(path[i], path[i + 1]).id,
                    )
            for fwd in self._forwarders.values():
                fwd.reset_stats()
            self.route = route
            self.source_id = source
            self.dest_id = dest
        lanes = [
            {"nodes": path,
             "entry_host": self.topology.node(path[1]).host,
             "entry_port": self.topology.node(path[1]).port}
            for path in paths
        ]
        return {"ok": True, "route": route, "lanes": lanes,
                "target_port": self.topology.node(route[1]).port}

    # -------------------------------------------------------------- snapshot
    def snapshot(self, server_port=None, server_running=False,
                 fallback=None) -> dict:
        """``GET /api/topology`` payload (spec §6).

        ``fallback`` carries the TransferManager counters; they stand in for
        the single link of a direct two-node route, where the client talks
        straight to the receiver and no forwarder is there to count.
        """
        self._ensure_handles()
        # pull exact counters from the isolated children (they push them
        # every 250 ms too — this just closes the last race window).
        # Refresh in PARALLEL: a sequential request/reply over each child's
        # pipe cost up to 250 ms x 7 nodes per topology poll.
        pulls = [threading.Thread(target=fn, kwargs={"timeout": 0.25},
                                  daemon=True)
                 for fwd in self._forwarders.values()
                 if (fn := getattr(fwd, "refresh_stats", None)) is not None]
        for pull in pulls:
            pull.start()
        for pull in pulls:
            pull.join(timeout=0.4)
        with self._lock:
            route = list(self.route) if self.route else None
            source, dest = self.source_id, self.dest_id
            enabled = bool(self._tm.config.get("topology_enabled"))
            preset = self.preset_name
            multipath = dict(self.multipath)
        try:
            paths = all_paths(self.topology, source, dest)
        except KeyError:
            paths = []

        aggregated = {}
        for fwd in self._forwarders.values():
            for link_id, counts in fwd.link_stats().items():
                agg = aggregated.setdefault(link_id, dict(_ZERO))
                for key in agg:
                    agg[key] += counts[key]

        # Reported latency = the delay the links actually simulate. The
        # runtime knob (config.topology_latency_ms) is pushed to every
        # forwarder by start_all(), so a running forwarder is the source of
        # truth; with nothing running (idle snapshot) fall back to config.
        # The preset's 10 ms is only the default of that knob, and showing
        # it while 2 ms is being applied would misreport the network.
        latency = self._latency_ms()
        for fwd in self._forwarders.values():
            if fwd.running:
                latency = fwd.latency_ms
                break

        direct_link = None
        if route is not None and len(route) == 2:
            link = self.topology.link_between(route[0], route[1])
            if link is not None:
                direct_link = link.id

        link_stats = {}
        for link in self.topology.links:
            if link.id == direct_link and fallback:
                counts = {
                    "data_packets": fallback["packets_sent"]
                    + fallback["retransmissions"],
                    "ack_packets": fallback["packets_acked"],
                    "dropped": fallback["packets_lost"],
                }
            else:
                counts = aggregated.get(link.id, dict(_ZERO))
            link_stats[link.id] = {**counts, "latency_ms": latency}

        nodes = []
        for node in self.topology.nodes:
            forwarder = self._forwarders[node.id]
            up = forwarder.running or (server_running and server_port == node.port)
            nodes.append({"id": node.id, "label": node.label, "role": node.role,
                          "host": node.host, "port": node.port, "up": bool(up),
                          "config": self._effective_config(node.id)})
        links = [{"id": link.id, "a": link.a, "b": link.b,
                  "latency_ms": latency} for link in self.topology.links]
        return {"enabled": enabled, "nodes": nodes, "links": links,
                "route": route, "source": source, "dest": dest,
                "link_stats": link_stats, "preset": preset,
                "presets": self.preset_catalog(), "paths": paths,
                "multipath": multipath}


__all__ = ["TopologyManager", "DEFAULT_SOURCE", "DEFAULT_DEST"]
