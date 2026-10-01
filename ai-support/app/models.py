"""Pydantic models for request/response validation and internal data types."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────
# Internal Agent Types
# ──────────────────────────────────────────────

class AgentContext(BaseModel):
    """Context passed through the agent pipeline."""

    user_id: str | None = None
    is_authenticated: bool = False
    access_token: str | None = None
    conversation_id: str
    conversation_history: list[dict[str, str]] = Field(default_factory=list)


class RetrievedChunk(BaseModel):
    """A single chunk returned from vector search."""

    id: str
    source: str
    title: str
    content: str
    similarity: float
    metadata: dict[str, Any] | None = None


class RetrievalResult(BaseModel):
    """Output from the Retrieval Agent."""

    chunks: list[RetrievedChunk] = Field(default_factory=list)
    should_abstain: bool = False
    max_similarity: float = 0.0
    query_embedding: list[float] = Field(default_factory=list)


class Intent(BaseModel):
    """Classified user intent."""

    intent: str  # CATALOG_SEARCH, BOOKING_STATUS, FAQ, OFF_TOPIC, etc.
    tool_name: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    requires_action: bool = False
    confidence: float = 0.0


class ActionResult(BaseModel):
    """Output from a single Action Agent tool invocation."""

    tool: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: Any = None
    success: bool = True
    error: str | None = None


class VerificationResult(BaseModel):
    """Output from the Verifier Agent."""

    verdict: str  # GROUNDED | PARTIALLY_GROUNDED | UNGROUNDED
    cleaned_response: str = ""
    reasoning: str = ""
    claims_checked: int = 0
    claims_grounded: int = 0


class SupportResponse(BaseModel):
    """Final response sent back to the customer."""

    content: str
    sources: list[RetrievedChunk] = Field(default_factory=list)
    actions_taken: list[ActionResult] = Field(default_factory=list)
    verifier_verdict: str | None = None
    was_abstained: bool = False
    latency_ms: int = 0
    token_count: int = 0
    langfuse_trace_id: str | None = None


# ──────────────────────────────────────────────
# API Request / Response Models
# ──────────────────────────────────────────────

class ChatRequest(BaseModel):
    """POST /api/support/chat request body."""

    message: str = Field(..., min_length=1, max_length=2000)
    conversation_id: str | None = None  # None = start new conversation


class SourceRef(BaseModel):
    """Simplified source reference for the client."""

    id: str
    title: str
    source_type: str  # catalog, faq, policy, booking_help
    snippet: str  # First 200 chars of content
    similarity: float


class ActionSummary(BaseModel):
    """Simplified action summary for the client."""

    tool: str
    success: bool
    summary: str  # Human-readable summary of what happened


class ChatResponse(BaseModel):
    """POST /api/support/chat response body."""

    conversation_id: str
    message_id: str
    content: str
    sources: list[SourceRef] = Field(default_factory=list)
    actions_taken: list[ActionSummary] = Field(default_factory=list)
    verified: bool = False
    was_abstained: bool = False


class MessageEntry(BaseModel):
    """A single message in conversation history."""

    id: str
    role: str
    content: str
    sources: list[SourceRef] = Field(default_factory=list)
    verified: bool = False
    was_abstained: bool = False
    feedback_score: int | None = None
    created_at: datetime


class HistoryResponse(BaseModel):
    """GET /api/support/history response body."""

    conversation_id: str
    messages: list[MessageEntry]


class FeedbackRequest(BaseModel):
    """POST /api/support/feedback request body."""

    message_id: str
    score: int = Field(..., ge=1, le=5)  # 1=thumbs down, 5=thumbs up


class FeedbackResponse(BaseModel):
    """POST /api/support/feedback response body."""

    success: bool = True
