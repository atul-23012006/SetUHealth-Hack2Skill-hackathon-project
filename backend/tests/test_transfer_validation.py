"""A transfer is rejected before any stock moves when its quantity or facility
pair is invalid. Before this validation existed, a request larger than the
donor's stock zeroed the donor while crediting the recipient in full (creating
units), a negative quantity reversed the move, and a facility could transfer to
itself."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import store, transfers

client = TestClient(app)
ADMIN_HEADERS = {"X-User-Id": "national_admin"}
MEDICINE = "Paracetamol 500mg"


def _stock(level: float) -> dict:
    return {
        "resource_id": "paracetamol_500mg",
        "unit": "strip",
        "category": "general",
        "capacity": 500,
        "reorder_level": 50,
        "levels": [level] * 90,
    }


@pytest.fixture
def pair(synthetic_facility):
    origin = synthetic_facility("TEST-VAL-O", "PHC", {MEDICINE: _stock(100)})
    dest = synthetic_facility(
        "TEST-VAL-D", "PHC", {MEDICINE: _stock(100)}, district="Nashik", lat=20.00, lon=73.79,
    )
    return origin["id"], dest["id"]


def _levels(*ids):
    return [store.STOCK_HISTORY[i][MEDICINE]["levels"][-1] for i in ids]


@pytest.mark.parametrize("quantity", [0, -5, float("nan"), float("inf"), None])
def test_non_positive_or_non_numeric_quantity_is_rejected(pair, quantity):
    origin, dest = pair
    with pytest.raises(ValueError, match="positive number"):
        transfers.create_and_execute_transfer(origin, dest, MEDICINE, quantity)
    assert _levels(origin, dest) == [100, 100]


def test_quantity_above_donor_stock_is_rejected_without_moving_stock(pair):
    origin, dest = pair
    with pytest.raises(ValueError, match="Donor has only"):
        transfers.create_and_execute_transfer(origin, dest, MEDICINE, 100.5)
    assert _levels(origin, dest) == [100, 100]


def test_transfer_to_self_is_rejected(pair):
    origin, _ = pair
    with pytest.raises(ValueError, match="different facilities"):
        transfers.create_and_execute_transfer(origin, origin, MEDICINE, 10)
    assert _levels(origin) == [100]


def test_full_donor_stock_can_still_be_transferred(pair):
    origin, dest = pair
    manifest = transfers.create_and_execute_transfer(origin, dest, MEDICINE, 100)
    assert manifest["status"] == "Completed"
    assert _levels(origin, dest) == [0, 200]


def test_api_returns_400_for_invalid_transfer(pair):
    origin, dest = pair
    resp = client.post(
        "/api/transfers",
        json={"from_phc_id": origin, "to_phc_id": dest, "medicine": MEDICINE, "quantity": 101},
        headers=ADMIN_HEADERS,
    )
    assert resp.status_code == 400
    assert "Donor has only" in resp.json()["detail"]
    assert _levels(origin, dest) == [100, 100]
