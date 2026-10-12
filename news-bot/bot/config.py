"""Настройки бота. Читаются из переменных окружения / файла .env."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _ids(raw: str) -> set[int]:
    out: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            out.add(int(part))
    return out


@dataclass
class Settings:
    telegram_token: str = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN", "").strip())
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", "").strip())
    channel_id: str = field(default_factory=lambda: os.getenv("TELEGRAM_CHANNEL_ID", "").strip())
    digest_interval_hours: int = field(default_factory=lambda: _int("DIGEST_INTERVAL_HOURS", 6))
    max_items_per_digest: int = field(default_factory=lambda: _int("MAX_ITEMS_PER_DIGEST", 5))
    max_article_age_hours: int = field(default_factory=lambda: _int("MAX_ARTICLE_AGE_HOURS", 36))
    claude_model: str = field(default_factory=lambda: os.getenv("CLAUDE_MODEL", "claude-opus-5-5").strip())
    db_path: Path = field(default_factory=lambda: Path(os.getenv("DB_PATH", "data/newsbot.sqlite3")))
    admin_ids: set[int] = field(default_factory=lambda: _ids(os.getenv("ADMIN_IDS", "")))

    def validate(self) -> None:
        missing = []
        if not self.telegram_token:
            missing.append("TELEGRAM_BOT_TOKEN")
        if not self.anthropic_api_key and not os.getenv("ANTHROPIC_AUTH_TOKEN"):
            missing.append("ANTHROPIC_API_KEY")
        if missing:
            raise SystemExit(
                "Не заданы переменные окружения: " + ", ".join(missing)
                + ". Скопируйте .env.example в .env и заполните."
            )


settings = Settings()
