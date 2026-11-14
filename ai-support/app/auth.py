"""JWT authentication — validates the same tokens issued by the Express server."""
from __future__ import annotations

import logging
from typing import Any

import jwt
from fastapi import HTTPException, Request

from app.config import Settings

logger = logging.getLogger(__name__)


async def get_current_user(request: Request, settings: Settings, db: Any = None) -> str | None:
    """Extract and validate JWT from cookies or Authorization header.

    Uses the same JWT_SECRET as the Express server so tokens are interoperable.
    Returns the userId or None for unauthenticated requests.
    """
    token = request.cookies.get("docnow_access") or request.cookies.get("accessToken")
    if not token:
        # Also check Authorization header as fallback
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()

    if not token or token in ("null", "undefined"):
        return None

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            # A token with no exp would stay valid forever; Express always sets one.
            options={"verify_exp": True, "require": ["exp"]},
        )
        user_id = payload.get("userId")
        if not user_id:
            logger.warning("JWT payload missing userId")
            return None
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid JWT: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token")

    await _assert_session_still_valid(db, user_id, payload.get("tokenVersion"))
    return user_id


async def _assert_session_still_valid(db: Any, user_id: str, token_version: Any) -> None:
    """Mirror the Express auth middleware: a blocked user or a bumped tokenVersion loses access now."""
    if db is None or getattr(db, "pool", None) is None:
        return

    state = await db.get_user_auth_state(user_id)
    if not state:
        raise HTTPException(status_code=401, detail="User not found")
    if state.get("status") == "BLOCKED":
        raise HTTPException(status_code=401, detail="Account is blocked")
    if state.get("tokenVersion") != token_version:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")


def get_access_token(request: Request) -> str | None:
    """Extract the raw access token string for forwarding to Express API."""
    token = request.cookies.get("docnow_access") or request.cookies.get("accessToken")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
    if not token or token in ("null", "undefined"):
        return None
    return token
