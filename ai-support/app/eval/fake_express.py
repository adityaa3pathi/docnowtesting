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


def details_summary(item: dict) -> dict:
    """Port of server/src/services/catalogDetails.ts buildDetailsSummary(): search shows only 6 tests."""
    details = item.get("detailsData") if isinstance(item.get("detailsData"), dict) else {}
    constituents = details.get("constituents") or []
    count_match = re.search(r"\d+", item.get("parameters") or "")
    test_count = len(constituents) or (int(count_match[0]) if count_match else None)
    fasting = [v for v in (details.get("fasting"), details.get("fastingTime")) if v]
    return {
        "testCount": test_count,
        "constituentsPreview": [c.get("name") for c in constituents[:6]],
        "remainingConstituents": max((test_count or 0) - min(len(constituents), 6), 0),
        "fastingLabel": " ".join(map(str, fasting)) or None,
        "idealFor": ", ".join(details.get("gender") or []) or None,
        "reportingTime": details.get("reportingTime") or item.get("reportTime"),
    }


def _list_item(item: dict) -> dict:
    """Same fields as GET /api/catalog/products: no detailsData, only the summary."""
    price, mrp = item.get("discountedPrice") or item.get("displayPrice"), item.get("displayPrice")
    keep = ("id", "partnerCode", "name", "type", "displayPrice", "discountedPrice", "description",
            "parameters", "sampleType", "reportTime")
    return {**{k: item.get(k) for k in keep}, "price": price, "mrp": mrp if item.get("discountedPrice") else None,
            "detailsSummary": details_summary(item)}


def _detail(item: dict) -> dict:
    """Same as GET /api/catalog/products/:code: the whole row plus the summary."""
    return {**item, "price": item.get("discountedPrice") or item.get("displayPrice"),
            "mrp": item.get("displayPrice") if item.get("discountedPrice") else None,
            "detailsSummary": details_summary(item)}


class FakeExpress:
    """Use as an httpx transport handler; `calls` keeps (method, path) for tool-accuracy checks."""

    def __init__(self, catalog: list[dict] | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.catalog = CATALOG if catalog is None else catalog

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = re.sub(r"^.*?/api", "", request.url.path)
        self.calls.append((request.method, path))
        status, body = self._route(request.method, path, request)
        return httpx.Response(status, json=body)

    def _route(self, method: str, path: str, request: httpx.Request) -> tuple[int, dict]:
        if method == "GET" and path == "/catalog/products":
            term = (request.url.params.get("search") or "").lower()
            hits = [i for i in self.catalog if term and term in i["name"].lower()]
            limit = int(request.url.params.get("limit", 5))
            return 200, {"products": [_list_item(i) for i in hits[:limit]], "totalCount": len(hits)}
        if method == "GET" and (m := re.fullmatch(r"/catalog/products/([^/]+)", path)):
            item = next((i for i in self.catalog if i["partnerCode"] == m[1]), None)
            return (200, _detail(item)) if item else (404, {"error": "Product not found"})
        # Same rule as Express authMiddleware, so a wrong auth header fails the eval too.
        if path.startswith("/bookings") and not request.headers.get("Authorization", "").startswith("Bearer "):
            return 401, {"error": "Authorization token missing"}
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
