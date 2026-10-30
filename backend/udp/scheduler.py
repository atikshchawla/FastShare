"""Source-side multipath scheduler (multi-path Phase 3).

Chooses which lane (source -> destination path) the next Stop-and-Wait
transmission takes. Policy per the locked multipath decisions:

1. **explore** — round-robin across lanes for the first
   ``explore_per_lane`` attempts per lane (fresh view before judging),
2. **watch** — rolling ``window``-attempt history per lane; a lane whose
   ``window_loss >= flag_loss`` after ``min_samples`` attempts is FLAGGED
   (default: 100-attempt window, flag at 20% loss),
3. **shift** — flagged lanes share only ``probe_share`` of the traffic
   (kept in rotation so the flag can clear), healthy lanes split the rest
   weighted by ``1 - window_loss`` — traffic moves to the least-loss paths,
4. **hysteresis** — a flagged lane recovers only below ``recover_loss``,
   so the schedule does not flap.

Pure stdlib: ``udp.client`` imports it; the controller reads ``state()``.

Thread-safety: ``pick()`` / ``record()`` / ``state()`` are guarded by an
internal lock (the transfer thread mutates while the status poll reads).
Lock order is strictly **manager -> scheduler**: ``status_snapshot()``
holds the manager lock while reading ``state()``, so this class must never
call back into the manager while holding its own lock — ``on_event`` fires
*after* the lock is released.
"""

import random
import threading
from collections import deque


def _lane_name(index: int) -> str:
    return chr(ord("A") + index) if index < 26 else str(index)


class PathScheduler:
    def __init__(self, lane_count, *, enabled=True, window=100,
                 flag_loss=0.20, recover_loss=0.10, probe_share=0.10,
                 explore_per_lane=10, min_samples=None, on_event=None):
        self.lane_count = max(1, int(lane_count))
        self.enabled = bool(enabled)
        self.window = max(2, int(window))
        self.flag_loss = float(flag_loss)
        self.recover_loss = float(recover_loss)
        self.probe_share = min(max(float(probe_share), 0.0), 0.5)
        self.explore_per_lane = max(0, int(explore_per_lane))
        # when to first allow flagging: a quarter of the window, at least 2
        self.min_samples = (max(2, self.window // 4) if min_samples is None
                            else max(2, int(min_samples)))
        self.on_event = on_event or (lambda text: None)

        self._history = [deque(maxlen=self.window)
                         for _ in range(self.lane_count)]
        self._flagged = [False] * self.lane_count
        self._sent = [0] * self.lane_count
        self._lost = [0] * self.lane_count
        self._picks = 0
        self._rr = 0
        self._mode = "explore"
        self._weights = [1.0 / self.lane_count] * self.lane_count
        # guards pick/record/state across the transfer + status-poll threads
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- picks
    def pick(self) -> int:
        """Lane index for the next transmission."""
        with self._lock:
            n = self.lane_count
            if n == 1:
                self._mode = "single"
                return 0
            if not self.enabled:
                self._mode = "disabled"
                return 0
            self._picks += 1
            if self._picks <= self.explore_per_lane * n:
                self._mode = "explore"
                idx = (self._picks - 1) % n
            elif not any(self._flagged):
                self._mode = "round_robin"
                idx = self._rr
                self._rr = (self._rr + 1) % n
            else:
                self._mode = "weighted"
                idx = self._weighted_choice()
            return idx

    def record(self, lane: int, delivered: bool) -> None:
        """Report the outcome of one attempt that went out on ``lane``."""
        if not 0 <= lane < self.lane_count:
            return
        with self._lock:
            self._history[lane].append(1 if delivered else 0)
            self._sent[lane] += 1
            if not delivered:
                self._lost[lane] += 1
            events = self._reevaluate()
        # fire callbacks AFTER releasing the lock: on_event logs through
        # the TransferManager lock, and status_snapshot() takes the manager
        # lock -> this lock (same order everywhere, no AB-BA).
        for text in events:
            self.on_event(text)

    # ------------------------------------------------------------- policies
    def _window_loss(self, lane: int) -> float:
        history = self._history[lane]
        if not history:
            return 0.0
        return 1.0 - (sum(history) / len(history))

    def _reevaluate(self) -> list[str]:
        """Recompute flags/weights; returns on_event texts to fire unlocked."""
        events: list[str] = []
        for lane in range(self.lane_count):
            history = self._history[lane]
            if len(history) < self.min_samples:
                continue
            loss = self._window_loss(lane)
            if not self._flagged[lane] and loss >= self.flag_loss:
                self._flagged[lane] = True
                events.append(
                    f"PATH {_lane_name(lane)} flagged at {loss:.0%} loss "
                    f"-> shifting traffic to healthier lanes")
            elif self._flagged[lane] and loss < self.recover_loss:
                self._flagged[lane] = False
                events.append(
                    f"PATH {_lane_name(lane)} recovered ({loss:.0%} loss) "
                    f"-> back in rotation")
        self._weights = self._compute_weights()
        return events

    def _compute_weights(self) -> list[float]:
        n = self.lane_count
        flagged = [i for i in range(n) if self._flagged[i]]
        if not flagged:
            return [1.0 / n] * n
        healthy = [i for i in range(n) if not self._flagged[i]]
        if not healthy:
            # every lane is bad: probe them all equally
            return [1.0 / n] * n
        weights = [0.0] * n
        for lane in flagged:
            weights[lane] = self.probe_share / len(flagged)
        base = {i: max(1.0 - self._window_loss(i), 0.01) for i in healthy}
        total = sum(base.values())
        for i in healthy:
            weights[i] = (1.0 - self.probe_share) * base[i] / total
        return weights

    def _weighted_choice(self) -> int:
        if sum(self._weights) <= 0:
            return 0
        return random.choices(range(self.lane_count),
                              weights=self._weights, k=1)[0]

    # ---------------------------------------------------------------- state
    def state(self) -> dict:
        """Snapshot for ``/api/status`` + the UI path panel."""
        with self._lock:
            lanes = []
            for i in range(self.lane_count):
                history = self._history[i]
                window_loss = self._window_loss(i) if history else 0.0
                lanes.append({
                    "lane": i,
                    "name": _lane_name(i),
                    "sent": self._sent[i],
                    "lost": self._lost[i],
                    "attempts": len(history),
                    "window_loss": round(window_loss, 3),
                    "flagged": self._flagged[i],
                    "weight": round(self._weights[i], 3),
                })
            if self.lane_count == 1:
                mode = "single"
            elif not self.enabled:
                mode = "disabled"
            else:
                mode = self._mode
            return {
                "mode": mode,
                "enabled": self.enabled and self.lane_count > 1,
                "window": self.window,
                "flag_loss": self.flag_loss,
                "recover_loss": self.recover_loss,
                "probe_share": self.probe_share,
                "lanes": lanes,
            }


__all__ = ["PathScheduler"]
