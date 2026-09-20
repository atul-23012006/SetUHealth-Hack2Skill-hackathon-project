# Contributing to SetuHealth

This page covers the one technical question that matters most for this
project's actual growth model: **how does a new state, or a new partner
country, onboard a node to the federated layer?** Ordinary code
contribution (bug fixes, features) follows the usual GitHub flow — fork,
branch, PR — and isn't covered further here.

## The node-summary contract

Every node in the federation — today, an Indian state; eventually, a
partner nation — is defined entirely by whether it can produce one object,
in the exact shape `app/services/federated.py`'s `state_summary()` computes
for a state:

```python
{
    "node": "Maharashtra",                 # node's display name
    "facility_count": 32,                  # int
    "category_depletion_rates": {          # per resource-category, avg daily depletion rate
        "antibiotic": 2.84,
        "chronic": 2.93,
        # ... one entry per app/data/resource_types.py category the node stocks
    },
    "critical_alerts": 130,                # count of (facility, resource) pairs at critical risk
    "warning_alerts": 190,                 # same, at warning risk
    "critical_facility_count": 47,         # distinct facilities with >=1 critical resource
    "warning_facility_count": 63,          # distinct facilities with >=1 warning resource
    "population_served": 919090,           # sum of population_served across the node's facilities
}
```

This is **the only thing that crosses a node boundary.** No facility id, no
lat/lon, no patient or staff record ever appears in this object — see
Guardrail 3 in `SETUHEALTH_NEXT_LEVEL_PLAN.md` and `federated.py`'s own
module docstring, which is the actual, enforced architectural invariant
this whole platform is built around, not a policy on paper.
`national_federated_prior()` and `brics_shared_prior()` take a list of these
objects and federated-average `category_depletion_rates`, weighted by
`facility_count` — that's the entire aggregation algorithm, and it doesn't
care whether the node behind a given summary is a state or a country.

## Onboarding a new Indian state (real, followable today)

In the current demo architecture, a "node" is any distinct value of
`state` appearing in the facility roster (`store.PHCS`) — `federated.py`
derives the node list itself (`states = sorted({p["state"] for p in
store.PHCS})` in `national_federated_prior()`), so there is no separate
registration step to keep in sync.

1. **Add the state and its districts** to `STATES` in
   `backend/app/data/reference.py`:
   ```python
   STATES = {
       ...,
       "Odisha": ["Bhubaneswar", "Cuttack", "Puri", "Sambalpur"],
   }
   ```
2. **Add each district's real PHC count** to `REAL_PHC_COUNTS` in the same
   file, sourced from the Ministry of Health & Family Welfare's Rural
   Health Statistics (the same source already cited for the existing six
   states) — not an invented number. If you can't find a published figure
   for a district, say so in the PR description rather than guessing.
3. **Add each district's centroid** (`(lat, lon)`) to `DISTRICT_CENTERS` in
   `backend/app/data/generate_data.py` — the synthetic generator scatters
   PHCs around this point.
4. **Regenerate the dataset**: `cd backend && python -m app.data.generate_data`
   (or `--fast` for a quicker 90-day rebuild during development — see
   `generate_data.py`'s module docstring).
5. That's it. `federated.state_summary("Odisha")` now returns a real
   summary the moment any PHC with `"state": "Odisha"` exists in
   `store.PHCS`, `national_federated_prior()` picks it up automatically in
   its node list, and `contributing_nodes_count` /
   `model_confidence_score` on the Federated Network page update to match
   — you can verify this directly with
   `backend/tests/test_federated_confidence.py`'s
   `test_confidence_score_changes_when_a_state_node_is_removed`, which
   exercises exactly this mechanism in reverse.

**What this does not cover:** connecting a *real* state health department's
live database instead of the synthetic generator. That would mean replacing
`app/data/generate_data.py`'s output with an ingestion adapter that computes
the same `stock_history` / `phcs` shapes `store.py` currently loads from
JSON — a real integration project, not a config change, and out of scope
for this demo. `docs/INTEROP.md` describes the closest existing piece of
that story (the `/api/export/*` endpoints), which work in the opposite
direction (publishing out, not ingesting in).

## Onboarding a new BRICS partner nation

Be honest with yourself about what exists today before you start: **there
is no live cross-border network call anywhere in this codebase.** BRICS
"federation" is simulated inside a single Python process —
`brics_shared_prior()` in `federated.py` calls
`_synthetic_partner_summary(nation, seed_offset)` for a fixed list of four
partner names, which returns a deterministically-seeded fake summary in
the same shape as the contract above. This is clearly labelled — see the
`SimulatedDataBadge` component `Federated.tsx` renders next to every
non-India row, and the `note` field `brics_shared_prior()` returns.

To add a fifth partner node **to the simulation** (the honest, currently-real
option):

1. Add one call to the `partners` list in `brics_shared_prior()`:
   ```python
   partners = [
       _synthetic_partner_summary("Brazil", 1),
       _synthetic_partner_summary("South Africa", 2),
       _synthetic_partner_summary("Indonesia (observer)", 3),
       _synthetic_partner_summary("Egypt (observer)", 4),
       _synthetic_partner_summary("Ethiopia (observer)", 5),  # new
   ]
   ```
2. Nothing else changes — `global_category_depletion_prior`,
   `contributing_nodes_count`, and `model_confidence_score` all recompute
   from `len(all_nodes)`/the new node's data automatically, and the
   Federated Network page's confidence meter reflects it on next load.
   `backend/tests/test_federated_confidence.py`'s
   `test_confidence_score_changes_when_a_partner_nation_node_is_added`
   exercises this same mechanism.

**To onboard a real partner nation's health system** (the roadmap item,
not implemented here): `_synthetic_partner_summary()` would be replaced
with an adapter that fetches or receives that country's actual node-summary
object — over whatever transport a real government-to-government data
exchange agreement specifies (a scheduled pull, a signed push, a shared
message queue) — and validates it against the contract shape above before
handing it to the same aggregation math. The aggregation logic in
`national_federated_prior()` / `brics_shared_prior()` would not need to
change at all; only where the summary objects come from would. This is
genuinely future work — see `docs/GOVERNANCE.md` for how a decision like
"which country's node adapter ships next" would get made once other
organizations are actually contributing, not just this repo's current
maintainers.

## Code contributions in general

- Read `SETUHEALTH_NEXT_LEVEL_PLAN.md`'s Guardrails section first — in
  particular, guardrail 2 (never present a simulated integration as real)
  and guardrail 3 (the aggregate-only privacy boundary) apply to every PR,
  not just the phase they were written for.
- Run the backend test suite (`cd backend && python -m pytest tests -q`)
  and the frontend build (`cd frontend && npm run build`) before opening a
  PR; both are fast enough to run on every change.
- If you're adding a new resource type or facility type, start at
  `backend/app/data/resource_types.py` — its module docstring explains
  why that's the only file you should need to touch.
