"""Shared geography helpers. Extracted from redistribution.py so
dispatch.py (Phase 5) can compute the same distance without duplicating
the formula."""
import math


def haversine_km(a: dict, b: dict) -> float:
    """Great-circle distance in km between two facilities with 'lat'/'lon' keys."""
    lat1, lon1, lat2, lon2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))
