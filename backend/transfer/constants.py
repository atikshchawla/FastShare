"""Shared status values and size limits for the transfer controller."""

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

MAX_FEED = 3000         # max event feed lines kept
MAX_LOG_ENTRIES = 4000  # cap packet log size (UI asks for a window anyway)
