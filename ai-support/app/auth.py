"""JWT authentication — validates the same tokens issued by the Express server."""
from __future__ import annotations

import logging

import jwt
from fastapi import HTTPException, Request

from app.config import Settings

logger = logging.getLogger(__name__)


async def get_current_user(request: Request, settings: Settings) -> str | None:
    """Extract and validate JWT from cookies.

    Uses the same JWT_SECRET as the Express server so tokens are interoperable.
    Returns the userId or None for unauthenticated requests.
    """
    token = request.cookies.get("accessToken")
    if not token:
        # Also check Authorization header as fallback
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if not token:
        return None

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            options={"verify_exp": True},
        )
        user_id = payload.get("userId")
        if not user_id:
            logger.warning("JWT payload missing userId")
            return None
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid JWT: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token")


def get_access_token(request: Request) -> str | None:
    """Extract the raw access token string for forwarding to Express API."""
    token = request.cookies.get("accessToken")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    return token
