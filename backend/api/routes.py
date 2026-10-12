"""HTTP API endpoints that the Next.js dashboard talks to.

The frontend NEVER implements UDP: it asks this controller to start/stop
the server and the client, and reads state snapshots back over HTTP.

This module only assembles the endpoint groups in ``api/endpoints/`` into
one ``/api`` router -- main.py keeps importing ``router`` from here.
"""

from fastapi import APIRouter

from api.endpoints import resume, server, status, testing, topology, transfer

router = APIRouter(prefix="/api", tags=["controller"])
router.include_router(status.router)
router.include_router(server.router)
router.include_router(transfer.router)
router.include_router(resume.router)
router.include_router(testing.router)
router.include_router(topology.router)
