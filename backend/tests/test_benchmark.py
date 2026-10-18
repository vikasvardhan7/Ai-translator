from types import SimpleNamespace

import httpx
import pytest

from app.models.protocol import ErrorCode
from app.services.translation.base import NothingRecognised, TranslationFailed
from scripts.benchmark import (
    Row,
    Sample,
    compare,
    describe,
    generating_models,
    summarize,
    translate_sample,
)
from tests.fakes import FakeTranslator
from tests.test_fleurs import archive, source, tsv_line

DATA = "/datasets/google/fleurs/resolve/main/data"
LISTING = "/api/datasets/google/fleurs/tree/main/data"
SAMPLE = Sample("te_01", b"x", "te", "How are you?")


def row(model="m", expected="te", detected="te", milliseconds=100, error="") -> Row:
    return Row(model, "f", expected, detected, detected == expected, milliseconds, error=error)


def fleurs() -> httpx.Client:
    return source(
        {
            LISTING: [
                {"type": "directory", "path": "data/te_in"},
                {"type": "directory", "path": "data/en_us"},
            ],
            f"{DATA}/te_in/test.tsv": tsv_line("7", "t1.wav", "నమస్కారం"),
            f"{DATA}/en_us/test.tsv": tsv_line("7", "e1.wav", "Hello"),
            f"{DATA}/te_in/audio/test.tar.gz": archive({"test/t1.wav": b"te1"}),
            f"{DATA}/en_us/audio/test.tar.gz": archive({"test/e1.wav": b"en1"}),
        }
    )


def test_models_are_taken_live_from_the_api_listing() -> None:
    listing = [
        SimpleNamespace(name="models/b-flash", supported_actions=["generateContent"]),
        SimpleNamespace(name="models/embedder", supported_actions=["embedContent"]),
        SimpleNamespace(name="models/a-lite", supported_actions=["countTokens", "generateContent"]),
        SimpleNamespace(name="models/unknown", supported_actions=None),
    ]

    assert generating_models(listing) == ["a-lite", "b-flash"]


@pytest.mark.anyio
async def test_every_model_hears_each_streamed_clip(capsys) -> None:
    translators = {"m1": FakeTranslator(), "m2": FakeTranslator(language="en")}

    with fleurs() as http:
        rows = await compare(http, translators, ["te", "en"], 3, "en", pause=0)

    assert [(r.name, r.model, r.correct) for r in rows] == [
        ("te_01", "m1", True),
        ("te_01", "m2", False),
        ("en_01", "m1", False),
        ("en_01", "m2", True),
    ]
    assert translators["m1"].calls[0].audio == b"te1"
    assert "expected:   Hello" in capsys.readouterr().out


@pytest.mark.anyio
async def test_languages_fleurs_does_not_have_are_named() -> None:
    with fleurs() as http:
        with pytest.raises(LookupError, match="xyz"):
            await compare(http, {"m": FakeTranslator()}, ["te", "xyz"], 1, "en", pause=0)


@pytest.mark.anyio
async def test_no_languages_is_refused() -> None:
    with fleurs() as http:
        with pytest.raises(LookupError, match="at least one"):
            await compare(http, {"m": FakeTranslator()}, [], 1, "en", pause=0)


@pytest.mark.anyio
async def test_a_missing_archive_stops_the_run() -> None:
    responses = {
        LISTING: [{"type": "directory", "path": "data/te_in"}],
        f"{DATA}/te_in/test.tsv": tsv_line("7", "t1.wav", "నమస్కారం"),
    }
    with source(responses) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await compare(http, {"m": FakeTranslator()}, ["te"], 1, "en", pause=0)


def test_summary_per_model() -> None:
    rows = [
        row("a", "te", "te", 100),
        row("a", "hi", "en", 300),
        row("a", "en", "", 0, "quota_exceeded"),
        row("b", "te", "te", 50),
    ]

    assert summarize(rows) == [
        "a: language correct 1/3, errors 1/3, median 200 ms",
        "b: language correct 1/1, errors 0/1, median 50 ms",
    ]


def test_describe_shows_what_each_model_heard() -> None:
    result = Row("m", "te_01", "te", "te", True, 900, "నమస్కారం", "Hello")

    assert describe(result) == [
        "  m: te (900 ms)",
        "    heard:      నమస్కారం",
        "    translated: Hello",
    ]
    assert describe(Row("m", "x", "", milliseconds=5, error="quota_exceeded: Limit.")) == [
        "  m: quota_exceeded: Limit. (5 ms)"
    ]


@pytest.mark.anyio
async def test_one_bad_sample_does_not_stop_the_run() -> None:
    class Crashing(FakeTranslator):
        async def translate_speech(self, *args, **kwargs):
            raise RuntimeError("bad response")

    result = await translate_sample(Crashing(), "m", SAMPLE, "en")

    assert result.error == "unexpected: RuntimeError"


@pytest.mark.anyio
async def test_provider_errors_are_recorded_with_their_message() -> None:
    failure = TranslationFailed(ErrorCode.QUOTA_EXCEEDED, "Limit reached.", retryable=True)

    result = await translate_sample(FakeTranslator(failure=failure), "m", SAMPLE, "en")

    assert result.error == "quota_exceeded: Limit reached."


@pytest.mark.anyio
async def test_successful_sample_records_language_and_text() -> None:
    result = await translate_sample(FakeTranslator(), "m", SAMPLE, "en")

    assert (result.detected, result.correct, result.translation) == (
        "te",
        True,
        "How are you? [en]",
    )


@pytest.mark.anyio
async def test_unrecognised_speech_is_recorded() -> None:
    result = await translate_sample(FakeTranslator(failure=NothingRecognised()), "m", SAMPLE, "en")

    assert result.error == "nothing recognised"


@pytest.mark.anyio
async def test_each_clip_is_translated_as_in_a_conversation() -> None:
    translator = FakeTranslator()

    await translate_sample(translator, "m", SAMPLE, "en")
    await translate_sample(translator, "m", Sample("en_01", b"x", "en"), "en")

    assert [call.target_languages for call in translator.calls] == [["te", "en"], ["en"]]
