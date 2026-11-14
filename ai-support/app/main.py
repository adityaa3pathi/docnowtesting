"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, require_runtime_secrets
from app.database import Database
from app.ingestion.catalog_sync import run_periodic_catalog_sync
from app.observability import init_langfuse, shutdown_langfuse
from app.proxy_auth import PROXY_SECRET_HEADER, is_guarded, proxy_secret_ok

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Singletons ────────────────────────────────
settings = Settings()
db = Database(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("Starting DocNow AI Support service...")
    # Tests build their own Settings, so a bare app import must not need the real secrets.
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        require_runtime_secrets(settings)
    if not settings.proxy_secret:
        logger.warning("SUPPORT_PROXY_SECRET is not set: /api/support is reachable without the Express proxy")
    await db.connect()
    init_langfuse(settings)

    sync_task: asyncio.Task | None = None
    if settings.catalog_sync_interval_seconds > 0:
        sync_task = asyncio.create_task(run_periodic_catalog_sync(db, settings))
        logger.info("Catalog re-sync every %ds", settings.catalog_sync_interval_seconds)

    logger.info("AI Support service ready (enabled=%s)", settings.enabled)
    yield

    if sync_task:
        # Wait for it to stop before closing the pool it is using.
        sync_task.cancel()
        with suppress(asyncio.CancelledError):
            await sync_task
    shutdown_langfuse()
    await db.disconnect()
    logger.info("AI Support service stopped")


app = FastAPI(
    title="DocNow AI Support",
    version="1.0.0",
    description="Multi-agent customer support system",
    lifespan=lifespan,
)

# CORS — only needed if client calls FastAPI directly (bypassing Express proxy)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://docnow.in", "https://www.docnow.in"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_proxy_secret(request: Request, call_next):
    """Reject support calls that did not come through Express, where the cost limits live."""
    # This runs outside CORSMiddleware, so a blocked preflight would hide the real error.
    if request.method != "OPTIONS" and is_guarded(request.url.path) and not proxy_secret_ok(
        settings.proxy_secret, request.headers.get(PROXY_SECRET_HEADER)
    ):
        logger.warning("Rejected direct call to %s (missing or wrong proxy secret)", request.url.path)
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)


# ── Route registration ────────────────────────
from app.routes.chat import router as chat_router  # noqa: E402
from app.routes.history import router as history_router  # noqa: E402
from app.routes.feedback import router as feedback_router  # noqa: E402

app.include_router(chat_router, prefix="/api/support", tags=["chat"])
app.include_router(history_router, prefix="/api/support", tags=["history"])
app.include_router(feedback_router, prefix="/api/support", tags=["feedback"])


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "ai-support", "enabled": settings.enabled}
