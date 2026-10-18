from app.services.voice.base import VoiceOption
from tests.conftest import make_client
from tests.fakes import VOICE_LIMIT, FakeSynthesizer
from tests.test_gemini_voice import PUCK


def test_the_voices_come_from_the_voice_service() -> None:
    kore = VoiceOption("Kore", "Kore", "", "", "", "", "")
    client = make_client(synthesizer=FakeSynthesizer(voices=[VoiceOption(**PUCK), kore]))

    response = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json() == {
        "voices": [
            PUCK,
            {
                "id": "Kore",
                "display_name": "Kore",
                "description": "",
                "gender": "",
                "language_code": "",
                "pitch": "",
                "accent": "",
            },
        ]
    }


def test_there_are_no_voices_without_a_voice_service() -> None:
    response = make_client().get("/api/voices")

    assert (response.status_code, response.json()) == (200, {"voices": []})


def test_a_failed_voice_list_is_reported_plainly() -> None:
    client = make_client(synthesizer=FakeSynthesizer(voices_failure=VOICE_LIMIT))

    response = client.get("/api/voices")

    assert response.status_code == 503
    assert response.json() == {"detail": "The free voice limit was reached."}
