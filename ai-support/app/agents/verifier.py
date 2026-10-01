"""Verifier Agent — second LLM pass that blocks ungrounded claims.

This is the exact "second LLM verifier pass that blocks any claim not supported
by retrieved sources" pattern. It's the core defensive mechanism.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langfuse.decorators import observe

from app.agents.llm import call_gemini
from app.models import ActionResult, RetrievalResult, VerificationResult
from app.prompts.verifier import VERIFIER_PROMPT

logger = logging.getLogger(__name__)


@observe(name="verifier-agent")
async def verify(
    draft: str,
    retrieval: RetrievalResult,
    actions: list[ActionResult],
    settings: Any,
) -> VerificationResult:
    """Verify every factual claim in the draft against retrieved sources.

    Returns:
        GROUNDED — all claims supported by sources/actions
        PARTIALLY_GROUNDED — some claims unsupported (they get stripped)
        UNGROUNDED — most claims fabricated → response is blocked
    """
    logger.info("Verifying draft response (%d chars)", len(draft))

    # Build source context for the verifier
    sources_text = "\n".join(
        f"[SOURCE {i + 1}] {c.title}: {c.content}"
        for i, c in enumerate(retrieval.chunks)
    ) or "(no retrieved sources)"

    actions_text = "\n".join(
        f"[ACTION {i + 1}] {a.tool}: {json.dumps(a.output, default=str)[:500]}"
        for i, a in enumerate(actions)
        if a.success
    ) or "(no actions taken)"

    prompt = VERIFIER_PROMPT.format(
        sources=sources_text,
        actions=actions_text,
        draft=draft,
    )

    try:
        response_text = await call_gemini(
            prompt=prompt,
            settings=settings,
            system_prompt="You are a factual verification agent. Return valid JSON only.",
            temperature=0,
            response_mime_type="application/json",
        )

        result = json.loads(response_text)
        return VerificationResult(
            verdict=result.get("verdict", "UNGROUNDED"),
            cleaned_response=result.get("cleaned_response", draft),
            reasoning=result.get("reasoning", ""),
            claims_checked=result.get("claims_checked", 0),
            claims_grounded=result.get("claims_grounded", 0),
        )

    except Exception:
        logger.exception("Verification failed — defaulting to UNGROUNDED for safety")
        return VerificationResult(
            verdict="UNGROUNDED",
            cleaned_response="I'm sorry, I couldn't verify this information.",
            reasoning="Verification error — blocking response for safety",
        )
