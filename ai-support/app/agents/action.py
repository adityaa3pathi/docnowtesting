"""Action Agent — calls Express booking/catalog APIs via internal HTTP."""
from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import quote

import httpx
from langfuse import observe

from app.models import ActionResult, AgentContext, Intent
from app.tools.registry import TOOL_REGISTRY

logger = logging.getLogger(__name__)

# Path values come from the model, so they must look like an ID, never like a path.
_SAFE_PATH_VALUE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@observe(name="action-agent", capture_input=False, capture_output=False)
async def execute_action(
    intent: Intent,
    ctx: AgentContext,
    settings: Any,
) -> ActionResult:
    """Execute a booking or catalog operation via the Express API.

    Looks up the tool in TOOL_REGISTRY, builds the URL, forwards
    the user's auth token for protected endpoints, and returns
    the structured result.
    """
    tool_name = intent.tool_name
    logger.info("Executing action: %s keys=%s", tool_name, sorted(intent.parameters))

    if not tool_name or tool_name not in TOOL_REGISTRY:
        return ActionResult(
            tool=tool_name or "unknown",
            input=intent.parameters,
            success=False,
            error=f"Unknown tool: {tool_name}",
        )

    tool_def = TOOL_REGISTRY[tool_name]

    # Auth guard
    if tool_def.requires_auth and not ctx.is_authenticated:
        return ActionResult(
            tool=tool_name,
            input=intent.parameters,
            success=False,
            error="Authentication required. Please log in to access booking features.",
        )

    # Build headers — forward access token for auth-required tools
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "User-Agent": "DocNow-AISupport/1.0",
    }
    if tool_def.requires_auth and ctx.access_token:
        headers["Cookie"] = f"accessToken={ctx.access_token}"

    # Build URL with path parameters; drop anything the tool does not declare
    url = f"{settings.express_api_url}{tool_def.endpoint_template}"
    params = {k: v for k, v in intent.parameters.items() if k in tool_def.parameters}

    for key, value in list(params.items()):
        placeholder = f"{{{key}}}"
        if placeholder in url:
            if not _SAFE_PATH_VALUE.match(str(value)):
                return ActionResult(
                    tool=tool_name, input=intent.parameters, success=False, error=f"Invalid {key}"
                )
            url = url.replace(placeholder, quote(str(value), safe=""))
            del params[key]  # Remove path params from query/body

    if "{" in url:
        return ActionResult(
            tool=tool_name, input=intent.parameters, success=False, error="Missing required booking details"
        )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if tool_def.method.upper() == "GET":
                response = await client.get(url, headers=headers, params=params)
            elif tool_def.method.upper() == "POST":
                response = await client.post(url, headers=headers, json=params)
            else:
                return ActionResult(
                    tool=tool_name,
                    input=intent.parameters,
                    success=False,
                    error=f"Unsupported HTTP method: {tool_def.method}",
                )

            response.raise_for_status()
            data = response.json()

            return ActionResult(
                tool=tool_name,
                input=intent.parameters,
                output=data,
                success=True,
            )

    except httpx.HTTPStatusError as exc:
        error_msg = f"HTTP {exc.response.status_code}"
        try:
            error_body = exc.response.json()
            error_msg = error_body.get("error", error_body.get("message", error_msg))
        except Exception:
            pass
        logger.warning("Action %s failed: %s", tool_name, error_msg)
        return ActionResult(
            tool=tool_name,
            input=intent.parameters,
            success=False,
            error=error_msg,
        )

    except Exception as exc:
        logger.exception("Unexpected error in action %s", tool_name)
        return ActionResult(
            tool=tool_name,
            input=intent.parameters,
            success=False,
            error=str(exc),
        )
