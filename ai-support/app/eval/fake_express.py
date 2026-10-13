"""Fake Express API for eval runs: fixed bookings and slots, records every call."""
from __future__ import annotations

import json
import re
from pathlib import Path

import httpx

CATALOG = json.loads((Path(__file__).parent / "fixtures" / "catalog.json").read_text())["items"]

BOOKINGS = [
    {"id": "12345", "status": "Sample Collector Assigned", "tests": ["Complete Blood Count (CBC)"],
     "slot": "Tomorrow 09:00-10:00", "phlebotomist": "Ravi K.", "patient": "Self"},
    {"id": "98765", "status": "Order Booked", "tests": ["Lipid Profile"],
     "slot": "Saturday 08:00-09:00", "phlebotomist": None, "patient": "Self"},
    {"id": "55501", "status": "Cancelled", "tests": ["Thyroid Profile (T3, T4, TSH)"],
     "slot": "Last Monday 07:00-08:00", "phlebotomist": None, "patient": "Mother",
     "cancelReason": "Slot missed: phlebotomist could not reach the address"},
]
SLOTS = ["07:00-08:00", "08:00-09:00", "09:00-10:00", "11:00-12:00"]


class FakeExpress:
    """Use as an httpx transport handler; `calls` keeps (method, path) for tool-accuracy checks."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = re.sub(r"^.*?/api", "", request.url.path)
        self.calls.append((request.method, path))
        status, body = self._route(request.method, path, request)
        return httpx.Response(status, json=body)

    def _route(self, method: str, path: str, request: httpx.Request) -> tuple[int, dict]:
        if method == "GET" and path == "/catalog/products":
            term = (request.url.params.get("search") or "").lower()
            hits = [i for i in CATALOG if term and term in i["name"].lower()]
            return 200, {"products": hits[: int(request.url.params.get("limit", 5))]}
        if method == "GET" and (m := re.fullmatch(r"/catalog/products/([^/]+)", path)):
            item = next((i for i in CATALOG if i["partnerCode"] == m[1]), None)
            return (200, item) if item else (404, {"error": "Product not found"})
        if method == "GET" and path == "/bookings":
            return 200, {"bookings": BOOKINGS}
        if m := re.fullmatch(r"/bookings/([^/]+)/(status|reschedulable-slots|cancel|reschedule)", path):
            booking = next((b for b in BOOKINGS if b["id"] == m[1]), None)
            if not booking:
                return 404, {"error": "Booking not found"}
            action = m[2]
            if action == "status":
                return 200, booking
            if action == "reschedulable-slots":
                return 200, {"bookingId": booking["id"], "slots": SLOTS}
            if action == "cancel" and method == "POST":
                return 200, {"bookingId": booking["id"], "status": "Cancelled", "refund": "initiated"}
            if action == "reschedule" and method == "POST":
                return 200, {"bookingId": booking["id"], "status": "Rescheduled"}
        return 404, {"error": f"No fake route for {method} {path}"}
