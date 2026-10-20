import os
import time
import urllib.parse
import urllib.request

EVERY_SECONDS = 300
ANSWERS = {
    "OK": "points to this server",
    "KO": "refused: check DUCKDNS_SUBDOMAIN and DUCKDNS_TOKEN in deploy/.env",
}


def update(subdomain: str, token: str) -> str:
    query = urllib.parse.urlencode({"domains": subdomain, "token": token, "ip": ""})
    with urllib.request.urlopen(f"https://www.duckdns.org/update?{query}", timeout=20) as answer:
        text = answer.read().decode().strip()
    return ANSWERS.get(text, "gave an unexpected answer")


def main() -> None:
    subdomain = os.environ.get("DUCKDNS_SUBDOMAIN", "").strip().removesuffix(".duckdns.org")
    token = os.environ.get("DUCKDNS_TOKEN", "").strip()
    if not subdomain or not token:
        print(
            "DuckDNS is not set up in deploy/.env, so the address is not kept up to date.",
            flush=True,
        )
        return
    last = ""
    while True:
        try:
            result = update(subdomain, token)
        except OSError as error:
            result = f"could not be reached ({type(error).__name__})"
        if result != last:
            print(f"{subdomain}.duckdns.org {result}", flush=True)
            last = result
        time.sleep(EVERY_SECONDS)


if __name__ == "__main__":
    main()
