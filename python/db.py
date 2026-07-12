# SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies
#
# SPDX-License-Identifier: MPL-2.0

"""
Lightweight SQLite cache for QSense Machine Monitor.

Tables
------
anomalies   — recent anomaly events (capped at MAX_ANOMALIES rows)
environment — recent temperature + humidity readings (capped at MAX_ENV_ROWS)
metadata    — key/value store (run_start_time, last_anomaly_time, etc.)
"""

import sqlite3
import threading
from datetime import datetime

DB_PATH       = "/tmp/qsense_cache.db"
MAX_ANOMALIES = 50
MAX_ENV_ROWS  = 200

_lock = threading.Lock()


def _connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _lock, _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS anomalies (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                score     REAL    NOT NULL,
                severity  TEXT    NOT NULL,   -- 'anomaly' | 'critical'
                timestamp TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS environment (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                temperature REAL NOT NULL,
                humidity    REAL NOT NULL,
                timestamp   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS metadata (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)


# ---------------------------------------------------------------------------
# Anomalies
# ---------------------------------------------------------------------------

def record_anomaly(score: float, severity: str, timestamp: str):
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO anomalies (score, severity, timestamp) VALUES (?, ?, ?)",
            (round(score, 4), severity, timestamp),
        )
        # Keep only the most recent MAX_ANOMALIES rows
        conn.execute(
            "DELETE FROM anomalies WHERE id NOT IN "
            "(SELECT id FROM anomalies ORDER BY id DESC LIMIT ?)",
            (MAX_ANOMALIES,),
        )
        conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_anomaly_time', ?)",
            (timestamp,),
        )


def get_recent_anomalies(limit: int = 5) -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT score, severity, timestamp FROM anomalies ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

def record_environment(temperature: float, humidity: float, timestamp: str):
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO environment (temperature, humidity, timestamp) VALUES (?, ?, ?)",
            (round(temperature, 2), round(humidity, 2), timestamp),
        )
        conn.execute(
            "DELETE FROM environment WHERE id NOT IN "
            "(SELECT id FROM environment ORDER BY id DESC LIMIT ?)",
            (MAX_ENV_ROWS,),
        )


def get_latest_environment() -> dict | None:
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT temperature, humidity, timestamp FROM environment ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

def set_metadata(key: str, value: str):
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
            (key, value),
        )


def get_metadata(key: str) -> str | None:
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT value FROM metadata WHERE key = ?", (key,)
        ).fetchone()
    return row["value"] if row else None


def get_all_metadata() -> dict:
    with _lock, _connect() as conn:
        rows = conn.execute("SELECT key, value FROM metadata").fetchall()
    return {r["key"]: r["value"] for r in rows}
