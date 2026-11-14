"""Token checks must match the Express auth middleware: exp required, blocks and logouts honoured."""
from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest
from fastapi import HTTPException

from app.auth import get_current_user
from app.config import Settings, require_runtime_secrets

# Marks a claim that must be left out of the token entirely.
_OMIT = object()


def _request(token: str | None) -> MagicMock:
    request = MagicMock()
    request.cookies = {"docnow_access": token} if token else {}
    request.headers = {}
    return request


def _token(settings: Settings, **claims) -> str:
    payload = {"userId": "user-1", "tokenVersion": 0, "exp": int(time.time()) + 600}
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not _OMIT}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@pytest.fixture
def auth_db() -> MagicMock:
    db = MagicMock()
    db.pool = MagicMock()
    db.get_user_auth_state = AsyncMock(return_value={"status": "ACTIVE", "tokenVersion": 0})
    return db


@pytest.mark.asyncio
async def test_valid_token_returns_the_user_id(settings, auth_db):
    assert await get_current_user(_request(_token(settings)), settings, auth_db) == "user-1"


@pytest.mark.asyncio
async def test_no_token_is_unauthenticated_not_an_error(settings, auth_db):
    assert await get_current_user(_request(None), settings, auth_db) is None


@pytest.mark.asyncio
async def test_token_without_exp_is_rejected(settings, auth_db):
    """An exp-less token would never expire; Express always sets one."""
    with pytest.raises(HTTPException) as err:
        await get_current_user(_request(_token(settings, exp=_OMIT)), settings, auth_db)
    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_is_rejected(settings, auth_db):
    with pytest.raises(HTTPException) as err:
        await get_current_user(_request(_token(settings, exp=int(time.time()) - 10)), settings, auth_db)
    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_blocked_user_loses_access_immediately(settings, auth_db):
    auth_db.get_user_auth_state = AsyncMock(return_value={"status": "BLOCKED", "tokenVersion": 0})
    with pytest.raises(HTTPException) as err:
        await get_current_user(_request(_token(settings)), settings, auth_db)
    assert err.value.status_code == 401
    assert "blocked" in err.value.detail.lower()


@pytest.mark.asyncio
async def test_bumped_token_version_loses_access_immediately(settings, auth_db):
    auth_db.get_user_auth_state = AsyncMock(return_value={"status": "ACTIVE", "tokenVersion": 3})
    with pytest.raises(HTTPException) as err:
        await get_current_user(_request(_token(settings, tokenVersion=2)), settings, auth_db)
    assert err.value.status_code == 401


@pytest.mark.asyncio
async def test_token_without_token_version_is_rejected(settings, auth_db):
    """Express compares undefined against 0 and rejects; mirror that."""
    with pytest.raises(HTTPException):
        await get_current_user(_request(_token(settings, tokenVersion=_OMIT)), settings, auth_db)


@pytest.mark.asyncio
async def test_deleted_user_is_rejected(settings, auth_db):
    auth_db.get_user_auth_state = AsyncMock(return_value=None)
    with pytest.raises(HTTPException):
        await get_current_user(_request(_token(settings)), settings, auth_db)


@pytest.mark.asyncio
async def test_without_a_pool_the_signature_check_still_works(settings):
    db = MagicMock()
    db.pool = None
    assert await get_current_user(_request(_token(settings)), settings, db) == "user-1"


def test_startup_refuses_an_empty_jwt_secret():
    with pytest.raises(RuntimeError, match="SUPPORT_JWT_SECRET"):
        require_runtime_secrets(Settings(jwt_secret="", _env_file=None))


def test_startup_accepts_a_configured_jwt_secret():
    require_runtime_secrets(Settings(jwt_secret="x", _env_file=None))
