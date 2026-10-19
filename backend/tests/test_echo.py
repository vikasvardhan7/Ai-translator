import pytest

from app.api import stream
from app.core.text import is_echo, is_overheard
from tests.conftest import make_client, receive
from tests.fakes import FakeTranslator
from tests.test_pipeline import open_stream, speak


def played(ws, utterance_id: str, listener_id: str = "A", seconds: float = 1.5) -> None:
    ws.send_json(
        {
            "type": "voice.played",
            "utterance_id": utterance_id,
            "listener_id": listener_id,
            "seconds": seconds,
        }
    )


def reply_after_voice(reply: str, count: int, *, voice_played: bool = True) -> list[dict]:
    translator = FakeTranslator()
    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        first = [receive(ws) for _ in range(3)]
        assert [m["type"] for m in first] == [
            "utterance.received",
            "transcript.final",
            "translation.final",
        ]
        if voice_played:
            played(ws, first[0]["utterance_id"])
        translator.transcripts.append(reply)
        speak(ws)
        messages = [receive(ws) for _ in range(count + 1)]
        ws.send_json({"type": "ping"})
        assert receive(ws)["type"] == "pong"
    assert messages[0]["type"] == "utterance.received"
    assert {m["utterance_id"] for m in messages} == {messages[0]["utterance_id"]}
    return messages[1:]


@pytest.mark.parametrize("reply", ["How are you? [en]", "how are you", "How are you, en"])
def test_the_voice_heard_back_from_the_speakers_is_ignored(reply: str) -> None:
    messages = reply_after_voice(reply, count=1)

    assert [m["type"] for m in messages] == ["utterance.ignored"]


def test_unrelated_speech_is_still_translated() -> None:
    messages = reply_after_voice("Where is the station?", count=2)

    assert [m["type"] for m in messages] == ["transcript.final", "translation.final"]
    assert messages[0]["text"] == "Where is the station?"


def test_a_reply_that_repeats_a_caption_is_kept_when_no_voice_was_played() -> None:
    messages = reply_after_voice("How are you? [en]", count=2, voice_played=False)

    assert [m["type"] for m in messages] == ["transcript.final", "translation.final"]


def test_a_reply_after_the_voice_has_finished_is_kept(monkeypatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(stream, "_now", lambda: clock[0])
    translator = FakeTranslator()

    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        received = receive(ws)
        assert [receive(ws)["type"] for _ in range(2)][-1] == "translation.final"
        played(ws, received["utterance_id"])
        clock[0] += stream.ECHO_MARGIN_SECONDS + 2
        translator.transcripts.append("How are you? [en]")
        speak(ws)
        later = [receive(ws)["type"] for _ in range(3)]

    assert later == ["utterance.received", "transcript.final", "translation.final"]


def test_a_voice_held_and_played_later_still_counts(monkeypatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(stream, "_now", lambda: clock[0])
    translator = FakeTranslator()

    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        received = receive(ws)
        assert [receive(ws)["type"] for _ in range(2)][-1] == "translation.final"
        clock[0] += 20
        played(ws, received["utterance_id"], seconds=3)
        translator.transcripts.append("How are you? [en]")
        speak(ws)
        later = [receive(ws)["type"] for _ in range(2)]

    assert later == ["utterance.received", "utterance.ignored"]


@pytest.mark.parametrize(
    "message",
    [
        {"utterance_id": None, "listener_id": "A", "seconds": 1},
        {"listener_id": "A", "seconds": 1},
        {"utterance_id": "x", "listener_id": None, "seconds": 1},
        {"utterance_id": "x", "listener_id": "A", "seconds": -1},
        {"utterance_id": "x", "listener_id": "A", "seconds": 1000},
        {"utterance_id": "x", "listener_id": "A", "seconds": "1"},
        {"utterance_id": "x", "listener_id": "A", "seconds": True},
        {"utterance_id": "x", "listener_id": "A"},
    ],
    ids=[
        "null-id",
        "no-id",
        "null-listener",
        "negative",
        "too-long",
        "text-seconds",
        "boolean",
        "no-seconds",
    ],
)
def test_a_bad_voice_played_message_is_refused(message: dict) -> None:
    translator = FakeTranslator()
    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        received = receive(ws)
        [receive(ws) for _ in range(2)]
        sent = {**message}
        if sent.get("utterance_id") == "x":
            sent["utterance_id"] = received["utterance_id"]
        ws.send_json({"type": "voice.played", **sent})
        error = receive(ws)

    assert error["code"] == "invalid_message"
    assert "voice.played" in error["message"]


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
        ("No", "I know what you mean"),
        ("Ok", "Let us look at the book"),
        ("Yes", "Yesterday we shipped it"),
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
        "no-inside-know",
        "ok-inside-book",
        "yes-inside-yesterday",
    ],
)
def test_other_speech_is_not_an_echo(heard: str, played: str) -> None:
    assert not is_echo(heard, played)


@pytest.mark.parametrize(
    ("heard", "spoken", "overheard"),
    [
        ("welcome to the review", "Hello everyone, welcome to the review", True),
        ("Hello everyone welcome to the review", "Hello everyone, welcome to the review", True),
        ("numbers for this quarter look", "The numbers for this quarter look strong", True),
        ("Can you hear me", "Hello everyone, welcome to the review", False),
        ("No", "I know what you mean", False),
        ("Ok", "Let us look at the book", False),
        ("Yes", "Yesterday we shipped it", False),
        ("Okay", "Okay", True),
        ("I agree", "I agree with that", False),
    ],
    ids=[
        "fragment",
        "whole",
        "middle",
        "different",
        "no-in-know",
        "ok-in-book",
        "yes-in-yesterday",
        "same-short",
        "short-fragment",
    ],
)
def test_speech_overheard_from_the_meeting(heard: str, spoken: str, overheard: bool) -> None:
    assert is_overheard(heard, spoken) is overheard


@pytest.mark.parametrize(
    "message",
    [{"utterance_id": "forgotten", "listener_id": "A"}, {"utterance_id": "x", "listener_id": "C"}],
    ids=["forgotten", "other-listener"],
)
def test_a_voice_played_for_an_unknown_translation_is_ignored_quietly(message: dict) -> None:
    translator = FakeTranslator()
    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        received = receive(ws)
        [receive(ws) for _ in range(2)]
        sent = {**message, "seconds": 1}
        if sent["utterance_id"] == "x":
            sent["utterance_id"] = received["utterance_id"]
        ws.send_json({"type": "voice.played", **sent})
        ws.send_json({"type": "ping"})
        answer = receive(ws)

    assert answer["type"] == "pong"
