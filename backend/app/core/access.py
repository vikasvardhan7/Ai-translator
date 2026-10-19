import ipaddress
import re
import secrets

from starlette.requests import HTTPConnection

HOST_KEY_HEADER = "x-host-key"
ROOM_ID_HEADER = "x-room-id"
ROOM_TOKEN_HEADER = "x-room-token"
FORWARDING_HEADERS = ("forwarded", "x-forwarded-for", "x-real-ip", "cf-connecting-ip")
HOST_KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
HOST_KEY_GROUPS = 3
HOST_KEY_GROUP_LENGTH = 4
NOT_KEY_CHARACTERS = re.compile(r"[^A-Z0-9]")


def new_host_key() -> str:
    return "-".join(
        "".join(secrets.choice(HOST_KEY_ALPHABET) for _ in range(HOST_KEY_GROUP_LENGTH))
        for _ in range(HOST_KEY_GROUPS)
    )


def _normalized(key: str) -> bytes:
    return NOT_KEY_CHARACTERS.sub("", key.upper()).encode()


def _is_loopback(name: str) -> bool:
    if name == "localhost" or name.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def _host_name(host: str) -> str:
    if host.startswith("["):
        return host[1 : host.find("]")]
    return host.rsplit(":", 1)[0]


def is_forwarded(connection: HTTPConnection) -> bool:
    return any(name in connection.headers for name in FORWARDING_HEADERS)


def is_trusted_host(connection: HTTPConnection) -> bool:
    host = _host_name(connection.headers.get("host", "").strip().lower())
    return _is_loopback(host) or is_forwarded(connection)


def is_local(connection: HTTPConnection) -> bool:
    client = connection.client
    return (
        client is not None
        and not is_forwarded(connection)
        and _is_loopback(client.host)
        and is_trusted_host(connection)
    )


def is_host(connection: HTTPConnection, host_key: str, *, key_everywhere: bool) -> bool:
    given = connection.headers.get(HOST_KEY_HEADER, "")
    return (not key_everywhere and is_local(connection)) or (
        bool(given) and secrets.compare_digest(_normalized(given), _normalized(host_key))
    )
