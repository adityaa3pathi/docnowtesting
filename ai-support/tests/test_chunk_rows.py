"""asyncpg returns jsonb as text; chunk rows must reach the agents as dicts."""
from __future__ import annotations

from app.database import chunk_row
from app.models import RetrievedChunk


def test_json_text_metadata_becomes_a_dict():
    row = chunk_row({"id": "c1", "source": "catalog", "title": "Lipid", "content": "x",
                     "metadata": '{"name": "Lipid Profile", "discountedPrice": null}'})
    assert row["metadata"] == {"name": "Lipid Profile", "discountedPrice": None}
    RetrievedChunk(id="c1", source="catalog", title="Lipid", content="x", similarity=0.9, metadata=row["metadata"])


def test_missing_or_dict_metadata_is_kept():
    assert chunk_row({"id": "c1", "metadata": None})["metadata"] is None
    assert chunk_row({"id": "c1", "metadata": {"a": 1}})["metadata"] == {"a": 1}


def test_unparseable_metadata_is_dropped_not_fatal():
    assert chunk_row({"id": "c1", "metadata": "not json"})["metadata"] is None
