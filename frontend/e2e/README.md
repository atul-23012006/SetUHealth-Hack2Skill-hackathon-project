# End-to-end tests

Real-browser tests against the running app — no mocks. Requires **both** dev
servers already running (demo auth mode, the default):

```bash
# terminal 1
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm run dev             # http://localhost:5174 (or :5173)
# terminal 3
cd frontend && npm run test:e2e
```

If the frontend dev server picked a different port (5173 vs 5174 etc.),
override it: `E2E_BASE_URL=http://localhost:5173 npm run test:e2e`.

These tests read live data (the demo dataset, and — for the weather/benchmark
specs — real Open-Meteo/World Bank/OpenStreetMap responses the backend
proxies). A spec that depends on the real feed being reachable skips itself
with a clear reason if that feed is down, rather than failing the whole run.
