from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_speech_synthesizer, require_host
from app.models.voice import VoiceOut, VoicesOut
from app.services.voice.base import SpeechSynthesizer, VoiceFailed

router = APIRouter(prefix="/api/voices", tags=["voices"])

Synthesizer = Annotated[SpeechSynthesizer | None, Depends(get_speech_synthesizer)]


@router.get("", response_model=VoicesOut, dependencies=[Depends(require_host)])
async def list_voices(synthesizer: Synthesizer) -> VoicesOut:
    if synthesizer is None:
        return VoicesOut(voices=[])
    try:
        voices = await synthesizer.list_voices()
    except VoiceFailed as failure:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, failure.message) from failure
    return VoicesOut(voices=[VoiceOut(**asdict(voice)) for voice in voices])
