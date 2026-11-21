"""Orchestrator: the support pipeline as a LangGraph StateGraph, traced in Langfuse.

Flow (graph diagram above build_graph):
  User Message
    → 1. Safety: greeting / emergency fixed text, no model call
    → 2. Intent classification, with retrieval running in parallel
    → 3. Route: symptom / fixed text / abstain / tool / knowledge base
    → 4. If action needed: Action Agent (tool execution)
    → 5. Draft Response Generation (LLM with retrieval context + action results)
    → 6. Verifier Agent (checks draft against sources — blocks ungrounded claims)
    → 7. Final Response (verified) or Abstention
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any, TypedDict

from langfuse import observe
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime

from app.agents import usage
from app.agents.cards import cards_from_actions, live_cards_for_chunks
from app.agents.symptoms import symptom_reply
from app.agents.llm import AIBusyError, call_gemini
from app.agents.retrieval import retrieve
from app.agents.tool_output import compact_tool_output
from app.agents.verifier import verify
from app.models import (
    ActionResult,
    AgentContext,
    Intent,
    RetrievalResult,
    RetrievedChunk,
    SupportResponse,
    VerificationResult,
)
from app.observability import annotate, current_trace_id
from app.symptoms.keywords import keyword_topic
from app.symptoms.safety import EMERGENCY_RESPONSE, MEDICAL_ADVICE_RESPONSE, emergency_sign
from app.prompts.intent import INTENT_CLASSIFICATION_PROMPT, SYMPTOM_TOPIC_IDS, intent_schema
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

ACTION_FAILED_RESPONSE = (
    "I couldn't complete that just now. Please check the booking details and try again, "
    "or contact our support team at +91 9649089089."
)

CATALOG_FAILED_RESPONSE = (
    "I'm having trouble fetching live catalog details right now. "
    "Please browse tests directly on docnow.in or contact our support team at +91 9649089089."
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

# Intents a symptom word may turn into SYMPTOM_CHECK; booking and medical-advice turns keep theirs.
_SYMPTOM_OVERRIDABLE = {"CATALOG_SEARCH", "PRODUCT_DETAILS", "FAQ", "OFF_TOPIC", "UNKNOWN", "SYMPTOM_CHECK"}

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
        symptom_topics=", ".join(SYMPTOM_TOPIC_IDS),
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


# ──────────────────────────────────────────────
# The pipeline as a LangGraph StateGraph
#
#   safety ─► intent ─┬─► symptom ──────────────────────────────► END
#     │               ├─► fixed_reply (greeting/off-topic/medical) ► END
#     ▼               └─► retrieval ─┬─► abstain ───────────────► END
#    END                             ├─► action ─┬─► booking_reply ► END
#                                    │           ├─► END (login / confirm / failed)
#                                    │           ▼
#                                    └─────────► draft ─► verifier ─► response ─► END
#
# Search starts as an asyncio task inside the intent node and the retrieval node joins or
# cancels it. A LangGraph fan-out would wait for both branches, so booking and off-topic
# turns would pay for a search they never use. The task lives in the per-turn runtime
# context, not in graph state. Nodes call retrieve/classify_intent/generate_draft/verify
# through this module's globals, so patching app.agents.orchestrator.<name> still works.
# ──────────────────────────────────────────────


@dataclass
class TurnDeps:
    """Per-turn dependencies handed to every node as the LangGraph runtime context."""

    ctx: AgentContext
    db: Any
    settings: Any
    retrieval_task: asyncio.Task | None = None


class TurnState(TypedDict, total=False):
    message: str
    intent: Intent
    confirmed: bool  # a plain "yes" to the write action asked about last turn
    retrieval: RetrievalResult
    tool_turn: bool
    booking_turn: bool  # booking tools answer from the customer's own records, not KB chunks
    actions: list[ActionResult]
    draft: str
    verification: VerificationResult
    response: SupportResponse  # set by whichever node ends the turn


def _finished(state: TurnState) -> bool:
    return state.get("response") is not None


async def safety_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    message, settings = state["message"], runtime.context.settings
    # Plain greetings and thanks get the canned reply with no model or search call.
    if _GREETING.match(message):
        return {"response": SupportResponse(content=GREETING_RESPONSE)}
    # Emergency signs get the fixed 112 reply before any model call, and never a test.
    if settings.symptom_suggestions and emergency_sign(message):
        annotate(symptom_flow="emergency")
        return {"response": SupportResponse(content=EMERGENCY_RESPONSE, verifier_verdict="FIXED_TEXT")}
    return {}


async def intent_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    deps = runtime.context
    message, ctx, settings = state["message"], deps.ctx, deps.settings

    # A "yes" to the write action asked about last turn runs it; no search needed.
    confirmed = ctx.pending_action is not None and bool(_CONFIRM.match(message))
    retrieval = RetrievalResult()
    if confirmed:
        intent = ctx.pending_action
    elif settings.parallel_intent_retrieval:
        # Search runs while intent is classified; tool and greeting turns cancel it unused.
        deps.retrieval_task = asyncio.create_task(retrieve(message, deps.db, settings))
        intent = await classify_intent(message, "", ctx, settings)
    else:
        retrieval = await retrieve(message, deps.db, settings)
        summary = "; ".join(f"{c.title} ({c.source}, sim={c.similarity:.2f})" for c in retrieval.chunks)
        intent = await classify_intent(message, summary or "none", ctx, settings)
    logger.info(
        "Intent: %s (tool=%s, action=%s, conf=%.2f)",
        intent.intent, intent.tool_name, intent.requires_action, intent.confidence,
    )

    # The classifier often files "I feel tired" as a test search; symptom words win over that.
    if settings.symptom_suggestions and intent.intent in _SYMPTOM_OVERRIDABLE:
        topic = keyword_topic(message)
        if topic and (intent.intent != "SYMPTOM_CHECK" or intent.parameters.get("symptom_topic") in (None, "other")):
            intent = Intent(intent="SYMPTOM_CHECK", parameters={"symptom_topic": topic}, confidence=intent.confidence)

    # With symptom suggestions off, symptom and medical-advice turns are answered like FAQs.
    if intent.intent in ("SYMPTOM_CHECK", "MEDICAL_ADVICE") and not settings.symptom_suggestions:
        intent = intent.model_copy(update={"intent": "FAQ", "tool_name": None, "requires_action": False})

    return {"intent": intent, "confirmed": confirmed, "retrieval": retrieval}


def route_after_intent(state: TurnState) -> str:
    intent = state["intent"].intent
    if intent == "SYMPTOM_CHECK":
        return "symptom"
    if intent in ("MEDICAL_ADVICE", "GREETING", "OFF_TOPIC"):
        return "fixed_reply"
    return "retrieval"


async def symptom_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    # Symptom turns get fixed, doctor-approved wording, never a model draft.
    content, actions, cards = await symptom_reply(state["intent"], runtime.context.ctx, runtime.context.settings)
    return {"response": SupportResponse(content=content, actions_taken=actions, cards=cards, verifier_verdict="FIXED_TEXT")}


async def fixed_reply_node(state: TurnState) -> dict:
    intent = state["intent"].intent
    if intent == "MEDICAL_ADVICE":
        annotate(symptom_flow="medical_advice")
        return {"response": SupportResponse(content=MEDICAL_ADVICE_RESPONSE, verifier_verdict="FIXED_TEXT")}
    if intent == "GREETING":
        return {"response": SupportResponse(content=GREETING_RESPONSE, was_abstained=False)}
    # Off-topic questions score as close to the catalog as real ones (eval 13-10-2026),
    # so similarity alone cannot gate this. The UNGROUNDED label is stored in prod; keep it.
    return {"response": SupportResponse(content=OFF_TOPIC_RESPONSE, was_abstained=True, verifier_verdict="UNGROUNDED")}


async def retrieval_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    """Join the search started beside intent classification, or cancel it on booking turns."""
    deps, intent = runtime.context, state["intent"]
    tool_turn = bool((intent.requires_action or state["confirmed"]) and intent.tool_name)
    tool_def = TOOL_REGISTRY.get(intent.tool_name) if tool_turn else None
    booking_turn = bool(tool_def and tool_def.requires_auth)
    update: dict = {"tool_turn": tool_turn, "booking_turn": booking_turn}
    if booking_turn and deps.retrieval_task:
        deps.retrieval_task.cancel()
    elif deps.retrieval_task:
        update["retrieval"] = await deps.retrieval_task
    return update


def route_after_retrieval(state: TurnState) -> str:
    if state["tool_turn"]:
        return "action"
    retrieval = state["retrieval"]
    # Nothing relevant in the knowledge base: abstain before paying for draft and verifier.
    if retrieval.failed or retrieval.should_abstain:
        return "abstain"
    return "draft"


async def abstain_node(state: TurnState) -> dict:
    if state["retrieval"].failed:
        return {"response": SupportResponse(content=ERROR_RESPONSE, was_abstained=True)}
    return {"response": SupportResponse(content=ABSTENTION_MESSAGE, verifier_verdict="NO_CONTEXT", was_abstained=True)}


async def action_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    deps, intent = runtime.context, state["intent"]
    tool_def = TOOL_REGISTRY.get(intent.tool_name)
    if tool_def and tool_def.requires_auth and not deps.ctx.is_authenticated:
        return {"response": SupportResponse(
            content=(
                "Please log in to access your bookings. You can log in from "
                "the top-right corner of the page. Once logged in, I can help "
                "you check booking status, reschedule, or cancel appointments."
            ),
            was_abstained=False,
        )}

    if tool_def and tool_def.is_write and not state["confirmed"]:
        return {"response": SupportResponse(content=_confirmation_request(intent), pending_action=intent)}

    from app.agents.action import execute_action

    action_result = await execute_action(intent, deps.ctx, deps.settings)
    actions = [action_result]

    # A failed booking tool gets a fixed reply: an unverified draft could claim it worked.
    if not action_result.success:
        if state["booking_turn"]:
            return {"actions": actions, "response": SupportResponse(
                content=ACTION_FAILED_RESPONSE, actions_taken=actions, was_abstained=True,
            )}
        # Catalog tools fall back to KB chunks if there are any; otherwise a catalog-specific reply.
        retrieval = state["retrieval"]
        if retrieval.should_abstain or not retrieval.chunks:
            return {"actions": actions, "response": SupportResponse(
                content=CATALOG_FAILED_RESPONSE, actions_taken=actions, was_abstained=True,
            )}
    return {"actions": actions}


def route_after_action(state: TurnState) -> str:
    if _finished(state):
        return END
    return "booking_reply" if state["booking_turn"] else "draft"


async def booking_reply_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    # No KB chunks reach this draft, so there is nothing for the verifier to check.
    intent, actions = state["intent"], state["actions"]
    draft = await generate_draft(state["message"], [], actions, runtime.context.ctx, runtime.context.settings)
    if draft == ABSTENTION_MESSAGE and intent.tool_name in WRITE_DONE_RESPONSES:
        # The change already happened; never tell the customer we could not help.
        draft = WRITE_DONE_RESPONSES[intent.tool_name]
    return {"response": SupportResponse(
        content=draft, actions_taken=actions, verifier_verdict="TOOL_ONLY", was_abstained=draft == ABSTENTION_MESSAGE,
    )}


async def draft_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    draft = await generate_draft(
        state["message"], state["retrieval"].chunks, state.get("actions", []), runtime.context.ctx, runtime.context.settings
    )
    return {"draft": draft}


async def verifier_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    # The grounded-abstention gate: the draft is checked against the sources it was given.
    verification = await verify(state["draft"], state["retrieval"], state.get("actions", []), runtime.context.settings)
    return {"verification": verification}


async def response_node(state: TurnState, runtime: Runtime[TurnDeps]) -> dict:
    verification, retrieval, actions = state["verification"], state["retrieval"], state.get("actions", [])
    if verification.verdict == "UNGROUNDED":
        return {"response": SupportResponse(
            content=ABSTENTION_MESSAGE, sources=[], actions_taken=actions,
            verifier_verdict="UNGROUNDED", was_abstained=True,
        )}
    # Cards come only from catalog rows, after the reply passed the verifier.
    cards = cards_from_actions(actions) or await live_cards_for_chunks(
        retrieval.chunks, verification.cleaned_response, runtime.context.ctx, runtime.context.settings
    )
    return {"response": SupportResponse(
        content=verification.cleaned_response, sources=retrieval.chunks, actions_taken=actions,
        verifier_verdict=verification.verdict, was_abstained=False, cards=cards,
    )}


def build_graph():
    g = StateGraph(TurnState, context_schema=TurnDeps)
    g.add_node("safety", safety_node)
    g.add_node("intent", intent_node)
    g.add_node("symptom", symptom_node)
    g.add_node("fixed_reply", fixed_reply_node)
    g.add_node("retrieval", retrieval_node)
    g.add_node("abstain", abstain_node)
    g.add_node("action", action_node)
    g.add_node("booking_reply", booking_reply_node)
    g.add_node("draft", draft_node)
    g.add_node("verifier", verifier_node)
    g.add_node("response", response_node)

    g.add_edge(START, "safety")
    g.add_conditional_edges("safety", lambda s: END if _finished(s) else "intent", ["intent", END])
    g.add_conditional_edges("intent", route_after_intent, ["symptom", "fixed_reply", "retrieval"])
    g.add_conditional_edges("retrieval", route_after_retrieval, ["action", "abstain", "draft"])
    g.add_conditional_edges("action", route_after_action, ["booking_reply", "draft", END])
    g.add_edge("draft", "verifier")
    g.add_edge("verifier", "response")
    for terminal in ("symptom", "fixed_reply", "abstain", "booking_reply", "response"):
        g.add_edge(terminal, END)
    return g.compile(name="support-graph")


SUPPORT_GRAPH = build_graph()


async def _run_pipeline(
    message: str,
    ctx: AgentContext,
    db: Any,
    settings: Any,
) -> SupportResponse:
    start_time = time.monotonic()
    deps = TurnDeps(ctx=ctx, db=db, settings=settings)
    try:
        final = await SUPPORT_GRAPH.ainvoke({"message": message}, context=deps)
        response = final["response"]
    except AIBusyError:
        response = SupportResponse(content=BUSY_RESPONSE, was_abstained=True)
    except Exception:
        logger.exception("Orchestrator error for conversation %s", ctx.conversation_id)
        response = SupportResponse(content=ERROR_RESPONSE, was_abstained=True)
    finally:
        task = deps.retrieval_task
        if task and not task.done():
            task.cancel()
        elif task and not task.cancelled():
            task.exception()  # mark a finished-but-unused failure as seen
    response.latency_ms = _elapsed(start_time)
    return response
