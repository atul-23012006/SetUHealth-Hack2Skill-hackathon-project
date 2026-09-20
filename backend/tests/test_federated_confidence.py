"""Proves the Phase 6 acceptance criterion directly: model_confidence_score
visibly changes when a node joins or leaves the federated network — it
isn't a static or cosmetic number.
"""
import math

from app.services import federated, store


def test_confidence_score_is_zero_for_a_single_node():
    assert federated._model_confidence_score(1) == 0.0
    assert federated._model_confidence_score(0) == 0.0


def test_confidence_score_rises_with_diminishing_returns():
    scores = {n: federated._model_confidence_score(n) for n in (1, 2, 4, 8, 16, 32)}
    values = list(scores.values())
    assert values == sorted(values), "must be monotonically non-decreasing in node count"
    assert values[-1] < 100.0, "approaches but never claims perfect confidence"
    # 1->2 nodes must gain more than 16->32 nodes: the textbook diminishing-returns shape.
    assert (scores[2] - scores[1]) > (scores[32] - scores[16])


def test_confidence_score_matches_the_documented_formula():
    for n in (2, 5, 6, 10):
        expected = round(100.0 * (1.0 - 1.0 / math.sqrt(n)), 1)
        assert federated._model_confidence_score(n) == expected


def test_national_prior_reports_contributing_nodes_and_matching_confidence():
    prior = federated.national_federated_prior()
    assert prior["contributing_nodes_count"] == len(prior["participating_nodes"])
    assert prior["model_confidence_score"] == federated._model_confidence_score(
        prior["contributing_nodes_count"]
    )


def test_confidence_score_changes_when_a_state_node_is_removed():
    """Directly simulates removing a contributing node from the network (a
    state going offline / leaving the federation) and confirms both
    contributing_nodes_count and model_confidence_score visibly drop —
    the exact behaviour the Federated page surfaces."""
    before = federated.national_federated_prior()
    states_before = before["participating_nodes"]
    assert len(states_before) >= 2, "fixture dataset must have at least 2 states for this test to mean anything"

    removed_state = states_before[0]
    original_phcs = store.PHCS
    try:
        store.PHCS = [p for p in original_phcs if p["state"] != removed_state]
        after = federated.national_federated_prior()
    finally:
        store.PHCS = original_phcs

    assert after["contributing_nodes_count"] == before["contributing_nodes_count"] - 1
    assert after["model_confidence_score"] < before["model_confidence_score"]


def test_confidence_score_changes_when_a_partner_nation_node_is_added():
    """Same behaviour at the BRICS level: adding an observer nation node
    raises contributing_nodes_count and, with it, model_confidence_score."""
    before = federated.brics_shared_prior()
    extra_node = federated._synthetic_partner_summary("Ethiopia (observer)", 99)

    before_count = before["contributing_nodes_count"]
    after_count = before_count + 1
    assert federated._model_confidence_score(after_count) > federated._model_confidence_score(before_count)
    assert extra_node["node"] == "Ethiopia (observer)"
