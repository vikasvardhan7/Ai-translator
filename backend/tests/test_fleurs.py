import io
import tarfile

import httpx

from scripts.fleurs import (
    SAMPLE_RATE,
    ChunkReader,
    Sentence,
    list_configs,
    parse_sentences,
    pick_clips,
    stream_clips,
)


def tsv_line(sentence_id: str, file_name: str, text: str, seconds: float = 5) -> str:
    samples = int(seconds * SAMPLE_RATE)
    return "\t".join([sentence_id, file_name, text, text.lower(), "x", str(samples), "MALE"])


def archive(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def source(responses: dict[str, bytes | str | list]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        body = responses.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        if isinstance(body, list):
            return httpx.Response(200, json=body)
        return httpx.Response(200, content=body.encode() if isinstance(body, str) else body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_configs_are_listed_live_by_language_code() -> None:
    listing = [
        {"type": "directory", "path": "data/te_in"},
        {"type": "directory", "path": "data/yue_hant_hk"},
        {"type": "file", "path": "data/metadata.zip"},
    ]
    with source({"/api/datasets/google/fleurs/tree/main/data": listing}) as client:
        assert list_configs(client) == {"te": "te_in", "yue": "yue_hant_hk"}


def test_parse_sentences_skips_broken_lines() -> None:
    tsv = "\n".join([tsv_line("1", "a.wav", "Hello"), "broken", "2\tb.wav\tHi\tx\tx\tnan\tMALE"])

    assert parse_sentences(tsv) == [Sentence("1", "a.wav", "Hello", 5 * SAMPLE_RATE)]


def test_chunk_reader_reassembles_small_chunks() -> None:
    data = archive({"test/a.wav": b"audio" * 1000})
    chunks = iter([data[i : i + 7] for i in range(0, len(data), 7)])

    with tarfile.open(fileobj=ChunkReader(chunks), mode="r|gz") as tar:
        member = next(iter(tar))
        assert tar.extractfile(member).read() == b"audio" * 1000


def test_pick_clips_takes_short_distinct_listed_sentences() -> None:
    sentences = [
        Sentence("1", "one.wav", "One", 5 * SAMPLE_RATE),
        Sentence("1", "one-again.wav", "One", 5 * SAMPLE_RATE),
        Sentence("2", "long.wav", "Long", 40 * SAMPLE_RATE),
        Sentence("3", "three.wav", "Three", 5 * SAMPLE_RATE),
        Sentence("4", "four.wav", "Four", 5 * SAMPLE_RATE),
    ]
    data = archive(
        {
            "test/one.wav": b"1",
            "test/one-again.wav": b"1b",
            "test/long.wav": b"2",
            "test/unlisted.wav": b"x",
            "test/three.wav": b"3",
            "test/four.wav": b"4",
        }
    )

    with tarfile.open(fileobj=io.BytesIO(data), mode="r|gz") as tar:
        picked = pick_clips(tar, sentences, 2)

    assert [(s.sentence_id, audio) for s, audio in picked] == [("1", b"1"), ("3", b"3")]


def test_stream_clips_keeps_audio_in_memory() -> None:
    sentences = [Sentence("7", "t1.wav", "నమస్కారం", SAMPLE_RATE)]
    tar = archive({"test/t1.wav": b"te1"})
    with source({"/datasets/google/fleurs/resolve/main/data/te_in/audio/test.tar.gz": tar}) as c:
        clips = stream_clips(c, "te_in", sentences, 5)

    assert clips == [(sentences[0], b"te1")]
