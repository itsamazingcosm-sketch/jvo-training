"""Сбор новостей из RSS-лент."""
from __future__ import annotations

import asyncio
import hashlib
import html
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import mktime

import feedparser
import httpx

from .sources import SOURCES, Source, is_relevant_by_keywords

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; JVO-NewsBot/1.0; +https://t.me)"
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


@dataclass
class Article:
    id: str
    title: str
    url: str
    summary: str
    source: str
    topic_hint: str
    published_at: datetime | None

    @property
    def published_iso(self) -> str | None:
        return self.published_at.isoformat(timespec="seconds") if self.published_at else None


def clean_text(raw: str | None, limit: int = 1200) -> str:
    if not raw:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", raw))
    text = _WS_RE.sub(" ", text).strip()
    return text[:limit]


def make_id(url: str, title: str) -> str:
    key = (url or "").split("?")[0].strip().lower() or title.strip().lower()
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]


def _entry_date(entry) -> datetime | None:
    for attr in ("published_parsed", "updated_parsed"):
        value = getattr(entry, attr, None)
        if value:
            try:
                return datetime.fromtimestamp(mktime(value), tz=timezone.utc)
            except (OverflowError, ValueError):
                continue
    return None


def parse_feed(content: bytes | str, source: Source, max_age_hours: int, now: datetime | None = None) -> list[Article]:
    """Разбирает RSS/Atom и возвращает свежие статьи, прошедшие фильтр по ключевым словам."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=max_age_hours)
    parsed = feedparser.parse(content)
    out: list[Article] = []
    for entry in parsed.entries:
        title = clean_text(getattr(entry, "title", ""), 300)
        url = (getattr(entry, "link", "") or "").strip()
        if not title or not url:
            continue
        published = _entry_date(entry)
        if published and published < cutoff:
            continue
        summary = clean_text(getattr(entry, "summary", "") or getattr(entry, "description", ""))
        if not is_relevant_by_keywords(f"{title} {summary}"):
            continue
        out.append(
            Article(
                id=make_id(url, title),
                title=title,
                url=url,
                summary=summary,
                source=source.name,
                topic_hint=source.topic,
                published_at=published,
            )
        )
    return out


async def fetch_source(client: httpx.AsyncClient, source: Source, max_age_hours: int) -> list[Article]:
    try:
        resp = await client.get(source.url)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Лента %s недоступна: %s", source.name, exc)
        return []
    articles = parse_feed(resp.content, source, max_age_hours)
    log.info("Лента %s: %d подходящих статей", source.name, len(articles))
    return articles


async def fetch_all(max_age_hours: int, sources: list[Source] | None = None, timeout: float = 20.0) -> list[Article]:
    """Скачивает все ленты параллельно, убирает дубли по id, сортирует от свежих к старым."""
    sources = sources or SOURCES
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT}, timeout=timeout, follow_redirects=True
    ) as client:
        results = await asyncio.gather(*(fetch_source(client, s, max_age_hours) for s in sources))
    seen: set[str] = set()
    merged: list[Article] = []
    for articles in results:
        for a in articles:
            if a.id in seen:
                continue
            seen.add(a.id)
            merged.append(a)
    merged.sort(key=lambda a: a.published_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return merged
