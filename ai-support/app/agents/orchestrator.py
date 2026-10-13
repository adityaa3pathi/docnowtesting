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

import json
import logging
import re
import time
from typing import Any

from langfuse import observe

from app.agents.llm import AIBusyError, call_gemini
from app.agents.retrieval import retrieve
from app.agents.verifier import verify
from app.models import (
    ActionResult,
    AgentContext,
    Intent,
    RetrievedChunk,
    SupportResponse,
)
from app.observability import current_trace_id
from app.prompts.intent import INTENT_CLASSIFICATION_PROMPT, intent_schema
from app.prompts.system import DRAFT_GENERATION_PROMPT, ORCHESTRATOR_SYSTEM_PROMPT
from app.prompts.verifier import ABSTENTION_MESSAGE
from app.tools.registry import TOOL_REGISTRY, render_tool_list

logger = logging.getLogger(__name__)

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

# Only a short, plain "yes" confirms a pending write; anything else drops it.
_CONFIRM = re.compile(
    r"^\s*(yes|y|yeah|yep|confirm|confirmed|ok|okay|sure|go ahead|do it|haan|haan ji|ha|ji)\s*(please)?[.!\s]*$",
    re.IGNORECASE,
)


def _history_text(ctx: AgentContext) -> str:
    return "\n".join(f"{m['role'].upper()}: {m['content']}" for m in ctx.conversation_history[-6:])


def _confirmation_request(intent: Intent) -> str:
    details = ", ".join(f"{k}: {v}" for k, v in intent.parameters.items()) or "no details"
    action = "cancel this booking" if intent.tool_name == "cancel_booking" else "reschedule this booking"
    return f"Please confirm: do you want me to {action} ({details})? Reply YES to continue, or anything else to stop."


@observe(name="intent-classification")
async def classify_intent(
    query: str,
    retrieval_summary: str,
    ctx: AgentContext,
    settings: Any,
) -> Intent:
    """Classify user intent using LLM."""
    prompt = INTENT_CLASSIFICATION_PROMPT.format(
        query=query,
        context_summary=retrieval_summary,
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
        )
        parsed = json.loads(result_text)
        return Intent(
            intent=parsed.get("intent", "UNKNOWN"),
            tool_name=parsed.get("tool_name"),
            parameters=parsed.get("parameters", {}),
            requires_action=parsed.get("requires_action", False),
            confidence=parsed.get("confidence", 0.0),
        )
    except AIBusyError:
        raise
    except Exception:
        logger.exception("Intent classification failed")
        return Intent(intent="UNKNOWN", requires_action=False, confidence=0.0)


@observe(name="draft-generation")
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
        f"[ACTION: {a.tool}] Result: {json.dumps(a.output, default=str)[:500]}"
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
        )
    except AIBusyError:
        raise
    except Exception:
        logger.exception("Draft generation failed")
        return ABSTENTION_MESSAGE


@observe(name="support-agent-orchestrator")
async def handle_message(
    message: str,
    ctx: AgentContext,
    db: Any,
    settings: Any,
) -> SupportResponse:
    """Full agent pipeline: Retrieve → Classify → Act → Generate → Verify.

    This is the main entry point called by the chat route handler.
    """
    response = await _run_pipeline(message, ctx, db, settings)
    response.langfuse_trace_id = current_trace_id()
    return response


async def _run_pipeline(
    message: str,
    ctx: AgentContext,
    db: Any,
    settings: Any,
) -> SupportResponse:
    start_time = time.monotonic()

    try:
        # 1. Always retrieve context
        retrieval = await retrieve(message, db, settings)

        # Build a summary of retrieved context for intent classification
        retrieval_summary = "; ".join(
            f"{c.title} ({c.source}, sim={c.similarity:.2f})" for c in retrieval.chunks
        ) or "No relevant context found"

        # 2. A "yes" to the write action asked about last turn runs it; else classify
        confirmed = ctx.pending_action is not None and bool(_CONFIRM.match(message))
        if confirmed:
            intent = ctx.pending_action
        else:
            intent = await classify_intent(message, retrieval_summary, ctx, settings)
        logger.info(
            "Intent: %s (tool=%s, action=%s, conf=%.2f)",
            intent.intent, intent.tool_name, intent.requires_action, intent.confidence,
        )

        # 3. Greeting — return immediately without verification
        if intent.intent == "GREETING":
            latency_ms = int((time.monotonic() - start_time) * 1000)
            return SupportResponse(
                content=GREETING_RESPONSE,
                was_abstained=False,
                latency_ms=latency_ms,
            )

        # 4. Off-topic → abstain. Off-topic questions score as close to the catalog
        # as real ones (eval 13-10-2026), so similarity alone cannot gate this.
        if intent.intent == "OFF_TOPIC":
            latency_ms = int((time.monotonic() - start_time) * 1000)
            return SupportResponse(
                content=OFF_TOPIC_RESPONSE,
                was_abstained=True,
                verifier_verdict="UNGROUNDED",
                latency_ms=latency_ms,
            )

        # 5. Execute action if needed
        actions: list[ActionResult] = []
        if (intent.requires_action or confirmed) and intent.tool_name:
            if not ctx.is_authenticated:
                latency_ms = int((time.monotonic() - start_time) * 1000)
                return SupportResponse(
                    content=(
                        "Please log in to access your bookings. You can log in from "
                        "the top-right corner of the page. Once logged in, I can help "
                        "you check booking status, reschedule, or cancel appointments."
                    ),
                    was_abstained=False,
                    latency_ms=latency_ms,
                )

            tool_def = TOOL_REGISTRY.get(intent.tool_name)
            if tool_def and tool_def.is_write and not confirmed:
                return SupportResponse(
                    content=_confirmation_request(intent),
                    pending_action=intent,
                    latency_ms=int((time.monotonic() - start_time) * 1000),
                )

            from app.agents.action import execute_action

            action_result = await execute_action(intent, ctx, settings)
            actions.append(action_result)

        # 6. Generate draft response
        draft = await generate_draft(
            message, retrieval.chunks, actions, ctx, settings
        )

        # 7. Verify — the critical grounded abstention gate
        verification = await verify(draft, retrieval, actions, settings)

        latency_ms = int((time.monotonic() - start_time) * 1000)

        if verification.verdict == "UNGROUNDED":
            return SupportResponse(
                content=ABSTENTION_MESSAGE,
                sources=[],
                actions_taken=actions,
                verifier_verdict="UNGROUNDED",
                was_abstained=True,
                latency_ms=latency_ms,
            )

        # 8. Return verified response
        return SupportResponse(
            content=verification.cleaned_response,
            sources=retrieval.chunks,
            actions_taken=actions,
            verifier_verdict=verification.verdict,
            was_abstained=False,
            latency_ms=latency_ms,
        )

    except AIBusyError:
        return SupportResponse(
            content=BUSY_RESPONSE,
            was_abstained=True,
            latency_ms=int((time.monotonic() - start_time) * 1000),
        )
    except Exception:
        logger.exception("Orchestrator error for conversation %s", ctx.conversation_id)
        latency_ms = int((time.monotonic() - start_time) * 1000)
        return SupportResponse(
            content=(
                "I'm sorry, something went wrong while processing your request. "
                "Please try again or contact our support team at +91 9649089089."
            ),
            was_abstained=True,
            latency_ms=latency_ms,
        )
