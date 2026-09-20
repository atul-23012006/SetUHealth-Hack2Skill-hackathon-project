"""Checks the Phase 4 interop exports actually meet their own claims: the
JSON exports validate against their published Pydantic schemas (FastAPI's
response_model already enforces this at request time, so these are mostly
sanity checks on content), and the DHIS2 ADX export is structurally valid
against the documented ADX profile (urn:ihe:qrph:adx:2015) — root element,
namespace, mandatory group/dataValue attributes, ISO8601 period encoding,
and DHIS2-shaped identifiers.

We don't have the official ADX XSD available offline to run a formal schema
validation against, so this test encodes the ADX profile's documented rules
(https://docs.dhis2.org — "ADX data format": orgUnit/period/dataSet
mandatory on <group>, dataElement/value mandatory on <dataValue>, period as
(date)/(duration)) directly, rather than skipping verification or merely
asserting "it looks like XML."
"""
import re
import xml.etree.ElementTree as ET

from fastapi.testclient import TestClient

from app.main import app
from app.services import federated

client = TestClient(app)

ADX_NS = "urn:ihe:qrph:adx:2015"
_DHIS2_UID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{10}$")
_ISO_PERIOD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}/P\d+[YMD]$")
_ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def test_alerts_export_matches_its_schema():
    resp = client.get("/api/export/alerts.json")
    assert resp.status_code == 200
    alerts = resp.json()
    assert alerts, "expected at least one open alert against the demo dataset"
    for a in alerts:
        assert a["schema_version"] == "1.0"
        assert a["risk_level"] in ("warning", "critical")
        assert a["forecast_method"] in ("exponential_smoothing", "fallback")
        assert ":" in a["alert_id"]


def test_transfers_export_matches_its_schema():
    resp = client.get("/api/export/transfers.json")
    assert resp.status_code == 200
    transfers = resp.json()
    assert transfers, "expected at least one open redistribution recommendation"
    for t in transfers:
        assert t["schema_version"] == "1.0"
        assert t["status"] == "recommended"
        assert t["quantity"] > 0
        assert t["urgency"] in ("low", "warning", "critical")


def test_dhis2_adx_export_is_structurally_valid():
    resp = client.get("/api/export/dhis2-adx")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/xml")

    root = ET.fromstring(resp.text)
    assert root.tag == f"{{{ADX_NS}}}adx", "root element must be <adx> in the ADX namespace"
    assert _ISO_DATETIME_RE.match(root.attrib.get("exported", "")), "exported must be an ISO8601 UTC datetime"

    groups = root.findall(f"{{{ADX_NS}}}group")
    real_states = federated.national_federated_prior()["participating_nodes"]
    assert len(groups) == len(real_states), (
        "one <group> per real (synthetic) state in the dataset — "
        "this is the 'at least one real state's data' acceptance criterion"
    )

    dataset_uids = set()
    for group in groups:
        for attr in ("orgUnit", "period", "dataSet"):
            assert attr in group.attrib and group.attrib[attr], f"<group> is missing mandatory '{attr}'"
        assert _DHIS2_UID_RE.match(group.attrib["orgUnit"]), "orgUnit must be a DHIS2-UID-shaped identifier"
        assert _DHIS2_UID_RE.match(group.attrib["dataSet"]), "dataSet must be a DHIS2-UID-shaped identifier"
        assert _ISO_PERIOD_RE.match(group.attrib["period"]), "period must be ISO8601 (date)/(duration), e.g. 2026-09-01/P1M"
        dataset_uids.add(group.attrib["dataSet"])

        data_values = group.findall(f"{{{ADX_NS}}}dataValue")
        assert data_values, "each group must carry at least one dataValue"
        for dv in data_values:
            assert "dataElement" in dv.attrib and dv.attrib["dataElement"], "dataValue is missing mandatory 'dataElement'"
            assert _DHIS2_UID_RE.match(dv.attrib["dataElement"]), "dataElement must be a DHIS2-UID-shaped identifier"
            assert "value" in dv.attrib
            float(dv.attrib["value"])  # must be numeric

    assert len(dataset_uids) == 1, "this export publishes a single dataset — every group should share one dataSet id"


def test_dhis2_adx_identifiers_are_deterministic_across_calls():
    """The same state/category must map to the same placeholder id on every
    call — an integrator building a mapping table against these ids can't
    do so if they change between requests."""
    first = client.get("/api/export/dhis2-adx").text
    second = client.get("/api/export/dhis2-adx").text
    first_ids = re.findall(r'(?:orgUnit|dataSet|dataElement)="([^"]+)"', first)
    second_ids = re.findall(r'(?:orgUnit|dataSet|dataElement)="([^"]+)"', second)
    assert first_ids == second_ids
