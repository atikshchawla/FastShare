"""Topology graph: nodes, links, presets (extended star / tri-path), routing.

Pure data + path search — no sockets, no state. Presets are switchable at
runtime via ``POST /api/topology/preset`` (user-defined graphs come later
per the feature spec, FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md §8).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Node:
    id: str
    label: str
    role: str          # "hub" | "cluster" | "leaf" | "source" | "dest" | "router"
    host: str
    port: int


@dataclass(frozen=True)
class Link:
    id: str
    a: str
    b: str
    latency_ms: int


def _link(a: str, b: str, latency_ms: int = 10) -> Link:
    # Canonical id order matches the feature spec examples ("l1-ch1").
    return Link(id=f"{a}-{b}", a=a, b=b, latency_ms=latency_ms)


class Topology:
    """Immutable graph with an adjacency index for routing."""

    def __init__(self, nodes, links):
        self.nodes = list(nodes)
        self.links = list(links)
        self._by_id = {n.id: n for n in self.nodes}
        if len(self._by_id) != len(self.nodes):
            raise ValueError("duplicate node ids in topology")
        ports = [n.port for n in self.nodes]
        if len(set(ports)) != len(ports):
            raise ValueError("duplicate node ports in topology")
        self._adj = {n.id: [] for n in self.nodes}
        for link in self.links:
            if link.a not in self._by_id or link.b not in self._by_id:
                raise ValueError(f"link {link.id} references unknown node")
            self._adj[link.a].append(link.b)
            self._adj[link.b].append(link.a)

    @property
    def node_ids(self):
        return list(self._by_id)

    def node(self, node_id: str) -> Node:
        return self._by_id[node_id]

    def node_ids_except(self, *excluded: str):
        return [nid for nid in self._by_id if nid not in excluded]

    def link_between(self, a: str, b: str) -> Link | None:
        for link in self.links:
            if {link.a, link.b} == {a, b}:
                return link
        return None


def bfs_route(topology: Topology, src: str, dst: str) -> list[str] | None:
    """Shortest hop path ``[src, ..., dst]`` for the end-to-end session.

    Returns ``None`` when ``src == dst``, either id is unknown (KeyError is
    raised for unknown ids — they are caller/programming errors), or the
    nodes are disconnected. Intermediate entries are the forwarder nodes.
    """
    if src not in topology._by_id:
        raise KeyError(f"unknown node id: {src}")
    if dst not in topology._by_id:
        raise KeyError(f"unknown node id: {dst}")
    if src == dst:
        return None
    # BFS with parent pointers (graph is tiny; clarity over micro-speed).
    parents = {src: None}
    queue = [src]
    while queue:
        current = queue.pop(0)
        if current == dst:
            break
        for neighbour in topology._adj[current]:
            if neighbour not in parents:
                parents[neighbour] = current
                queue.append(neighbour)
    if dst not in parents:
        return None
    path = [dst]
    while parents[path[-1]] is not None:
        path.append(parents[path[-1]])
    path.reverse()
    return path


def all_paths(topology: Topology, src: str, dst: str,
              max_paths: int = 8) -> list[list[str]]:
    """Every simple ``[src, ..., dst]`` path, shortest first.

    Deterministic: paths are sorted by hop count, then lexicographically
    (so the tri-path preset always yields lanes A, B, C in that order).
    ``max_paths`` caps the search for safety; the shipped presets are tiny.
    Raises ``KeyError`` for unknown ids, ``[]`` for ``src == dst`` or when
    the nodes are disconnected (same contract as ``bfs_route``).
    """
    if src not in topology._by_id:
        raise KeyError(f"unknown node id: {src}")
    if dst not in topology._by_id:
        raise KeyError(f"unknown node id: {dst}")
    if src == dst:
        return []
    found: list[list[str]] = []
    stack: list[tuple[str, tuple[str, ...]]] = [(src, (src,))]
    while stack and len(found) < max_paths:
        current, path_t = stack.pop()
        if current == dst:
            found.append(list(path_t))
            continue
        # reversed() + stack => neighbours are explored in adjacency order
        for neighbour in reversed(topology._adj[current]):
            if neighbour not in path_t:
                stack.append((neighbour, path_t + (neighbour,)))
    found.sort(key=lambda p: (len(p), p))
    return found[:max_paths]


# ---------------------------------------------------------------------------
# Presets. Ports 6101-6107 (star, feature spec §4); tri-path uses the
# disjoint range 6201-6208 so both graphs can coexist with a receiver bound
# on either side of a preset switch.
# ---------------------------------------------------------------------------
PRESET_EXTENDED_STAR = Topology(
    nodes=[
        Node("hub", "HUB", "hub", "127.0.0.1", 6101),
        Node("l1", "LEAF 1", "leaf", "127.0.0.1", 6102),
        Node("ch1", "CH 1", "cluster", "127.0.0.1", 6103),
        Node("l2", "LEAF 2", "leaf", "127.0.0.1", 6104),
        Node("ch2", "CH 2", "cluster", "127.0.0.1", 6105),
        Node("l3", "LEAF 3", "leaf", "127.0.0.1", 6106),
        Node("l4", "LEAF 4", "leaf", "127.0.0.1", 6107),
    ],
    links=[
        _link("l1", "ch1"),
        _link("l2", "ch1"),
        _link("ch1", "hub"),
        _link("hub", "ch2"),
        _link("l3", "ch2"),
        _link("l4", "ch2"),
    ],
)

# Three node-disjoint lanes src -> dst, two routers each (multipath spec).
PRESET_TRI_PATH = Topology(
    nodes=[
        Node("src", "SOURCE", "source", "127.0.0.1", 6201),
        Node("a1", "PATH A R1", "router", "127.0.0.1", 6202),
        Node("a2", "PATH A R2", "router", "127.0.0.1", 6203),
        Node("b1", "PATH B R1", "router", "127.0.0.1", 6204),
        Node("b2", "PATH B R2", "router", "127.0.0.1", 6205),
        Node("c1", "PATH C R1", "router", "127.0.0.1", 6206),
        Node("c2", "PATH C R2", "router", "127.0.0.1", 6207),
        Node("dst", "DEST", "dest", "127.0.0.1", 6208),
    ],
    links=[
        _link("src", "a1"),
        _link("a1", "a2"),
        _link("a2", "dst"),
        _link("src", "b1"),
        _link("b1", "b2"),
        _link("b2", "dst"),
        _link("src", "c1"),
        _link("c1", "c2"),
        _link("c2", "dst"),
    ],
)


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    topology: Topology
    source: str        # default source/dest pick for this graph
    dest: str


PRESETS: dict[str, Preset] = {
    "star": Preset("star", "Extended star", PRESET_EXTENDED_STAR, "l1", "hub"),
    "tri": Preset("tri", "Tri-path (3 lanes)", PRESET_TRI_PATH, "src", "dst"),
}
