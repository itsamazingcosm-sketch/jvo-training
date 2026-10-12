"""Сценарий одного выпуска: собрать → отфильтровать → переупаковать."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from .fetcher import Article, fetch_all
from .rewriter import Rewriter, RewrittenNews, to_json
from .storage import Storage

log = logging.getLogger(__name__)


@dataclass
class Post:
    article: Article
    news: RewrittenNews


@dataclass
class RunResult:
    fetched: int
    candidates: int
    posts: list[Post]


async def build_digest(
    storage: Storage,
    rewriter: Rewriter,
    *,
    max_items: int,
    max_age_hours: int,
    articles: list[Article] | None = None,
    max_candidates: int = 25,
    concurrency: int = 3,
) -> RunResult:
    """Собирает новости и возвращает готовые к публикации посты.

    Статьи, которые уже были в базе, пропускаются. Релевантность и переупаковку делает модель.
    `articles` можно передать явно (для тестов и режима --demo), иначе ленты скачиваются.
    """
    if articles is None:
        articles = await fetch_all(max_age_hours)
    fetched = len(articles)

    fresh: list[Article] = []
    for a in articles:
        if storage.remember(a.id, a.url, a.title, a.source, a.published_iso):
            fresh.append(a)
    fresh = fresh[:max_candidates]
    log.info("Всего статей %d, новых %d", fetched, len(fresh))

    recently_posted = storage.recent_posted_titles()
    sem = asyncio.Semaphore(concurrency)

    async def process(article: Article) -> Post | None:
        async with sem:
            news = await rewriter.rewrite(article, recently_posted)
        if news is None:
            storage.set_status(article.id, "failed")
            return None
        if not news.relevant or not news.opportunities:
            storage.set_status(article.id, "skipped", to_json(news))
            return None
        storage.set_status(article.id, "ready", to_json(news))
        return Post(article, news)

    results = await asyncio.gather(*(process(a) for a in fresh))
    posts = [p for p in results if p is not None][:max_items]
    # Статьи, не вошедшие в выпуск из-за лимита, помечаем как пропущенные:
    # к следующему выпуску они устареют, копить очередь нет смысла.
    chosen = {p.article.id for p in posts}
    for p in results:
        if p is not None and p.article.id not in chosen:
            storage.set_status(p.article.id, "skipped")
    return RunResult(fetched=fetched, candidates=len(fresh), posts=posts)
