"""Pydantic Settings for the AI Support microservice."""
from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuration loaded from environment variables with SUPPORT_ prefix."""

    # Database (same PostgreSQL as Express server)
    database_url: str = "postgresql://docnow:docnow@localhost:5432/docnow"

    # Express API (internal HTTP calls for booking operations)
    express_api_url: str = "http://localhost:5000/api"

    # Google AI
    gemini_api_key: str = ""
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    llm_model: str = "gemini-3.5-flash-lite"
    # Tried in order when llm_model fails with an outage error (429, 5xx, timeout, 402, retired model);
    # comma-separated, "" = no failover. Same API key, so a key- or billing-level outage hits them too.
    llm_fallback_models: str = "gemini-3.1-flash-lite"
    # The SDK has no default timeout, so a stalled call would hang the chat until the proxy gives up.
    genai_timeout_seconds: float = 30.0

    # Cohere Rerank: reorders the fused candidates. Off by default: it sends the customer's question to
    # Cohere (US), the same data-residency question that keeps Langfuse off. Errors fall back to RRF order.
    cohere_api_key: str = ""
    rerank_enabled: bool = False
    rerank_model: str = "rerank-v3.5"
    rerank_candidates: int = 20
    rerank_timeout_seconds: float = 2.0
    # Abstain when the best reranker score is below this; 0 disables the gate. Tune on both corpora.
    rerank_min_score: float = 0.0

    # Groq: eval judge only, so grading does not eat the Gemini free quota
    groq_api_key: str = ""

    # Langfuse Observability
    # Off by default: production traces would send customer chats outside India.
    langfuse_enabled: bool = False
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"

    # Agent configuration
    # Tuned on the golden set with query/document embedding types (13-10-2026):
    # off-topic tops out at 0.61, answerable starts at 0.61. Re-tune if the embedding setup changes.
    relevance_threshold: float = 0.58
    # When the dense gate abstains, a short query whose rare term is in a test title still gets that test.
    # Off (Phase 2 eval): it saved 1/69 bare codes ("qft", 0.579) but let "gold rate today" through to the
    # QuantiFERON-TB Gold tests. Revisit with the reranker confirming rescued chunks.
    bm25_rescue_enabled: bool = False
    max_tokens: int = 4000
    max_conversation_turns: int = 10
    # Run intent and retrieval together; false restores the old sequential path.
    parallel_intent_retrieval: bool = True
    # Follow-up rewrite (turns with history only): "off" searches the message as typed, "replace" searches
    # only the rewritten query, "both" searches both and fuses them (app/agents/rewrite.py).
    query_rewrite: str = "replace"
    rewrite_thinking_level: str = "low"
    rewrite_max_output_tokens: int = 256

    # Per-call thinking and output caps (caps include thinking tokens); "" sends no thinking config.
    # gemini-3.7-flash rejects "minimal"; a rejected level is retried once without thinking config.
    intent_thinking_level: str = "low"
    draft_thinking_level: str = "low"
    verifier_thinking_level: str = "low"
    intent_max_output_tokens: int = 512
    draft_max_output_tokens: int = 1024
    # The verifier echoes the whole draft back, so it needs the draft cap plus room.
    verifier_max_output_tokens: int = 2560

    # Auth (MUST match Express server's JWT_SECRET)
    jwt_secret: str = ""

    # Shared secret the Express proxy sends; empty leaves the service open (local dev only).
    proxy_secret: str = ""

    # Re-sync the catalog into KnowledgeChunk every N seconds; 0 disables the background task.
    catalog_sync_interval_seconds: int = 0

    # Feature flag
    enabled: bool = True
    # Doctor-approved symptom suggestions and the emergency check (app/symptoms). Off until launch.
    symptom_suggestions: bool = False

    model_config = {
        "env_prefix": "SUPPORT_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }

    def embedding_fingerprint(self) -> str:
        """Identifies the embedding setup, so chunks are re-embedded when model or dimensions change."""
        return f"{self.embedding_model}@{self.embedding_dimensions}"


def require_runtime_secrets(settings: Settings) -> None:
    """An empty jwt_secret only shows up as a 500 for the first logged-in user, so refuse to serve."""
    if not settings.jwt_secret:
        raise RuntimeError(
            "SUPPORT_JWT_SECRET is not set; it must match the Express server's JWT_SECRET."
        )
