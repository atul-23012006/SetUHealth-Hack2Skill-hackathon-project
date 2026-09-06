from fastapi import APIRouter, HTTPException

from app.services import transfers as transfer_service

router = APIRouter(prefix="/api/fhir", tags=["fhir"])


def _build_fhir_supply_request(tr: dict) -> dict:
    """Build a FHIR R4-compliant SupplyRequest resource from a transfer manifest."""
    return {
        "resourceType": "SupplyRequest",
        "id": tr["id"],
        "meta": {
            "profile": ["http://hl7.org/fhir/R4/SupplyRequest"],
            "lastUpdated": tr["created_at"],
        },
        "text": {
            "status": "generated",
            "div": (
                f"<div xmlns='http://www.w3.org/1999/xhtml'>"
                f"Transfer of {tr['quantity']} {tr['unit']} of {tr['medicine']} "
                f"from {tr['from_phc_name']} ({tr['from_district']}, {tr['from_state']}) "
                f"to {tr['to_phc_name']} ({tr['to_district']}, {tr['to_state']})."
                f"</div>"
            ),
        },
        "status": "active",
        "intent": "directive",
        "itemCodeableConcept": {
            "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "display": tr["medicine"],
                }
            ],
            "text": tr["medicine"],
        },
        "quantity": {
            "value": tr["quantity"],
            "unit": tr["unit"],
            "system": "http://unitsofmeasure.org",
        },
        "authoredOn": tr["created_at"],
        "occurrenceDateTime": tr["created_at"],
        "deliverFrom": {
            "reference": f"Location/{tr['from_phc_id']}",
            "display": f"{tr['from_phc_name']}, {tr['from_district']}, {tr['from_state']}, India",
        },
        "deliverTo": {
            "reference": f"Location/{tr['to_phc_id']}",
            "display": f"{tr['to_phc_name']}, {tr['to_district']}, {tr['to_state']}, India",
        },
        "requester": {
            "display": "SetuHealth — National PHC Resource Grid (AI Optimizer)",
        },
        "note": [
            {
                "text": f"Auto-generated transfer manifest from the SetuHealth LP redistribution optimizer. "
                        f"Status: {tr.get('status', 'completed')}."
            }
        ],
    }


@router.get("/transfer/{transfer_id}")
def export_fhir_supply_request(transfer_id: str):
    """Return a FHIR R4 SupplyRequest resource for a completed transfer manifest."""
    all_transfers = transfer_service.load_transfers()
    tr = next((t for t in all_transfers if t["id"] == transfer_id), None)
    if not tr:
        raise HTTPException(status_code=404, detail=f"Transfer {transfer_id} not found")
    return _build_fhir_supply_request(tr)
