from tests.audio import BRIGHT, DEEP, frames, voice
from tests.conftest import make_client, receive
from tests.fakes import FakeTranslator
from tests.test_call import CALL_BODY, say, until_closed
from tests.test_pipeline import open_stream
from tests.test_rooms import connect, joined

SAME_LANGUAGE = {
    "consent": True,
    "participants": [
        {"id": "A", "name": "Person A", "preferred_language": "te"},
        {"id": "B", "name": "Person B", "preferred_language": "te"},
    ],
}
DIFFERENT_LANGUAGES = {
    "consent": True,
    "participants": [
        {"id": "A", "name": "Person A", "preferred_language": "en"},
        {"id": "B", "name": "Person B", "preferred_language": "te"},
    ],
}


def talk(ws, sound, seed: int) -> None:
    for frame in frames(voice(2.0, sound, seed)):
        ws.send_bytes(frame)
    ws.send_json({"type": "audio.pause"})


def captions(messages: list[dict]) -> list[tuple[str | None, str | None]]:
    return [(m["speaker_id"], m["voice"]) for m in messages if m["type"] == "transcript.final"]


def conversation(body: dict, sounds, fixes=()) -> list[dict]:
    with open_stream(make_client(translator=FakeTranslator()), body) as ws:
        receive(ws)
        for seed, sound in enumerate(sounds):
            talk(ws, sound, seed)
            if seed in dict(fixes):
                caption = next(
                    m for m in iter(lambda: receive(ws), None) if m["type"] == "transcript.final"
                )
                ws.send_json(
                    {
                        "type": "voice.fix",
                        "utterance_id": caption["utterance_id"],
                        "voice": dict(fixes)[seed],
                    }
                )
        return until_closed(ws)


def test_people_sharing_a_language_on_one_device_are_told_apart_by_voice() -> None:
    messages = conversation(SAME_LANGUAGE, [DEEP, BRIGHT, DEEP, BRIGHT])

    assert captions(messages) == [("A", "A"), ("B", "B"), ("A", "A"), ("B", "B")]
    assert not [m for m in messages if m["type"] == "translation.final"]


def test_a_wrong_name_is_fixed_and_the_voice_is_learned() -> None:
    messages = conversation(SAME_LANGUAGE, [DEEP, DEEP, BRIGHT], fixes=[(0, "B")])

    assert captions(messages) == [("B", "B"), ("A", "A")]


def test_different_languages_still_decide_who_spoke() -> None:
    messages = conversation(DIFFERENT_LANGUAGES, [DEEP, BRIGHT])

    assert captions(messages) == [("B", None), ("B", None)]


def test_voices_in_a_captioned_meeting_are_numbered() -> None:
    translator = FakeTranslator(transcripts=["One", "Two", "Three", "Four"])
    with open_stream(make_client(translator=translator), CALL_BODY) as ws:
        receive(ws)
        for seed, (source, sound) in enumerate(
            [("B", DEEP), ("B", BRIGHT), ("A", DEEP), ("B", DEEP)]
        ):
            say(ws, source, voice(2.0, sound, seed))
            ws.send_json({"type": "audio.pause", "participant_id": source})
        messages = until_closed(ws)

    assert captions(messages) == [("B", "1"), ("B", "2"), ("A", None), ("B", "1")]


def test_a_bad_fix_is_refused() -> None:
    with open_stream(make_client(translator=FakeTranslator()), SAME_LANGUAGE) as ws:
        receive(ws)
        for fix in (
            {"type": "voice.fix", "utterance_id": "u1", "voice": "C"},
            {"type": "voice.fix", "voice": "A"},
            {"type": "voice.fix", "utterance_id": "u1", "voice": 1},
        ):
            ws.send_json(fix)
            refused = receive(ws)
            assert (refused["type"], refused["code"]) == ("error", "invalid_message")
            assert "'A' or 'B'" in refused["message"]


def test_live_words_reach_the_others_in_a_call_but_not_the_speaker() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            receive(a), receive(b)
            a.send_json({"type": "words.live", "text": "How are y"})
            a.send_json({"type": "ping"})
            on_a = receive(a)
            on_b = receive(b)
            a.send_json({"type": "words.live", "text": "x" * 501})
            refused = receive(a)

    assert on_a["type"] == "pong"
    assert (on_b["type"], on_b["speaker_id"], on_b["text"]) == ("words.live", "A", "How are y")
    assert (refused["type"], refused["code"]) == ("error", "invalid_message")


def test_live_words_on_one_device_are_not_echoed_back() -> None:
    with open_stream(make_client(translator=FakeTranslator()), SAME_LANGUAGE) as ws:
        receive(ws)
        ws.send_json({"type": "words.live", "text": "Hello"})
        ws.send_json({"type": "ping"})
        answer = receive(ws)

    assert answer["type"] == "pong"
