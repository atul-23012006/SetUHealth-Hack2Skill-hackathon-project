"""Proves the Phase 5 acceptance criterion directly: a below-threshold
transfer created with auto_execute=true is auto-dispatched (badge-worthy
fields on the manifest, a logged audit-trail entry) with no separate
manual step, while an above-threshold transfer behaves exactly as before —
manual, no dispatch — regardless of the flag.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.services import db, transfers

client = TestClient(app)
ADMIN_HEADERS = {"X-User-Id": "national_admin"}


def _flat_stock(capacity: float, reorder_level: float, level: float) -> dict:
    """A stock record with a constant level and near-zero recent drawdown,
    so forecasting.py projects no breach within the horizon (days_to_stockout
    stays None) and the destination reads as "low" risk — deterministically,
    regardless of Holt's smoothing internals."""
    return {
        "resource_id": "paracetamol_500mg",
        "unit": "strip",
        "category": "general",
        "capacity": capacity,
        "reorder_level": reorder_level,
        "levels": [level] * 90,
    }


def test_below_threshold_transfer_auto_dispatches_with_no_manual_step(synthetic_facility):
    origin = synthetic_facility(
        "TEST-DISP-ORIGIN", "PHC",
        {"Paracetamol 500mg": _flat_stock(200, 50, 150)},
        state="Maharashtra", district="Pune", lat=18.52, lon=73.85,
    )
    dest = synthetic_facility(
        "TEST-DISP-DEST", "PHC",
        {"Paracetamol 500mg": _flat_stock(200, 50, 150)},  # comfortably above reorder -> "low" risk
        state="Maharashtra", district="Nashik", lat=20.00, lon=73.79,
    )

    events_before = len(db.list_events(limit=1000))
    resp = client.post(
        "/api/transfers",
        json={
            "from_phc_id": origin["id"],
            "to_phc_id": dest["id"],
            "medicine": "Paracetamol 500mg",
            "quantity": 20,  # well under the 50-unit threshold
            "auto_execute": True,
        },
        headers=ADMIN_HEADERS,
    )
    assert resp.status_code == 200, resp.text
    manifest = resp.json()["manifest"]

    # Appears with the auto-dispatch badge fields — no separate manual
    # dispatch/courier-assignment step was needed beyond this one call.
    assert manifest["auto_dispatched"] is True
    assert manifest["dispatch"] is not None
    assert manifest["dispatch"]["simulated"] is True
    assert manifest["dispatch"]["provider"] == "simulated_ground_courier"
    assert manifest["dispatch"]["eta_minutes"] > 0
    assert manifest["auto_dispatch_declined_reason"] is None

    # It shows up on the Transfers page's data source immediately.
    listed = client.get("/api/transfers").json()
    assert any(t["id"] == manifest["id"] and t["auto_dispatched"] for t in listed)

    # And a dispatch event was logged to the audit trail.
    events_after = db.list_events(limit=1000)
    assert len(events_after) > events_before
    dispatch_events = [e for e in events_after if e["kind"] == "dispatch"]
    assert dispatch_events, "expected a 'dispatch' kind entry in the audit trail"
    assert "[SIMULATED]" in dispatch_events[0]["summary"]


def test_cross_state_transfer_never_auto_dispatches(synthetic_facility):
    origin = synthetic_facility(
        "TEST-DISP-MH", "PHC",
        {"Paracetamol 500mg": _flat_stock(200, 50, 150)},
        state="Maharashtra", lat=18.52, lon=73.85,
    )
    dest = synthetic_facility(
        "TEST-DISP-KL", "PHC",
        {"Paracetamol 500mg": _flat_stock(200, 50, 150)},
        state="Kerala", lat=8.52, lon=76.94,
    )

    manifest = transfers.create_and_execute_transfer(
        origin["id"], dest["id"], "Paracetamol 500mg", 10, auto_execute=True,
    )
    assert manifest["auto_dispatched"] is False
    assert manifest["dispatch"] is None
    assert "cross-state" in manifest["auto_dispatch_declined_reason"]


def test_over_threshold_quantity_never_auto_dispatches(synthetic_facility):
    origin = synthetic_facility(
        "TEST-DISP-BIG-O", "PHC", {"Paracetamol 500mg": _flat_stock(1000, 50, 900)},
    )
    dest = synthetic_facility(
        "TEST-DISP-BIG-D", "PHC", {"Paracetamol 500mg": _flat_stock(1000, 50, 900)},
        district="Nashik", lat=20.00, lon=73.79,
    )

    manifest = transfers.create_and_execute_transfer(
        origin["id"], dest["id"], "Paracetamol 500mg", 999,  # far over the 50-unit threshold
        auto_execute=True,
    )
    assert manifest["auto_dispatched"] is False
    assert "threshold" in manifest["auto_dispatch_declined_reason"]
    # Execution itself still happened exactly as before — quantity moved.
    assert manifest["status"] == "Completed"
    assert manifest["quantity"] == 999


def test_critical_risk_destination_never_auto_dispatches(synthetic_facility):
    origin = synthetic_facility(
        "TEST-DISP-CRIT-O", "PHC", {"Paracetamol 500mg": _flat_stock(200, 50, 150)},
    )
    dest = synthetic_facility(
        "TEST-DISP-CRIT-D", "PHC",
        # current level at/below reorder_level -> forecasting.py forces "critical" immediately
        {"Paracetamol 500mg": _flat_stock(200, 50, 40)},
        district="Nashik", lat=20.00, lon=73.79,
    )

    manifest = transfers.create_and_execute_transfer(
        origin["id"], dest["id"], "Paracetamol 500mg", 10, auto_execute=True,
    )
    assert manifest["auto_dispatched"] is False
    assert "critical" in manifest["auto_dispatch_declined_reason"]


def test_auto_execute_false_behaves_exactly_as_manual_always_did(synthetic_facility):
    """The default (auto_execute omitted) must be indistinguishable from
    every transfer this system executed before Phase 5 existed."""
    origin = synthetic_facility(
        "TEST-DISP-MANUAL-O", "PHC", {"Paracetamol 500mg": _flat_stock(200, 50, 150)},
    )
    dest = synthetic_facility(
        "TEST-DISP-MANUAL-D", "PHC", {"Paracetamol 500mg": _flat_stock(200, 50, 150)},
        district="Nashik", lat=20.00, lon=73.79,
    )

    manifest = transfers.create_and_execute_transfer(
        origin["id"], dest["id"], "Paracetamol 500mg", 10,
    )
    assert manifest["auto_dispatched"] is False
    assert manifest["dispatch"] is None
    assert manifest["auto_dispatch_declined_reason"] is None  # never evaluated when not requested
    assert manifest["status"] == "Completed"
