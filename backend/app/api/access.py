from fastapi import APIRouter, Request

from app.api.dependencies import is_host_request
from app.models.access import AccessOut

router = APIRouter(prefix="/api/access", tags=["access"])


@router.get("", response_model=AccessOut)
async def check_access(request: Request) -> AccessOut:
    return AccessOut(host=is_host_request(request))
