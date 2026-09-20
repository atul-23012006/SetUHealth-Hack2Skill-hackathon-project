# SetuHealth Interoperability Guide

This page is for an external integrator — a state health IT department, a
partner logistics system (e-Aushadhi, eVIN), or a hospital's own ERP —
evaluating whether to pull data out of SetuHealth without adopting the
platform wholesale. That is the actual design goal here, in the spirit of
OpenLMIS: publish a neutral, versioned data contract so any system can plug
in over a plain HTTP GET, instead of everyone re-building stock-tracking and
stockout forecasting from scratch.

Three endpoints, all under `/api/export/`, all unauthenticated GETs, all
documented interactively at `/docs` (FastAPI's auto-generated OpenAPI UI) on
any running instance:

| Endpoint | Format | What it is |
|---|---|---|
| `GET /api/export/alerts.json` | JSON, `StockoutAlertV1[]` | Every facility/resource pair currently at elevated stockout risk |
| `GET /api/export/transfers.json` | JSON, `TransferRequestV1[]` | Every open redistribution recommendation from the LP optimizer |
| `GET /api/export/dhis2-adx` | XML, DHIS2 ADX | State-level resource depletion rates, in DHIS2's aggregate exchange format |

All three are read from the exact same live in-memory state the officer
console renders — there is no separate "export snapshot" job or stale cache
to fall out of sync.

## Why two JSON schemas and one XML format

The two JSON schemas are the same idea OpenLMIS applies to logistics: a
**stockout alert** and a **transfer request** are the two objects any
resource-logistics system fundamentally needs to exchange, so those are
exactly what's published. The DHIS2 ADX export exists because DHIS2 is
already the dominant national health information system across dozens of
countries — a state DHIS2 instance can pull SetuHealth's depletion-rate
aggregates into its own dashboards using a format it already understands
natively, with zero custom parsing.

## StockoutAlertV1

One object per (facility, resource) pair currently at `"warning"` or
`"critical"` risk. There is no separate "resolved" event — an alert simply
stops appearing in the next call once risk returns to `"low"`.

```json
{
  "schema_version": "1.0",
  "alert_id": "PHC-0001:cotrimoxazole_syrup",
  "facility_id": "PHC-0001",
  "facility_name": "Pune PHC 1",
  "facility_type": "PHC",
  "state": "Maharashtra",
  "district": "Pune",
  "resource_id": "cotrimoxazole_syrup",
  "resource_name": "Cotrimoxazole Syrup",
  "resource_category": "antibiotic",
  "unit": "bottle",
  "current_level": 14.7,
  "reorder_level": 18.0,
  "capacity": 73.0,
  "days_to_stockout": 0.0,
  "risk_level": "critical",
  "daily_depletion_rate": 4.25,
  "forecast_method": "exponential_smoothing",
  "generated_at": "2026-09-20T08:39:28.241786Z"
}
```

Field notes:

- **`facility_id`** — SetuHealth's internal id (`PHC-0001`, `BLD-0002`,
  `DH-0003`, ...). Not a national facility registry id; if you need to
  reconcile against your own facility master, match on `facility_name` +
  `district` + `state` until a shared identifier scheme exists.
- **`facility_type`** — one of the network's registered facility types
  (`PHC`, `Blood_Bank`, `District_Hospital` today — see
  `app/data/resource_types.py` for the authoritative, extensible list).
- **`resource_id`** — a stable slug (`paracetamol_500mg`,
  `blood_unit_o_negative`, ...), independent of the display name, so a
  rename of `resource_name` doesn't break a client's mapping table.
- **`days_to_stockout`** — `null` means the 14-day forecast horizon ends
  without a projected breach of `reorder_level`, not that the facility is
  safe indefinitely.
- **`forecast_method`** — `"exponential_smoothing"` (Holt's linear trend
  model, the normal case) or `"fallback"` (a trailing moving average, used
  when there isn't enough consumption history to fit a trend model).

## TransferRequestV1

One object per open recommendation from the redistribution optimizer — a
suggestion, not a record of something that has happened. `status` is always
`"recommended"` today.

```json
{
  "schema_version": "1.0",
  "request_id": "PHC-0097:PHC-0107:ors_sachets",
  "status": "recommended",
  "resource_id": "ors_sachets",
  "resource_name": "ORS Sachets",
  "unit": "packet",
  "quantity": 72.0,
  "origin_facility_id": "PHC-0097",
  "origin_facility_name": "Jodhpur PHC 6",
  "origin_state": "Rajasthan",
  "origin_district": "Jodhpur",
  "destination_facility_id": "PHC-0107",
  "destination_facility_name": "Bikaner PHC 2",
  "destination_state": "Rajasthan",
  "destination_district": "Bikaner",
  "distance_km": 189.7,
  "cross_state": false,
  "urgency": "critical",
  "generated_at": "2026-09-20T08:39:49.205280Z"
}
```

**This is a different object from an executed transfer.** Once an officer
executes a recommendation through the console, it becomes a ledger entry
with its own, already-existing export: `GET /api/fhir/transfer/{id}`, a FHIR
R4 `SupplyRequest` resource. `TransferRequestV1` deliberately doesn't cover
that case in this version — a future `TransferRequestV2` could unify the
two, but V1 keeps "open recommendation" and "executed transfer" as separate,
unambiguous concepts rather than overloading one schema with two meanings.

## DHIS2 ADX export

`GET /api/export/dhis2-adx` returns an XML document in DHIS2's ADX
(Aggregate Data Exchange) format — `urn:ihe:qrph:adx:2015`, the same profile
DHIS2's own `/api/dataValueSets` endpoint accepts as `application/xml+adx`.
One `<group>` per state, one `<dataValue>` per resource category, valued at
that state's federated-averaged daily depletion rate for the category (the
same numbers `GET /api/federated/national` already serves as JSON).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<adx xmlns="urn:ihe:qrph:adx:2015" exported="2026-09-20T08:40:18Z">
  <group orgUnit="QgaUfFZq7U4" period="2026-09-01/P1M" dataSet="JmPbbC3kuWs">
    <dataValue dataElement="E4VMK6NwwD6" value="1.064"/>
    <dataValue dataElement="cf3KcYrhzm0" value="2.617"/>
    ...
  </group>
  ...
</adx>
```

This satisfies the ADX profile's mandatory structure: `orgUnit`, `period`,
and `dataSet` are required on every `<group>` (ADX groups data values by
exactly these three, unlike DHIS2's older DXF2 format); `dataElement` and
`value` are required on every `<dataValue>`; and `period` is encoded the way
ADX requires — ISO 8601 `(date)/(duration)`, e.g. `2026-09-01/P1M` for
"the month of September 2026" — rather than DHIS2's internal period-code
shorthand (`202609`). This is checked automatically:
`backend/tests/test_export.py::test_dhis2_adx_export_is_structurally_valid`
parses the response and asserts every one of the rules above, plus that
`orgUnit`/`dataSet`/`dataElement` are shaped like real DHIS2 UIDs (11
characters, first a letter).

**What "schema-valid" means here, precisely.** This demo has no DHIS2
instance to actually import into, so there is no official DHIS2 database
behind `orgUnit`/`dataSet`/`dataElement` — those are deterministic
placeholder ids (see `_dhis2_uid()` in `app/routers/export.py`), not real
metadata UIDs from any DHIS2 instance. What is genuinely true, and what the
test above checks: the document is well-formed, in the correct namespace,
with every attribute the ADX profile requires present and correctly
encoded. **Connecting this to a real DHIS2 instance is a one-time mapping
step**, not a code change: resolve your instance's actual org unit UIDs for
these six states and data element UIDs for these nine resource categories
via its metadata API (`GET /api/organisationUnits`, `GET /api/dataElements`
on your DHIS2 instance), then substitute them for the placeholders — the
document structure itself does not change. The placeholder ids are stable
across calls (the same state or category always maps to the same id), so a
mapping table built once stays valid.

The period always reflects the calendar month the export was generated in.
SetuHealth's depletion rates are a live current-state figure, not a closed
monthly reporting-period submission the way DHIS2's own facilities usually
report — that distinction matters if you're reconciling against a real
DHIS2 dataset that expects a specific reporting-period cutoff.

## Versioning

Every JSON object carries `schema_version` (currently `"1.0"` on both
schemas). A change to a field an integrator might already depend on ships
as a new class (`StockoutAlertV2`) and, if the response shape actually
differs, a new endpoint — never a silent change to what `"1.0"` means. The
ADX export doesn't carry an explicit version field (ADX itself doesn't
define one), so a breaking change there would move to a new path
(`/api/export/dhis2-adx-v2`).

## Authentication

None, today. Every `/api/export/*` endpoint is a plain GET, matching the
rest of this demo's read endpoints (see `app/routers/`). A production
deployment integrating with an external state system would put these
behind the same kind of API-key or OAuth2 client-credentials flow any
public health data exchange uses — that's infrastructure this demo doesn't
claim to have built, not a property of the schemas or export format
themselves.
