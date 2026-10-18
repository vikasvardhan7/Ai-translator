import re

LANGUAGE_CODE_PATTERN = re.compile(r"[a-z]{2,3}")


def language_code(value: str) -> str | None:
    primary = value.strip().lower().replace("_", "-").split("-")[0]
    return primary if LANGUAGE_CODE_PATTERN.fullmatch(primary) else None


def invalid_language_message(value: str) -> str:
    return f"'{value}' is not a language code. Use an ISO 639 code such as te, hi, en or yue."
