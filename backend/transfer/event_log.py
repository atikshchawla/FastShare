"""Bounded event containers that feed the live UI.

Three views over the same transfer:
- ``feed``    -- human-readable log lines (protocol trace console)
- ``packets`` -- per-sequence table entries (packet monitor), keyed by seq
                 with an insertion-order list and a hard cap. Keeps only the
                 LATEST status per seq (a table, not a log).
- ``stream``  -- append-only list of EVERY status transition, each with a
                 monotonically increasing ``id`` (a log, not a table). This
                 is what the animated canvas consumes: a frontend cursor
                 (``since``) drains it so fast transitions like
                 TIMEOUT -> RETRANSMITTED survive between 500 ms polls.
"""

import time

from .constants import MAX_EVENT_STREAM, MAX_FEED, MAX_LOG_ENTRIES


class EventLog:
    def __init__(self):
        # Cursor high-water. Monotonic across transfers (NOT reset in
        # reset()): a stale frontend cursor from a previous transfer can then
        # never alias onto the new transfer's lower ids.
        self.next_id = 1
        self.reset()

    def reset(self):
        self.feed = []              # [{"t": epoch, "text": str}, ...]
        self.packets = {}           # seq -> last packet entry
        self.order = []             # insertion order of seqs (for trimming)
        self.stream = []            # append-only transitions (ring, ids asc)

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
        derive sizes without double counting. Every tabulated transition is
        also appended to ``stream`` (with a fresh monotonic id) so the canvas
        can observe transitions the table would otherwise overwrite.
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
            self.stream.append({
                "id": self.next_id,
                "t": time.time(),
                "seq": entry["seq"],
                "type": entry["type"],
                "status": entry["status"],
                "retries": entry.get("retries", 0),
                "lane": entry.get("lane"),
                "rtt_ms": entry.get("rtt_ms"),
                "size": entry.get("size", 0),
            })
            self.next_id += 1
            if len(self.stream) > MAX_EVENT_STREAM:
                self.stream = self.stream[-MAX_EVENT_STREAM:]
        return prev

    # ---- read side -----------------------------------------------------
    def packet_log(self, limit=150):
        """Most recent packet entries, oldest first."""
        seqs = self.order[-limit:]
        return [self.packets[s] for s in seqs]

    def recent_feed(self, limit=500):
        return list(self.feed[-limit:])

    def current_cursor(self):
        """High-water event id (frontend passes this back as ``since``)."""
        return self.next_id - 1

    def packet_events(self, since=0, limit=500):
        """Append-only transitions for the animated canvas.

        Returns ``(events, cursor, gap)``:
        - ``events``: entries with ``id > since``, oldest first, capped at
          ``limit``. ``since < 0`` (cold start) returns the whole retained
          backlog so a freshly-loaded page catches up in one shot.
        - ``cursor``: the current high-water id to send back next poll.
        - ``gap``: True when ``since`` fell behind the retained ring (some
          intermediate events were trimmed away) — the client may want a
          full resync. Rare in practice (the ring holds 2000 events).
        """
        cursor = self.current_cursor()
        if since < 0:
            return list(self.stream[-limit:]), cursor, False
        gap = bool(self.stream) and self.stream[0]["id"] > since + 1
        events = [e for e in self.stream if e["id"] > since][-limit:]
        return events, cursor, gap
