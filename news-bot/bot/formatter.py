"""Форматирование сообщений для Telegram (HTML parse mode)."""
from __future__ import annotations

from html import escape

from .fetcher import Article
from .rewriter import RewrittenNews

TOPIC_LABEL = {
    "ecommerce": "E-commerce",
    "retail": "Ритейл",
    "saas": "SaaS",
    "tech": "Технологии",
    "ai": "AI",
    "other": "Рынок",
}

TOPIC_EMOJI = {
    "ecommerce": "🛒",
    "retail": "🏬",
    "saas": "☁️",
    "tech": "⚙️",
    "ai": "🤖",
    "other": "📰",
}

TELEGRAM_LIMIT = 4096


def format_news(news: RewrittenNews, article: Article | None = None, url: str | None = None, source: str | None = None) -> str:
    url = url or (article.url if article else "")
    source = source or (article.source if article else "")
    emoji = TOPIC_EMOJI.get(news.topic, "📰")
    label = TOPIC_LABEL.get(news.topic, "Рынок")

    lines = [
        f"{emoji} <b>{escape(news.headline)}</b>",
        f"<i>#{label.replace('-', '').replace(' ', '')} · {escape(news.audience)}</i>",
        "",
        f"<b>Что случилось.</b> {escape(news.summary)}",
        "",
        "<b>Какие открываются возможности:</b>",
    ]
    for i, opp in enumerate(news.opportunities, 1):
        lines.append(f"{i}. {escape(opp.point)} <i>{escape(opp.why)}</i>")
    if url:
        lines += ["", f'<a href="{escape(url, quote=True)}">Источник: {escape(source or "ссылка")}</a>']
    text = "\n".join(lines)
    if len(text) > TELEGRAM_LIMIT:
        text = text[: TELEGRAM_LIMIT - 1] + "…"
    return text


HELP_TEXT = (
    "Я собираю свежие новости российского рынка e-commerce, ритейла, SaaS, технологий и AI "
    "и переупаковываю каждую в формат «что случилось → какие открываются возможности». "
    "Даже негативная новость превращается в список шансов для бизнеса.\n\n"
    "Команды:\n"
    "/news — свежий выпуск прямо сейчас\n"
    "/subscribe — получать выпуски автоматически\n"
    "/unsubscribe — отписаться\n"
    "/status — когда был последний сбор и сколько новостей вышло\n"
    "/help — эта справка"
)
