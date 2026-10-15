"""Per-turn Gemini token accounting, collected without threading state through every call."""
from __future__ import annotations

import contextlib
from contextvars import ContextVar
from dataclasses import asdict, dataclass, field
from typing import Any, Iterator, Optional

from google.genai import types

# Stage names used by call_gemini callers and the eval's per-stage metrics.
STAGES = ("intent", "draft", "verifier")


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


_current: ContextVar[Optional[TurnUsage]] = ContextVar("support_turn_usage", default=None)


@contextlib.contextmanager
def track_turn() -> Iterator[TurnUsage]:
    turn = TurnUsage()
    token = _current.set(turn)
    try:
        yield turn
    finally:
        _current.reset(token)


def from_response(response: Any, stage: str, model: str, latency_ms: int) -> CallUsage:
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


def record(call: CallUsage) -> None:
    turn = _current.get()
    if turn is not None:
        turn.calls.append(call)
