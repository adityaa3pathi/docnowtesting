"""The cost limits live on Express, so FastAPI must refuse unproxied /api/support calls."""
from __future__ import annotations

from app.proxy_auth import PROXY_SECRET_HEADER, is_guarded, proxy_secret_ok


def test_support_paths_are_guarded_and_health_is_not():
    assert is_guarded("/api/support/chat")
    assert is_guarded("/api/support/history")
    assert not is_guarded("/health")
    assert not is_guarded("/docs")


def test_unset_secret_leaves_the_service_open():
    assert proxy_secret_ok("", None)
    assert proxy_secret_ok("", "anything")


def test_configured_secret_requires_an_exact_match():
    assert proxy_secret_ok("s3cret", "s3cret")
    assert not proxy_secret_ok("s3cret", None)
    assert not proxy_secret_ok("s3cret", "")
    assert not proxy_secret_ok("s3cret", "s3cre")
    assert not proxy_secret_ok("s3cret", "S3CRET")


def test_header_name_matches_the_express_proxy():
    assert PROXY_SECRET_HEADER == "x-docnow-support-proxy"
