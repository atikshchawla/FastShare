"""Unit tests for the topology graph (transfer/topology/graph.py)."""

import pytest

from transfer.topology import PRESET_EXTENDED_STAR, Topology, bfs_route
from transfer.topology.graph import Link, Node


def test_preset_shape_seven_nodes_six_links():
    preset = PRESET_EXTENDED_STAR
    assert len(preset.nodes) == 7
    assert len(preset.links) == 6


def test_preset_unique_ids_and_ports():
    preset = PRESET_EXTENDED_STAR
    assert len(set(preset.node_ids)) == 7
    assert sorted(n.port for n in preset.nodes) == list(range(6101, 6108))
    assert len({n.host for n in preset.nodes}) == 1
    assert {n.host for n in preset.nodes} == {"127.0.0.1"}


def test_preset_roles():
    preset = PRESET_EXTENDED_STAR
    roles = {n.id: n.role for n in preset.nodes}
    assert roles["hub"] == "hub"
    assert roles["ch1"] == "cluster" and roles["ch2"] == "cluster"
    assert roles["l1"] == roles["l3"] == roles["l4"] == "leaf"


def test_preset_links_reference_existing_nodes():
    preset = PRESET_EXTENDED_STAR
    ids = set(preset.node_ids)
    for link in preset.links:
        assert link.a in ids and link.b in ids
        assert link.latency_ms == 10


def test_preset_link_ids_are_canonical_and_lookupable():
    preset = PRESET_EXTENDED_STAR
    link = preset.link_between("ch1", "l1")
    assert link is not None
    assert link.id == "l1-ch1"
    assert preset.link_between("l1", "ch1").id == "l1-ch1"
    assert preset.link_between("l1", "l4") is None


def test_route_leaf_to_own_cluster_head_one_hop():
    route = bfs_route(PRESET_EXTENDED_STAR, "l1", "ch1")
    assert route == ["l1", "ch1"]


def test_route_same_cluster_sibling_leaf_two_hops():
    route = bfs_route(PRESET_EXTENDED_STAR, "l1", "l2")
    assert route == ["l1", "ch1", "l2"]


def test_route_leaf_to_hub_two_hops():
    route = bfs_route(PRESET_EXTENDED_STAR, "l1", "hub")
    assert route == ["l1", "ch1", "hub"]


def test_route_cross_cluster_leaf_four_hops():
    route = bfs_route(PRESET_EXTENDED_STAR, "l1", "l3")
    assert route == ["l1", "ch1", "hub", "ch2", "l3"]
    assert len(route) - 1 == 4


def test_route_cross_cluster_is_symmetric_in_length():
    forward = bfs_route(PRESET_EXTENDED_STAR, "l4", "l2")
    backward = bfs_route(PRESET_EXTENDED_STAR, "l2", "l4")
    assert forward == ["l4", "ch2", "hub", "ch1", "l2"]
    assert len(backward) == len(forward)


def test_route_hub_to_leaf_two_hops():
    route = bfs_route(PRESET_EXTENDED_STAR, "hub", "l3")
    assert route == ["hub", "ch2", "l3"]


def test_every_node_pair_has_a_valid_route():
    preset = PRESET_EXTENDED_STAR
    for src in preset.node_ids:
        for dst in preset.node_ids:
            route = bfs_route(preset, src, dst)
            if src == dst:
                assert route is None
                continue
            assert route is not None, f"missing route {src}->{dst}"
            assert route[0] == src and route[-1] == dst
            for a, b in zip(route, route[1:]):
                assert preset.link_between(a, b) is not None, (
                    f"route {src}->{dst} uses missing link {a}-{b}")


def test_same_node_is_rejected():
    assert bfs_route(PRESET_EXTENDED_STAR, "l1", "l1") is None
    assert bfs_route(PRESET_EXTENDED_STAR, "hub", "hub") is None


def test_unknown_ids_raise_key_error():
    with pytest.raises(KeyError):
        bfs_route(PRESET_EXTENDED_STAR, "nope", "hub")
    with pytest.raises(KeyError):
        bfs_route(PRESET_EXTENDED_STAR, "l1", "nope")


def test_duplicate_node_ids_rejected():
    node = Node("x", "X", "leaf", "127.0.0.1", 7000)
    with pytest.raises(ValueError):
        Topology([node, node], [])


def test_duplicate_node_ports_rejected():
    a = Node("a", "A", "leaf", "127.0.0.1", 7000)
    b = Node("b", "B", "leaf", "127.0.0.1", 7000)
    with pytest.raises(ValueError):
        Topology([a, b], [])


def test_link_to_unknown_node_rejected():
    a = Node("a", "A", "leaf", "127.0.0.1", 7000)
    with pytest.raises(ValueError):
        Topology([a], [Link(id="a-b", a="a", b="b", latency_ms=10)])


def test_node_ids_except_excludes_forwarders():
    preset = PRESET_EXTENDED_STAR
    others = preset.node_ids_except("hub", "ch1")
    assert "hub" not in others and "ch1" not in others
    assert "l1" in others and len(others) == 5
