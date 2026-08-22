"""In-memory data store loaded from the generated synthetic dataset.
Acts as the single source of truth the routers/services read from.
"""
import json
from pathlib import Path

from app.data.generate_data import build, OUT_DIR

_REQUIRED = ["dates.json", "phcs.json", "stock_history.json", "bed_history.json", "staff_history.json", "medicines.json"]


def _ensure_data():
    if not all((OUT_DIR / f).exists() for f in _REQUIRED):
        build()


def _load(name: str):
    return json.loads((OUT_DIR / name).read_text())


_ensure_data()

DATES: list[str] = _load("dates.json")
PHCS: list[dict] = _load("phcs.json")
STOCK_HISTORY: dict = _load("stock_history.json")
BED_HISTORY: dict = _load("bed_history.json")
STAFF_HISTORY: dict = _load("staff_history.json")
MEDICINES: list[dict] = _load("medicines.json")

PHC_BY_ID = {p["id"]: p for p in PHCS}


def phcs_in_state(state: str | None = None, district: str | None = None):
    out = PHCS
    if state:
        out = [p for p in out if p["state"] == state]
    if district:
        out = [p for p in out if p["district"] == district]
    return out


def states():
    seen = {}
    for p in PHCS:
        seen.setdefault(p["state"], set()).add(p["district"])
    return {s: sorted(d) for s, d in seen.items()}
