"""POST /api/support/feedback — Message feedback endpoint."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.auth import get_current_user
from app.models import FeedbackRequest, FeedbackResponse
from app.observability import score_trace

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(request: Request, body: FeedbackRequest):
    """Record thumbs up/down feedback on an assistant message.

    Also sends the score to Langfuse for dashboard tracking.
    """
    from app.main import db, settings

    user_id = await get_current_user(request, settings)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    updated = await db.update_feedback(body.message_id, user_id, body.score)
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found")

    trace_id = updated.get("langfuseTraceId")
    if trace_id:
        comment = "thumbs_up" if body.score >= 4 else "thumbs_down"
        score_trace(trace_id, "user_feedback", body.score, comment)

    return FeedbackResponse(success=True)
