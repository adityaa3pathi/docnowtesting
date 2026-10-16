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
    llm_model: str = "gemini-3.5-flash"

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
    max_tokens: int = 4000
    max_conversation_turns: int = 10
    # Run intent and retrieval together; false restores the old sequential path.
    parallel_intent_retrieval: bool = True

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

    # Feature flag
    enabled: bool = True

    model_config = {
        "env_prefix": "SUPPORT_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }
