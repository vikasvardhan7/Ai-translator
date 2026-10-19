from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.languages import language_code
from app.services.assistant.base import AppAction

APPS = ["translator", "meetings", "assistant", "personalize", "help", "privacy", "terms"]
THEMES = ["ocean", "sunset", "mint", "blossom", "aurora"]
DURATIONS = ["15", "30", "45", "60", "90", "120"]
WHERE = ["here", "remote", "meeting"]
FORMATS = ["text", "subtitles"]


@dataclass(frozen=True)
class ActionSpec:
    name: str
    description: str
    choices: dict[str, list[str]]
    language_argument: str | None = None
    texts: dict[str, tuple[str, int]] = field(default_factory=dict)
    optional: tuple[str, ...] = ()
    time_argument: str | None = None

    def schema(self) -> dict[str, Any]:
        properties: dict[str, Any] = {
            key: {"type": "string", "enum": values} for key, values in self.choices.items()
        }
        if self.language_argument:
            properties[self.language_argument] = {
                "type": "string",
                "description": "ISO 639 code of the language, for example te, hi or en.",
            }
        for key, (description, _) in self.texts.items():
            properties[key] = {"type": "string", "description": description}
        if self.time_argument:
            properties[self.time_argument] = {
                "type": "string",
                "description": "The local date and time with its UTC offset, ISO 8601,"
                " for example 2026-10-20T17:00:00+05:30.",
            }
        required = [key for key in properties if key not in self.optional]
        return {"type": "object", "properties": properties, "required": required}


CATALOG = {
    spec.name: spec
    for spec in [
        ActionSpec(
            "open_app",
            "Open one of the desktop apps: translator (conversations, calls and live captions),"
            " meetings (schedule meetings and see upcoming ones), assistant (this chat),"
            " personalize (colours and themes), help, privacy or terms.",
            {"app": APPS},
        ),
        ActionSpec("close_app", "Close one of the open desktop apps.", {"app": APPS}),
        ActionSpec(
            "start_conversation",
            "Open the translator ready to start: here (two people next to each other), remote"
            " (a call with up to 5 people on other devices, through one invite link) or meeting"
            " (captions for an online meeting). The person still says hello so their language"
            " is found.",
            {"where": WHERE},
        ),
        ActionSpec(
            "schedule_meeting",
            "Schedule a translated meeting that others join through a link. Ask for anything"
            " missing (when, how long) before calling this.",
            {"duration_minutes": DURATIONS},
            texts={
                "title": ("A short title for the meeting.", 120),
                "agenda": ("What the meeting is about; may be empty.", 2000),
            },
            optional=("agenda",),
            time_argument="starts_at",
        ),
        ActionSpec(
            "set_theme",
            "Change the look of the app: ocean (blue waves), sunset (warm coral), mint (fresh"
            " green), blossom (soft pink) or aurora (dark night with aurora).",
            {"theme": THEMES},
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
            "show_people",
            "Show who is in the running call, who is connected, and the invite link to share.",
            {},
        ),
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


def _aware_time(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    return moment.isoformat() if moment.tzinfo is not None else None


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
    for key, (_, limit) in spec.texts.items():
        text = given.get(key, "")
        text = text.strip() if isinstance(text, str) else ""
        if len(text) > limit or (not text and key not in spec.optional):
            return None
        values[key] = text
    if spec.time_argument:
        moment = _aware_time(given.get(spec.time_argument))
        if moment is None:
            return None
        values[spec.time_argument] = moment
    return AppAction(name, values)
