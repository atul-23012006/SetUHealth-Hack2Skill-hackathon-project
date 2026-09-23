# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SetuHealth: a federated national PHC (Primary Health Centre) resource grid. FastAPI backend (`backend/`) + React/TypeScript/Vite frontend (`frontend/`). Everything runs on a deterministic synthetic dataset; no real data source is connected.

## Commands

Backend (run from `backend/`, Python 3.12, venv at `backend/.venv`):

```bash
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000                  # API docs at /docs
python -m pytest tests -q                                  # full suite (~30s, 137 tests)
python -m pytest tests/test_dispatch.py -q                 # one file
python -m pytest tests/test_dispatch.py -q -k <name>       # one test
python -m app.data.generate_data                           # rebuild the synthetic dataset
```

Frontend (run from `frontend/`):

```bash
npm install            # or `npm ci` — package-lock.json is authoritative
npm run dev            # Vite on :5173 (falls to 5174+ if taken); API URL from VITE_API_URL, default http://localhost:8000
npm run build          # `tsc -b && vite build` — this is the typecheck; there is no separate one
npm run lint           # oxlint (not ESLint). Currently reports warnings in Dashboard/StateView/Explore/PublicStateDetail, no errors
npm test               # vitest run — unit/component tests (src/**/*.test.{ts,tsx}), jsdom
npm run test:e2e       # playwright — e2e/*.spec.ts against the REAL running app (see e2e/README.md: both dev servers must already be up)
npm run typecheck:test # tsc -p tsconfig.vitest.json — tests have their own tsconfig so vitest/RTL types never affect `npm run build`
```

Full stack: `docker compose up --build` → frontend :8080, backend :8000.

`GEMINI_API_KEY` (in `backend/.env`) is optional. Without it `services/genai.py` returns deterministic mock text, so the whole app and all tests work offline. Configurable via `app/config.py` / `.env`: `gemini_api_key` (+ `gemini_model`/`gemini_fallback_model`, `auth_mode` ("demo" default, or "token" — see below), `jwt_secret`/`token_ttl_hours`/`demo_user_password` for token mode, `cors_origins` (default `["*"]`), `live_data_enabled` (`LIVE_DATA_ENABLED=false` makes every `/api/live/*` feed return 503, for offline demos), `data_gov_in_api_key` (defaults to data.gov.in's own published sample key), and `signal_polling_enabled`/`signal_poll_minutes`/`alert_webhook_url` for the live-signal alert poller.

## Backend architecture

Request path: `routers/*.py` (thin, mounted in `app/main.py` under `/api/*`) → `services/*.py` → `services/store.py`.

- **`services/store.py` is the single source of truth.** It loads `backend/app/data/generated/*.json` into module-level globals at import time (`PHCS`, `PHC_BY_ID`, `STOCK_HISTORY`, `BED_HISTORY`, `STAFF_HISTORY`, `FOOTFALL_HISTORY`, `MEDICINES`) and builds the dataset first if any file is missing. Services read those globals directly; mutations (transfers, crises) edit them in place and mirror back to JSON with `save_*_history()`.
- **Any mutation of stock data must call `forecasting.clear_forecast_cache()`** — forecasts are cached and only invalidated explicitly.
- **Two persistence layers.** Histories live in JSON files; the transactional ledger (transfers, crisis log, audit trail) lives in SQLite (`generated/setuhealth.db`, `services/db.py`) so it survives restarts. Both are under `backend/app/data/generated/`, which is gitignored and is the Docker named volume. Transfers, crises and resets reach the audit trail through `db.record_transfer`/`record_crisis`/`db.log_event`; a new state-mutating path should do the same.
- **Generic resource model.** `PHCS` is really a *facility* roster (each record has `facility_type`; filter with `store.phcs_in_state(..., facility_type=...)`; it treats a missing type as `PHC`), and `STOCK_HISTORY` is keyed by resource `display_name`, not just medicine. Forecasting, anomaly detection, redistribution and federation know only about `ResourceType`s defined in `app/data/resource_types.py`; adding a resource type means appending one entry there and nothing else. The `medicine` field in API payloads is the resource display name. `MEDICINES` stays medicine-only because it backs the clinical UI.
- **Engines** (`services/`): `forecasting.py` (Holt's linear smoothing via statsmodels, moving-average fallback, ±1σ band), `redistribution.py` (PuLP/CBC LP per resource; `recommend_capacity` covers beds/staff), `anomaly.py` (median/MAD outlier on consumption vs footfall), `federated.py` (state → national → BRICS averaging of aggregate summaries), `transfers.py` (executes a move, logs it, invalidates cache), `dispatch.py` (`LogisticsProvider` interface with one simulated implementation).
- **Auth is a demo shim, not a login.** The frontend picks an identity from the fixed roster in `services/auth.py` and sends it as an `X-User-Id` header on every request. Transfer authorization (`authorize_transfer`) keys off role: `phc_operator` (own facility), `state_coordinator` (own state), `national_admin`. Callers depend only on `get_current_user[_optional]`/`authorize_transfer`, so a real IdP can replace `USERS`.
- **`routers/public.py`** is the only unauthenticated router and the only one rate limited (slowapi); it serves the read-only Public Portal. `routers/export.py` + `schemas/interop.py` publish versioned neutral schemas (`*V1`) and `routers/fhir.py` a FHIR SupplyRequest. Keep those schemas versioned rather than editing them in place.
- **Real-world data** (`services/live_data.py`, `routers/live.py`, `/api/live/*`): keyless public APIs proxied and cached by the backend — Open-Meteo (weather, air quality, geocoding), World Bank (BRICS health indicators), OpenStreetMap via Overpass (real facilities), data.gov.in (official but historical state-wise PHC/Sub-Centre/CHC counts, `facility_count_benchmarks` — paginate with `_data_gov_in_records`, the sample API key caps each page at ~10 rows regardless of the `limit` param, silently). Every response carries its `source`; an unreachable feed is a 503, never a made-up fallback. Successes are cached in-process AND in `db.live_cache` (`live_cache_persist`) so a restart doesn't lose them; `reset_all()` deliberately never touches that table. All network I/O goes through the one function `live_data._request`; `tests/conftest.py` stubs it for every test (autouse), so tests never touch the internet — fake it over that seam to test a feed. Only the network's own facilities are synthetic and are flagged `synthetic: true`.
- **Assistant** (`routers/assistant.py`, `services/genai.py`): chat (`/chat`, one-shot) and streaming (`/chat/stream`, SSE) replies, plus `parse_chat_action` → `execute_action`, which can run a transfer from natural language under the same authorization check. `genai.py` uses the `google-genai` SDK (not the deprecated `google-generativeai`), tries `gemini_model` then `gemini_fallback_model` with one capped retry on 429/503, and puts a model in a short cooldown after it fails so a stalled model isn't retried on every request.
- **Weather-as-demand scenario** (`services/weather_impact.py`): a pure overlay — takes the real signals from `live_data.state_weather()`, applies a small, transparent table of planning-assumption multipliers (`RULES`) to specific medicines in the affected states, and re-runs `forecasting.days_to_stockout_from_demand`/`risk_for` on the adjusted demand. Never mutates `store`; `?weather_adjusted=true&intensity=` on `/api/alerts` and `/api/redistribution` opts into it, and `/api/live/impact` returns the full comparison. A scenario result can never show a *better* outcome than the real baseline (see `_worsened`/the min() clamp).
- **Live-signal alerts** (`services/signal_alerts.py`): a background task (started from `app/main.py`'s lifespan, `signal_polling_enabled`) polls `live_data.state_weather()` and fires exactly once per signal's transition into `"high"` (tracked in `db.signal_state`), storing a notification (`db.notifications`) and optionally POSTing to `alert_webhook_url`. `/api/notifications/*` (auth-gated in token mode) serves them to the frontend's `NotificationBell`.
- **Auth has two modes** (`services/auth.py`, `auth_mode` setting): `"demo"` (default) is header-only (`X-User-Id` against the fixed `USERS` roster, unsafe anywhere real) — unchanged from before. `"token"` requires a real sign-in: scrypt-hashed passwords seeded from the same roster into `db.users` (`ensure_seeded`, `DEMO_USER_PASSWORD` or a logged-once random one), short-lived signed JWTs (`create_token`/`decode_token`), and every console router wrapped with `Depends(auth.require_console_access)` in `main.py` (`/api/public`, `/api/auth`, `/api/live`, `/api/export`, `/api/health` stay open). Manage accounts with `python -m app.scripts.manage_users` (list/set-password/activate/deactivate). `authorize_transfer`'s role logic is identical in both modes.

### Test gotcha

`tests/conftest.py`'s `synthetic_facility` fixture injects throwaway facilities into the live `store` globals. Any test that executes a transfer calls `save_stock_history()`, which writes the *entire* in-memory store to `generated/stock_history.json`; the fixture re-saves after cleanup so test facilities don't persist on disk. Use the fixture rather than mutating `store` by hand.

## Frontend architecture

- `src/App.tsx` defines two route trees: the authenticated officer console under `Layout` (`/`, `/states/:state`, `/phcs/:id`, `/medicines/:medicine/states/:state`, `/federated`, `/transfers`, `/assistant`) and the public portal under `PublicLayout` (`/public`, `/public/states/:state`).
- All backend access goes through `src/lib/api.ts` (one axios client, types in `lib/types.ts`). An interceptor reads the acting user from `localStorage` on every request and sets `X-User-Id` via `config.headers.set(...)` — plain property assignment on axios headers silently does nothing.
- i18n is hand-rolled and split across two files that get merged into one lookup: `lib/i18n.ts` (older console strings) and `lib/i18nUi.ts` (everything added for the real-data UI, auth, notifications — has full en/hi/mr/ta parity, checked by `lib/i18n.test.ts`). `useLang()` from `LangContext` gives `t(key, vars?)` with `{name}` placeholder interpolation; missing keys fall back English, then to the raw key.
- Guided tours: one per route, defined in `lib/tours.ts` (each step is a CSS selector for an element id the page renders). `components/TourButton.tsx` is mounted in both layouts keyed by pathname, waits for the page's data and entrance animations, and silently skips steps whose target isn't on screen.
- Design system lives in `index.css`: `.card`, `.page-title`, `.page-enter`/`.stagger` entrance animation, `.skeleton`, brand + gold tokens. Entrance animations must use `backwards` fill mode, never `both`/`forwards`: a lingering `transform` makes every section a stacking context that paints over dropdowns overflowing from the section above.
- Maps use `components/BaseTiles.tsx` (Esri Light Gray, key-free). The CARTO basemap it replaced now returns an "API KEY REQUIRED" watermark.
- Real-data UI: `LiveSignalsPanel` + `WeatherImpactPanel` (Dashboard), `pages/Explore.tsx` (`/explore`), `BenchmarkExplorer` + `FacilityCountBenchmark` (Federated), `NotificationBell` (header, both layouts). Ctrl/Cmd+K opens `CommandPalette`. `lib/useAsync.ts` ignores stale responses.
- `AuthContext` mirrors the backend's two modes: demo mode's "acting as" picker is unchanged; token mode shows `SignInPage` in place of the console (`Layout.tsx`'s `gated`) until `login()` resolves, and a global `401` response dispatches `SIGNED_OUT_EVENT` (see `api.ts`) so any request can force a re-sign-in, not just the auth calls.
- Tests: `src/**/*.test.{ts,tsx}` (vitest + Testing Library, jsdom) sit next to the code they test; `src/test/setup.ts` stubs `matchMedia`/`IntersectionObserver`/`ResizeObserver`/`localStorage`. `vitest.config.ts` forces `pool: 'forks'` — the thread pool was observed leaking fake-timer/global stubs (StatCard's `vi.useFakeTimers`) into unrelated test files ("document is not defined"). `e2e/*.spec.ts` (Playwright) drive the real running app with no mocks — see `e2e/README.md`.
- PWA: `public/sw.js` (cache name `setu-health-v3`, bump it when changing cached assets), `manifest.json`, `InstallPrompt.tsx`. Hero orb (`HeroOrb.tsx`, react-three-fiber) is lazy-loaded with a static PNG fallback.
- Styling is Tailwind v4 via `@tailwindcss/postcss`; icons are `lucide-react`; maps are Leaflet with marker clustering.

## Project invariants

From `CONTRIBUTING.md`, these apply to every change:

- **Never present a simulated integration or synthetic figure as real.** Simulated things (dispatch provider, BRICS partner nodes, placeholder DHIS2 UIDs, seeded anomalies) are labelled as simulated in code, the audit log, and the UI. Only the 12 NLEM medicines' consumption anchors and district PHC counts are sourced (`data/reference.py`).
- **Aggregate-only privacy boundary.** Only category-level summaries (e.g. `state_summary()`) may cross a federation node boundary; no facility or patient record may appear in a node summary. `federated.py`'s module docstring is the invariant.
- Before a PR: `python -m pytest tests -q` in `backend/`; `npm run build && npm test` in `frontend/` (and `npm run test:e2e` if both dev servers are up).
- CONTRIBUTING references `SETUHEALTH_NEXT_LEVEL_PLAN.md` for the full guardrails list; that file is not in the repo.

Further docs: `docs/INTEROP.md` (external-system integration), `docs/GOVERNANCE.md` (AGPL-3.0 rationale), `README.md` (architecture diagram and data/model provenance).

## Intent Layer

**Before modifying code in a subdirectory, read its AGENTS.md first** to understand local patterns and invariants.

- **Backend services** (state mutation, cache invalidation, transfers, dispatch, federation isolation): `backend/app/services/AGENTS.md`
- **Frontend pages** (route components, guided-tour selectors, offline transfer queue): `frontend/src/pages/AGENTS.md`

Global invariants: see "Project invariants" above. CLAUDE.md is the only root context file; do not add a root AGENTS.md.
