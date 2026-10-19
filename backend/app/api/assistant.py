from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_meeting_assistant, require_host_or_guest
from app.models.assistant import ActionOut, AssistantReply, AssistantRequest, SourceOut
from app.services.assistant.base import AssistantFailed, ChatMessage, MeetingAssistant, Said

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

NOT_SET_UP = "The assistant needs GEMINI_API_KEY and GEMINI_MODEL in the backend .env file."

Assistant = Annotated[MeetingAssistant | None, Depends(get_meeting_assistant)]


@router.post("", response_model=AssistantReply, dependencies=[Depends(require_host_or_guest)])
async def ask(body: AssistantRequest, assistant: Assistant) -> AssistantReply:
    if assistant is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_SET_UP)
    try:
        reply = await assistant.reply(
            [ChatMessage(message.role, message.text) for message in body.messages],
            body.language,
            [Said(line.speaker, line.text) for line in body.transcript],
            body.actions,
            body.now.isoformat() if body.now else None,
        )
    except AssistantFailed as failure:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, failure.message) from failure
    return AssistantReply(
        answer=reply.answer,
        actions=[ActionOut(name=a.name, arguments=a.arguments) for a in reply.actions],
        sources=[SourceOut(title=s.title, url=s.url) for s in reply.sources],
    )
