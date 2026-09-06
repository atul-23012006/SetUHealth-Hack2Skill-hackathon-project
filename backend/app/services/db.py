"""Lightweight SQLite persistence layer.

The in-memory store (``services/store.py``) stays the hot read path — this
module is the durable ledger behind it. Three things that were previously
either lost on restart or kept only in a loose JSON file now live in a real
transactional database:

* **transfers**   — executed redistribution manifests (was ``transfers.json``)
* **crisis_log**  — every simulated crisis, with an ``active`` flag so the
  dashboard's crisis banner survives a backend restart (was an ephemeral
  in-process list)
* **event_log**   — a plain audit trail of every state mutation, so the
  prototype reads as an operational system rather than a toy

Connections are opened per call: SQLite handles that fine, it keeps the code
free of thread-affinity bugs under uvicorn's worker threadpool, and the write
volume here (a few rows per demo action) makes pooling irrelevant.
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from app.data.generate_data import OUT_DIR

DB_PATH: Path = OUT_DIR / "setuhealth.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS transfers (
    id          TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    manifest    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crisis_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    target_type  TEXT NOT NULL,
    target_name  TEXT NOT NULL,
    crisis_type  TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS event_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    kind     TEXT NOT NULL,
    summary  TEXT NOT NULL,
    payload  TEXT
);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _now() -> str:
    return datetime.now().isoformat()


def init_db() -> None:
    """Create tables if missing and one-time-migrate a legacy transfers.json."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _conn() as conn:
        conn.executescript(_SCHEMA)
        row = conn.execute("SELECT COUNT(*) AS n FROM transfers").fetchone()
        if row["n"] == 0:
            legacy = OUT_DIR / "transfers.json"
            if legacy.exists():
                try:
                    for m in json.loads(legacy.read_text()):
                        conn.execute(
                            "INSERT OR IGNORE INTO transfers (id, created_at, manifest) VALUES (?, ?, ?)",
                            (m["id"], m.get("created_at", _now()), json.dumps(m)),
                        )
                except Exception:
                    pass


# --- transfers ---------------------------------------------------------------

def record_transfer(manifest: dict) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO transfers (id, created_at, manifest) VALUES (?, ?, ?)",
            (manifest["id"], manifest.get("created_at", _now()), json.dumps(manifest)),
        )
    log_event(
        "transfer",
        f"{manifest['quantity']} {manifest.get('unit', '')} of {manifest['medicine']} "
        f"{manifest['from_phc_name']} -> {manifest['to_phc_name']}",
        manifest,
    )


def list_transfers() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT manifest FROM transfers ORDER BY created_at DESC").fetchall()
    return [json.loads(r["manifest"]) for r in rows]


# --- crises ----------------------------------------------------------------

def record_crisis(rec: dict) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO crisis_log (created_at, target_type, target_name, crisis_type, active) "
            "VALUES (?, ?, ?, ?, 1)",
            (_now(), rec["target_type"], rec["target_name"], rec["crisis_type"]),
        )
    log_event(
        "crisis",
        f"{rec['crisis_type']} triggered for {rec['target_type']} '{rec['target_name']}'",
        rec,
    )


def list_active_crises() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT target_type, target_name, crisis_type FROM crisis_log "
            "WHERE active = 1 ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


def clear_crises() -> None:
    with _conn() as conn:
        conn.execute("UPDATE crisis_log SET active = 0 WHERE active = 1")


# --- audit trail ---------------------------------------------------------------

def log_event(kind: str, summary: str, payload: dict | None = None) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO event_log (ts, kind, summary, payload) VALUES (?, ?, ?, ?)",
            (_now(), kind, summary, json.dumps(payload) if payload is not None else None),
        )


def list_events(limit: int = 100) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT ts, kind, summary FROM event_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def reset_all() -> None:
    """Wipe the ledger back to empty — paired with the store's data reset."""
    with _conn() as conn:
        conn.execute("DELETE FROM transfers")
        conn.execute("DELETE FROM crisis_log")
        conn.execute("DELETE FROM event_log")
