# Frontend Pages

## Purpose
One component per route (see `../App.tsx`): the authenticated officer console (Dashboard, Insights, StateView, PHCDetail, MedicineStateDetail, Federated, Transfers, Assistant) and the two unauthenticated public-portal pages (PublicPortal, PublicStateDetail). Pages fetch data and compose components from `../components/`; they do not talk to the network except through `../lib/api.ts`.

## Entry Points
- `Dashboard.tsx` - daily triage only: national map, stat cards (with crisis-simulation deltas), the crisis simulator trigger, active-crisis banner, alerts, redistribution, "Demo Mode". Everything not needed to answer "what's short and who should send what, right now" lives elsewhere — see the note at the top of `Dashboard.tsx`'s JSX before adding a section back here.
- `Insights.tsx` - scenario tools and secondary signals moved off Dashboard: a simulated crisis's before/after detail (`CrisisImpactPanel`), `LiveSignalsPanel`/`WeatherImpactPanel` (real weather, the what-if overlay), consumption anomalies, bed/staff capacity redistribution, and the medicines reference. Has no crisis simulator of its own — `LiveSignalsPanel`'s "load into simulator" hands off to Dashboard via `?simState=&simCrisis=` query params, which Dashboard reads once on mount and clears with `history.replaceState`.
- `Federated.tsx` - also fetches `phcs`/`forecastAll`/`redistribution` to render the SDG 3.8 panel (moved here from Dashboard as a national-reporting rollup), in addition to its federated-prior content.
- `Transfers.tsx` - transfer ledger plus audit log; FHIR download.
- `PublicPortal.tsx` / `PublicStateDetail.tsx` - read-only portal using only the `api.public*` calls.

## Contracts & Invariants
- **All backend calls go through `../lib/api.ts`.** Never create a second axios client; the interceptor there attaches `X-User-Id`.
- **Guided-tour selectors are hard-coded.** Every route has a tour in `../lib/tours.ts`; each step's `target` is a CSS selector for an element id in these pages (e.g. `#national-map`, `#live-signals`, `#fed-benchmarks`, `#explore-map`, `#public-orb`) or a `Layout` nav link (`a[href="/federated"]`) — those links now render from `NAV_ITEMS` in the left sidebar (`Layout.tsx`), not a horizontal bar, but the `href`s and hence the selectors are unchanged. Renaming or removing one silently drops that step (no type or build error), so when you change an id, grep `tours.ts`. A new route needs a tour entry there too, and a `NAV_ITEMS` entry (plus an `i18nUi.ts` `nav.<key>` label in all four languages) if it belongs in the sidebar.
- **Older console pages use `useLang()`; public pages and the newer real-data UI (`Explore`, `LiveSignalsPanel`, `BenchmarkExplorer`) do not** and render English-only strings. Translated strings come from `../lib/i18n.ts` (English keys first; other languages fall back to English).
- **`Explore` mixes real and synthetic data and must keep them visibly distinct** (real OSM facilities = blue squares, badge "real"; network facilities = risk-coloured dots, badge "synthetic"). It syncs the chosen place to the URL (`?lat=&lon=&name=`).
- **Public pages must only use `api.public*`.** Those endpoints return aggregates only; do not add per-facility data or call authenticated endpoints from `Public*.tsx`.
- **Crisis polling:** Dashboard polls `api.activeCrises()` every 5 s only while `activeCrises.length > 0`. Changing that effect's dependency affects whether polling stops after a crisis ends.
- **Offline transfers:** while offline, `api.executeTransfer` queues to `localStorage["offline_transfers"]` (status "Pending (Offline)") and sends a best-effort `sendBeacon` breadcrumb that does not apply the transfer. `syncOfflineTransfers` replays the queue when back online. It keeps entries on network errors, 5xx, 408, 429 and 401/403 (the operator may not have picked an identity yet); any other 4xx (e.g. a quantity above the donor's stock) moves the entry to `localStorage[REJECTED_KEY]` with the server's reason, and `Layout` shows it in a dismissible banner.

## Patterns
To add a page: create it here, add the API method and types in `../lib/api.ts`/`../lib/types.ts`, register the route under the right layout in `../App.tsx`, and add nav text keys to `../lib/i18n.ts` if it appears in the console nav.

## Anti-patterns
- Don't call `setState` synchronously inside an effect or omit hook dependencies; `npm run lint` already warns about this in `Dashboard.tsx` (existing debt, don't add to it).
- Don't hand-set headers with property assignment on axios config (use `.set()`); see the note in `../lib/api.ts`.

## Related Context
- API client, types, i18n, auth context: `../lib/`
- Shared components (map, lists, tour, PWA install): `../components/`
- Project-wide invariants: `/CLAUDE.md`
