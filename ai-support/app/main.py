"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.database import Database
from app.observability import init_langfuse

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
    await db.connect()
    init_langfuse(settings)
    logger.info("AI Support service ready (enabled=%s)", settings.enabled)
    yield
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
