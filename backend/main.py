"""FastShare backend entry point.

Starts the FastAPI controller on http://localhost:8000.
The Next.js frontend (port 3000) talks to these HTTP endpoints;
actual file transfer runs over real UDP sockets (udp/client.py + server.py).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from api.routes import router

app = FastAPI(
    title="FastShare Controller",
    description="Reliable UDP file transfer -- HTTP control layer",
    version="0.1.0",
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