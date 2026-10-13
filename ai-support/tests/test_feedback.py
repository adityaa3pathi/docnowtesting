"""Tests for the feedback route — ownership check and Langfuse scoring."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _post(mock_db, user_id="user-1"):
    with (
        patch("app.main.db", mock_db),
        patch("app.routes.feedback.get_current_user", AsyncMock(return_value=user_id)),
        patch("app.routes.feedback.score_trace") as mock_score,
    ):
        resp = client.post("/api/support/feedback", json={"message_id": "msg-1", "score": 5})
    return resp, mock_score


def test_rejects_anonymous_user(mock_db):
    resp, _ = _post(mock_db, user_id=None)
    assert resp.status_code == 401
    mock_db.update_feedback.assert_not_called()


def test_rejects_message_owned_by_someone_else(mock_db):
    mock_db.update_feedback = AsyncMock(return_value=None)
    resp, mock_score = _post(mock_db)
    assert resp.status_code == 404
    mock_db.update_feedback.assert_awaited_once_with("msg-1", "user-1", 5)
    mock_score.assert_not_called()


def test_owned_message_sends_score_to_langfuse(mock_db):
    mock_db.update_feedback = AsyncMock(return_value={"langfuseTraceId": "trace-abc"})
    resp, mock_score = _post(mock_db)
    assert resp.status_code == 200
    mock_score.assert_called_once_with("trace-abc", "user_feedback", 5, "thumbs_up")


def test_owned_message_without_trace_skips_langfuse(mock_db):
    mock_db.update_feedback = AsyncMock(return_value={"langfuseTraceId": None})
    resp, mock_score = _post(mock_db)
    assert resp.status_code == 200
    mock_score.assert_not_called()
