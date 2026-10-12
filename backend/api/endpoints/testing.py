"""Testing endpoints: simulated packet loss and corruption."""

from fastapi import APIRouter

from api.models import ApiResponse, TestingConfig
from transfer.manager import manager

router = APIRouter()


@router.post("/testing/config", response_model=ApiResponse)
def testing_config(cfg: TestingConfig):
    return manager.apply_testing_config(
        cfg.loss_enabled, cfg.loss_probability,
        cfg.corrupt_enabled, cfg.corrupt_probability)
