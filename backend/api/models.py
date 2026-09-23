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


class TestingConfig(BaseModel):
    loss_enabled: bool = False
    loss_probability: float = Field(default=0.10, ge=0.0, le=0.90)


class TransferStartRequest(BaseModel):
    dest_filename: str | None = None


class ApiResponse(BaseModel):
    ok: bool
    message: str | None = None
    error: str | None = None