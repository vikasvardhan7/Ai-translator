from dataclasses import dataclass
from typing import Any

from app.core.languages import language_code
from app.services.assistant.base import AppAction

APPS = ["translator", "assistant", "help", "privacy", "terms"]
WHERE = ["here", "remote", "meeting"]
FORMATS = ["text", "subtitles"]


@dataclass(frozen=True)
class ActionSpec:
    name: str
    description: str
    choices: dict[str, list[str]]
    language_argument: str | None = None

    def schema(self) -> dict[str, Any]:
        properties: dict[str, Any] = {
            key: {"type": "string", "enum": values} for key, values in self.choices.items()
        }
        if self.language_argument:
            properties[self.language_argument] = {
                "type": "string",
                "description": "ISO 639 code of the language, for example te, hi or en.",
            }
        return {"type": "object", "properties": properties, "required": list(properties)}


CATALOG = {
    spec.name: spec
    for spec in [
        ActionSpec(
            "open_app",
            "Open one of the desktop apps: translator (conversations, two-device calls and"
            " meeting captions), assistant (this chat), help, privacy or terms.",
            {"app": APPS},
        ),
        ActionSpec("close_app", "Close one of the open desktop apps.", {"app": APPS}),
        ActionSpec(
            "start_conversation",
            "Open the translator ready to start: here (two people next to each other), remote"
            " (with someone on another device, through an invite link) or meeting (captions"
            " for an online meeting). The person still says hello so their language is found.",
            {"where": WHERE},
        ),
        ActionSpec("mute", "Mute this person's microphone in the running call.", {}),
        ActionSpec("unmute", "Turn this person's microphone back on in the running call.", {}),
        ActionSpec("voice_on", "Speak translations aloud in the running call.", {}),
        ActionSpec("captions_only", "Show captions only, without speaking translations.", {}),
        ActionSpec(
            "connect_meeting_sound",
            "Start listening to the online meeting's sound. The browser then asks which tab or"
            " screen to share.",
            {},
        ),
        ActionSpec("disconnect_meeting_sound", "Stop listening to the meeting's sound.", {}),
        ActionSpec("show_transcript", "Show the transcript panel of the running call.", {}),
        ActionSpec("hide_transcript", "Hide the transcript panel of the running call.", {}),
        ActionSpec("open_settings", "Open the settings of the running call.", {}),
        ActionSpec(
            "download_transcript",
            "Download the running call's transcript as plain text or as subtitles.",
            {"format": FORMATS},
        ),
        ActionSpec(
            "set_my_language",
            "Change the language this person reads and hears in the running call.",
            {},
            language_argument="language",
        ),
        ActionSpec("end_conversation", "End the running conversation or meeting.", {}),
    ]
}


def known(names: list[str]) -> list[ActionSpec]:
    return [CATALOG[name] for name in dict.fromkeys(names) if name in CATALOG]


def checked(name: str, arguments: object, allowed: set[str]) -> AppAction | None:
    spec = CATALOG.get(name)
    if spec is None or name not in allowed:
        return None
    given = arguments if isinstance(arguments, dict) else {}
    values: dict[str, str] = {}
    for key, choices in spec.choices.items():
        value = given.get(key)
        if value not in choices:
            return None
        values[key] = value
    if spec.language_argument:
        code = language_code(str(given.get(spec.language_argument, "")))
        if code is None:
            return None
        values[spec.language_argument] = code
    return AppAction(name, values)
