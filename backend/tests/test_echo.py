import pytest

from app.api import stream
from app.core.text import is_echo
from tests.conftest import make_client, receive
from tests.fakes import FakeTranslator
from tests.test_pipeline import open_stream, speak


def reply_after_translation(reply: str, count: int) -> list[dict]:
    translator = FakeTranslator()
    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        first = [receive(ws)["type"] for _ in range(3)]
        assert first == ["utterance.received", "transcript.final", "translation.final"]
        translator.transcripts.append(reply)
        speak(ws)
        messages = [receive(ws) for _ in range(count + 1)]
        ws.send_json({"type": "ping"})
        assert receive(ws)["type"] == "pong"
    assert messages[0]["type"] == "utterance.received"
    assert {m["utterance_id"] for m in messages} == {messages[0]["utterance_id"]}
    return messages[1:]


@pytest.mark.parametrize("reply", ["How are you? [en]", "how are you", "How are you, en"])
def test_the_translation_heard_back_from_the_speakers_is_ignored(reply: str) -> None:
    messages = reply_after_translation(reply, count=1)

    assert [m["type"] for m in messages] == ["utterance.ignored"]


def test_unrelated_speech_is_still_translated() -> None:
    messages = reply_after_translation("Where is the station?", count=2)

    assert [m["type"] for m in messages] == ["transcript.final", "translation.final"]
    assert messages[0]["text"] == "Where is the station?"


def test_an_old_translation_is_no_longer_an_echo(monkeypatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(stream, "_now", lambda: clock[0])
    translator = FakeTranslator()

    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        assert [receive(ws)["type"] for _ in range(3)][-1] == "translation.final"
        clock[0] += stream.ECHO_SECONDS
        translator.transcripts.append("How are you?")
        speak(ws)
        later = [receive(ws)["type"] for _ in range(3)]

    assert later == ["utterance.received", "transcript.final", "translation.final"]


@pytest.mark.parametrize(
    ("heard", "played"),
    [
        ("How are you?", "How are you? [en]"),
        ("are you doing my friend", "How are you doing, my friend?"),
        ("How are you? Hm", "How are you?"),
        ("How are you doing", "How are you, doing?"),
        ("how ar you doing today", "How are you doing today?"),
        ("మీరు ఎలా ఉన్నారు", "మీరు ఎలా ఉన్నారు?"),
        ("你好吗", "你好吗？"),
    ],
    ids=[
        "whole",
        "most-of-it",
        "echo-inside",
        "punctuation",
        "misheard-word",
        "telugu",
        "no-spaces",
    ],
)
def test_echoes_are_recognised(heard: str, played: str) -> None:
    assert is_echo(heard, played)


@pytest.mark.parametrize(
    ("heard", "played"),
    [
        ("Where is the station?", "How are you?"),
        ("I booked a room for tonight", "OK"),
        ("no", "No, I am not coming tomorrow."),
        ("coming tomorrow", "Are you coming tomorrow?"),
        ("Well, how are you today friend", "How are you?"),
        ("a", "How are you?"),
        ("", "How are you?"),
        ("how is the weather there", "How are you?"),
    ],
    ids=[
        "unrelated",
        "short-translation-inside",
        "short-reply",
        "reply-with-words-heard",
        "translation-inside-longer-speech",
        "one-letter",
        "empty",
        "few-shared-words",
    ],
)
def test_other_speech_is_not_an_echo(heard: str, played: str) -> None:
    assert not is_echo(heard, played)
