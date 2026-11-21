"""Omission check and probe scoring: the eval checks the verifier cannot do."""
from __future__ import annotations

from app.eval.omission import OmissionChecker, aliases
from app.eval.scorer import EvalResult, custom_metrics, probe_passed

PACKAGE = {
    "name": "DocNow Complete Health Package",
    "detailsData": {
        "constituents": [
            {"name": "Glycated Hemoglobin (HbA1c)"},
            {"name": "Vitamin D Total-25 Hydroxy"},
            {"name": "Ferritin, Serum"},
        ]
    },
}
BASIC = {"name": "Basic Package", "detailsData": {"constituents": [{"name": "TSH"}, {"name": "Ferritin, Serum"}]}}
SINGLE = {"name": "HbA1c", "detailsData": {"constituents": [{"name": "Glycated Hemoglobin (HbA1c)"}]}}
CHECKER = OmissionChecker([PACKAGE, BASIC, SINGLE])


def test_aliases_cover_acronym_bare_name_and_vitamin():
    assert {"hba1c", "glycated hemoglobin"} <= aliases("Glycated Hemoglobin (HbA1c)")
    assert "vitamin d" in aliases("Vitamin D Total-25 Hydroxy")
    assert "ferritin" in aliases("Ferritin, Serum")


def test_flags_denial_when_the_question_names_package_and_test():
    hits = CHECKER.check("Does the Complete Health Package include HbA1c?", "No, it does not include it.")
    assert [(h.item, h.test) for h in hits] == [("DocNow Complete Health Package", "Glycated Hemoglobin (HbA1c)")]


def test_flags_denial_named_in_the_answer_sentence():
    hits = CHECKER.check("what's in it?", "Vitamin D is not included in the DocNow Complete Health Package.")
    assert [h.test for h in hits] == ["Vitamin D Total-25 Hydroxy"]


def test_true_negative_is_not_flagged():
    # The Basic package really has no HbA1c.
    assert CHECKER.check("Does the Basic Package include HbA1c?", "No, the Basic Package does not include HbA1c.") == []


def test_positive_answer_is_not_flagged():
    assert CHECKER.check("Does the Complete Health Package include HbA1c?", "Yes, it includes HbA1c.") == []


def test_single_test_item_is_ignored():
    assert CHECKER.check("hba1c", "HbA1c does not include fasting.") == []


def _result(**overrides) -> EvalResult:
    base = dict(
        query_id="q", category="catalog", query="q", response="Yes, it is ₹2,100.",
        retrieved_contexts=[], retrieved_sources=[], ground_truth=None,
        should_abstain=False, was_abstained=False, verifier_verdict="GROUNDED",
        expected_source=None, expected_tool=None,
    )
    return EvalResult(**{**base, **overrides})


def test_probe_checks_any_none_all_case_insensitively():
    assert probe_passed(_result()) is None
    assert probe_passed(_result(expect_any=["yes", "includes"])) is True
    assert probe_passed(_result(expect_none=["it is"])) is False
    assert probe_passed(_result(expect_all=["YES", "2,100"])) is True
    assert probe_passed(_result(expect_all=["yes", "Basic"])) is False


def test_metrics_report_probe_pass_and_omission_rates():
    results = [
        _result(expect_any=["yes"]),
        _result(expect_any=["no"], omissions=["P: X"]),
        _result(was_abstained=True, omissions=["ignored"]),
    ]
    scores = custom_metrics(results)
    assert scores["probe_pass_rate"] == 0.5
    assert scores["omission_error_rate"] == 0.5
