# Frontend Pages

## Purpose
One component per route (see `../App.tsx`): the authenticated officer console (Dashboard, StateView, PHCDetail, MedicineStateDetail, Federated, Transfers, Assistant) and the two unauthenticated public-portal pages (PublicPortal, PublicStateDetail). Pages fetch data and compose components from `../components/`; they do not talk to the network except through `../lib/api.ts`.

## Entry Points
- `Dashboard.tsx` - the largest page (~740 lines, most API calls): national map, stat cards, crisis simulation ("Demo Mode"), alerts, redistribution.
- `Transfers.tsx` - transfer ledger plus audit log; FHIR download.
- `PublicPortal.tsx` / `PublicStateDetail.tsx` - read-only portal using only the `api.public*` calls.

## Contracts & Invariants
- **All backend calls go through `../lib/api.ts`.** Never create a second axios client; the interceptor there attaches `X-User-Id`.
- **Guided-tour selectors are hard-coded.** Every route has a tour in `../lib/tours.ts`; each step's `target` is a CSS selector for an element id in these pages (e.g. `#national-map`, `#live-signals`, `#fed-benchmarks`, `#explore-map`, `#public-orb`) or a `Layout` nav link (`a[href="/federated"]`). Renaming or removing one silently drops that step (no type or build error), so when you change an id, grep `tours.ts`. A new route needs a tour entry there too.
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
