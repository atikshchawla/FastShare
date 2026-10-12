"""Isolated topology node ("PC") — one Forwarder per OS process.

Spawned by TopologyManager (ProcessHandle) as::

    python -m transfer.topology.node_main --id ch1 --host 127.0.0.1 --port 6103

The child speaks **JSON lines** on stdin (commands) and stdout (events),
UTF-8, every line flushed — the parent owns both pipes:

  parent -> child (stdin)
    {"cmd":"configure","tag":N,"latency_ms":10,"loss":0.0,"corrupt":0.0}
    {"cmd":"route","tag":N,"route":{"prev":[h,p]|None,"next":[h,p],
         "prev_link":..,"next_link":..,"prev_is_client":..,"next_is_dest":..}}
    {"cmd":"clear_route","tag":N}   {"cmd":"reset_stats","tag":N}
    {"cmd":"stats","tag":N}         {"cmd":"shutdown","tag":N}

  child -> parent (stdout)
    {"event":"ready","port":N}          forwarder bound and receiving
    {"event":"error","text":...}        bind failed / fatal (exit code 1)
    {"event":"log","t":epoch,"text":..} per-PC log line (incl. Forwarder's)
    {"event":"ack","tag":N}             command applied
    {"event":"stats","tag":N,"links":{link_id: {data_packets, ack_packets,
                                                dropped}}}  counters snapshot

EOF on stdin (parent died or closed the pipe) shuts the forwarder down
cleanly, so children never outlive their controller.
"""

import argparse
import json
import os
import sys
import threading
import time

from .forwarder import Forwarder


def _route_kwargs(route: dict) -> dict:
    prev = route.get("prev")
    nxt = route.get("next")
    if nxt is None:
        raise ValueError("route.next is required")
    return {
        "prev_addr": tuple(prev) if prev else None,
        "next_addr": tuple(nxt),
        "prev_link": route.get("prev_link"),
        "next_link": route.get("next_link"),
        "prev_is_client": bool(route.get("prev_is_client")),
        "next_is_dest": bool(route.get("next_is_dest")),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="FastShare isolated node")
    parser.add_argument("--id", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args(argv)

    # Every stdout line is written under one lock (Forwarder log sink,
    # stats thread and the command loop all share the pipe).
    out_lock = threading.Lock()

    def emit(obj: dict) -> None:
        with out_lock:
            sys.stdout.write(json.dumps(obj) + "\n")
            sys.stdout.flush()

    def log(text: str) -> None:
        emit({"event": "log", "t": time.time(), "text": text})

    fwd = None
    try:
        fwd = Forwarder(args.id, args.host, args.port, log_sink=log)
        fwd.start()
    except OSError as exc:
        emit({"event": "error", "text": f"bind failed: {exc}"})
        if fwd is not None:
            try:
                fwd.stop()
            except Exception:  # noqa: BLE001 - best effort on the way out
                pass
        return 1

    emit({"event": "ready", "port": fwd.bound_port})
    log(f"isolated node '{args.id}' up (pid {os.getpid()})")

    # Configuration delta log: only announce real changes (the parent may
    # re-send the same values on every start_all()).
    applied = {"latency_ms": fwd.latency_ms, "loss": 0.0, "corrupt": 0.0}
    stats_stop = threading.Event()

    def stats_loop():
        while not stats_stop.wait(0.25):
            emit({"event": "stats", "links": fwd.link_stats()})

    threading.Thread(target=stats_loop, name=f"stats-{args.id}",
                     daemon=True).start()

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            cmd = msg.get("cmd")
            tag = msg.get("tag")
            shutdown = False
            try:
                if cmd == "configure":
                    nxt = {
                        "latency_ms": int(msg.get("latency_ms", 10)),
                        "loss": float(msg.get("loss", 0.0)),
                        "corrupt": float(msg.get("corrupt", 0.0)),
                    }
                    fwd.latency_ms = nxt["latency_ms"]
                    fwd.loss_probability = nxt["loss"]
                    fwd.corrupt_probability = nxt["corrupt"]
                    if nxt != applied:
                        applied = nxt
                        log(f"config: latency={nxt['latency_ms']}ms "
                            f"loss={int(nxt['loss'] * 100)}% "
                            f"corrupt={int(nxt['corrupt'] * 100)}%")
                elif cmd == "route":
                    fwd.set_route(**_route_kwargs(msg.get("route") or {}))
                elif cmd == "clear_route":
                    fwd.clear_route()
                elif cmd == "reset_stats":
                    fwd.reset_stats()
                elif cmd == "stats":
                    emit({"event": "stats", "tag": tag,
                          "links": fwd.link_stats()})
                    tag = None   # stats already carried the reply
                elif cmd == "shutdown":
                    shutdown = True
                else:
                    log(f"unknown command: {cmd!r}")
            except (KeyError, TypeError, ValueError) as exc:
                emit({"event": "error",
                      "text": f"bad {cmd!r} command: {exc}"})
            if tag is not None:
                emit({"event": "ack", "tag": tag})
            if shutdown:
                break
    finally:
        stats_stop.set()
        try:
            fwd.stop()
        finally:
            log(f"isolated node '{args.id}' down")
    return 0


if __name__ == "__main__":
    sys.exit(main())
