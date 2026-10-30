"""FastShare backend entry point.

Starts the FastAPI controller on http://localhost:8000.
The Next.js frontend (port 3000) talks to these HTTP endpoints;
actual file transfer runs over real UDP sockets (udp/client.py + server.py).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from api.routes import router
from transfer.manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Shutdown hook (P0-6): stop the UDP receiver + topology forwarders
    # (incl. isolated child processes) so Ctrl-C / SIGTERM doesn't leave
    # orphaned nodes holding their ports.
    yield
    try:
        manager.stop_server()
    except Exception:  # noqa: BLE001 - shutdown must never raise
        pass


app = FastAPI(
    title="FastShare Controller",
    description="Reliable UDP file transfer -- HTTP control layer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    return {
        "app": "FastShare",
        "subtitle": "Reliable File Transfer over UDP",
        "docs": "/docs",
        "status": "/api/status",
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)