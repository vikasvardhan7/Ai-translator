import argparse
import asyncio
import statistics
import sys
import tarfile
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import httpx
from google import genai
from google.genai import errors

from app.core.config import get_settings
from app.core.languages import language_code
from app.services.translation.base import NothingRecognised, TranslationFailed
from app.services.translation.gemini import GeminiSpeechTranslator
from scripts.fleurs import list_configs, read_sentences, stream_clips


@dataclass(frozen=True)
class Sample:
    name: str
    audio: bytes
    expected: str
    reference: str = ""


@dataclass
class Row:
    model: str
    name: str
    expected: str
    detected: str = ""
    correct: bool = False
    milliseconds: int = 0
    transcript: str = ""
    translation: str = ""
    error: str = ""


def generating_models(models: Iterable[Any]) -> list[str]:
    return sorted(
        model.name.removeprefix("models/")
        for model in models
        if "generateContent" in (model.supported_actions or [])
    )


def language_samples(
    http: httpx.Client, config: str, code: str, count: int, references: dict[str, str]
) -> list[Sample]:
    sentences = read_sentences(http, config)
    clips = stream_clips(http, config, sentences, count)
    return [
        Sample(f"{code}_{number:02d}", audio, code, references.get(sentence.sentence_id, ""))
        for number, (sentence, audio) in enumerate(clips, start=1)
    ]


def summarize(rows: list[Row]) -> list[str]:
    lines = []
    for model in dict.fromkeys(row.model for row in rows):
        own = [row for row in rows if row.model == model]
        correct = sum(row.correct for row in own)
        errors_seen = sum(bool(row.error) for row in own)
        timings = [row.milliseconds for row in own if not row.error]
        median = f"{statistics.median(timings):.0f} ms" if timings else "n/a"
        lines.append(
            f"{model}: language correct {correct}/{len(own)}, "
            f"errors {errors_seen}/{len(own)}, median {median}"
        )
    return lines


def describe(row: Row) -> list[str]:
    if row.error:
        return [f"  {row.model}: {row.error} ({row.milliseconds} ms)"]
    return [
        f"  {row.model}: {row.detected} ({row.milliseconds} ms)",
        f"    heard:      {row.transcript}",
        f"    translated: {row.translation}",
    ]


async def translate_sample(translator: Any, model: str, sample: Sample, target: str) -> Row:
    row = Row(model, sample.name, sample.expected)
    started = time.perf_counter()
    try:
        conversation = list(dict.fromkeys([sample.expected, target]))
        result = await translator.translate_speech(sample.audio, "audio/wav", conversation)
        row.detected = result.language
        row.transcript = result.text
        row.translation = result.for_language(target).text
        row.correct = result.language == row.expected
    except NothingRecognised:
        row.error = "nothing recognised"
    except TranslationFailed as failure:
        row.error = f"{failure.code.value}: {failure.message}"
    except Exception as exc:
        row.error = f"unexpected: {type(exc).__name__}"
    row.milliseconds = round((time.perf_counter() - started) * 1000)
    return row


async def compare(
    http: httpx.Client,
    translators: dict[str, Any],
    languages: list[str],
    count: int,
    target: str,
    pause: float,
) -> list[Row]:
    if not languages:
        raise LookupError("Give at least one language code in --fleurs, for example te,hi,en.")
    configs = await asyncio.to_thread(list_configs, http)
    missing = [code for code in languages if code not in configs]
    if missing:
        raise LookupError(f"FLEURS has no recordings for: {', '.join(missing)}")
    references: dict[str, str] = {}
    if target in configs:
        sentences = await asyncio.to_thread(read_sentences, http, configs[target])
        references = {s.sentence_id: s.text for s in sentences}

    rows: list[Row] = []
    for code in languages:
        samples = await asyncio.to_thread(
            language_samples, http, configs[code], code, count, references
        )
        for sample in samples:
            if rows:
                await asyncio.sleep(pause)
            print(f"\n{sample.name}")
            for model, translator in translators.items():
                row = await translate_sample(translator, model, sample, target)
                rows.append(row)
                print("\n".join(describe(row)))
            if sample.reference:
                print(f"  expected:   {sample.reference}")
    return rows


async def run(args: argparse.Namespace, api_key: str, target: str) -> list[Row]:
    languages = list(
        dict.fromkeys(c for raw in args.fleurs.split(",") if (c := language_code(raw)))
    )
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    translators = {m: GeminiSpeechTranslator(api_key, m, timeout_seconds=60) for m in models}
    try:
        with httpx.Client(follow_redirects=True, timeout=60) as http:
            return await compare(http, translators, languages, args.count, target, args.pause)
    finally:
        for translator in translators.values():
            await translator.aclose()


def main() -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(
        description="Compare Gemini models live on real speech streamed from FLEURS."
    )
    parser.add_argument("--fleurs", default="te,hi,en", help="Languages to stream from FLEURS")
    parser.add_argument("--count", type=int, default=10, help="Clips per language")
    parser.add_argument("--target", default="en", help="Language to translate into")
    parser.add_argument(
        "--models",
        default=settings.gemini_model,
        help="Comma-separated models (default GEMINI_MODEL)",
    )
    parser.add_argument("--list-models", action="store_true", help="Show models your key can use")
    parser.add_argument("--pause", type=float, default=4.0, help="Seconds between clips")
    args = parser.parse_args()
    sys.stdout.reconfigure(errors="replace")

    if settings.gemini_api_key is None or not settings.gemini_api_key.get_secret_value():
        print("GEMINI_API_KEY is missing from backend/.env.")
        return 1
    api_key = settings.gemini_api_key.get_secret_value()

    if args.list_models:
        try:
            with genai.Client(api_key=api_key) as client:
                names = generating_models(client.models.list())
        except errors.APIError as exc:
            print(f"Could not list models: {exc.code} {exc.status}")
            return 1
        print("\n".join(names))
        return 0

    if not args.models:
        print("Set GEMINI_MODEL in backend/.env or pass --models (see --list-models).")
        return 1

    target = language_code(args.target)
    if target is None or args.count < 1:
        print("Use a language code for --target (for example en) and a --count of at least 1.")
        return 1

    try:
        rows = asyncio.run(run(args, api_key, target))
    except LookupError as exc:
        print(exc)
        return 1
    except httpx.HTTPStatusError as exc:
        print(f"Download failed: {exc.response.status_code} for {exc.request.url}")
        return 1
    except (httpx.HTTPError, tarfile.TarError) as exc:
        print(f"Download failed: {type(exc).__name__}. Check the internet connection and retry.")
        return 1

    print("\nSummary")
    for line in summarize(rows):
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
