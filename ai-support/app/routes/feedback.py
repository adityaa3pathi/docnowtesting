"""POST /api/support/feedback — Message feedback endpoint."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.auth import get_current_user
from app.models import FeedbackRequest, FeedbackResponse

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

    # Update feedback in DB
    await db.update_feedback(body.message_id, body.score)

    # Send score to Langfuse if available
    try:
        from app.observability import score_trace

        # Retrieve the message to get the langfuse trace ID
        if db.pool:
            async with db.pool.acquire() as conn:
                row = await conn.fetchrow(
                    'SELECT "langfuseTraceId" FROM "SupportMessage" WHERE id = $1',
                    body.message_id,
                )
                trace_id = row["langfuseTraceId"] if row else None

            if trace_id:
                comment = "thumbs_up" if body.score >= 4 else "thumbs_down"
                score_trace(trace_id, "user_feedback", body.score, comment)
                logger.info("Feedback score %d sent to Langfuse for trace %s", body.score, trace_id)
    except Exception:
        logger.warning("Failed to send feedback to Langfuse", exc_info=True)

    return FeedbackResponse(success=True)
