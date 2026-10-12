"""Resume endpoints: inspect / discard an interrupted transfer on disk."""

from urllib.parse import unquote

from fastapi import APIRouter, HTTPException

from api.models import ApiResponse
from transfer.manager import manager

router = APIRouter()


@router.get("/resume/check")
def resume_check(name: str, size: int):
    """Does an interrupted copy of this exact file exist on the receiver?"""
    return manager.resume_check(unquote(name), size)


@router.post("/resume/discard", response_model=ApiResponse)
def resume_discard(name: str, size: int):
    """Delete the pending partial so the next transfer starts fresh."""
    result = manager.resume_discard(unquote(name), size)
    if not result["ok"]:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
