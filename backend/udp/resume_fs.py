"""On-disk format of interrupted transfers (the receiver's resume store).

Every receive session writes ``<final>.part`` and a ``<final>.part.meta``
JSON sidecar (name, size, packet_size, total_packets, final_path). The
sidecar is what lets a cancelled, crashed or fully restarted receiver
answer "where should this file continue?".

Shared by:
- ``udp/server.py``     (the receiver: creates/advances/cleans partials)
- ``transfer/manager.py`` (the controller: /api/resume/check|discard)
"""

import json
import os


def find_partial(receive_dir, name, size, packet_size=None):
    """Locate an interrupted transfer's partial file for this exact file.

    A match requires the sidecar .meta JSON (written at START) to describe
    the same name/size, and -- when ``packet_size`` is given -- the same
    packet size (resume math depends on it). Returns a dict or None.
    """
    try:
        entries = sorted(os.listdir(receive_dir))
    except OSError:
        return None
    for fn in entries:
        if not fn.endswith(".part"):
            continue
        part_path = os.path.join(receive_dir, fn)
        meta_path = part_path + ".meta"
        try:
            with open(meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
            received = os.path.getsize(part_path)
        except (OSError, ValueError):
            continue
        if meta.get("name") != name or meta.get("size") != size:
            continue
        if packet_size is not None and meta.get("packet_size") != packet_size:
            continue
        return {"part_path": part_path, "meta_path": meta_path,
                "meta": meta, "received": received}
    return None


def resume_point(received, size, packet_size, total_packets):
    """Where a resume should continue, given bytes already on disk.

    Stop-and-Wait only ever writes whole packets, so the resume point is
    received // packet_size (a torn tail is dropped by the caller).
    Returns (resumed_seq, aligned_bytes):
      - received >= size  -> (total_packets, size): everything is there,
        the sender only needs to re-send END.
      - received <= 0     -> (0, 0): nothing usable, caller starts fresh.
    """
    if received <= 0 or packet_size <= 0:
        return 0, 0
    if received >= size:
        return total_packets, size
    full = received // packet_size
    return full, full * packet_size


def discard_partial(candidate):
    """Delete a partial file + its sidecar meta (used by 'start over').

    Returns True when the partial is gone (removed now, or already absent)
    and False when the remove failed — e.g. the file is locked on Windows —
    so callers can stop retrying instead of spinning forever.
    """
    ok = True
    try:
        os.remove(candidate["part_path"])
    except FileNotFoundError:
        pass
    except OSError:
        ok = False
    try:
        os.remove(candidate["meta_path"])
    except OSError:
        pass
    return ok


def write_meta(part_path, meta):
    """Write/replace the sidecar next to a .part file."""
    with open(part_path + ".meta", "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
