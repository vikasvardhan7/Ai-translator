import pytest

from app.services import voice_prints
from app.services.voice_prints import NEW_VOICE_DISTANCE, VoiceBook, distance, voice_print
from tests.audio import BRIGHT, DEEP, WARM, silence, voice


def heard(sound, seed: int = 0, seconds: float = 2.0):
    found = voice_print(voice(seconds, sound, seed))
    assert found is not None
    return found


def test_the_same_voice_is_close_and_different_voices_are_far() -> None:
    for sound in (DEEP, BRIGHT, WARM):
        assert max(distance(heard(sound), heard(sound, seed)) for seed in range(1, 6)) < 3
    others = [(DEEP, BRIGHT), (DEEP, WARM), (BRIGHT, WARM)]
    assert min(distance(heard(a), heard(b)) for a, b in others) > 3 * NEW_VOICE_DISTANCE


@pytest.mark.parametrize(
    "pcm",
    [silence(3.0), voice(0.5, DEEP), b"", b"\x01"],
    ids=["silence", "too-short", "nothing", "odd-byte"],
)
def test_too_little_speech_has_no_voice_print(pcm: bytes) -> None:
    assert voice_print(pcm) is None


def test_voices_get_the_next_free_name_and_keep_it() -> None:
    book = VoiceBook(["1", "2", "3"])

    names = [
        book.match(str(n), heard(sound, n))
        for n, sound in enumerate([DEEP, DEEP, BRIGHT, DEEP, WARM, BRIGHT])
    ]

    assert names == ["1", "1", "2", "1", "3", "2"]


def test_once_every_name_is_used_the_nearest_voice_is_chosen() -> None:
    book = VoiceBook(["A", "B"])
    book.match("u1", heard(DEEP))
    book.match("u2", heard(BRIGHT))

    assert book.match("u3", heard(WARM)) in {"A", "B"}
    assert book.match("u4", heard(DEEP, 4)) == "A"


def test_a_fixed_sentence_moves_to_the_right_voice() -> None:
    book = VoiceBook(["A", "B"])
    assert book.match("u1", heard(DEEP)) == "A"

    assert book.fix("u1", "B")

    assert book.match("u2", heard(DEEP, 2)) == "B"
    assert book.match("u3", heard(BRIGHT)) == "A"


def test_a_voice_that_swallowed_two_people_is_split_by_a_fix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(voice_prints, "NEW_VOICE_DISTANCE", 1000.0)
    book = VoiceBook(["A", "B"])
    assert [book.match("u1", heard(DEEP)), book.match("u2", heard(BRIGHT))] == ["A", "A"]

    assert book.fix("u2", "B")

    assert book.match("u3", heard(BRIGHT, 3)) == "B"
    assert book.match("u4", heard(DEEP, 4)) == "A"


def test_only_known_sentences_and_names_can_be_fixed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(voice_prints, "REMEMBERED", 2)
    book = VoiceBook(["A", "B"])
    for n in range(3):
        book.match(f"u{n}", heard(DEEP, n))

    assert not book.fix("u0", "B")
    assert not book.fix("u2", "C")
    assert not book.fix("unknown", "B")
    assert book.fix("u2", "A")
