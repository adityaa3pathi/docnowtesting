"""Shared-secret gate for /api/support/*.

Rate limits and per-user caps live on the Express proxy; a caller that reaches
FastAPI directly skipped all of them, so only the proxy may call these routes.
"""
from __future__ import annotations

import hmac

PROXY_SECRET_HEADER = "x-docnow-support-proxy"

# Health checks must stay reachable for the load balancer and the Render keep-alive ping.
OPEN_PATH_PREFIXES = ("/health", "/docs", "/openapi.json", "/redoc")

GUARDED_PATH_PREFIX = "/api/support"


def is_guarded(path: str) -> bool:
    if path.startswith(OPEN_PATH_PREFIXES):
        return False
    return path.startswith(GUARDED_PATH_PREFIX)


def proxy_secret_ok(expected: str, presented: str | None) -> bool:
    """Constant-time compare, so a wrong header cannot be guessed byte by byte from timing."""
    if not expected:
        return True
    if not presented:
        return False
    return hmac.compare_digest(expected.encode("utf-8"), presented.encode("utf-8"))
