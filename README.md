# SetuHealth — Federated National PHC Resource Grid

A federated AI platform for national-scale health resource and supply chain
management: real-time visibility into medicine stock, bed availability, and
staff attendance across a country's Primary Health Centre (PHC) network —
with predictive stockout forecasting, automated cross-district redistribution
recommendations, a multilingual/voice GenAI assistant, and a federated
learning layer designed to extend shared predictive modelling across BRICS
nations without any facility- or patient-level data crossing a border.

## Brief description

SetuHealth gives national health ministries real-time, forecasted visibility
into every PHC's medicine stock, beds, and staff — flagging stockouts before
they happen and recommending exactly which facility should send supplies to
which. A federated layer lets states, and eventually BRICS partner nations,
share only aggregated model statistics, never raw records.

## Architecture

```
frontend/  React + TypeScript + Vite + Tailwind + Recharts + Leaflet
backend/   FastAPI (Python) — data, forecasting, redistribution, federated
           aggregation, and Gemini-powered GenAI endpoints
```

```mermaid
flowchart TB
    subgraph SRC["Data Sources"]
        RHS["Rural Health Statistics\n(NHM district PHC counts)"]
        NLEM["NLEM essential medicines list"]
    end

    subgraph GEN["Data Generation (one-time)"]
        GENPY["generate_data.py\n(deterministic synthetic 90-day dataset)"]
        JSON[("generated/*.json\nphcs, stock, beds, staff")]
    end

    subgraph BACKEND["Backend — FastAPI"]
        STORE["services/store.py\nin-memory store\n(single source of truth)"]
        FORECAST["services/forecasting.py\nHolt's Linear Exp. Smoothing\n(+ moving-avg fallback, surge detection)"]
        REDIST["services/redistribution.py\nPuLP LP optimizer\n(deficit vs surplus, haversine cost)"]
        FED["services/federated.py\nstate to national to BRICS\naggregated priors"]
        GENAI["services/genai.py\nGemini GenAI\n(mock fallback, no key needed)"]
        ROUTERS["routers/*.py\nREST endpoints under /api/*"]
    end

    subgraph FRONTEND["Frontend — React + Vite"]
        API["lib/api.ts (axios client)"]
        PAGES["Dashboard / StateView / PHCDetail\nFederated / Transfers / Assistant"]
    end

    USER(["User"])

    RHS --> GENPY
    NLEM --> GENPY
    GENPY --> JSON
    JSON --> STORE

    STORE --> FORECAST --> REDIST
    STORE --> FED
    STORE --> GENAI
    FORECAST --> ROUTERS
    REDIST --> ROUTERS
    FED --> ROUTERS
    GENAI --> ROUTERS

    ROUTERS <--> API
    API --> PAGES
    PAGES --> USER

    USER -- "execute transfer / trigger crisis" --> PAGES
    PAGES -- "POST /api/transfers, /api/crisis" --> API
    API --> ROUTERS
    ROUTERS -- "mutate + invalidate forecast cache" --> STORE
```

- **Data**: a deterministic synthetic dataset (`backend/app/data/generate_data.py`)
  of 150+ PHCs across 6 real Indian states / 24 districts, 12 essential
  medicines (from India's NLEM), and 90 days of daily stock / bed / staff /
  OPD-footfall history with realistic seasonal demand spikes (e.g.
  anti-malarials in monsoon) and a subset of facilities deliberately under
  supply stress — so forecasting and redistribution have real signal to act
  on. Two things are grounded in published sources rather than invented:
  per-district facility counts are generated proportionally from the real
  number of functioning PHCs in each district (Ministry of Health & Family
  Welfare / NHM [Rural Health Statistics — District-wise Availability of
  Health Centres](https://www.nhm.gov.in/images/pdf/monitoring/rhs/district-wise-health-centres.pdf),
  `reference.py::REAL_PHC_COUNTS`, scaled to 10% for demo speed), and
  per-medicine daily consumption is drawn around published mean/std anchors
  from NHSRC DLMIS 2022-23, WHO/UNICEF India PHC benchmarks, the ICMR NCD
  Survey and NVBDCP indent data (`reference.py::REAL_CONSUMPTION_ANCHORS`).
  A handful of facilities are also given a deliberate consumption-vs-footfall
  inconsistency over the trailing 21 days for the anomaly detector to surface.
  The same generator scales linearly to the full real counts (and the full
  ~1.6 lakh PHC network) given real operational data feeds.
- **Forecasting** (`backend/app/services/forecasting.py`): fits Holt's Linear
  Exponential Smoothing (statsmodels, additive trend) over each PHC/medicine's
  consumption history to project 14 days ahead, falling back to a trailing
  14-day moving average when history is too short or the fit fails —
  computing days-to-stockout and flagging `critical` (≤7 days) / `warning`
  (≤14 days) risk, plus separate surge detection comparing recent vs baseline
  consumption. It also returns a **±1σ prediction interval** (from in-sample
  RMSE) that the PHC-detail chart renders as an uncertainty band around the
  stockout line. Results are cached and invalidated whenever the store mutates.
- **Redistribution** (`backend/app/services/redistribution.py`): solves a
  linear program (PuLP, CBC solver) per medicine that splits PHCs into
  deficit and surplus pools and picks transfers minimizing unmet deficit and
  haversine-distance transport cost (with penalties for cross-district/
  cross-state moves), capped by what the donor can spare and what the
  recipient needs. Every recommended transfer can be expanded into a
  Gemini-written justification (deficit size, spare units, distance, urgency).
  The same nearest-surplus matching also covers **bed overflow and staff
  shortages**, not just medicine (`recommend_capacity`).
- **Consumption-integrity detection** (`backend/app/services/anomaly.py`):
  reconciles each PHC's medicine drawdown against its OPD patient footfall
  over a trailing 21-day window and flags facilities whose ratio is a robust
  outlier (median/MAD z-score) — `over_consumption` (possible pilferage or
  write-offs booked as dispensing) or `under_reporting` (registers not kept).
  The generator seeds a handful of such inconsistencies; the detector
  rediscovers them from the network distribution alone.
- **Federated layer** (`backend/app/services/federated.py`): each state node
  computes local category-level summary statistics; the national server
  federated-averages them (weighted by facility count) into a national
  prior. The same mechanism is demonstrated combining with synthetic partner
  nodes (Brazil, South Africa, and observer nations) into a BRICS-wide
  shared prior — only aggregates ever cross a node boundary.
- **GenAI** (`backend/app/services/genai.py`): Google Gemini generates
  plain-language stockout explanations, transfer justifications, and anomaly
  investigator notes, and powers a chat assistant answering questions about
  the live network — in English, Hindi, Marathi or Tamil (same scaffolding
  extends to any language), with browser-based voice input/output. Runs in a
  graceful offline mock mode with no API key so the app is fully demoable
  before a key is provisioned.
- **Persistence** (`backend/app/services/db.py`): the in-memory store stays
  the hot read path, but executed transfers, the crisis log, and a full audit
  trail of every state mutation are written to a SQLite database — so an
  active crisis, the transfer ledger, and the audit history all survive a
  backend restart. The audit trail is visible on the Transfers page.

## Running locally

### One command (Docker)

```bash
cp .env.example .env   # optional: add GEMINI_API_KEY for live answers
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend + API docs: http://localhost:8000/docs

The backend's generated dataset and SQLite ledger live on a named volume, so
transfers, the crisis log and the audit trail persist across
`docker compose down`.

### Backend (without Docker)

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 -m app.data.generate_data   # builds the synthetic dataset (one-time)
cp .env.example .env                # optionally add GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173 (expects the API at `VITE_API_URL`, default
`http://localhost:8000` — see `frontend/.env`)

### Enabling live Gemini responses

Get a free key from [Google AI Studio](https://aistudio.google.com/apikey),
then set `GEMINI_API_KEY` in `backend/.env` and restart the backend. No code
changes needed — `app/services/genai.py` detects the key automatically and
switches from mock to live responses.

## Scaling across India (and BRICS)

- PHC data model and reference lists (`backend/app/data/reference.py`) are
  state/district-agnostic — adding a new state is adding entries to a dict,
  not new code.
- The federated aggregation layer is designed so a real state health
  department's server would run the same local-summary computation and push
  only aggregates upward — the national/BRICS endpoints already consume that
  shape.
- Deployment target: containerized FastAPI + static frontend, deployable to
  any state's own infrastructure or a shared national cloud (see
  `backend/Dockerfile`, `frontend/Dockerfile`).
