"""Controller API tests (FastAPI TestClient, no sockets required).

Verifies the JSON contract the Next.js dashboard relies on, including the
simulation config used by the Testing panel.
"""

import sys
import os

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


def test_status_reports_checksum_and_testing_fields(client):
    s = client.get("/api/status").json()
    assert s["protocol"]["checksum"] == "Enabled (CRC-32)"
    assert s["protocol"]["reliability"] == "Stop-and-Wait ARQ"
    assert "corrupt_enabled" in s["testing"]
    assert "corrupt_probability" in s["testing"]
    assert "checksum_errors" in s


def test_testing_config_roundtrip(client):
    before = dict(manager.testing)
    try:
        r = client.post("/api/testing/config", json={
            "loss_enabled": True,
            "loss_probability": 0.25,
            "corrupt_enabled": True,
            "corrupt_probability": 0.15,
        })
        assert r.status_code == 200
        t = client.get("/api/status").json()["testing"]
        assert t["loss_enabled"] is True
        assert t["loss_probability"] == pytest.approx(0.25)
        assert t["corrupt_enabled"] is True
        assert t["corrupt_probability"] == pytest.approx(0.15)
        # invalid probability rejected by pydantic
        bad = client.post("/api/testing/config", json={
            "corrupt_probability": 1.5,
        })
        assert bad.status_code == 422
    finally:
        manager.apply_testing_config(
            before["loss_enabled"], before["loss_probability"],
            before["corrupt_enabled"], before["corrupt_probability"])


def test_transfer_start_requires_running_server(client):
    if manager.server_status == "running":
        pytest.skip("server running; guard not reachable")
    r = client.post(
        "/api/transfer/start",
        files={"file": ("x.bin", b"payload-bytes", "application/octet-stream")},
    )
    assert r.status_code == 400
    assert "receiver" in r.json()["detail"].lower()


def test_status_reports_resume_enabled(client):
    s = client.get("/api/status").json()
    assert s["protocol"]["resume"].startswith("Enabled")
    assert s["resume"] == "enabled"
    assert "resumed_from_seq" in s


def test_resume_check_and_discard_endpoints(client):
    # no partial file exists for this name -> not available, discard is 404
    r = client.get("/api/resume/check",
                   params={"name": "ghost.bin", "size": 123})
    assert r.status_code == 200
    assert r.json() == {"available": False, "resumed_seq": 0,
                        "received_bytes": 0, "total_packets": 0,
                        "file_size": 123, "percent": 0.0}

    d = client.post("/api/resume/discard",
                    params={"name": "ghost.bin", "size": 123})
    assert d.status_code == 404

    # start is a multipart upload: resume is a query flag, not JSON opts
    r2 = client.post("/api/transfer/start?resume=false",
                     files={"file": ("x.bin", b"data", "application/octet-stream")})
    assert r2.status_code == 400          # no server running, but it parsed
    assert "receiver" in r2.json()["detail"].lower()
