"""Open interoperability export endpoints — the OpenLMIS mechanism: a
published, neutral data contract any external system can consume with a
plain unauthenticated GET, without adopting SetuHealth wholesale. See
docs/INTEROP.md for the integrator-facing writeup of both formats below.
"""
import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Response

from app.schemas.interop import StockoutAlertV1, TransferRequestV1
from app.services import federated, forecasting, redistribution, store

router = APIRouter(prefix="/api/export", tags=["export"])

ADX_NAMESPACE = "urn:ihe:qrph:adx:2015"
_DHIS2_UID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def _dhis2_uid(*key_parts: str) -> str:
    """A deterministic, DHIS2-UID-shaped placeholder id (11 characters,
    first a letter, matching DHIS2's own UID format) derived from a
    real-world key (a state name, a resource category).

    This is NOT a real DHIS2 metadata UID — there is no DHIS2 instance
    behind this demo to resolve one against. A live integration replaces
    these by resolving the target instance's actual orgUnit/dataElement
    UIDs via its metadata API (GET /api/organisationUnits,
    /api/dataElements) and mapping SetuHealth's state/category names onto
    them once, at integration time. Being deterministic here only means the
    same state or category always maps to the same placeholder across
    calls within this demo — see docs/INTEROP.md.
    """
    digest = hashlib.sha1("|".join(key_parts).encode("utf-8")).hexdigest()
    first = _DHIS2_UID_ALPHABET[int(digest[0:2], 16) % 52]  # first char must be a letter
    rest = "".join(
        _DHIS2_UID_ALPHABET[int(digest[i:i + 2], 16) % len(_DHIS2_UID_ALPHABET)]
        for i in range(2, 22, 2)
    )
    return first + rest


@router.get(
    "/alerts.json",
    response_model=list[StockoutAlertV1],
    summary="Current stockout alerts (StockoutAlertV1)",
    description=(
        "Every facility/resource pair currently at 'warning' or 'critical' stockout risk, in the "
        "versioned StockoutAlertV1 shape (see app/schemas/interop.py and docs/INTEROP.md). No "
        "authentication required — this is the same alert data the officer console's dashboard "
        "already renders, published as a stable external contract instead of scraped off the UI."
    ),
)
def export_alerts() -> list[StockoutAlertV1]:
    now = datetime.now(timezone.utc)
    return [
        StockoutAlertV1(
            alert_id=f"{a['phc_id']}:{a['resource_id']}",
            facility_id=a["phc_id"],
            facility_name=a["phc_name"],
            facility_type=a["facility_type"],
            state=a["state"],
            district=a["district"],
            resource_id=a["resource_id"],
            resource_name=a["medicine"],
            resource_category=a["resource_category"],
            unit=a["unit"],
            current_level=a["current_level"],
            reorder_level=a["reorder_level"],
            capacity=a["capacity"],
            days_to_stockout=a["days_to_stockout"],
            risk_level=a["risk"],
            daily_depletion_rate=a["daily_depletion_rate"],
            forecast_method=a["forecast_method"],
            generated_at=now,
        )
        for a in forecasting.network_alerts()
    ]


@router.get(
    "/transfers.json",
    response_model=list[TransferRequestV1],
    summary="Recommended redistribution transfers (TransferRequestV1)",
    description=(
        "Every open redistribution recommendation from the LP optimizer (app/services/"
        "redistribution.py), in the versioned TransferRequestV1 shape. These are "
        "recommendations, not executed transfers — see the `status` field and "
        "app/schemas/interop.py's docstring for how this relates to the existing "
        "GET /api/fhir/transfer/{id} export of an already-executed transfer."
    ),
)
def export_transfers() -> list[TransferRequestV1]:
    now = datetime.now(timezone.utc)
    out = []
    for r in redistribution.recommend_all():
        resource = store.resource_type(r["medicine"])
        out.append(
            TransferRequestV1(
                request_id=f"{r['from_phc_id']}:{r['to_phc_id']}:{resource.id if resource else r['medicine']}",
                resource_id=resource.id if resource else r["medicine"],
                resource_name=r["medicine"],
                unit=r["unit"],
                quantity=r["quantity"],
                origin_facility_id=r["from_phc_id"],
                origin_facility_name=r["from_phc_name"],
                origin_state=r["from_state"],
                origin_district=r["from_district"],
                destination_facility_id=r["to_phc_id"],
                destination_facility_name=r["to_phc_name"],
                destination_state=r["to_state"],
                destination_district=r["to_district"],
                distance_km=r["distance_km"],
                cross_state=r["cross_state"],
                urgency=r["urgency"],
                generated_at=now,
            )
        )
    return out


@router.get(
    "/dhis2-adx",
    summary="State-level resource depletion rates as a DHIS2 ADX export",
    description=(
        "A minimal, schema-valid DHIS2 ADX (Aggregate Data Exchange, urn:ihe:qrph:adx:2015) XML "
        "document: one <group> per state (orgUnit/period/dataSet, all mandatory per the ADX "
        "profile), one <dataValue> per resource category, valued at that state's "
        "federated-averaged daily depletion rate for the category (same numbers "
        "GET /api/federated/national already serves as JSON). orgUnit/dataSet/dataElement are "
        "deterministic placeholder ids — see docs/INTEROP.md for why, and how a live DHIS2 "
        "integration would resolve real ones. This does not require a DHIS2 instance to exist "
        "anywhere; it proves the export format itself is real and spec-compliant, which is the "
        "actual credibility claim (see docs/INTEROP.md)."
    ),
)
def export_dhis2_adx() -> Response:
    prior = federated.national_federated_prior()
    now = datetime.now(timezone.utc)
    # ADX periods are ISO8601 (date|datetime)/(duration). SetuHealth's depletion
    # rates are a live current-state figure, not a closed reporting-period
    # submission, so the period is always "the calendar month this export was
    # generated in" — a documented convention, not a claim about a real
    # reporting cycle.
    period = f"{now.strftime('%Y-%m')}-01/P1M"
    dataset_uid = _dhis2_uid("dataset", "setuhealth-resource-stock")

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<adx xmlns="{ADX_NAMESPACE}" exported="{now.strftime("%Y-%m-%dT%H:%M:%SZ")}">',
    ]
    for s in prior["node_summaries"]:
        org_unit_uid = _dhis2_uid("state", s["node"])
        lines.append(f'  <group orgUnit="{org_unit_uid}" period="{period}" dataSet="{dataset_uid}">')
        for category, rate in sorted(s["category_depletion_rates"].items()):
            data_element_uid = _dhis2_uid("category", category)
            lines.append(f'    <dataValue dataElement="{data_element_uid}" value="{rate}"/>')
        lines.append("  </group>")
    lines.append("</adx>")

    return Response(content="\n".join(lines), media_type="application/xml")
