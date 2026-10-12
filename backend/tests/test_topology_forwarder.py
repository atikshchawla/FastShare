"""Unit tests for the topology forwarder (transfer/topology/forwarder.py).

Everything runs on real loopback UDP sockets with ephemeral ports — the
same no-mocks philosophy as tests/conftest.py.
"""

import socket
import time

import pytest

from transfer.topology import Forwarder
from udp import protocol
from udp.packet import build_packet, parse_packet


def _bound_socket(timeout=1.0):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(timeout)
    return sock


def _recv(sock, timeout=1.0):
    sock.settimeout(timeout)
    try:
        data, _ = sock.recvfrom(65536)
        return data
    except socket.timeout:
        return None


def _assert_silence(sock, wait=0.3):
    assert _recv(sock, timeout=wait) is None, "unexpected datagram received"


@pytest.fixture
def make_forwarder():
    started = []

    def _make(latency_ms=0):
        fwd = Forwarder("n1", "127.0.0.1", 0, latency_ms=latency_ms)
        fwd.start()
        started.append(fwd)
        return fwd

    yield _make
    for fwd in started:
        fwd.stop()


def test_forwards_data_from_prev_to_next(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b")
    sender.sendto(
        build_packet(7, protocol.PACKET_TYPE_DATA, b"hello"),
        ("127.0.0.1", fwd.bound_port))
    data = _recv(nxt)
    assert data is not None
    assert parse_packet(data) == (7, protocol.PACKET_TYPE_DATA, b"hello")
    stats = fwd.link_stats()
    # counted on the arrival link; the downstream forwarder counts n1-b
    assert stats["a-n1"]["data_packets"] == 1
    assert stats["n1-b"]["data_packets"] == 0
    assert stats["a-n1"]["ack_packets"] == 0
    assert stats["a-n1"]["dropped"] == 0


def test_counts_departure_link_when_next_is_destination(make_forwarder):
    fwd = make_forwarder()
    dest = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=dest.getsockname(),
                  prev_link="a-n1", next_link="n1-b", next_is_dest=True)
    sender.sendto(build_packet(1, protocol.PACKET_TYPE_START, b"meta"),
                  ("127.0.0.1", fwd.bound_port))
    assert _recv(dest) is not None
    stats = fwd.link_stats()
    assert stats["a-n1"]["data_packets"] == 1
    assert stats["n1-b"]["data_packets"] == 1   # dest keeps no counters itself


def test_forwards_ack_back_and_counts_both_sides_for_client(make_forwarder):
    fwd = make_forwarder()
    client = _bound_socket()
    nxt = _bound_socket()
    fwd.set_route(prev_addr=client.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", prev_is_client=True)
    nxt.sendto(build_packet(3, protocol.PACKET_TYPE_ACK),
               ("127.0.0.1", fwd.bound_port))
    data = _recv(client)
    assert data is not None
    assert parse_packet(data) == (3, protocol.PACKET_TYPE_ACK, b"")
    stats = fwd.link_stats()
    assert stats["n1-b"]["ack_packets"] == 1   # arrival side
    assert stats["a-n1"]["ack_packets"] == 1   # client socket counts nothing


def test_ack_tx_not_counted_when_prev_is_another_forwarder(make_forwarder):
    fwd = make_forwarder()
    prev_node = _bound_socket()
    nxt = _bound_socket()
    fwd.set_route(prev_addr=prev_node.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", prev_is_client=False)
    nxt.sendto(build_packet(3, protocol.PACKET_TYPE_ACK),
               ("127.0.0.1", fwd.bound_port))
    assert _recv(prev_node) is not None
    stats = fwd.link_stats()
    assert stats["n1-b"]["ack_packets"] == 1
    assert stats["a-n1"]["ack_packets"] == 0   # the prev forwarder counts its rx


def test_loss_one_point_zero_drops_and_counts(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", next_is_dest=True)
    fwd.loss_probability = 1.0
    for seq in range(1, 4):
        sender.sendto(build_packet(seq, protocol.PACKET_TYPE_DATA, b"x"),
                      ("127.0.0.1", fwd.bound_port))
    _assert_silence(nxt, wait=0.4)
    stats = fwd.link_stats()
    assert stats["a-n1"]["dropped"] == 3
    assert stats["a-n1"]["data_packets"] == 0
    assert stats["n1-b"] == {"data_packets": 0, "ack_packets": 0, "dropped": 0}


def test_corruption_detected_on_arrival_link(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b")
    fwd.corrupt_probability = 1.0
    sender.sendto(build_packet(1, protocol.PACKET_TYPE_DATA, b"payload"),
                  ("127.0.0.1", fwd.bound_port))
    _assert_silence(nxt, wait=0.4)
    stats = fwd.link_stats()
    assert stats["a-n1"]["dropped"] == 1       # CRC-32 rejected it here
    assert stats["a-n1"]["data_packets"] == 0


def test_latency_is_respected(make_forwarder):
    fwd = make_forwarder(latency_ms=150)
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", next_is_dest=True)
    sent_at = time.monotonic()
    sender.sendto(build_packet(1, protocol.PACKET_TYPE_DATA, b"slow"),
                  ("127.0.0.1", fwd.bound_port))
    assert _recv(nxt) is not None
    elapsed = time.monotonic() - sent_at
    # lower bound: the queued worker must wait for the link delay
    # (small tolerance for OS timer granularity)
    assert elapsed >= 0.12, f"forwarded after only {elapsed * 1000:.0f}ms"


def test_datagram_order_is_preserved(make_forwarder):
    fwd = make_forwarder(latency_ms=40)
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", next_is_dest=True)
    for seq in (1, 2, 3):
        sender.sendto(build_packet(seq, protocol.PACKET_TYPE_DATA, b"o"),
                      ("127.0.0.1", fwd.bound_port))
    seqs = []
    for _ in range(3):
        data = _recv(nxt, timeout=2.0)
        assert data is not None, "a datagram was lost or reordered"
        seqs.append(parse_packet(data)[0])
    assert seqs == [1, 2, 3]


def test_routeless_forwarder_drops(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b")
    fwd.clear_route()
    sender.sendto(build_packet(1, protocol.PACKET_TYPE_DATA, b"x"),
                  ("127.0.0.1", fwd.bound_port))
    _assert_silence(nxt, wait=0.3)
    stats = fwd.link_stats()   # pre-registered links stay visible at zero
    assert stats["a-n1"] == {"data_packets": 0, "ack_packets": 0, "dropped": 0}
    assert stats["n1-b"] == {"data_packets": 0, "ack_packets": 0, "dropped": 0}


def test_stranger_sender_is_dropped_and_uncounted(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    peer = _bound_socket()
    stranger = _bound_socket()
    fwd.set_route(prev_addr=peer.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", next_is_dest=True)
    stranger.sendto(build_packet(1, protocol.PACKET_TYPE_DATA, b"evil"),
                    ("127.0.0.1", fwd.bound_port))
    _assert_silence(nxt, wait=0.3)
    stats = fwd.link_stats()
    assert stats["a-n1"] == {"data_packets": 0, "ack_packets": 0, "dropped": 0}


def test_client_sender_address_is_learned(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    client = _bound_socket()
    stranger = _bound_socket()
    fwd.set_route(prev_addr=None, next_addr=nxt.getsockname(),
                  prev_link="c-n1", next_link="n1-b",
                  prev_is_client=True, next_is_dest=True)
    client.sendto(build_packet(1, protocol.PACKET_TYPE_DATA, b"first"),
                  ("127.0.0.1", fwd.bound_port))
    data = _recv(nxt)
    assert data is not None
    assert parse_packet(data)[2] == b"first"
    # a stranger after learning is still not a route peer
    stranger.sendto(build_packet(2, protocol.PACKET_TYPE_DATA, b"evil"),
                    ("127.0.0.1", fwd.bound_port))
    _assert_silence(nxt, wait=0.3)
    stats = fwd.link_stats()
    assert stats["c-n1"]["data_packets"] == 1   # only the client's packet counted


def test_stop_releases_the_port(make_forwarder):
    fwd = make_forwarder()
    port = fwd.bound_port
    assert fwd.running
    fwd.stop()
    assert not fwd.running
    replacement = Forwarder("n2", "127.0.0.1", port, latency_ms=0)
    replacement.start()          # would raise OSError if the port leaked
    try:
        assert replacement.bound_port == port
    finally:
        replacement.stop()


def test_link_stats_snapshot_is_a_copy(make_forwarder):
    fwd = make_forwarder()
    nxt = _bound_socket()
    sender = _bound_socket()
    fwd.set_route(prev_addr=sender.getsockname(), next_addr=nxt.getsockname(),
                  prev_link="a-n1", next_link="n1-b", next_is_dest=True)
    sender.sendto(build_packet(1, protocol.PACKET_TYPE_DATA, b"x"),
                  ("127.0.0.1", fwd.bound_port))
    assert _recv(nxt) is not None
    snapshot = fwd.link_stats()
    snapshot["a-n1"]["data_packets"] = 999
    assert fwd.link_stats()["a-n1"]["data_packets"] == 1
