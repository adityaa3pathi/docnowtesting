from app.agents.cards import MAX_CARDS, cards_from_actions
from app.models import ActionResult
from app.routes.history import stored_cards


def _row(code, price=500, **extra):
    return {"partnerCode": code, "name": f"Test {code}", "type": "TEST", "price": price, **extra}


def test_cards_come_from_successful_catalog_rows_only():
    actions = [
        ActionResult(tool="search_catalog", output={"products": [_row("a", mrp=800, sampleType="Blood"), _row("b")]}),
        ActionResult(tool="search_catalog", success=False, output={"products": [_row("x")]}),
        ActionResult(tool="list_bookings", output=[_row("y")]),
    ]
    cards = cards_from_actions(actions)
    assert [c.code for c in cards] == ["a", "b"]
    assert cards[0].mrp == 800 and cards[0].sample_type == "Blood"
    assert cards[1].mrp is None


def test_single_product_dedupe_cap_and_bad_prices():
    rows = [_row(str(i)) for i in range(MAX_CARDS + 3)] + [_row("0"), _row("free", price=0), {"name": "no code", "price": 10}]
    cards = cards_from_actions([
        ActionResult(tool="get_product_details", output=_row("solo")),
        ActionResult(tool="search_catalog", output={"products": rows}),
    ])
    assert cards[0].code == "solo"
    assert len(cards) == MAX_CARDS
    assert len({c.code for c in cards}) == MAX_CARDS


def test_mrp_not_above_price_is_dropped():
    [card] = cards_from_actions([ActionResult(tool="get_product_details", output=_row("a", price=500, mrp=500))])
    assert card.mrp is None


def test_history_reads_saved_cards_and_skips_bad_rows():
    refs = [{"tool": "search_catalog"}, {"cards": [{"code": "a", "name": "A", "type": "TEST", "price": 1}, {"code": "bad"}]}]
    assert [c.code for c in stored_cards(refs)] == ["a"]
    assert stored_cards(None) == []
    assert stored_cards('[{"cards": []}]') == []


import pytest
from unittest.mock import AsyncMock, patch

from app.agents.orchestrator import handle_message
from app.models import Intent, RetrievalResult, RetrievedChunk, VerificationResult

_CHUNK = RetrievedChunk(id="c1", source="catalog", title="HbA1c", content="HbA1c info", similarity=0.9)
_INTENT = Intent(intent="CATALOG_SEARCH", tool_name="search_catalog", parameters={"search": "hba1c"}, requires_action=True, confidence=0.9)
_FOUND = ActionResult(tool="search_catalog", output={"products": [_row("hba1c", price=399)]})


async def _turn(verdict, mock_db, settings, agent_context):
    with (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock, return_value=RetrievalResult(chunks=[_CHUNK], max_similarity=0.9)),
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock, return_value=_INTENT),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock, return_value="HbA1c costs Rs 399."),
        patch("app.agents.orchestrator.verify", new_callable=AsyncMock, return_value=VerificationResult(verdict=verdict, cleaned_response="HbA1c costs Rs 399.")),
        patch("app.agents.action.execute_action", new_callable=AsyncMock, return_value=_FOUND),
    ):
        return await handle_message("hba1c price", agent_context, mock_db, settings)


@pytest.mark.asyncio
async def test_verified_catalog_reply_carries_cards(mock_db, settings, agent_context):
    response = await _turn("GROUNDED", mock_db, settings, agent_context)
    assert [(c.code, c.price) for c in response.cards] == [("hba1c", 399)]


@pytest.mark.asyncio
async def test_rejected_reply_carries_no_cards(mock_db, settings, agent_context):
    response = await _turn("UNGROUNDED", mock_db, settings, agent_context)
    assert response.was_abstained and response.cards == []
