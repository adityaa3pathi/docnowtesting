from __future__ import annotations

import logging
from typing import Any, Optional

from langfuse import Langfuse, get_client

logger = logging.getLogger(__name__)

_langfuse_client: Optional[Langfuse] = None


def init_langfuse(settings: Any) -> None:
    """Initialize the Langfuse client if keys are provided."""
    global _langfuse_client

    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        logger.info("Langfuse keys not provided. Tracing is off.")
        # Without a client, every @observe call builds a disabled one and warns about missing keys.
        logging.getLogger("langfuse").setLevel(logging.ERROR)
        return

    try:
        # Creating the client registers it as the singleton that @observe uses.
        _langfuse_client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            base_url=settings.langfuse_base_url,
        )
        logger.info("Langfuse configured successfully.")
    except Exception:
        logger.exception("Failed to initialize Langfuse")
        _langfuse_client = None


def shutdown_langfuse() -> None:
    """Flush pending spans and scores before the process exits."""
    if _langfuse_client:
        _langfuse_client.shutdown()


def current_trace_id() -> Optional[str]:
    """Trace id of the active @observe span, or None when tracing is off."""
    if not _langfuse_client:
        return None
    try:
        return get_client().get_current_trace_id()
    except Exception:
        logger.warning("Could not read current Langfuse trace id", exc_info=True)
        return None


def score_trace(trace_id: str, name: str, value: float, comment: Optional[str] = None) -> None:
    """Record a score for a specific Langfuse trace."""
    if not _langfuse_client:
        logger.debug("Langfuse not configured, skipping score for trace_id: %s", trace_id)
        return

    try:
        _langfuse_client.create_score(trace_id=trace_id, name=name, value=value, comment=comment)
        logger.debug("Score '%s' = %s recorded for trace_id: %s", name, value, trace_id)
    except Exception:
        logger.exception("Failed to record score for trace_id %s", trace_id)
