"""Shared fixtures + a real loopback UDP transfer harness used by the tests.

The tests drive the real UDP client/server on 127.0.0.1 with an ephemeral
port -- no mocks, no simulated frontend.
"""

import os
import random
import sys
import tempfile
import threading

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest  # noqa: E402

from udp.client import UDPClient  # noqa: E402
from udp.server import UDPServer  # noqa: E402


class TransferProbe:
    """Records everything the client/server report during a transfer."""

    def __init__(self):
        self.events = []
        self.messages = []
        self.received_path = None
        self.success = None
        self.duplicates = []
        self.done = threading.Event()

    # client callbacks
    def on_event(self, entry):
        self.events.append(dict(entry))

    def on_message(self, text):
        self.messages.append(text)

    def on_finished(self, ok, detail):
        self.success = ok
        self.done.set()

    # server callbacks
    def on_duplicate(self, seq):
        self.duplicates.append(seq)

    def on_received(self, path):
        self.received_path = path


@pytest.fixture
def random_file(tmp_path):
    def _make(size, seed=42):
        rng = random.Random(seed)
        path = tmp_path / f"input_{size}_{seed}.bin"
        path.write_bytes(bytes(rng.randrange(256) for _ in range(size)))
        return path
    return _make


def run_transfer(src_path, dest_name="test.bin", packet_size=1024, timeout=0.2,
                 max_retries=3, loss=0.0, ack_loss=0.0):
    """Run a full transfer on loopback UDP. Returns a filled TransferProbe."""
    probe = TransferProbe()
    server = UDPServer(port=0, packet_size=packet_size, loss_probability=loss,
                       receive_dir=tempfile.mkdtemp(prefix="fs_received_"),
                       on_duplicate=probe.on_duplicate,
                       on_transfer_complete=probe.on_received,
                       message=probe.on_message)
    server.start()
    client = UDPClient("127.0.0.1", server.bound_port, packet_size=packet_size,
                       timeout=timeout, max_retries=max_retries,
                       ack_loss_probability=ack_loss,
                       emit=probe.on_event, message=probe.on_message,
                       finished=probe.on_finished)
    thread = threading.Thread(target=client.send_file,
                              args=(str(src_path), dest_name), daemon=True)
    thread.start()
    assert probe.done.wait(timeout=90), "transfer did not finish"
    thread.join(timeout=5)
    server.stop()
    return probe


def data_status_counts(probe):
    """Count final statuses per DATA packet from the event stream."""
    final = {}
    for e in probe.events:
        if e["type"] == "DATA":
            final[e["seq"]] = e["status"]
    return final


def received_bytes(probe):
    with open(probe.received_path, "rb") as fh:
        return fh.read()