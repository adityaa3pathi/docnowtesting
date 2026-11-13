"""Emergency check that runs in code before any model call, and the approved symptom table.

Clinical content lives in approved.json and changes only with a doctor's written OK.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

EMERGENCY_RESPONSE = (
    "This could be a medical emergency. Please call 112 now, or 108 for an ambulance, "
    "or go to the nearest hospital emergency department. Please don't wait for a test."
)
DISCLAIMER = "This is not a diagnosis. A doctor can tell you which tests you need."
MEDICAL_ADVICE_RESPONSE = (
    "I can't diagnose, explain reports or suggest medicines. Please speak to a doctor about this. "
    "I can help you find a test, book it, or check a booking."
)

# Common Hinglish spellings folded to one form, so "seene me dard" matches "seene mein dard".
_VARIANTS = {"me": "mein", "mai": "mein", "nhi": "nahi", "nahin": "nahi", "rha": "raha", "rhi": "rahi", "h": "hai", "he": "hai"}
_NON_WORD = re.compile(r"[^\wऀ-ॿ]+")


def normalize(text: str) -> str:
    tokens = _NON_WORD.sub(" ", text.lower()).split()
    return " " + " ".join(_VARIANTS.get(t, t) for t in tokens) + " "


@lru_cache(maxsize=1)
def approved() -> dict:
    return json.loads((Path(__file__).parent / "approved.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _emergency_phrases() -> tuple[tuple[str, str], ...]:
    return tuple(
        (normalize(p), sign["sign"]) for sign in approved()["emergency_signs"] for p in sign["phrases"] if p.strip()
    )


def emergency_sign(message: str) -> str | None:
    """The approved emergency sign the message matches (whole words), or None."""
    text = normalize(message)
    return next((sign for phrase, sign in _emergency_phrases() if phrase in text), None)


def topics() -> dict:
    return approved()["topics"]
