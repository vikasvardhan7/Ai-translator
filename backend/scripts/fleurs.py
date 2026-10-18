import io
import tarfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import PurePosixPath

import httpx

LISTING_URL = "https://huggingface.co/api/datasets/google/fleurs/tree/main/data"
DATA_URL = "https://huggingface.co/datasets/google/fleurs/resolve/main/data"
SAMPLE_RATE = 16_000
MAX_SECONDS = 20


@dataclass(frozen=True)
class Sentence:
    sentence_id: str
    file_name: str
    text: str
    samples: int


class ChunkReader(io.RawIOBase):
    def __init__(self, chunks: Iterator[bytes]) -> None:
        self._chunks = chunks
        self._pending = b""

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        while not self._pending:
            try:
                self._pending = next(self._chunks)
            except StopIteration:
                return 0
        size = min(len(buffer), len(self._pending))
        buffer[:size] = self._pending[:size]
        self._pending = self._pending[size:]
        return size


def list_configs(client: httpx.Client) -> dict[str, str]:
    response = client.get(LISTING_URL)
    response.raise_for_status()
    configs: dict[str, str] = {}
    for entry in response.json():
        if entry.get("type") == "directory":
            config = PurePosixPath(entry["path"]).name
            configs.setdefault(config.split("_")[0], config)
    return configs


def parse_sentences(tsv: str) -> list[Sentence]:
    sentences = []
    for line in tsv.splitlines():
        columns = line.split("\t")
        if len(columns) < 6 or not columns[5].isdigit():
            continue
        sentences.append(Sentence(columns[0], columns[1], columns[2], int(columns[5])))
    return sentences


def read_sentences(client: httpx.Client, config: str) -> list[Sentence]:
    response = client.get(f"{DATA_URL}/{config}/test.tsv")
    response.raise_for_status()
    return parse_sentences(response.text)


def pick_clips(
    archive: tarfile.TarFile, sentences: list[Sentence], count: int
) -> list[tuple[Sentence, bytes]]:
    short = {s.file_name: s for s in sentences if s.samples <= MAX_SECONDS * SAMPLE_RATE}
    picked: list[tuple[Sentence, bytes]] = []
    used: set[str] = set()
    for member in archive:
        sentence = short.get(PurePosixPath(member.name).name)
        if not member.isfile() or sentence is None or sentence.sentence_id in used:
            continue
        data = archive.extractfile(member)
        if data is None:
            continue
        picked.append((sentence, data.read()))
        used.add(sentence.sentence_id)
        if len(picked) == count:
            break
    return picked


def stream_clips(
    client: httpx.Client, config: str, sentences: list[Sentence], count: int
) -> list[tuple[Sentence, bytes]]:
    with client.stream("GET", f"{DATA_URL}/{config}/audio/test.tar.gz") as response:
        response.raise_for_status()
        reader = ChunkReader(response.iter_bytes())
        with tarfile.open(fileobj=reader, mode="r|gz") as archive:
            return pick_clips(archive, sentences, count)
