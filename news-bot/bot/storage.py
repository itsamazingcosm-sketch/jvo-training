"""Хранилище на SQLite: увиденные статьи, подписчики, журнал публикаций."""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,            -- хэш ссылки/заголовка
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    published_at TEXT,
    first_seen_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',   -- new | skipped | posted | failed
    rewritten_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);

CREATE TABLE IF NOT EXISTS subscribers (
    chat_id INTEGER PRIMARY KEY,
    subscribed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    fetched INTEGER DEFAULT 0,
    candidates INTEGER DEFAULT 0,
    posted INTEGER DEFAULT 0,
    error TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Storage:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            self._conn.executescript(SCHEMA)

    # --- статьи ---------------------------------------------------------
    def is_seen(self, article_id: str) -> bool:
        cur = self._conn.execute("SELECT 1 FROM articles WHERE id = ?", (article_id,))
        return cur.fetchone() is not None

    def remember(self, article_id: str, url: str, title: str, source: str, published_at: str | None) -> bool:
        """Запоминает статью. Возвращает True, если статья новая."""
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO articles (id, url, title, source, published_at, first_seen_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (article_id, url, title, source, published_at, _now()),
            )
            return cur.rowcount == 1

    def set_status(self, article_id: str, status: str, rewritten_json: str | None = None) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE articles SET status = ?, rewritten_json = COALESCE(?, rewritten_json) WHERE id = ?",
                (status, rewritten_json, article_id),
            )

    def recent_posted_titles(self, limit: int = 40) -> list[str]:
        cur = self._conn.execute(
            "SELECT title FROM articles WHERE status = 'posted' ORDER BY first_seen_at DESC LIMIT ?",
            (limit,),
        )
        return [r["title"] for r in cur.fetchall()]

    def last_posted(self, limit: int = 5) -> list[sqlite3.Row]:
        cur = self._conn.execute(
            "SELECT * FROM articles WHERE status = 'posted' AND rewritten_json IS NOT NULL "
            "ORDER BY first_seen_at DESC LIMIT ?",
            (limit,),
        )
        return cur.fetchall()

    # --- подписчики -----------------------------------------------------
    def subscribe(self, chat_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO subscribers (chat_id, subscribed_at) VALUES (?, ?)",
                (chat_id, _now()),
            )
            return cur.rowcount == 1

    def unsubscribe(self, chat_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM subscribers WHERE chat_id = ?", (chat_id,))
            return cur.rowcount == 1

    def is_subscribed(self, chat_id: int) -> bool:
        cur = self._conn.execute("SELECT 1 FROM subscribers WHERE chat_id = ?", (chat_id,))
        return cur.fetchone() is not None

    def subscribers(self) -> list[int]:
        cur = self._conn.execute("SELECT chat_id FROM subscribers")
        return [r["chat_id"] for r in cur.fetchall()]

    # --- журнал запусков -------------------------------------------------
    def start_run(self) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute("INSERT INTO runs (started_at) VALUES (?)", (_now(),))
            return int(cur.lastrowid)

    def finish_run(self, run_id: int, fetched: int, candidates: int, posted: int, error: str | None = None) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE runs SET finished_at = ?, fetched = ?, candidates = ?, posted = ?, error = ? WHERE id = ?",
                (_now(), fetched, candidates, posted, error, run_id),
            )

    def last_run(self) -> sqlite3.Row | None:
        cur = self._conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1")
        return cur.fetchone()

    def close(self) -> None:
        self._conn.close()
