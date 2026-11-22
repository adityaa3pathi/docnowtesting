"""POST /api/support/chat — Main chat endpoint."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.sse import KEEPALIVE_COMMENT, format_sse_event
from pydantic import BaseModel

from app.agents.orchestrator import HISTORY_MESSAGES
from app.auth import get_access_token, get_current_user
from app.models import (
    ActionSummary,
    AgentContext,
    ChatRequest,
    ChatResponse,
    ChatStreamFinal,
    Intent,
    PendingActionOut,
    SourceRef,
    SupportResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()



async def load_turn_state(db, conversation_id: str, settings) -> tuple[list[dict], Intent | None]:
    """Latest history and any pending confirmation; raises 400 once the turn cap is reached."""
    user_turns, messages = await asyncio.gather(
        db.count_user_messages(conversation_id),
        db.get_recent_messages(conversation_id, limit=HISTORY_MESSAGES),
    )
    if user_turns >= settings.max_conversation_turns:
        raise HTTPException(
            status_code=400,
            detail="Conversation has reached the maximum number of turns. Please start a new conversation.",
        )
    history = [{"role": m["role"], "content": m["content"]} for m in messages]
    return history, _pending_action(messages)


@dataclass
class _Turn:
    """An accepted chat turn: who is asking, in which conversation, and what came before."""

    message: str
    user_id: str | None
    access_token: str | None
    conversation_id: str
    history: list[dict]
    pending_action: Intent | None
    start: float

    def context(self) -> AgentContext:
        return AgentContext(
            user_id=self.user_id,
            is_authenticated=self.user_id is not None,
            access_token=self.access_token,
            conversation_id=self.conversation_id,
            conversation_history=self.history,
            pending_action=self.pending_action,
        )


async def _open_turn(request: Request, body: ChatRequest, db, settings) -> _Turn:
    """Steps 1-4 of a turn, shared by both routes; raises HTTPException before any answer starts."""
    if not settings.enabled:
        raise HTTPException(status_code=503, detail="Support agent is currently disabled")

    start = time.monotonic()

    # 1. Auth
    user_id = await get_current_user(request, settings, db)
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
            logger.warning("Conversation %s not found for user %s; creating fresh conversation", conversation_id, user_id)
            conversation_id = await db.create_conversation(user_id)
    elif user_id:
        # Create new conversation
        conversation_id = await db.create_conversation(user_id)
    else:
        # Unauthenticated — use ephemeral conversation
        conversation_id = "ephemeral"

    # 3. Load conversation history
    history = []
    pending_action = None
    if conversation_id != "ephemeral":
        history, pending_action = await load_turn_state(db, conversation_id, settings)

    # 4. Store user message
    if conversation_id != "ephemeral":
        await db.add_message(
            conversation_id=conversation_id,
            role="user",
            content=body.message,
        )
    return _Turn(body.message, user_id, access_token, conversation_id, history, pending_action, start)


async def _close_turn(turn: _Turn, response: SupportResponse, db) -> ChatResponse:
    """Steps 6-7: store the assistant reply, then build the client body."""
    latency_ms = int((time.monotonic() - turn.start) * 1000)
    conversation_id = turn.conversation_id

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
        if response.pending_action:
            action_refs.append({"pending": response.pending_action.model_dump()})
        if response.cards:
            action_refs.append({"cards": [c.model_dump() for c in response.cards]})
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
        cards=response.cards,
    )


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

    turn = await _open_turn(request, body, db, settings)

    # 5. Run orchestrator
    from app.agents.orchestrator import handle_message

    try:
        response = await handle_message(body.message, turn.context(), db, settings)
    except Exception:
        logger.exception("Orchestrator error for conversation %s", turn.conversation_id)
        raise HTTPException(status_code=500, detail="An error occurred processing your request")

    return await _close_turn(turn, response, db)


# ── Streaming (Phase 5) ────────────────────────
# Same turn as POST /chat, sent as server-sent events. Transport only: the pipeline, prompts and
# stored rows are the JSON route's. Status events say what the turn is doing; the reply is sent
# once, in the final event, after the verifier. No draft or unverified text is ever sent.

SSE_HEADERS = {
    # no-transform: compression layers (Express compression, proxies) must pass events through, not buffer them.
    "Cache-Control": "no-cache, no-transform",
    # nginx in front of Express buffers proxied responses unless told not to.
    "X-Accel-Buffering": "no",
}
KEEPALIVE_SECONDS = 15.0
TURN_FAILED = "An error occurred processing your request"
# Turns whose client left after a booking write started run on to store their reply; keep a reference.
_FINISHING: set[asyncio.Task] = set()


def sse_event(event: str, data: Any) -> str:
    payload = data.model_dump_json() if isinstance(data, BaseModel) else json.dumps(data)
    return format_sse_event(data_str=payload, event=event).decode()


class _TurnStream(StreamingResponse):
    """Closes the event generator when the response ends, so its cleanup runs at once on a disconnect."""

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self.body_iterator.aclose()


@router.post("/chat/stream")
async def chat_stream(request: Request, body: ChatRequest) -> StreamingResponse:
    """POST /api/support/chat/stream: the chat turn as server-sent events.

    Events, in order:
      start   {"conversation_id"}   at once, so a client that loses the stream can reload the history
      status  {"stage"}             0+ of: searching, checking_bookings, updating_booking, drafting, verifying
      final   ChatStreamFinal       the reply: POST /chat's body plus pending_action; ends the stream
      error   {"detail"}            instead of final, where POST /chat would answer 500

    Errors before the turn starts (disabled 503, turn cap 400) are plain HTTP errors, as on POST /chat.
    If the client disconnects, the turn is cancelled (search and rewrite too) unless a booking write
    has started; then it runs on and stores its reply. A disconnect never starts a write.
    """
    from app.main import db, settings

    turn = await _open_turn(request, body, db, settings)
    return _TurnStream(_stream_turn(turn, db, settings), media_type="text/event-stream", headers=SSE_HEADERS)


async def _stream_turn(turn: _Turn, db, settings) -> AsyncIterator[str]:
    from app.agents.orchestrator import TurnEvents, handle_message

    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
    events = TurnEvents(on_status=lambda stage: queue.put_nowait(("status", {"stage": stage})))

    async def run() -> None:
        try:
            response = await handle_message(turn.message, turn.context(), db, settings, events=events)
            body = await _close_turn(turn, response, db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Orchestrator error for conversation %s", turn.conversation_id)
            queue.put_nowait(("error", {"detail": TURN_FAILED}))
            return
        pending = response.pending_action
        queue.put_nowait(("final", ChatStreamFinal(
            **body.model_dump(),
            pending_action=PendingActionOut(tool=pending.tool_name, parameters=pending.parameters) if pending else None,
        )))

    task = asyncio.create_task(run())
    try:
        yield sse_event("start", {"conversation_id": turn.conversation_id})
        while True:
            try:
                kind, data = await asyncio.wait_for(queue.get(), KEEPALIVE_SECONDS)
            except TimeoutError:
                yield KEEPALIVE_COMMENT.decode()
                continue
            yield sse_event(kind, data)
            if kind in ("final", "error"):
                return
    finally:
        # No await here: this also runs while the response is being cancelled.
        if not task.done():
            if events.write_started:
                logger.info("Client left during a booking write; finishing the turn so its reply is stored")
                _FINISHING.add(task)
                task.add_done_callback(_FINISHING.discard)
            else:
                task.cancel()


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


def _pending_action(messages: list[dict]) -> Intent | None:
    """The write action the last assistant message asked to confirm; stored server-side, never sent by the client."""
    last = next((m for m in reversed(messages) if m["role"] == "assistant"), None)
    if not last or not last.get("actionsTaken"):
        return None
    refs = last["actionsTaken"]
    refs = json.loads(refs) if isinstance(refs, str) else refs
    pending = next((r["pending"] for r in refs if isinstance(r, dict) and r.get("pending")), None)
    return Intent.model_validate(pending) if pending else None
