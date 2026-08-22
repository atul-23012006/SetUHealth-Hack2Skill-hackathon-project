from fastapi import APIRouter, HTTPException

from app.services import store

router = APIRouter(prefix="/api", tags=["phc"])


@router.get("/states")
def list_states():
    return store.states()


@router.get("/phcs")
def list_phcs(state: str | None = None, district: str | None = None):
    phcs = store.phcs_in_state(state, district)
    out = []
    for p in phcs:
        beds = store.BED_HISTORY[p["id"]]["occupied"][-1]
        attendance = store.STAFF_HISTORY[p["id"]]["attendance_pct"][-1]
        out.append({**p, "beds_occupied": beds, "attendance_pct": attendance})
    return out


@router.get("/phcs/{phc_id}")
def get_phc(phc_id: str):
    if phc_id not in store.PHC_BY_ID:
        raise HTTPException(404, "PHC not found")
    phc = store.PHC_BY_ID[phc_id]
    return {
        **phc,
        "dates": store.DATES,
        "bed_occupancy": store.BED_HISTORY[phc_id]["occupied"],
        "staff_attendance": store.STAFF_HISTORY[phc_id]["attendance_pct"],
        "stock": store.STOCK_HISTORY[phc_id],
    }


@router.get("/medicines")
def list_medicines():
    return store.MEDICINES
