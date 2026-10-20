from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import (
    get_app_settings,
    get_key_store,
    get_limiter,
    get_public_address,
    key_identity,
    require_owner,
)
from app.api.links import public_link
from app.core.config import Settings
from app.models.key import KeyCreate, KeyCreated, KeyList, KeyOut
from app.services.key_store import ApiKey, KeyLimitReached, KeyStore
from app.services.limits import RateLimiter
from app.services.public_address import PublicAddress

router = APIRouter(prefix="/api/keys", tags=["api keys"], dependencies=[Depends(require_owner)])

Keys = Annotated[KeyStore, Depends(get_key_store)]
Limiter = Annotated[RateLimiter, Depends(get_limiter)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
Public = Annotated[PublicAddress, Depends(get_public_address)]


def _out(key: ApiKey, limiter: RateLimiter) -> KeyOut:
    return KeyOut(
        id=key.id,
        name=key.name,
        shown=key.shown,
        daily_limit=key.daily_limit,
        used_today=limiter.used_today(key_identity(key)),
        created_at=key.created_at,
        last_used_at=key.last_used_at,
    )


@router.get("", response_model=KeyList)
async def list_keys(
    request: Request, keys: Keys, limiter: Limiter, settings: AppSettings, public: Public
) -> KeyList:
    public_url, problem = await public_link(request, settings, public)
    return KeyList(
        keys=[_out(key, limiter) for key in keys.all()],
        public_url=public_url,
        public_url_problem=problem,
    )


@router.post("", response_model=KeyCreated, status_code=status.HTTP_201_CREATED)
async def create_key(body: KeyCreate, keys: Keys, limiter: Limiter) -> KeyCreated:
    try:
        key, secret = keys.create(body.name, body.daily_limit)
    except KeyLimitReached as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "There are already 100 keys. Revoke some you no longer use."
        ) from exc
    return KeyCreated(key=_out(key, limiter), secret=secret)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_key(key_id: str, keys: Keys) -> None:
    if not keys.revoke(key_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "There is no such key.")
