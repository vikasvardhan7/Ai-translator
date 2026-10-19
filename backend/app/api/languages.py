from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.dependencies import get_speech_translator, require_host_or_guest
from app.models.language import DetectedLanguageOut
from app.models.protocol import ErrorCode
from app.services.audio_ingestion.segment import BYTES_PER_SECOND
from app.services.translation.base import NothingRecognised, SpeechTranslator, TranslationFailed

WAV_HEADER_BYTES = 44
MAX_RECORDING_SECONDS = 10
MAX_RECORDING_BYTES = WAV_HEADER_BYTES + MAX_RECORDING_SECONDS * BYTES_PER_SECOND

router = APIRouter(prefix="/api/languages", tags=["languages"])

Translator = Annotated[SpeechTranslator | None, Depends(get_speech_translator)]


async def _read_recording(request: Request) -> bytes:
    recording = bytearray()
    async for chunk in request.stream():
        recording.extend(chunk)
        if len(recording) > MAX_RECORDING_BYTES:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"The recording is longer than {MAX_RECORDING_SECONDS} seconds."
                " Record a few words and send it again.",
            )
    if recording[:4] != b"RIFF" or recording[8:12] != b"WAVE":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "The recording must be a WAV file: 16-bit PCM, mono, 16 kHz.",
        )
    return bytes(recording)


def _provider_error(failure: TranslationFailed) -> HTTPException:
    if failure.code == ErrorCode.QUOTA_EXCEEDED:
        return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, failure.message)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, failure.message)


@router.post(
    "/detect",
    response_model=DetectedLanguageOut,
    dependencies=[Depends(require_host_or_guest)],
)
async def detect_language(request: Request, translator: Translator) -> DetectedLanguageOut:
    recording = await _read_recording(request)
    if translator is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Language detection is not set up. Add GEMINI_API_KEY and GEMINI_MODEL"
            " to backend/.env.",
        )
    try:
        detected = await translator.detect_language(recording, "audio/wav")
    except NothingRecognised as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "No speech was heard. Say a few words in your language.",
        ) from exc
    except TranslationFailed as failure:
        raise _provider_error(failure) from failure
    return DetectedLanguageOut(language=detected.language, language_name=detected.language_name)
