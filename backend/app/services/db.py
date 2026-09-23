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

from app.config import settings
from app.data.generate_data import OUT_DIR

DB_PATH: Path = Path(settings.db_path) if settings.db_path else OUT_DIR / "setuhealth.db"

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
CREATE TABLE IF NOT EXISTS users (
    user_id             TEXT PRIMARY KEY,
    label               TEXT NOT NULL,
    role                TEXT NOT NULL,
    authorized_phc_ids  TEXT NOT NULL DEFAULT '[]',
    authorized_states   TEXT NOT NULL DEFAULT '[]',
    password_hash       TEXT NOT NULL,
    active              INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    kind      TEXT NOT NULL,
    title     TEXT NOT NULL,
    body      TEXT NOT NULL,
    state     TEXT,
    signal    TEXT,
    level     TEXT,
    delivery  TEXT,
    read      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signal_state (
    key         TEXT PRIMARY KEY,
    level       TEXT NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS live_cache (
    key         TEXT PRIMARY KEY,
    fetched_at  REAL NOT NULL,
    payload     TEXT NOT NULL
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


# --- users ---------------------------------------------------------------------
# Accounts are not simulation state: reset_all() leaves them alone.

def _user_row(row) -> dict | None:
    if not row:
        return None
    return {
        "user_id": row["user_id"], "label": row["label"], "role": row["role"],
        "authorized_phc_ids": json.loads(row["authorized_phc_ids"]),
        "authorized_states": json.loads(row["authorized_states"]),
        "password_hash": row["password_hash"], "active": bool(row["active"]),
    }


def user_get(user_id: str) -> dict | None:
    with _conn() as conn:
        return _user_row(conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone())


def user_count() -> int:
    with _conn() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]


def user_upsert(user: dict, password_hash: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO users (user_id, label, role, authorized_phc_ids, authorized_states, password_hash, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET label = excluded.label, role = excluded.role, "
            "authorized_phc_ids = excluded.authorized_phc_ids, authorized_states = excluded.authorized_states, "
            "password_hash = excluded.password_hash",
            (user["user_id"], user["label"], user["role"], json.dumps(user.get("authorized_phc_ids", [])),
             json.dumps(user.get("authorized_states", [])), password_hash, _now()),
        )


def user_set_active(user_id: str, active: bool) -> None:
    with _conn() as conn:
        conn.execute("UPDATE users SET active = ? WHERE user_id = ?", (1 if active else 0, user_id))


# --- notifications -------------------------------------------------------------
# Like the live cache these describe the *real* world, so reset_all() leaves them.

def notification_add(kind: str, title: str, body: str, state: str | None = None, signal: str | None = None,
                     level: str | None = None, delivery: str | None = None) -> int:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO notifications (ts, kind, title, body, state, signal, level, delivery) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (_now(), kind, title, body, state, signal, level, delivery),
        )
        return cur.lastrowid


def notification_list(limit: int = 30, unread_only: bool = False) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM notifications " + ("WHERE read = 0 " if unread_only else "") + "ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [{**dict(r), "read": bool(r["read"])} for r in rows]


def notification_unread_count() -> int:
    with _conn() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM notifications WHERE read = 0").fetchone()["n"]


def notification_mark_read(ids: list[int] | None = None) -> int:
    """Mark the given notifications (or all) read; returns how many changed."""
    with _conn() as conn:
        if ids:
            marks = ",".join("?" * len(ids))
            cur = conn.execute(f"UPDATE notifications SET read = 1 WHERE read = 0 AND id IN ({marks})", ids)
        else:
            cur = conn.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        return cur.rowcount


def signal_state_get(key: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT level, updated_at FROM signal_state WHERE key = ?", (key,)).fetchone()
    return dict(row) if row else None


def signal_state_put(key: str, level: str, updated_at: float) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO signal_state (key, level, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at",
            (key, level, updated_at),
        )


# --- live-data cache -----------------------------------------------------------
# Deliberately NOT cleared by reset_all(): it holds real fetched data, which a
# simulation reset has no business discarding.

def live_cache_get(key: str) -> tuple[float, object] | None:
    with _conn() as conn:
        row = conn.execute("SELECT fetched_at, payload FROM live_cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    try:
        return row["fetched_at"], json.loads(row["payload"])
    except ValueError:
        return None


def live_cache_put(key: str, fetched_at: float, value: object) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO live_cache (key, fetched_at, payload) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload",
            (key, fetched_at, json.dumps(value)),
        )


def live_cache_prune(older_than: float) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM live_cache WHERE fetched_at < ?", (older_than,))


def reset_all() -> None:
    """Wipe the ledger back to empty — paired with the store's data reset."""
    with _conn() as conn:
        conn.execute("DELETE FROM transfers")
        conn.execute("DELETE FROM crisis_log")
        conn.execute("DELETE FROM event_log")
