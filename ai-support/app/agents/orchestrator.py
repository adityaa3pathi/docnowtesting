"""Orchestrator — coordinates the three-agent pipeline with Langfuse tracing.

Flow:
  User Message
    → 1. Retrieval Agent (always runs — provides context)
    → 2. Intent Classification (question vs. action vs. greeting vs. off-topic)
    → 3. If action needed: Action Agent (tool execution)
    → 4. Draft Response Generation (LLM with retrieval context + action results)
    → 5. Verifier Agent (checks draft against sources — blocks ungrounded claims)
    → 6. Final Response (verified) or Abstention
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from langfuse import observe

from app.agents import usage
from app.agents.llm import AIBusyError, call_gemini
from app.agents.retrieval import retrieve
from app.agents.verifier import verify
from app.models import (
    ActionResult,
    AgentContext,
    Intent,
    RetrievalResult,
    RetrievedChunk,
    SupportResponse,
)
from app.observability import annotate, current_trace_id
from app.prompts.intent import INTENT_CLASSIFICATION_PROMPT, intent_schema
from app.prompts.system import DRAFT_GENERATION_PROMPT, ORCHESTRATOR_SYSTEM_PROMPT
from app.prompts.verifier import ABSTENTION_MESSAGE
from app.tools.registry import TOOL_REGISTRY, render_tool_list

logger = logging.getLogger(__name__)

# Raw messages carried into prompts; the chat route loads exactly this many.
HISTORY_MESSAGES = 6

GREETING_RESPONSE = (
    "Hello! 👋 I'm DocNow's support assistant. I can help you with:\n"
    "• Finding tests and health packages\n"
    "• Checking your booking status\n"
    "• Rescheduling or cancelling appointments\n"
    "• Answering questions about our policies\n\n"
    "How can I help you today?"
)

BUSY_RESPONSE = (
    "Our AI assistant is busy right now. Please try again in a little while, "
    "or contact our support team at +91 9649089089."
)

OFF_TOPIC_RESPONSE = (
    "Sorry, I can only help with DocNow: lab tests and packages, your bookings, "
    "and our policies. What can I help you with there?"
)

ERROR_RESPONSE = (
    "I'm sorry, something went wrong while processing your request. "
    "Please try again or contact our support team at +91 9649089089."
)

TOOL_OUTPUT_CHARS = 800
MAX_BOOKINGS_IN_PROMPT = 5

ACTION_FAILED_RESPONSE = (
    "I couldn't complete that just now. Please check the booking details and try again, "
    "or contact our support team at +91 9649089089."
)

WRITE_DONE_RESPONSES = {
    "cancel_booking": "Done. Your booking has been cancelled.",
    "reschedule_booking": "Done. Your booking has been rescheduled.",
}

# Plain greetings and thanks get the canned reply with no model or search call.
_GREETING = re.compile(
    r"^\s*(hi+|hello|hey|hola|namaste|namaskar|good (morning|afternoon|evening)|"
    r"thanks|thank you|thank u|thanks a lot|ty)\s*(there|docnow)?[.!\s]*$",
    re.IGNORECASE,
)

# Only a short, plain "yes" confirms a pending write; anything else drops it.
_CONFIRM = re.compile(
    r"^\s*(yes|y|yeah|yep|confirm|confirmed|ok|okay|sure|go ahead|do it|haan|haan ji|ha|ji)\s*(please)?[.!\s]*$",
    re.IGNORECASE,
)


def _history_text(ctx: AgentContext) -> str:
    return "\n".join(f"{m['role'].upper()}: {m['content']}" for m in ctx.conversation_history[-HISTORY_MESSAGES:])


def _confirmation_request(intent: Intent) -> str:
    details = ", ".join(f"{k}: {v}" for k, v in intent.parameters.items()) or "no details"
    action = "cancel this booking" if intent.tool_name == "cancel_booking" else "reschedule this booking"
    return f"Please confirm: do you want me to {action} ({details})? Reply YES to continue, or anything else to stop."


@observe(name="intent-classification", capture_input=False, capture_output=False)
async def classify_intent(
    query: str,
    retrieval_summary: str,
    ctx: AgentContext,
    settings: Any,
) -> Intent:
    """Classify user intent using LLM."""
    prompt = INTENT_CLASSIFICATION_PROMPT.format(
        query=query,
        context_summary=retrieval_summary or "not checked",
        is_authenticated=str(ctx.is_authenticated),
        conversation_history=_history_text(ctx) or "(new conversation)",
        tools=render_tool_list(),
    )

    try:
        result_text = await call_gemini(
            prompt=prompt,
            settings=settings,
            system_prompt="You are an intent classifier. Return valid JSON only.",
            temperature=0.1,
            response_json_schema=intent_schema(TOOL_REGISTRY),
            stage="intent",
        )
        parsed = json.loads(result_text)
        intent = Intent(
            intent=parsed.get("intent", "UNKNOWN"),
            tool_name=parsed.get("tool_name"),
            parameters=parsed.get("parameters", {}),
            requires_action=parsed.get("requires_action", False),
            confidence=parsed.get("confidence", 0.0),
        )
        annotate(intent=intent.intent, tool=intent.tool_name, confidence=intent.confidence)
        return intent
    except AIBusyError:
        raise
    except Exception:
        logger.exception("Intent classification failed")
        return Intent(intent="UNKNOWN", requires_action=False, confidence=0.0)


def _booking_line(b: dict) -> str:
    tests = b.get("items") or b.get("tests") or []
    when = b.get("slot") or " ".join(str(v) for v in (b.get("slotDate"), b.get("slotTime")) if v)
    return f"id={b.get('id')} | tests={', '.join(map(str, tests))} | when={when} | status={b.get('status')}"


def compact_tool_output(tool: str, output: Any) -> str:
    """Tool output as short lines for the prompt; bookings keep only id, tests, time and status."""
    if tool == "list_bookings":
        rows = output.get("bookings", []) if isinstance(output, dict) else output
        if isinstance(rows, list):
            return "\n".join(_booking_line(b) for b in rows[:MAX_BOOKINGS_IN_PROMPT] if isinstance(b, dict))
    return json.dumps(output, default=str)[:TOOL_OUTPUT_CHARS]


@observe(name="draft-generation", capture_input=False, capture_output=False)
async def generate_draft(
    query: str,
    retrieval_chunks: list[RetrievedChunk],
    actions: list[ActionResult],
    ctx: AgentContext,
    settings: Any,
) -> str:
    """Generate a draft response using retrieved context and action results."""
    context_text = "\n\n".join(
        f"[{c.source.upper()}] {c.title}:\n{c.content}" for c in retrieval_chunks
    )

    action_text = "\n\n".join(
        f"[ACTION: {a.tool}] Result:\n{compact_tool_output(a.tool, a.output)}"
        for a in actions
        if a.success
    )

    history_text = _history_text(ctx)

    prompt = DRAFT_GENERATION_PROMPT.format(
        query=query,
        context=context_text or "(no relevant context found)",
        action_results=action_text or "(no actions taken)",
        conversation_history=history_text or "(new conversation)",
    )

    try:
        return await call_gemini(
            prompt=prompt,
            settings=settings,
            system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
            # Answers quote prices and policies; low temperature keeps them literal.
            temperature=0.2,
            stage="draft",
        )
    except AIBusyError:
        raise
    except Exception:
        logger.exception("Draft generation failed")
        return ABSTENTION_MESSAGE


@observe(name="support-agent-orchestrator", capture_input=False, capture_output=False)
async def handle_message(
    message: str,
    ctx: AgentContext,
    db: Any,
    settings: Any,
) -> SupportResponse:
    """Full agent pipeline: Retrieve → Classify → Act → Generate → Verify.

    This is the main entry point called by the chat route handler.
    """
    with usage.track_turn() as turn:
        response = await _run_pipeline(message, ctx, db, settings)
    summary = turn.summary()
    response.usage = summary
    response.token_count = summary["total_tokens"]
    response.langfuse_trace_id = current_trace_id()
    annotate(calls=summary["calls"], total_tokens=summary["total_tokens"], cap_hits=summary["cap_hits"])
    logger.info(
        "turn tokens total=%d calls=%d cap_hits=%d", summary["total_tokens"], summary["calls"], summary["cap_hits"]
    )
    return response


def _elapsed(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


async def _run_pipeline(
    message: str,
    ctx: AgentContext,
    db: Any,
    settings: Any,
) -> SupportResponse:
    start_time = time.monotonic()
    retrieval_task: asyncio.Task | None = None

    try:
        if _GREETING.match(message):
            return SupportResponse(content=GREETING_RESPONSE, latency_ms=_elapsed(start_time))

        # A "yes" to the write action asked about last turn runs it; no search needed.
        confirmed = ctx.pending_action is not None and bool(_CONFIRM.match(message))
        retrieval = RetrievalResult()
        if confirmed:
            intent = ctx.pending_action
        elif settings.parallel_intent_retrieval:
            # Search runs while intent is classified; tool and greeting turns cancel it unused.
            retrieval_task = asyncio.create_task(retrieve(message, db, settings))
            intent = await classify_intent(message, "", ctx, settings)
        else:
            retrieval = await retrieve(message, db, settings)
            summary = "; ".join(f"{c.title} ({c.source}, sim={c.similarity:.2f})" for c in retrieval.chunks)
            intent = await classify_intent(message, summary or "none", ctx, settings)
        logger.info(
            "Intent: %s (tool=%s, action=%s, conf=%.2f)",
            intent.intent, intent.tool_name, intent.requires_action, intent.confidence,
        )

        # 3. Greeting — return immediately without verification
        if intent.intent == "GREETING":
            return SupportResponse(
                content=GREETING_RESPONSE,
                was_abstained=False,
                latency_ms=_elapsed(start_time),
            )

        # 4. Off-topic → abstain. Off-topic questions score as close to the catalog
        # as real ones (eval 13-10-2026), so similarity alone cannot gate this.
        if intent.intent == "OFF_TOPIC":
            return SupportResponse(
                content=OFF_TOPIC_RESPONSE,
                was_abstained=True,
                verifier_verdict="UNGROUNDED",
                latency_ms=_elapsed(start_time),
            )

        tool_turn = bool((intent.requires_action or confirmed) and intent.tool_name)
        tool_def = TOOL_REGISTRY.get(intent.tool_name) if tool_turn else None
        # Booking tools answer from the customer's own records; catalog tools still use and verify KB chunks.
        booking_turn = bool(tool_def and tool_def.requires_auth)
        if booking_turn and retrieval_task:
            retrieval_task.cancel()
        elif retrieval_task:
            retrieval = await retrieval_task

        if not tool_turn:
            if retrieval.failed:
                return SupportResponse(content=ERROR_RESPONSE, was_abstained=True, latency_ms=_elapsed(start_time))
            # Nothing relevant in the knowledge base: abstain before paying for draft and verifier.
            if retrieval.should_abstain:
                return SupportResponse(
                    content=ABSTENTION_MESSAGE,
                    verifier_verdict="NO_CONTEXT",
                    was_abstained=True,
                    latency_ms=_elapsed(start_time),
                )

        # 5. Execute action if needed
        actions: list[ActionResult] = []
        if tool_turn:
            if tool_def and tool_def.requires_auth and not ctx.is_authenticated:
                return SupportResponse(
                    content=(
                        "Please log in to access your bookings. You can log in from "
                        "the top-right corner of the page. Once logged in, I can help "
                        "you check booking status, reschedule, or cancel appointments."
                    ),
                    was_abstained=False,
                    latency_ms=_elapsed(start_time),
                )

            if tool_def and tool_def.is_write and not confirmed:
                return SupportResponse(
                    content=_confirmation_request(intent),
                    pending_action=intent,
                    latency_ms=_elapsed(start_time),
                )

            from app.agents.action import execute_action

            action_result = await execute_action(intent, ctx, settings)
            actions.append(action_result)

            # A failed tool gets a fixed reply: an unverified draft could claim it worked.
            if not action_result.success:
                return SupportResponse(
                    content=ACTION_FAILED_RESPONSE,
                    actions_taken=actions,
                    was_abstained=True,
                    latency_ms=_elapsed(start_time),
                )

            if booking_turn:
                # No KB chunks reach this draft, so there is nothing for the verifier to check.
                draft = await generate_draft(message, [], actions, ctx, settings)
                if draft == ABSTENTION_MESSAGE and intent.tool_name in WRITE_DONE_RESPONSES:
                    # The change already happened; never tell the customer we could not help.
                    draft = WRITE_DONE_RESPONSES[intent.tool_name]
                return SupportResponse(
                    content=draft,
                    actions_taken=actions,
                    verifier_verdict="TOOL_ONLY",
                    was_abstained=draft == ABSTENTION_MESSAGE,
                    latency_ms=_elapsed(start_time),
                )

        # 6. Generate draft response
        draft = await generate_draft(
            message, retrieval.chunks, actions, ctx, settings
        )

        # 7. Verify — the critical grounded abstention gate
        verification = await verify(draft, retrieval, actions, settings)

        if verification.verdict == "UNGROUNDED":
            return SupportResponse(
                content=ABSTENTION_MESSAGE,
                sources=[],
                actions_taken=actions,
                verifier_verdict="UNGROUNDED",
                was_abstained=True,
                latency_ms=_elapsed(start_time),
            )

        # 8. Return verified response
        return SupportResponse(
            content=verification.cleaned_response,
            sources=retrieval.chunks,
            actions_taken=actions,
            verifier_verdict=verification.verdict,
            was_abstained=False,
            latency_ms=_elapsed(start_time),
        )

    except AIBusyError:
        return SupportResponse(
            content=BUSY_RESPONSE,
            was_abstained=True,
            latency_ms=_elapsed(start_time),
        )
    except Exception:
        logger.exception("Orchestrator error for conversation %s", ctx.conversation_id)
        return SupportResponse(content=ERROR_RESPONSE, was_abstained=True, latency_ms=_elapsed(start_time))
    finally:
        if retrieval_task and not retrieval_task.done():
            retrieval_task.cancel()
        elif retrieval_task and not retrieval_task.cancelled():
            retrieval_task.exception()  # mark a finished-but-unused failure as seen
