"""POST /api/support/chat — Main chat endpoint."""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request

from app.auth import get_access_token, get_current_user
from app.models import (
    ActionSummary,
    AgentContext,
    ChatRequest,
    ChatResponse,
    SourceRef,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: Request, body: ChatRequest):
    """Handle a customer support chat message.

    Flow:
    1. Authenticate user (optional — unauthenticated gets catalog-only)
    2. Load or create conversation
    3. Store user message
    4. Run the three-agent orchestrator pipeline
    5. Store assistant response
    6. Return response with sources and actions
    """
    from app.main import db, settings

    if not settings.enabled:
        raise HTTPException(status_code=503, detail="Support agent is currently disabled")

    start = time.monotonic()

    # 1. Auth
    user_id = await get_current_user(request, settings)
    access_token = get_access_token(request)

    if not user_id:
        # Allow unauthenticated users for catalog-only queries
        # Create a temporary conversation ID
        user_id = None

    # 2. Conversation management
    conversation_id = body.conversation_id
    if conversation_id and user_id:
        # Verify ownership
        conv = await db.get_conversation(conversation_id, user_id)
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
    elif user_id:
        # Create new conversation
        conversation_id = await db.create_conversation(user_id)
    else:
        # Unauthenticated — use ephemeral conversation
        conversation_id = "ephemeral"

    # 3. Load conversation history
    history = []
    if conversation_id != "ephemeral":
        messages = await db.get_conversation_messages(conversation_id, limit=20)
        history = [{"role": m["role"], "content": m["content"]} for m in messages]

        # Check turn limit
        user_turns = sum(1 for m in history if m["role"] == "user")
        if user_turns >= settings.max_conversation_turns:
            raise HTTPException(
                status_code=400,
                detail="Conversation has reached the maximum number of turns. Please start a new conversation.",
            )

    # 4. Store user message
    user_msg_id = None
    if conversation_id != "ephemeral":
        user_msg_id = await db.add_message(
            conversation_id=conversation_id,
            role="user",
            content=body.message,
        )

    # 5. Run orchestrator
    from app.agents.orchestrator import handle_message

    ctx = AgentContext(
        user_id=user_id,
        is_authenticated=user_id is not None,
        access_token=access_token,
        conversation_id=conversation_id,
        conversation_history=history,
    )

    try:
        response = await handle_message(body.message, ctx, db, settings)
    except Exception:
        logger.exception("Orchestrator error for conversation %s", conversation_id)
        raise HTTPException(status_code=500, detail="An error occurred processing your request")

    latency_ms = int((time.monotonic() - start) * 1000)

    # 6. Store assistant response
    assistant_msg_id = "ephemeral"
    if conversation_id != "ephemeral":
        source_refs = [
            {"id": s.id, "title": s.title, "source": s.source, "similarity": s.similarity}
            for s in response.sources
        ]
        action_refs = [
            {"tool": a.tool, "success": a.success, "output_preview": str(a.output)[:200]}
            for a in response.actions_taken
        ]
        assistant_msg_id = await db.add_message(
            conversation_id=conversation_id,
            role="assistant",
            content=response.content,
            sources=source_refs,
            actions_taken=action_refs,
            verifier_verdict=response.verifier_verdict,
            was_abstained=response.was_abstained,
            token_count=response.token_count,
            latency_ms=latency_ms,
            langfuse_trace_id=response.langfuse_trace_id,
        )

    # 7. Build client response
    source_refs_out = [
        SourceRef(
            id=s.id,
            title=s.title,
            source_type=s.source,
            snippet=s.content[:200],
            similarity=s.similarity,
        )
        for s in response.sources
    ]
    action_summaries = [
        ActionSummary(
            tool=a.tool,
            success=a.success,
            summary=_summarize_action(a),
        )
        for a in response.actions_taken
    ]

    return ChatResponse(
        conversation_id=conversation_id,
        message_id=assistant_msg_id,
        content=response.content,
        sources=source_refs_out,
        actions_taken=action_summaries,
        verified=response.verifier_verdict == "GROUNDED",
        was_abstained=response.was_abstained,
    )


def _summarize_action(action) -> str:
    """Create a human-readable summary of an action result."""
    if not action.success:
        return f"Failed to execute {action.tool}: {action.error or 'unknown error'}"

    summaries = {
        "search_catalog": "Searched the test catalog",
        "get_product_details": "Retrieved test details",
        "list_bookings": "Retrieved your bookings",
        "get_booking_status": "Checked booking status",
        "get_reschedule_slots": "Found available slots",
        "cancel_booking": "Processed cancellation",
        "reschedule_booking": "Processed rescheduling",
    }
    return summaries.get(action.tool, f"Executed {action.tool}")
