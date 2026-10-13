from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Any, Optional

@dataclass
class ToolDefinition:
    name: str
    description: str
    requires_auth: bool
    method: str
    endpoint_template: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    # Changes a booking; runs only after the user confirms in the next message.
    is_write: bool = False

TOOL_REGISTRY: Dict[str, ToolDefinition] = {
    "search_catalog": ToolDefinition(
        name="search_catalog",
        description="Search for catalog products",
        requires_auth=False,
        method="GET",
        endpoint_template="/catalog/products",
        parameters={
            "search": {"type": "string", "description": "Query to search for"},
            "limit": {"type": "integer", "default": 5}
        }
    ),
    "get_product_details": ToolDefinition(
        name="get_product_details",
        description="Get product details by code",
        requires_auth=False,
        method="GET",
        endpoint_template="/catalog/products/{code}",
        parameters={
            "code": {"type": "string", "description": "Product code"}
        }
    ),
    "list_bookings": ToolDefinition(
        name="list_bookings",
        description="List all bookings for the user",
        requires_auth=True,
        method="GET",
        endpoint_template="/bookings"
    ),
    "get_booking_status": ToolDefinition(
        name="get_booking_status",
        description="Get status of a specific booking",
        requires_auth=True,
        method="GET",
        endpoint_template="/bookings/{booking_id}/status",
        parameters={
            "booking_id": {"type": "string"}
        }
    ),
    "get_reschedule_slots": ToolDefinition(
        name="get_reschedule_slots",
        description="Get available slots for rescheduling a booking",
        requires_auth=True,
        method="GET",
        endpoint_template="/bookings/{booking_id}/reschedulable-slots",
        parameters={
            "booking_id": {"type": "string"}
        }
    ),
    "cancel_booking": ToolDefinition(
        name="cancel_booking",
        description="Cancel a booking",
        requires_auth=True,
        method="POST",
        endpoint_template="/bookings/{booking_id}/cancel",
        is_write=True,
        parameters={
            "booking_id": {"type": "string"},
            "remarks": {"type": "string"}
        }
    ),
    "reschedule_booking": ToolDefinition(
        name="reschedule_booking",
        description="Reschedule a booking to a new slot",
        requires_auth=True,
        method="POST",
        endpoint_template="/bookings/{booking_id}/reschedule",
        is_write=True,
        parameters={
            "booking_id": {"type": "string"},
            "slot_id": {"type": "string"},
            "slotDate": {"type": "string"},
            "slotTime": {"type": "string"},
            "reschedule_reason": {"type": "string"}
        }
    )
}


def render_tool_list() -> str:
    """One line per tool for the intent prompt, so the model picks real names and parameters."""
    lines = []
    for tool in TOOL_REGISTRY.values():
        params = ", ".join(tool.parameters) or "none"
        lines.append(f"- {tool.name}: {tool.description} (parameters: {params})")
    return "\n".join(lines)
