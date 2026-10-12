"""Точка входа.

  python -m bot.main            — запустить бота
  python -m bot.main --once     — один раз собрать и опубликовать выпуск, без long polling (для cron)
  python -m bot.main --demo FILE.xml [FILE2.xml ...]
                                — прогнать локальные RSS-файлы через модель и напечатать посты в консоль
                                  (Telegram не нужен, нужен только ANTHROPIC_API_KEY)
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

import anthropic

from .config import settings
from .fetcher import parse_feed
from .formatter import format_news
from .pipeline import build_digest
from .rewriter import Rewriter
from .sources import Source
from .storage import Storage


def _logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)


def _html_to_console(text: str) -> str:
    import re
    from html import unescape

    return unescape(re.sub(r"<[^>]+>", "", text))


async def run_demo(files: list[str]) -> None:
    storage = Storage(":memory:")
    rewriter = Rewriter(anthropic.AsyncAnthropic(), model=settings.claude_model)
    articles = []
    for f in files:
        src = Source(Path(f).stem, f, "mixed")
        articles += parse_feed(Path(f).read_bytes(), src, max_age_hours=24 * 365 * 10)
    result = await build_digest(
        storage, rewriter, max_items=settings.max_items_per_digest, max_age_hours=0, articles=articles
    )
    print(f"\nСтатей в файлах: {result.fetched}, кандидатов: {result.candidates}, постов: {len(result.posts)}\n")
    for post in result.posts:
        print("=" * 72)
        print(_html_to_console(format_news(post.news, post.article)))
        print()


async def run_once() -> None:
    from .telegram_bot import NewsBot

    settings.validate()
    storage = Storage(settings.db_path)
    bot = NewsBot(settings, storage, Rewriter(anthropic.AsyncAnthropic(), model=settings.claude_model))
    try:
        posts = await bot.run_digest()
        print(f"Опубликовано новостей: {len(posts)}")
    finally:
        await bot.bot.session.close()


async def run_bot() -> None:
    from .telegram_bot import NewsBot

    settings.validate()
    storage = Storage(settings.db_path)
    bot = NewsBot(settings, storage, Rewriter(anthropic.AsyncAnthropic(), model=settings.claude_model))
    await bot.start()


def main() -> None:
    _logging()
    parser = argparse.ArgumentParser(description="Telegram-бот новостей e-commerce / retail / SaaS / tech / AI")
    parser.add_argument("--once", action="store_true", help="собрать и опубликовать один выпуск и выйти")
    parser.add_argument("--demo", nargs="+", metavar="RSS_FILE", help="обработать локальные RSS-файлы и напечатать результат")
    args = parser.parse_args()
    if args.demo:
        asyncio.run(run_demo(args.demo))
    elif args.once:
        asyncio.run(run_once())
    else:
        asyncio.run(run_bot())


if __name__ == "__main__":
    main()
