"""ProcessHandle: runs one topology node in its own OS process ("PC").

Duck-types the Forwarder surface TopologyManager uses — ``node_id``,
``host``, ``port``, ``latency_ms`` / ``loss_probability`` /
``corrupt_probability`` (read/write), ``running``, ``start()``, ``stop()``,
``set_route()``, ``clear_route()``, ``reset_stats()``, ``link_stats()`` — so
both flavours (in-process threads vs isolated children) flow through the
same manager code paths. Differences:

* ``start()`` spawns ``python -m transfer.topology.node_main`` and waits
  for its ``ready`` event (raises ``OSError`` like a bind failure does),
  ``stop()`` shuts it down (shutdown -> terminate -> kill);
* counters come back from the child (request/reply over the JSON-lines
  pipe); ``refresh_stats()`` pulls an exact snapshot for ``snapshot()``;
* the last route + config are cached and re-applied after a respawn, so a
  crashed/re-enabled node behaves like the in-process forwarder, which
  keeps them across ``stop()``/``start()``.
"""

import itertools
import json
import os
import subprocess
import sys
import threading

# repo root = three levels up from transfer/topology/process_node.py
BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_READY_TIMEOUT = 5.0     # python cold start + bind
_REQUEST_TIMEOUT = 1.5   # round trip for route/stats/ack commands
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class ProcessHandle:
    def __init__(self, node_id, host, port, on_log):
        self.node_id = node_id
        self.host = host
        self.port = port
        self._on_log = on_log          # callable(text) -> parent ring buffer
        self._lock = threading.RLock() # guards cfg/route/stats caches
        self._io_lock = threading.Lock()  # serialises stdin writes
        self._proc: subprocess.Popen | None = None
        self._reader: threading.Thread | None = None
        self._ready = threading.Event()
        self._last_error: str | None = None
        self._expect_stop = False
        self._tag = itertools.count(1)
        self._waiters: dict[int, threading.Event] = {}
        self._wait_data: dict[int, dict | None] = {}
        self._stats: dict[str, dict] = {}
        self._route_cache: dict | None = None
        self._cfg = {"latency_ms": 10, "loss": 0.0, "corrupt": 0.0}

    # -------------------------------------------------- config attr surface
    @property
    def latency_ms(self) -> int:
        with self._lock:
            return self._cfg["latency_ms"]

    @latency_ms.setter
    def latency_ms(self, value):
        self._set_cfg("latency_ms", max(0, int(value)))

    @property
    def loss_probability(self) -> float:
        with self._lock:
            return self._cfg["loss"]

    @loss_probability.setter
    def loss_probability(self, value):
        self._set_cfg("loss", float(value))

    @property
    def corrupt_probability(self) -> float:
        with self._lock:
            return self._cfg["corrupt"]

    @corrupt_probability.setter
    def corrupt_probability(self, value):
        self._set_cfg("corrupt", float(value))

    def _set_cfg(self, key, value):
        with self._lock:
            self._cfg[key] = value
            payload = dict(self._cfg)
        if self.running:
            self._write({"cmd": "configure", **payload})

    # ---------------------------------------------------------- lifecycle
    @property
    def running(self) -> bool:
        proc = self._proc
        return (proc is not None and proc.poll() is None
                and self._ready.is_set())

    def start(self) -> None:
        if self.running:
            return
        self._spawn()
        if not self._ready.wait(timeout=_READY_TIMEOUT):
            err = self._last_error or "node process did not become ready"
            self.stop()
            raise OSError(err)
        if self._last_error and not self.running:
            # child reported a bind failure and exited on its own
            err = self._last_error
            self.stop()
            raise OSError(err)
        # re-apply cached config + route (parity with the in-process
        # forwarder, which keeps them across stop()/start())
        with self._lock:
            payload = dict(self._cfg)
            route = self._route_cache
        self._write({"cmd": "configure", **payload})
        if route is not None:
            self._request({"cmd": "route", "route": route}, timeout=1.0)

    def stop(self) -> None:
        with self._lock:
            proc = self._proc
            if proc is None:
                return
            self._expect_stop = True
        if proc.poll() is None:
            try:
                self._write({"cmd": "shutdown"})
            except OSError:
                pass
            try:
                proc.wait(timeout=0.8)
            except subprocess.TimeoutExpired:
                proc.terminate()
                try:
                    proc.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    try:
                        proc.wait(timeout=0.5)
                    except subprocess.TimeoutExpired:
                        pass
        reader = self._reader
        if reader is not None and reader.is_alive() \
                and reader is not threading.current_thread():
            reader.join(timeout=1.0)
        with self._lock:
            self._proc = None
            self._reader = None
        self._ready.clear()
        self._on_log(f"isolated node '{self.node_id}' stopped")

    def _spawn(self) -> None:
        self._last_error = None
        self._expect_stop = False
        self._ready.clear()
        cmd = [sys.executable, "-m", "transfer.topology.node_main",
               "--id", self.node_id, "--host", self.host,
               "--port", str(self.port)]
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,   # tracebacks arrive as raw log lines
                cwd=BACKEND_DIR,
                text=True,
                bufsize=1,
                creationflags=_CREATE_NO_WINDOW,
            )
        except OSError as exc:
            self._last_error = f"spawn failed: {exc}"
            self._on_log(self._last_error)
            raise OSError(self._last_error) from exc
        with self._lock:
            self._proc = proc
        self._reader = threading.Thread(
            target=self._read_loop, args=(proc,),
            name=f"node-{self.node_id}-reader", daemon=True)
        self._reader.start()
        self._on_log(f"isolated node '{self.node_id}' spawned "
                     f"(pid {proc.pid})")

    # ------------------------------------------------------------- pipe io
    def _write(self, payload: dict) -> None:
        with self._io_lock:
            proc = self._proc
            if proc is None or proc.stdin is None:
                raise OSError(f"node '{self.node_id}' is not running")
            line = json.dumps(payload) + "\n"
            proc.stdin.write(line)
            proc.stdin.flush()

    def _request(self, payload: dict, timeout: float = _REQUEST_TIMEOUT):
        """Send a tagged command and wait for its ack/stats reply."""
        if not self.running:
            return None
        tag = next(self._tag)
        event = threading.Event()
        with self._lock:
            self._waiters[tag] = event
            self._wait_data[tag] = None
        try:
            self._write({**payload, "tag": tag})
        except OSError:
            with self._lock:
                self._waiters.pop(tag, None)
                self._wait_data.pop(tag, None)
            return None
        done = event.wait(timeout=timeout)
        with self._lock:
            data = self._wait_data.pop(tag, None)
            self._waiters.pop(tag, None)
        if not done:
            self._on_log(f"[{self.node_id}] command "
                         f"{payload.get('cmd')!r} timed out")
            return None
        return data

    def _read_loop(self, proc) -> None:
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    self._on_log(f"[{self.node_id}] {line}")
                    continue
                self._dispatch(msg)
        finally:
            self._ready.clear()
            if not self._expect_stop:
                code = proc.poll()
                if code is None:
                    try:
                        code = proc.wait(timeout=1.0)
                    except subprocess.TimeoutExpired:
                        code = "?"
                self._on_log(f"isolated node '{self.node_id}' exited "
                             f"(code {code})")

    def _dispatch(self, msg: dict) -> None:
        kind = msg.get("event")
        if kind == "log":
            self._on_log(msg.get("text", ""))
        elif kind == "stats":
            links = msg.get("links") or {}
            with self._lock:
                self._stats = links
            tag = msg.get("tag")
            if tag is not None:
                self._complete(tag, {"links": links})
        elif kind == "ack":
            self._complete(msg.get("tag"), {"ok": True})
        elif kind == "ready":
            self._ready.set()
        elif kind == "error":
            text = msg.get("text", "node error")
            with self._lock:
                self._last_error = text
            self._on_log(f"[{self.node_id}] error: {text}")
            if not self._ready.is_set():
                self._ready.set()   # wake the spawn waiter (it raises)
        else:
            self._on_log(f"[{self.node_id}] unknown event: {msg!r}")

    def _complete(self, tag, data) -> None:
        if tag is None:
            return
        with self._lock:
            if tag not in self._waiters:
                return
            self._wait_data[tag] = data
            event = self._waiters[tag]
        event.set()

    # ------------------------------------------------------ routing surface
    def set_route(self, prev_addr, next_addr, *,
                  prev_link=None, next_link=None,
                  prev_is_client=False, next_is_dest=False) -> None:
        route = {
            "prev": list(prev_addr) if prev_addr else None,
            "next": list(next_addr),
            "prev_link": prev_link,
            "next_link": next_link,
            "prev_is_client": bool(prev_is_client),
            "next_is_dest": bool(next_is_dest),
        }
        with self._lock:
            self._route_cache = route
        if self.running:
            self._request({"cmd": "route", "route": route})

    def clear_route(self) -> None:
        with self._lock:
            self._route_cache = None
        if self.running:
            self._request({"cmd": "clear_route"})

    def reset_stats(self) -> None:
        with self._lock:
            self._stats = {}
        if self.running:
            self._request({"cmd": "reset_stats"})

    def link_stats(self) -> dict:
        with self._lock:
            return {link: dict(counts)
                    for link, counts in self._stats.items()}

    def refresh_stats(self, timeout: float = 0.5) -> bool:
        """Pull an exact counters snapshot from the child (falls back to
        the last push when the child is slow or gone)."""
        if not self.running:
            return False
        return self._request({"cmd": "stats"}, timeout=timeout) is not None


__all__ = ["ProcessHandle", "BACKEND_DIR"]
