"""Symptom suggestions: emergency check first, fixed wording, tests only from the approved table."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.models import ActionResult, Intent, RetrievalResult
from app.symptoms.safety import (
    DISCLAIMER, EMERGENCY_RESPONSE, MEDICAL_ADVICE_RESPONSE, approved, emergency_sign, normalize, topics,
)
from app.agents.orchestrator import handle_message


def test_every_approved_phrase_triggers_its_own_sign():
    for sign in approved()["emergency_signs"]:
        for phrase in sign["phrases"]:
            assert emergency_sign(f"please help, {phrase}!") is not None, phrase


@pytest.mark.parametrize("message", [
    "I have chest pain since morning", "seene me dard ho raha hai", "मुझे सीने में दर्द है",
    "I want to kill myself", "mera baccha behosh ho gaya", "saans nahi aa rahi", "khoon ki ulti ho rahi hai",
])
def test_emergencies_are_caught(message):
    assert emergency_sign(message)


@pytest.mark.parametrize("message", [
    "thyroid test price", "I feel tired all the time", "is the hypothyroid test fasting", "cbc test",
    "chest x ray price", "fever for 3 days", "it fits my budget", "how to book hba1c", "my neck is stiff from sleeping",
])
def test_ordinary_questions_are_not_emergencies(message):
    assert emergency_sign(message) is None


def test_hinglish_spellings_fold_together():
    assert normalize("Seene me dard, nhi ruk rha!") == normalize("seene mein dard nahi ruk raha")


def test_every_topic_has_tests_and_sources():
    assert len(topics()) == 10
    for topic in topics().values():
        assert topic["label"] and topic["tests"]
        assert all(t["source"].startswith("https://medlineplus.gov/") for t in topic["tests"])
        assert all(bool(t["code"]) == bool(t["catalog_name"]) for t in topic["tests"])


def _settings(settings, on=True):
    return settings.model_copy(update={"symptom_suggestions": on})


def _symptom(topic):
    return Intent(intent="SYMPTOM_CHECK", parameters={"symptom_topic": topic}, confidence=0.9)


def _catalog_by_term(intent, ctx, settings):
    """Live catalog fake: every pinned code exists except Ferritin, which only an exact-name search finds."""
    if intent.tool_name == "get_product_details":
        code = intent.parameters["code"]
        if code == "parameter_885":
            return ActionResult(tool="get_product_details", success=False, error="HTTP 404")
        name = next(t["catalog_name"] for tp in topics().values() for t in tp["tests"] if t["code"] == code)
        return ActionResult(tool="get_product_details", output={"partnerCode": code, "name": name, "type": "TEST", "price": 300})
    term = intent.parameters["search"]
    return ActionResult(tool="search_catalog", output={"products": [
        {"partnerCode": "loose", "name": f"{term} Wellness Pack", "type": "PACKAGE", "price": 999},
        {"partnerCode": "staging_885", "name": term, "type": "TEST", "price": 558},
    ]})


def _patches(intent):
    return (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock, return_value=RetrievalResult()),
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock, return_value=intent),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock, return_value="draft"),
        patch("app.agents.orchestrator.verify", new_callable=AsyncMock),
        patch("app.agents.action.execute_action", new_callable=AsyncMock, side_effect=_catalog_by_term),
    )


@pytest.mark.asyncio
async def test_emergency_reply_comes_before_any_model_call(mock_db, settings, agent_context):
    p = _patches(_symptom("tiredness"))
    with p[0], p[1] as classify, p[2], p[3], p[4] as act:
        response = await handle_message("seene mein dard ho raha hai", agent_context, mock_db, _settings(settings))
    assert response.content == EMERGENCY_RESPONSE and response.cards == []
    classify.assert_not_awaited()
    act.assert_not_awaited()


@pytest.mark.asyncio
async def test_symptom_reply_uses_table_tests_and_fixed_wording(mock_db, settings, agent_context):
    p = _patches(_symptom("tiredness"))
    with p[0], p[1], p[2] as draft, p[3] as verify, p[4]:
        response = await handle_message("I feel tired all the time", agent_context, mock_db, _settings(settings))
    assert response.content.startswith("Tests often checked when people have tiredness")
    assert response.content.endswith(DISCLAIMER)
    pinned = [t["code"] for t in topics()["tiredness"]["tests"] if t["code"]]
    codes = [c.code for c in response.cards]
    assert codes == [("staging_885" if c == "parameter_885" else c) for c in dict.fromkeys(pinned)]
    assert "loose" not in codes
    assert "Also often checked: Comprehensive metabolic panel (CMP)." in response.content
    draft.assert_not_awaited()
    verify.assert_not_awaited()


@pytest.mark.asyncio
async def test_fever_reply_carries_see_a_doctor_note(mock_db, settings, agent_context):
    p = _patches(_symptom("fever_3_days"))
    with p[0], p[1], p[2], p[3], p[4]:
        response = await handle_message("bukhar 4 din se hai", agent_context, mock_db, _settings(settings))
    assert "see a doctor today" in response.content


@pytest.mark.asyncio
async def test_unknown_topic_lists_choices_without_tests(mock_db, settings, agent_context):
    p = _patches(_symptom("other"))
    with p[0], p[1], p[2], p[3], p[4] as act:
        response = await handle_message("my ear feels odd", agent_context, mock_db, _settings(settings))
    assert "Which one is closest" in response.content and response.cards == []
    act.assert_not_awaited()


@pytest.mark.asyncio
async def test_medical_advice_is_refused_kindly(mock_db, settings, agent_context):
    p = _patches(Intent(intent="MEDICAL_ADVICE", confidence=0.9))
    with p[0], p[1], p[2] as draft, p[3], p[4]:
        response = await handle_message("what disease do I have?", agent_context, mock_db, _settings(settings))
    assert response.content == MEDICAL_ADVICE_RESPONSE
    draft.assert_not_awaited()


@pytest.mark.asyncio
async def test_switch_off_keeps_todays_behaviour(mock_db, settings, agent_context):
    p = _patches(_symptom("tiredness"))
    with p[0], p[1] as classify, p[2], p[3], p[4] as act:
        response = await handle_message("seene mein dard ho raha hai", agent_context, mock_db, _settings(settings, on=False))
    classify.assert_awaited_once()
    act.assert_not_awaited()
    assert response.content != EMERGENCY_RESPONSE


@pytest.mark.parametrize("message,topic", [
    ("I feel tired all the time", "tiredness"), ("bahut thakan rehti hai", "tiredness"),
    ("my hair fall is too much", "hair_fall"), ("ghutne mein dard", "joint_pain"), ("periods late hain", "irregular_periods"),
])
def test_symptom_words_pick_the_topic(message, topic):
    from app.symptoms.keywords import keyword_topic
    assert keyword_topic(message) == topic


@pytest.mark.parametrize("message", ["thyroid test price", "full body checkup package", "hba1c cost", "book cbc"])
def test_plain_searches_have_no_symptom_topic(message):
    from app.symptoms.keywords import keyword_topic
    assert keyword_topic(message) is None


@pytest.mark.asyncio
async def test_symptom_words_override_a_catalog_classification(mock_db, settings, agent_context):
    search = Intent(intent="CATALOG_SEARCH", tool_name="search_catalog", parameters={"search": "fatigue"}, requires_action=True, confidence=0.8)
    p = _patches(search)
    with p[0], p[1], p[2] as draft, p[3], p[4]:
        response = await handle_message("I feel tired all the time", agent_context, mock_db, _settings(settings))
    assert response.content.startswith("Tests often checked when people have tiredness")
    draft.assert_not_awaited()


@pytest.mark.asyncio
async def test_tests_past_the_card_limit_are_still_named(mock_db, settings, agent_context):
    p = _patches(_symptom("irregular_periods"))
    with p[0], p[1], p[2], p[3], p[4]:
        response = await handle_message("my periods are irregular", agent_context, mock_db, _settings(settings))
    assert len(response.cards) == 6
    assert "Also often checked: Pregnancy test (hCG)." in response.content
