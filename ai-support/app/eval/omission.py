"""Deterministic omission check: an answer that says test X is not in package P when the catalog says it is.

The verifier cannot catch this. It checks the draft against the retrieved chunks, so when the chunk
was cut short (before Phase 1c) the wrong "No" looked grounded. This check reads the full catalog.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# "does not include", "isn't part of", "not included", "excludes", Hinglish "shamil nahi".
_NEGATION = re.compile(
    r"\b(?:does not|doesn't|do not|don't|is not|isn't|are not|aren't|not)\s+"
    r"(?:include|includes|included|part of|cover|covers|covered|contain|contains|have|has|listed)\b"
    r"|\bexclud(?:e|es|ed|ing)\b"
    r"|\b(?:shamil|included|include)\s+nahi",
    re.IGNORECASE,
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
# Specimen and method suffixes users never type: "Ferritin, Serum" is asked as "ferritin".
_SUFFIX = re.compile(r"[,\s-]+(?:serum|plasma|blood|urine|whole blood|by .*|-by .*)$", re.IGNORECASE)
MIN_ALIAS = 3


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("–", "-").replace("—", "-")).strip().lower()


def aliases(name: str) -> set[str]:
    """Ways an answer may name a test: full name, the acronym in brackets, the name without suffixes."""
    full = _norm(name)
    out = {full}
    for inner in re.findall(r"\(([^)]+)\)", full):
        out.add(inner.strip())
    bare = re.sub(r"\s*\([^)]*\)", "", full).strip()
    out.add(bare)
    out.add(_SUFFIX.sub("", bare).strip())
    # "Vitamin D Total-25 Hydroxy" is asked about as "Vitamin D".
    vitamin = re.match(r"(vitamin [a-z]\d*)\b", bare)
    if vitamin:
        out.add(vitamin.group(1))
    return {a for a in out if len(a) >= MIN_ALIAS}


def _mentions(text: str, alias: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", text) is not None


def _item_aliases(name: str) -> set[str]:
    full = _norm(name)
    return {full, full.removeprefix("docnow ").strip()}


@dataclass
class Omission:
    item: str
    test: str
    sentence: str


class OmissionChecker:
    """Built once per corpus; check() is pure string matching."""

    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.items: list[tuple[str, set[str], list[tuple[str, set[str]]]]] = []
        for item in items:
            details = item.get("detailsData") if isinstance(item.get("detailsData"), dict) else {}
            constituents = details.get("constituents")
            if not isinstance(constituents, list):
                continue
            tests = [(c["name"], aliases(c["name"])) for c in constituents if isinstance(c, dict) and c.get("name")]
            # A single-test item cannot omit its own test, and its name matches that test's alias.
            if len(tests) >= 2:
                self.items.append((item["name"], _item_aliases(item["name"]), tests))

    def check(self, query: str, response: str) -> list[Omission]:
        q = _norm(query)
        found: list[Omission] = []
        for raw in _SENTENCE.split(response):
            sentence = _norm(raw)
            if not sentence or not _NEGATION.search(sentence):
                continue
            # "No, it does not include it" names neither; the question does.
            named_here = [it for it in self.items if any(_mentions(sentence, a) for a in it[1])]
            candidates = named_here or [it for it in self.items if any(_mentions(q, a) for a in it[1])]
            for name, _, tests in candidates:
                hits = [t for t, al in tests if any(_mentions(sentence, a) for a in al)]
                if not hits:
                    hits = [t for t, al in tests if any(_mentions(q, a) for a in al)]
                found.extend(Omission(name, t, raw.strip()) for t in hits)
        return found
