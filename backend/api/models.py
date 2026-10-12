"""Pydantic models for the FastAPI controller layer.

JSON here is used ONLY for controller <-> frontend communication.
The UDP datagrams themselves remain binary structs (see udp/packet.py).
"""

from pydantic import BaseModel, Field


class ServerConfig(BaseModel):
    server_ip: str = "127.0.0.1"
    udp_port: int = Field(default=5001, ge=1, le=65535)
    packet_size: int = Field(default=1024, ge=64, le=64512)
    timeout_ms: int = Field(default=500, ge=50, le=10000)
    window_size: int = Field(default=1, ge=1, le=1)  # Stop-and-Wait for now
    max_retries: int = Field(default=5, ge=1, le=20)
    # Multi-server topology (None = leave the stored value untouched, so
    # callers that never mention the feature cannot flip it off). The flags
    # take effect on the next server start (spec §10.3).
    topology_enabled: bool | None = None
    topology_latency_ms: int | None = Field(default=None, ge=1, le=1000)


class TestingConfig(BaseModel):
    loss_enabled: bool = False
    loss_probability: float = Field(default=0.10, ge=0.0, le=0.90)
    corrupt_enabled: bool = False
    corrupt_probability: float = Field(default=0.10, ge=0.0, le=0.90)


class NodeConfig(BaseModel):
    """Per-node override for one topology node (POST /topology/node/config).

    ``None`` = leave that field untouched, so a caller can patch a single
    knob (e.g. only ``latency_ms``) without restating the rest. ``reset``
    drops the node's whole override so it follows the global config again.
    """

    id: str
    reset: bool = False
    latency_ms: int | None = Field(default=None, ge=1, le=1000)
    loss_enabled: bool | None = None
    loss_probability: float | None = Field(default=None, ge=0.0, le=0.90)
    corrupt_enabled: bool | None = None
    corrupt_probability: float | None = Field(default=None, ge=0.0, le=0.90)
    enabled: bool | None = None


class TopologyPreset(BaseModel):
    """Preset switch request (POST /topology/preset)."""

    name: str = Field(min_length=1, max_length=32)


class MultipathConfig(BaseModel):
    """Source-side scheduler policy (POST /topology/multipath/config).

    ``None`` = leave that option untouched.
    """

    enabled: bool | None = None
    window: int | None = Field(default=None, ge=4, le=10000)
    flag_loss: float | None = Field(default=None, ge=0.05, le=0.90)
    recover_loss: float | None = Field(default=None, ge=0.0, le=0.50)
    probe_share: float | None = Field(default=None, ge=0.0, le=0.50)
    explore_per_lane: int | None = Field(default=None, ge=0, le=1000)
    min_samples: int | None = Field(default=None, ge=2, le=1000)


class ApiResponse(BaseModel):
    ok: bool
    message: str | None = None
    error: str | None = None