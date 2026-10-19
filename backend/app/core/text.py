import unicodedata
from dataclasses import dataclass

IGNORED_CHARACTER_KINDS = ("P", "Z")
MIN_ECHO_LETTERS = 2
MIN_ECHO_SHARE = 0.8
MIN_ECHO_WORDS = 3
MAX_REMEMBERED = 10


@dataclass(frozen=True)
class PlayedVoice:
    listener_id: str
    text: str
    sent: float
    until: float


def letters(text: str) -> str:
    return "".join(
        c for c in text if not unicodedata.category(c).startswith(IGNORED_CHARACTER_KINDS)
    ).casefold()


def words(text: str) -> list[str]:
    return [word for word in map(letters, text.split()) if word]


def is_echo(heard: str, played: str) -> bool:
    heard_letters, played_letters = letters(heard), letters(played)
    if len(heard_letters) < MIN_ECHO_LETTERS or not played_letters:
        return False
    if heard_letters in played_letters:
        return len(heard_letters) >= MIN_ECHO_SHARE * len(played_letters)
    if played_letters in heard_letters:
        return len(played_letters) >= MIN_ECHO_SHARE * len(heard_letters)
    heard_words = words(heard)
    played_words = set(words(played))
    shared = sum(word in played_words for word in heard_words)
    return len(heard_words) >= MIN_ECHO_WORDS and shared >= MIN_ECHO_SHARE * len(heard_words)


def is_overheard(heard: str, spoken: str) -> bool:
    heard_words = words(heard)
    if len(heard_words) < MIN_ECHO_WORDS:
        return is_echo(heard, spoken)
    spoken_words = set(words(spoken))
    shared = sum(word in spoken_words for word in heard_words)
    return shared >= MIN_ECHO_SHARE * len(heard_words)
