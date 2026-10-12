"""Bounded event containers that feed the live UI.

Two views over the same transfer:
- ``feed``   -- human-readable log lines (protocol trace console)
- ``packets``-- per-sequence table entries (packet monitor), keyed by seq
                with an insertion-order list and a hard cap
"""

import time

from .constants import MAX_FEED, MAX_LOG_ENTRIES


class EventLog:
    def __init__(self):
        self.reset()

    def reset(self):
        self.feed = []              # [{"t": epoch, "text": str}, ...]
        self.packets = {}           # seq -> last packet entry
        self.order = []             # insertion order of seqs (for trimming)

    # ---- write side ----------------------------------------------------
    def log(self, text):
        """Append one line to the human-readable feed (caller holds the lock)."""
        self.feed.append({"t": time.time(), "text": text})
        if len(self.feed) > MAX_FEED:
            self.feed = self.feed[-MAX_FEED:]

    def record(self, entry):
        """Store a packet event; returns the previous entry for this seq.

        Only DATA-bearing types (START/DATA/END) are tabulated; ACK-only
        noise is ignored. The caller uses the returned previous entry to
        derive sizes without double counting.
        """
        seq = entry["seq"]
        prev = self.packets.get(seq)
        if entry["type"] in ("START", "DATA", "END"):
            self.packets[seq] = entry
            if prev is None:
                self.order.append(seq)
            if len(self.order) > MAX_LOG_ENTRIES:
                drop = self.order.pop(0)
                self.packets.pop(drop, None)
        return prev

    # ---- read side -----------------------------------------------------
    def packet_log(self, limit=150):
        """Most recent packet entries, oldest first."""
        seqs = self.order[-limit:]
        return [self.packets[s] for s in seqs]

    def recent_feed(self, limit=500):
        return list(self.feed[-limit:])
