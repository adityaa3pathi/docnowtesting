"""Plain words that mark a symptom message, so the safe path runs even if the classifier calls it a search.

Language matching only, not clinical content. The routine check-up topic is left to the classifier
because "full body checkup" is a normal package search.
"""
from __future__ import annotations

from app.symptoms.safety import normalize

TOPIC_WORDS: dict[str, list[str]] = {
    "tiredness": ["tired", "tiredness", "fatigue", "exhausted", "no energy", "low energy", "weakness", "feel weak",
                  "thakan", "thakaan", "thaka hua", "kamzori", "थकान", "कमज़ोरी", "कमजोरी"],
    "hair_fall": ["hair fall", "hair falling", "hair loss", "losing hair", "baal gir", "baal jhad", "बाल झड़", "बाल गिर"],
    "weight_gain": ["weight gain", "gaining weight", "putting on weight", "wajan badh", "vajan badh", "motapa", "वजन बढ़"],
    "urination_thirst": ["frequent urination", "urinating a lot", "peeing a lot", "very thirsty", "always thirsty",
                         "baar baar peshab", "bar bar peshab", "pyaas bahut", "बार बार पेशाब"],
    "joint_pain": ["joint pain", "joints hurt", "knee pain", "jodo mein dard", "joron mein dard", "ghutne mein dard",
                   "जोड़ों में दर्द", "घुटने में दर्द"],
    "fever_3_days": ["fever", "bukhar", "bukhaar", "बुखार"],
    "acidity": ["acidity", "heartburn", "acid reflux", "khatte dakar", "seene mein jalan", "एसिडिटी"],
    "irregular_periods": ["irregular periods", "periods irregular", "missed period", "periods late", "late periods",
                          "period nahi aaya", "periods nahi aa", "मासिक धर्म"],
    "low_vitamin": ["tingling", "numbness", "pins and needles", "bone pain", "haddi mein dard", "jhunjhuni",
                    "haath pair sunn", "झुनझुनी"],
}
_PHRASES = [(normalize(w), topic) for topic, words in TOPIC_WORDS.items() for w in words]


def keyword_topic(message: str) -> str | None:
    text = normalize(message)
    return next((topic for phrase, topic in _PHRASES if phrase in text), None)
