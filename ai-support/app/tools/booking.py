from __future__ import annotations

import httpx
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

async def list_bookings(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    try:
        response = await client.get("/api/bookings", headers=headers)
        response.raise_for_status()
        return {"success": True, "data": response.json()}
    except Exception as e:
        logger.error(f"Error listing bookings: {e}")
        return {"success": False, "error": str(e)}

async def get_booking_status(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    booking_id = params.get("booking_id")
    if not booking_id:
        return {"success": False, "error": "booking_id is required"}
        
    try:
        response = await client.get(f"/api/bookings/{booking_id}/status", headers=headers)
        response.raise_for_status()
        return {"success": True, "data": response.json()}
    except Exception as e:
        logger.error(f"Error getting booking status: {e}")
        return {"success": False, "error": str(e)}

async def get_reschedule_slots(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    booking_id = params.get("booking_id")
    if not booking_id:
        return {"success": False, "error": "booking_id is required"}
        
    try:
        response = await client.get(f"/api/bookings/{booking_id}/reschedulable-slots", headers=headers)
        response.raise_for_status()
        return {"success": True, "data": response.json()}
    except Exception as e:
        logger.error(f"Error getting reschedule slots: {e}")
        return {"success": False, "error": str(e)}

async def cancel_booking(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    booking_id = params.get("booking_id")
    remarks = params.get("remarks", "")
    
    if not booking_id:
        return {"success": False, "error": "booking_id is required"}
        
    try:
        response = await client.post(f"/api/bookings/{booking_id}/cancel", json={"remarks": remarks}, headers=headers)
        response.raise_for_status()
        return {"success": True, "data": response.json()}
    except Exception as e:
        logger.error(f"Error canceling booking: {e}")
        return {"success": False, "error": str(e)}

async def reschedule_booking(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    booking_id = params.get("booking_id")
    if not booking_id:
        return {"success": False, "error": "booking_id is required"}
        
    body = {
        "slot_id": params.get("slot_id"),
        "slotDate": params.get("slotDate"),
        "slotTime": params.get("slotTime"),
        "reschedule_reason": params.get("reschedule_reason")
    }
    
    try:
        response = await client.post(f"/api/bookings/{booking_id}/reschedule", json=body, headers=headers)
        response.raise_for_status()
        return {"success": True, "data": response.json()}
    except Exception as e:
        logger.error(f"Error rescheduling booking: {e}")
        return {"success": False, "error": str(e)}
