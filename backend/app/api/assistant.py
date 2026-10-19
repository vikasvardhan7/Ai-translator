from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_meeting_assistant, require_host_or_guest
from app.models.assistant import AssistantAnswer, AssistantQuestion
from app.services.assistant.base import AssistantFailed, MeetingAssistant, Said

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

NOT_SET_UP = "The assistant needs GEMINI_API_KEY and GEMINI_MODEL in the backend .env file."

Assistant = Annotated[MeetingAssistant | None, Depends(get_meeting_assistant)]


@router.post("", response_model=AssistantAnswer, dependencies=[Depends(require_host_or_guest)])
async def ask(body: AssistantQuestion, assistant: Assistant) -> AssistantAnswer:
    if assistant is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_SET_UP)
    transcript = [Said(line.speaker, line.text) for line in body.transcript]
    try:
        answer = await assistant.answer(body.question, body.language, transcript)
    except AssistantFailed as failure:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, failure.message) from failure
    return AssistantAnswer(answer=answer)
