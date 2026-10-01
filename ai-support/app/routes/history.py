"""GET /api/support/history — Conversation history endpoint."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.auth import get_current_user
from app.models import HistoryResponse, MessageEntry, SourceRef

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/history", response_model=HistoryResponse)
async def get_history(request: Request, conversation_id: str):
    """Return paginated conversation history for the authenticated user."""
    from app.main import db, settings

    user_id = await get_current_user(request, settings)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Verify ownership
    conv = await db.get_conversation(conversation_id, user_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = await db.get_conversation_messages(conversation_id, limit=50)

    entries = []
    for m in messages:
        sources = []
        if m.get("sources"):
            raw_sources = m["sources"] if isinstance(m["sources"], list) else []
            sources = [
                SourceRef(
                    id=s.get("id", ""),
                    title=s.get("title", ""),
                    source_type=s.get("source", "unknown"),
                    snippet=s.get("content", "")[:200] if s.get("content") else "",
                    similarity=s.get("similarity", 0.0),
                )
                for s in raw_sources
            ]

        entries.append(
            MessageEntry(
                id=m["id"],
                role=m["role"],
                content=m["content"],
                sources=sources,
                verified=m.get("verifierVerdict") == "GROUNDED",
                was_abstained=m.get("wasAbstained", False),
                feedback_score=m.get("feedbackScore"),
                created_at=m["createdAt"],
            )
        )

    return HistoryResponse(conversation_id=conversation_id, messages=entries)
