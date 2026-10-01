from __future__ import annotations

import logging
from typing import Any, Optional
from langfuse import Langfuse

logger = logging.getLogger(__name__)

_langfuse_client: Optional[Langfuse] = None

def init_langfuse(settings: Any) -> None:
    """Initialize Langfuse client if keys are provided."""
    global _langfuse_client
    
    public_key = getattr(settings, 'LANGFUSE_PUBLIC_KEY', None)
    secret_key = getattr(settings, 'LANGFUSE_SECRET_KEY', None)
    host = getattr(settings, 'LANGFUSE_HOST', 'https://cloud.langfuse.com')
    
    if public_key and secret_key:
        try:
            _langfuse_client = Langfuse(
                public_key=public_key,
                secret_key=secret_key,
                host=host
            )
            logger.info("Langfuse configured successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize Langfuse: {e}")
            _langfuse_client = None
    else:
        logger.info("Langfuse keys not provided. Langfuse will not be configured.")

def get_langfuse() -> Optional[Langfuse]:
    """Return the Langfuse client if configured, else None."""
    return _langfuse_client

def score_trace(trace_id: str, name: str, value: float, comment: Optional[str] = None) -> None:
    """Record a score for a specific Langfuse trace."""
    client = get_langfuse()
    if not client:
        logger.warning(f"Langfuse not configured, skipping score for trace_id: {trace_id}")
        return
        
    try:
        client.score(
            trace_id=trace_id,
            name=name,
            value=value,
            comment=comment
        )
        logger.debug(f"Score '{name}' = {value} recorded for trace_id: {trace_id}")
    except Exception as e:
        logger.error(f"Failed to record score for trace_id {trace_id}: {e}")
