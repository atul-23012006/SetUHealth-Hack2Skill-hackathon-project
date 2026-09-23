# Backend Services

## Purpose
All domain logic: forecasting, redistribution, anomaly detection, federation, transfers, dispatch, auth, GenAI, and the persistence layers. Routers (`../routers/`) stay thin and call in here. This directory does not do HTTP concerns (status codes, request models) beyond raising `ValueError`/`HTTPException`-compatible errors for routers to translate.

## Entry Points
- `store.py` - in-memory source of truth (module-level globals loaded from `../data/generated/`). Everything else reads it.
- `forecasting.py` - `forecast_medicine`, `network_alerts`; results cached, `clear_forecast_cache()` invalidates.
- `redistribution.py` - LP recommendations; consumes forecasting risk to pick deficit vs surplus facilities.
- `transfers.py` - `create_and_execute_transfer`, the only place stock is moved between facilities.
- `db.py` - SQLite ledger (transfers, crises, audit events).
- `live_data.py` - real-world feeds (weather, World Bank, OpenStreetMap, data.gov.in) plus the nearest-network-facilities lookup.
- `weather_impact.py` - pure overlay turning real weather signals into a demand scenario; never mutates `store`.
- `signal_alerts.py` - background poller that fires a notification the moment a real weather signal crosses into "high".

## Contracts & Invariants
- **Cache invalidation is manual.** Any code that changes `store.STOCK_HISTORY` levels must call `forecasting.clear_forecast_cache()`. `store.py` and `transfers.py` do this today (cold-chain failure, crisis, reset, transfer).
- **Lazy imports are deliberate.** `forecasting` imports `store` at module level, so `store.py` and `transfers.py` import `clear_forecast_cache`/`forecast_medicine` inside functions. A top-level import would be circular.
- **Transfer write order** (`create_and_execute_transfer`): mutate last element of both `levels` lists → `store.save_stock_history()` → build manifest → optional dispatch → `db.record_transfer` (also writes the audit row) → clear forecast cache. Keep the ledger write and cache clear after the mutation.
- **Transfers are validated before any mutation** and rejected with `ValueError` (router: 400; assistant: "Transfer failed"): sender != recipient, quantity a finite number > 0, quantity <= the donor's current level. A rejected transfer must leave stock, ledger and audit log untouched. New validation belongs above the first `levels` write.
- **Auto-dispatch gate** is one function, `_auto_dispatch_eligibility`: same state, quantity <= `AUTO_DISPATCH_MAX_QUANTITY` (50), destination risk not `critical`. Ineligible transfers still execute; they just record `auto_dispatch_declined_reason`. Do not scatter these checks elsewhere.
- **`dispatch.py`** defines the `LogisticsProvider` interface and one implementation, `SimulatedGroundCourierProvider`. It is labelled simulated (`DispatchResult.simulated`, audit log, manifest). A new provider implements the interface and takes a `TransferRequestV1`; never present a simulated one as real.
- **`public_stats.py` must not read raw facility records** (`store.PHCS`, `store.PHC_BY_ID`, ...). It only wraps `federated.py`'s aggregation helpers, so it structurally cannot leak facility fields to the unauthenticated portal. Keep it that way.
- **`federated.py` summaries are aggregate-only.** Nothing facility- or patient-level may appear in a node summary. Partner-nation nodes are synthetic and must stay labelled as such.
- **`anomaly.py` and `redistribution.py` are resource-agnostic.** They iterate whatever is in `store.STOCK_HISTORY`; do not add medicine-specific branches. New resources go in `../data/resource_types.py`. The anomaly detector must never read the generator's ground-truth labels.
- **`genai.py` degrades, never fails.** With no key, or when every configured model errors, `_generate()`/`_generate_stream()` return `None` and the caller falls through to a deterministic mock template (word-streamed for `chat_reply_stream`, so the UI behaves the same either way). `_call_models` tries `gemini_model` then `gemini_fallback_model`, retrying a 429/503 once before moving to the next model, and puts a model that failed into a short cooldown (`_down_until`) so a stalled model isn't retried on every request. The text generators (`explain_*`, `chat_reply[_stream]`) take a `lang` argument (en/hi/mr/ta).
- **`live_data.py` never fabricates.** Data is real and carries its `source`, or the call raises `LiveDataError` (router: 503). Its only network seam is `_request`; keep it that way so tests can stub it (the autouse fixture in `tests/conftest.py` does). Successes are cached in-process and in `db.live_cache` (`_cached`, `live_cache_persist`), so a restart doesn't lose them; `reset_all()` deliberately never clears that table. On upstream failure the last good value is served with `stale: True`. Weather "signals" are transparent threshold rules and their `reason` must state the rule that fired (a test enforces this for floods). The network's own facilities are synthetic: keep `synthetic: True` on them. `data.gov.in`'s sample key silently caps each page (~10 rows) regardless of `limit`; paginate with `_data_gov_in_records`, never a single `_request` call.
- **`weather_impact.py` never makes a scenario look better than the real baseline** (the `min()` clamp / `_worsened` check) and never mutates `store`; it re-derives forecasts via `forecasting.days_to_stockout_from_demand`/`risk_for` on scaled demand, it doesn't touch stock levels.
- **Authorization** lives only in `auth.py` (`get_current_user[_optional]`, `authorize_transfer`, `USERS` roster, `require_console_access`). Add new roles there, not in routers. Two `auth_mode`s share this file: `"demo"` reads `X-User-Id` against `USERS` with no check beyond membership; `"token"` requires a valid JWT from `create_token`/`decode_token` and re-reads `db.user_get` on every request (so a deactivated account is cut off immediately, not just at its next login). Never let the demo header work when `auth_mode == "token"` — `get_current_user`/`get_current_user_optional` already branch on `token_mode()` for this; don't add a second code path that checks the header directly.

## Patterns
To add a state-changing operation: mutate `store` globals → persist via the matching `store.save_*` → record through `db.record_*` or `db.log_event` → `clear_forecast_cache()` → add a `synthetic_facility`-based test (see `../../tests/conftest.py`).

## Related Context
- Data model and resource registry: `../data/resource_types.py`
- HTTP layer: `../routers/`, versioned external schemas: `../schemas/interop.py`
- Project-wide invariants: `/CLAUDE.md`
