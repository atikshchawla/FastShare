"""Controller API tests for GET /api/topology (feature spec §6).

Uses the FastAPI TestClient; only the ``up``-flag test touches real sockets
(one server start on the preset ports, cleaned up afterwards).
"""

import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi.testclient import TestClient  # noqa: E402

import main as main_mod  # noqa: E402
from transfer.manager import manager  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_state():
    """Every test starts from a stopped receiver with default picks
    (transfer tests may have left a running server / sticky destination)
    and with no per-node overrides left behind."""
    if manager.server_status == "running":
        manager.stop_server()
    if manager.topology.preset_name != "star":
        manager.topology.set_preset("star")
    manager.topology.source_id = "l1"
    manager.topology.dest_id = "hub"
    yield
    if manager.server_status == "running":
        manager.stop_server()
    manager.topology.stop_all()
    for node_id in list(manager.topology._node_overrides):
        manager.topology.node_config(node_id, reset=True)


@pytest.fixture
def topology_enabled():
    old = manager.config["topology_enabled"]
    manager.config["topology_enabled"] = True
    yield
    manager.config["topology_enabled"] = old
    if manager.server_status == "running":
        manager.stop_server()


def test_topology_shape_when_disabled(client):
    t = client.get("/api/topology").json()
    assert t["enabled"] is False
    assert [n["id"] for n in t["nodes"]] == [
        "hub", "l1", "ch1", "l2", "ch2", "l3", "l4"]
    assert sorted(n["port"] for n in t["nodes"]) == list(range(6101, 6108))
    roles = {n["id"]: n["role"] for n in t["nodes"]}
    assert roles["hub"] == "hub"
    assert roles["ch1"] == roles["ch2"] == "cluster"
    assert roles["l1"] == roles["l4"] == "leaf"
    assert all(n["up"] is False for n in t["nodes"])
    assert [l["id"] for l in t["links"]] == [
        "l1-ch1", "l2-ch1", "ch1-hub", "hub-ch2", "l3-ch2", "l4-ch2"]
    assert t["route"] is None
    assert t["source"] == "l1" and t["dest"] == "hub"
    assert set(t["link_stats"]) == {l["id"] for l in t["links"]}
    for stats in t["link_stats"].values():
        assert {"data_packets", "ack_packets", "dropped",
                "latency_ms"} <= set(stats)
        assert stats["latency_ms"] == 10
        assert stats["data_packets"] == stats["ack_packets"] == stats["dropped"] == 0


def test_enabled_flag_is_reported(client, topology_enabled):
    t = client.get("/api/topology").json()
    assert t["enabled"] is True


def test_all_nodes_report_up_while_receiver_runs(client, topology_enabled):
    assert manager.start_server()["ok"] is True
    t = client.get("/api/topology").json()
    assert all(n["up"] for n in t["nodes"]), \
        {n["id"]: n["up"] for n in t["nodes"]}
    # the receiver is parked on the default destination (hub, 6101)
    assert client.get("/api/status").json()["server_port"] == 6101


def test_transfer_start_validates_nodes(client, topology_enabled):
    assert manager.start_server()["ok"] is True
    status_before = manager.transfer_status
    files = {"file": ("t.bin", b"abc", "application/octet-stream")}

    unknown = client.post("/api/transfer/start?source=nope&dest=l3",
                          files={"file": ("t.bin", b"abc",
                                          "application/octet-stream")})
    assert unknown.status_code == 400
    assert "unknown topology node" in unknown.json()["detail"]

    same = client.post("/api/transfer/start?source=l2&dest=l2", files=files)
    assert same.status_code == 400
    assert "differ" in same.json()["detail"]
    # a rejected pick starts nothing: the transfer state stays untouched
    assert manager.transfer_status == status_before


def test_server_config_preserves_unmentioned_topology_flags(client):
    before = manager.config["topology_enabled"]
    try:
        r = client.post("/api/server/config", json={
            "server_ip": "127.0.0.1", "udp_port": 5001,
            "packet_size": 1024, "timeout_ms": 500,
            "window_size": 1, "max_retries": 5,
        })
        assert r.status_code == 200
        assert manager.config["topology_enabled"] == before  # untouched
        r2 = client.post("/api/server/config", json={"topology_enabled": True})
        assert r2.status_code == 200
        assert manager.config["topology_enabled"] is True
        r3 = client.post("/api/server/config", json={"topology_latency_ms": 4})
        assert manager.config["topology_latency_ms"] == 4
        assert manager.config["topology_enabled"] is True  # still untouched
    finally:
        manager.config["topology_enabled"] = before
        manager.config["topology_latency_ms"] = 10


def test_link_latency_reports_configured_delay(client):
    """``links[].latency_ms`` / ``link_stats[].latency_ms`` must report the
    delay the links actually simulate (config.topology_latency_ms), not the
    preset's 10 ms default -- spec §5 defines it as the *configured*
    one-way delay for the link, and the UI badge reads this field."""
    if manager.server_status == "running":   # idle snapshot -> config wins
        manager.stop_server()
    try:
        manager.config["topology_latency_ms"] = 2
        t = client.get("/api/topology").json()
        assert {l["latency_ms"] for l in t["links"]} == {2}
        assert {s["latency_ms"] for s in t["link_stats"].values()} == {2}
    finally:
        manager.config["topology_latency_ms"] = 10


# ------------------------------------------------- per-node config (plan §3)


def test_node_config_patches_forwarder(client):
    """POST /topology/node/config stores the override and live-patches the
    forwarder's latency/loss without touching the other nodes."""
    r = client.post("/api/topology/node/config", json={
        "id": "ch1", "latency_ms": 37,
        "loss_enabled": True, "loss_probability": 0.25,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["config"]["latency_ms"] == 37
    assert body["config"]["loss_enabled"] is True
    assert body["config"]["loss_probability"] == 0.25

    patched = manager.topology._forwarders["ch1"]
    untouched = manager.topology._forwarders["ch2"]
    assert patched.latency_ms == 37
    assert patched.loss_probability == 0.25
    assert untouched.latency_ms == manager.config["topology_latency_ms"]
    assert untouched.loss_probability == 0.0  # global loss is off


def test_node_overrides_survive_start_all_and_patch_testing(client):
    """The one behavioural backend change: start_all() and patch_testing()
    must not clobber per-node overrides (they used to overwrite latency,
    loss and corruption from the global config on every call)."""
    assert client.post("/api/topology/node/config", json={
        "id": "l2", "latency_ms": 55,
        "loss_enabled": True, "loss_probability": 0.5,
    }).status_code == 200
    try:
        manager.topology.start_all()   # re-applies global config to nodes
        fwd = manager.topology._forwarders["l2"]
        assert fwd.latency_ms == 55
        assert fwd.loss_probability == 0.5
        other = manager.topology._forwarders["l3"]
        assert other.latency_ms == manager.config["topology_latency_ms"]
        assert other.loss_probability == 0.0

        manager.apply_testing_config(True, 0.2, False, 0.0)  # global patch
        assert fwd.loss_probability == 0.5        # override wins
        assert other.loss_probability == 0.2      # global applies here
    finally:
        manager.topology.stop_all()
        manager.apply_testing_config(False, 0.10, False, 0.10)


def test_snapshot_exposes_effective_node_config(client):
    """Each nodes[] entry carries its effective config: override values for
    patched nodes, the global values everywhere else."""
    assert client.post("/api/topology/node/config", json={
        "id": "hub", "latency_ms": 42, "enabled": True,
    }).status_code == 200
    t = client.get("/api/topology").json()
    configs = {n["id"]: n["config"] for n in t["nodes"]}
    expected_keys = {"latency_ms", "loss_enabled", "loss_probability",
                     "corrupt_enabled", "corrupt_probability", "enabled"}
    assert all(set(cfg) == expected_keys for cfg in configs.values())
    assert configs["hub"]["latency_ms"] == 42
    assert configs["l1"]["latency_ms"] == manager.config["topology_latency_ms"]
    assert configs["l1"]["enabled"] is True


def test_node_config_reset_restores_global(client):
    assert client.post("/api/topology/node/config", json={
        "id": "ch2", "latency_ms": 77,
    }).status_code == 200
    assert client.post("/api/topology/node/config", json={
        "id": "ch2", "reset": True,
    }).status_code == 200
    t = client.get("/api/topology").json()
    node = next(n for n in t["nodes"] if n["id"] == "ch2")
    assert node["config"]["latency_ms"] == manager.config["topology_latency_ms"]


def test_unknown_node_rejected(client):
    r = client.post("/api/topology/node/config",
                    json={"id": "nope", "latency_ms": 5})
    assert r.status_code == 400
    assert "unknown topology node" in r.json()["detail"]


def test_node_out_of_range_rejected(client):
    r = client.post("/api/topology/node/config",
                    json={"id": "hub", "loss_probability": 1.5})
    assert r.status_code == 422


def test_disabled_node_stays_down_and_snapshot_reports_it(client,
                                                          topology_enabled):
    """enabled=False stops the forwarder, start_all() must not resurrect
    it, and the snapshot reports up:false + the effective config."""
    assert manager.start_server()["ok"] is True
    try:
        assert client.post("/api/topology/node/config", json={
            "id": "l3", "enabled": False,
        }).status_code == 200

        t = client.get("/api/topology").json()
        node = next(n for n in t["nodes"] if n["id"] == "l3")
        assert node["up"] is False
        assert node["config"]["enabled"] is False
        assert next(n for n in t["nodes"] if n["id"] == "l4")["up"] is True

        # a later server-side reapply must keep the node down
        manager.topology.start_all(
            exclude_port=manager.server.bound_port)
        assert manager.topology._forwarders["l3"].running is False

        # re-enable brings it back while the receiver runs
        assert client.post("/api/topology/node/config", json={
            "id": "l3", "enabled": True,
        }).status_code == 200
        assert manager.topology._forwarders["l3"].running is True
        t = client.get("/api/topology").json()
        assert next(n for n in t["nodes"] if n["id"] == "l3")["up"] is True
    finally:
        manager.topology.stop_all()
