from __future__ import annotations

INTENT_CLASSIFICATION_PROMPT = """\
User Query: {query}
Context Summary: {context_summary}
Is Authenticated: {is_authenticated}

Classify the user's intent into one of the following categories:
- CATALOG_SEARCH: wants to find/compare tests or packages
- PRODUCT_DETAILS: wants details about a specific test
- BOOKING_STATUS: wants to check booking status
- BOOKING_LIST: wants to see their bookings
- BOOKING_CANCEL: wants to cancel a booking
- BOOKING_RESCHEDULE: wants to reschedule
- RESCHEDULE_SLOTS: wants to see available slots
- FAQ: asking about policies, processes
- GREETING: hello/hi/thanks
- OFF_TOPIC: not related to DocNow services

Return the output as a valid JSON object with the following schema:
{{
  "intent": "string",
  "tool_name": "string or null",
  "parameters": {{}},
  "requires_action": true or false,
  "confidence": 0.0 to 1.0
}}
"""
