"""Per-turn Gemini token accounting, collected without threading state through every call."""
from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import asdict, dataclass, field
from typing import Any

from google.genai import types
from langchain_core.messages import AIMessage

# Stage names used by call_gemini callers and the eval's per-stage metrics.
STAGES = ("intent", "draft", "verifier", "rewrite")


@dataclass
class CallUsage:
    stage: str
    model: str
    prompt_tokens: int = 0
    output_tokens: int = 0
    thought_tokens: int = 0
    cached_tokens: int = 0
    latency_ms: int = 0
    cap_hit: bool = False


@dataclass
class TurnUsage:
    calls: list[CallUsage] = field(default_factory=list)

    def total_tokens(self) -> int:
        # Cached tokens are part of prompt_tokens, so they are not added again.
        return sum(c.prompt_tokens + c.output_tokens + c.thought_tokens for c in self.calls)

    def summary(self) -> dict[str, Any]:
        return {
            "calls": len(self.calls),
            "prompt_tokens": sum(c.prompt_tokens for c in self.calls),
            "output_tokens": sum(c.output_tokens for c in self.calls),
            "thought_tokens": sum(c.thought_tokens for c in self.calls),
            "cached_tokens": sum(c.cached_tokens for c in self.calls),
            "cap_hits": sum(1 for c in self.calls if c.cap_hit),
            "total_tokens": self.total_tokens(),
            "per_call": [asdict(c) for c in self.calls],
        }


_current: ContextVar[TurnUsage | None] = ContextVar("support_turn_usage", default=None)


@contextlib.contextmanager
def track_turn() -> Iterator[TurnUsage]:
    turn = TurnUsage()
    token = _current.set(turn)
    try:
        yield turn
    finally:
        _current.reset(token)


def from_response(response: Any, stage: str, model: str, latency_ms: int) -> CallUsage:
    """Token counts from a google-genai response or a LangChain AIMessage (call_gemini since Phase 4).

    For an AIMessage, `model` is the one that actually answered, so a fallback shows in the usage.
    """
    if isinstance(response, AIMessage):
        return _from_message(response, stage, model, latency_ms)
    meta = getattr(response, "usage_metadata", None)

    def count(name: str) -> int:
        return int(getattr(meta, name, 0) or 0) if meta is not None else 0

    candidates = getattr(response, "candidates", None) or []
    cap_hit = any(getattr(c, "finish_reason", None) == types.FinishReason.MAX_TOKENS for c in candidates)
    return CallUsage(
        stage=stage,
        model=model,
        prompt_tokens=count("prompt_token_count"),
        output_tokens=count("candidates_token_count"),
        thought_tokens=count("thoughts_token_count"),
        cached_tokens=count("cached_content_token_count"),
        latency_ms=latency_ms,
        cap_hit=cap_hit,
    )


def _from_message(message: AIMessage, stage: str, model: str, latency_ms: int) -> CallUsage:
    meta = message.usage_metadata or {}
    thoughts = int((meta.get("output_token_details") or {}).get("reasoning", 0) or 0)
    # LangChain counts thinking inside output_tokens; CallUsage keeps them apart, as google-genai does.
    return CallUsage(
        stage=stage,
        model=message.response_metadata.get("model_name") or model,
        prompt_tokens=int(meta.get("input_tokens", 0) or 0),
        output_tokens=max(int(meta.get("output_tokens", 0) or 0) - thoughts, 0),
        thought_tokens=thoughts,
        cached_tokens=int((meta.get("input_token_details") or {}).get("cache_read", 0) or 0),
        latency_ms=latency_ms,
        cap_hit=message.response_metadata.get("finish_reason") == "MAX_TOKENS",
    )


def record(call: CallUsage) -> None:
    turn = _current.get()
    if turn is not None:
        turn.calls.append(call)
