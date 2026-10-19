from fastapi import Request

from app.core.access import is_local_page, own_origin
from app.core.config import Settings
from app.services.public_address import DID_NOT_START, PublicAddress


async def public_link(
    request: Request, settings: Settings, public: PublicAddress
) -> tuple[str | None, str | None]:
    if settings.public_url:
        return settings.public_url.rstrip("/"), None
    if not is_local_page(request):
        return own_origin(request), None
    if public.problem is not None:
        return None, public.problem
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    address = await public.get(f"http://localhost:{port}")
    return address, None if address else DID_NOT_START
