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
    llm_model: str = "gemini-2.0-flash"

    # Langfuse Observability
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"

    # Agent configuration
    relevance_threshold: float = 0.7
    max_tokens: int = 4000
    max_conversation_turns: int = 10

    # Auth (MUST match Express server's JWT_SECRET)
    jwt_secret: str = ""

    # Feature flag
    enabled: bool = True

    model_config = {
        "env_prefix": "SUPPORT_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }
