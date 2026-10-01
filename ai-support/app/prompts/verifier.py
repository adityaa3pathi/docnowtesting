from __future__ import annotations

ABSTENTION_MESSAGE = "I'm sorry, I don't have enough verified information to answer that accurately. For help with this, please contact our support team at +91 9649089089 or docnowhealthcare@gmail.com."

VERIFIER_PROMPT = """\
Sources:
{sources}

Actions:
{actions}

Draft Response:
{draft}

Instructions:
You are a fact-checking verifier. Check each factual claim in the draft response against the provided sources and actions.
Return a JSON object with the following schema:
{{
  "verdict": "GROUNDED" | "UNGROUNDED" | "PARTIALLY_GROUNDED",
  "claims_checked": 0,
  "claims_grounded": 0,
  "reasoning": "string explanation",
  "cleaned_response": "string with ungrounded claims removed, or null if fully ungrounded"
}}
"""
