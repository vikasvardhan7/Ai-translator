import pytest

from tests.audio import tone
from tests.conftest import VALID_BODY, make_client, receive
from tests.fakes import FakeTranslator
from tests.test_call import CALL_BODY, call_client, say
from tests.test_pipeline import open_stream, speak


def english_speaker(**kwargs) -> FakeTranslator:
    return FakeTranslator(language="en", text="Hello", translation="Namaste", **kwargs)


def test_the_next_sentence_is_translated_into_the_new_language() -> None:
    translator = english_speaker()

    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        ws.send_json({"type": "language.set", "participant_id": "B", "language": "hi"})
        updated = receive(ws)
        speak(ws)
        received, transcript, translation = (receive(ws) for _ in range(3))

    assert updated["type"] == "participants.updated"
    assert [(p["id"], p["preferred_language"]) for p in updated["participants"]] == [
        ("A", "en"),
        ("B", "hi"),
    ]
    assert translator.calls[-1].target_languages == ["en", "hi"]
    assert transcript["speaker_id"] == "A"
    assert (translation["listener_id"], translation["target_language"]) == ("B", "hi")
    assert translation["text"] == "Namaste [hi]"


def test_a_change_during_a_translation_applies_from_the_next_sentence() -> None:
    translator = english_speaker(delays=[0.3, 0.0])

    with open_stream(make_client(translator=translator)) as ws:
        receive(ws)
        speak(ws)
        receive(ws)
        ws.send_json({"type": "language.set", "participant_id": "B", "language": "hi"})
        first = [receive(ws) for _ in range(3)]
        speak(ws)
        second = [receive(ws) for _ in range(3)]

    assert [m["type"] for m in first] == [
        "participants.updated",
        "transcript.final",
        "translation.final",
    ]
    assert first[-1]["target_language"] == "te"
    assert second[-1]["target_language"] == "hi"


def test_a_meeting_changes_the_language_of_the_person_using_it() -> None:
    translator = english_speaker()

    with open_stream(call_client(translator), CALL_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "language.set", "participant_id": "A", "language": "hi"})
        updated = receive(ws)
        say(ws, "B", tone(1.0))
        ws.send_json({"type": "audio.pause", "participant_id": "B"})
        messages = [receive(ws) for _ in range(3)]

    assert updated["participants"] == [{"id": "A", "name": "Person A", "preferred_language": "hi"}]
    assert translator.calls[-1].target_languages == ["hi"]
    translation = messages[2]
    assert (translation["speaker_id"], translation["listener_id"]) == ("B", "A")
    assert translation["target_language"] == "hi"


@pytest.mark.parametrize(
    ("message", "detail"),
    [
        ({"language": "hi"}, "language.set needs participant_id 'A' or 'B'."),
        ({"participant_id": "C", "language": "hi"}, "language.set needs participant_id"),
        ({"participant_id": ["A"], "language": "hi"}, "language.set needs participant_id"),
        ({"participant_id": "A", "language": "Telugu"}, "'Telugu' is not a language code."),
        ({"participant_id": "A", "language": 7}, "language.set needs a language code"),
        ({"participant_id": "A"}, "language.set needs a language code"),
    ],
    ids=["no-participant", "unknown", "list", "not-a-code", "number", "missing"],
)
def test_a_bad_language_change_is_refused(message: dict, detail: str) -> None:
    with open_stream(call_client(english_speaker()), VALID_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "language.set", **message})
        error = receive(ws)
        ws.send_json({"type": "ping"})
        pong = receive(ws)

    assert error["code"] == "invalid_message"
    assert error["message"].startswith(detail)
    assert pong["type"] == "pong"


@pytest.mark.parametrize(
    ("message", "detail"),
    [
        ({"participant_id": "B", "language": "hi"}, "language.set needs participant_id 'A'."),
        ({"participant_id": "A", "language": "Telugu"}, "'Telugu' is not a language code."),
    ],
    ids=["the-meeting", "not-a-code"],
)
def test_a_bad_language_change_in_a_meeting_is_refused(message: dict, detail: str) -> None:
    with open_stream(call_client(english_speaker()), CALL_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "language.set", **message})
        error = receive(ws)

    assert (error["code"], error["message"].startswith(detail)) == ("invalid_message", True)
