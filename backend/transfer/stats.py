"""Pure performance math for the transfer controller.

No I/O, no locks, no ownership of state -- everything here is either a
small state object the manager holds (RttSampler) or a pure function that
turns counters into the numbers the dashboard displays (derive_metrics).
"""

# RFC 6298-style EWMA weights for the smoothed RTT
SRTT_ALPHA = 0.875
SRTT_BETA = 0.125


class RttSampler:
    """Current / min / max RTT plus the smoothed RTT (EWMA)."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.current = None   # latest sample (ms)
        self.minimum = None
        self.maximum = None
        self.srtt = None      # smoothed RTT
        self.samples = 0

    def record(self, rtt_ms):
        """Fold one RTT sample (milliseconds) into the trackers."""
        self.current = rtt_ms
        self.minimum = rtt_ms if self.minimum is None else min(self.minimum, rtt_ms)
        self.maximum = rtt_ms if self.maximum is None else max(self.maximum, rtt_ms)
        if self.srtt is None:
            self.srtt = rtt_ms
        else:
            self.srtt = SRTT_ALPHA * self.srtt + SRTT_BETA * rtt_ms
        self.samples += 1

    def as_dict(self):
        """Rounded snapshot fragment (keys match the HTTP contract)."""
        return {
            "rtt_ms": round(self.current, 2) if self.current is not None else None,
            "rtt_min_ms": round(self.minimum, 2) if self.minimum is not None else None,
            "rtt_max_ms": round(self.maximum, 2) if self.maximum is not None else None,
            "srtt_ms": round(self.srtt, 2) if self.srtt is not None else None,
            "rtt_samples": self.samples,
        }


def derive_metrics(*, elapsed_seconds, confirmed_bytes, resumed_bytes,
                   file_size, wire_bytes, packets_sent, retransmissions,
                   total_packets, packets_acked, is_completed):
    """Turn raw counters into the dashboard's derived numbers.

    goodput/ETA measure bytes actually moved THIS session, so a resumed run
    (reused bytes counted in confirmed_bytes) doesn't fake an instant rate.
    """
    total = max(total_packets, 1)
    progress = round(min(100.0, (packets_acked / total) * 100), 1)

    session_bytes = max(0, confirmed_bytes - resumed_bytes)
    if elapsed_seconds > 0 and session_bytes > 0:
        goodput_bps = session_bytes / elapsed_seconds
        eta = max(0.0, file_size - confirmed_bytes) / goodput_bps
    else:
        goodput_bps = 0.0
        eta = None
    if is_completed:
        eta = 0.0

    throughput_bps = (wire_bytes / elapsed_seconds) if elapsed_seconds > 0 else 0.0
    loss_percent = (retransmissions / max(packets_sent, 1)) * 100.0

    return {
        "progress_percent": progress,
        "goodput_kbps": round(goodput_bps / 1024, 2),
        "throughput_kbps": round(throughput_bps / 1024, 2),
        "loss_percent": round(loss_percent, 2),
        "eta_seconds": round(eta, 1) if eta is not None else None,
    }
