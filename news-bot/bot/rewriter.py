"""Обработка новостей моделью Claude.

Два шага за один вызов на каждую статью:
1. Оценка релевантности (ecommerce / retail / SaaS / технологии / AI, Россия).
2. Переупаковка в формат «Новость коротко → Какие открываются возможности».
   Негативная новость не замалчивается, а разворачивается в сторону возможностей.
"""
from __future__ import annotations

import json
import logging
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from .fetcher import Article

log = logging.getLogger(__name__)

Topic = Literal["ecommerce", "retail", "saas", "tech", "ai", "other"]
Tone = Literal["positive", "neutral", "negative"]


class Opportunity(BaseModel):
    point: str = Field(description="Одна возможность: 1 короткое предложение, что именно можно сделать или получить")
    why: str = Field(description="Аргумент в 1 предложение: почему это возможность, на чём основан вывод")


class RewrittenNews(BaseModel):
    relevant: bool = Field(description="Относится ли новость к e-commerce, ритейлу, SaaS, технологиям или ИИ и касается ли России")
    topic: Topic
    original_tone: Tone = Field(description="Тональность исходной новости")
    headline: str = Field(description="Заголовок до 80 символов, без кликбейта, без эмодзи")
    summary: str = Field(description="Суть новости: 1–2 предложения, только факты из источника, без оценок")
    opportunities: list[Opportunity] = Field(
        description="2–3 возможности для бизнеса (продавцов, ритейлеров, SaaS-команд, разработчиков). Если новость нерелевантна — пустой список"
    )
    audience: str = Field(description="Кому это особенно важно, 3–6 слов (например: «селлерам маркетплейсов», «SaaS-командам в B2B»)")


SYSTEM_PROMPT = """Ты — редактор телеграм-канала о российском рынке e-commerce, ритейла, SaaS, технологий и искусственного интеллекта.
Твоя задача — переупаковывать новости в формат «что случилось → какие возможности это открывает».

Правила:
- Пиши по-русски, деловым и живым языком, без канцелярита и без восторженных эпитетов.
- Коротко: суть новости в 1–2 предложениях, 2–3 возможности по 1–2 предложения каждая.
- Факты только из текста новости. Ничего не придумывай: не добавляй цифр, имён и сроков, которых нет в источнике.
- Возможности должны быть конкретными и аргументированными: кому, что именно можно сделать, и почему это следует из новости.
- Если новость негативная (штрафы, блокировки, падение, уход с рынка, сокращения, сбои, новые ограничения) — не скрывай суть и не приукрашивай факты, но в блоке возможностей честно покажи, кто и как может на этом выиграть: освободившаяся ниша, спрос на замену, повод пересмотреть процессы, новые требования, под которые можно сделать продукт, и т.п.
- Никакой токсичного позитива: не пиши «это отличная новость», если это не так. Позитив — в возможностях, а не в оценках.
- Новости не про Россию и не про e-commerce / ритейл / SaaS / технологии / ИИ отмечай как нерелевантные (relevant=false). Политику, криминал, курьёзы, личную жизнь — отмечай как нерелевантные.
- Дубликаты уже опубликованных тем (список дан в запросе) отмечай как нерелевантные.
- Без эмодзи в тексте — оформление добавит бот."""


class Rewriter:
    def __init__(self, client: anthropic.AsyncAnthropic, model: str = "claude-opus-5-5"):
        self.client = client
        self.model = model

    async def rewrite(self, article: Article, recently_posted: list[str] | None = None) -> RewrittenNews | None:
        """Возвращает переупакованную новость или None, если модель отказалась/ошибка."""
        user_prompt = self._build_prompt(article, recently_posted or [])
        try:
            response = await self.client.beta.messages.parse(
                model=self.model,
                max_tokens=4000,
                # Статьи короткие, глубокие рассуждения не нужны: экономим токены и время.
                output_config={"effort": "low"},
                # Системный промпт одинаковый для всех статей — кэшируем.
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_prompt}],
                output_format=RewrittenNews,
                # Если классификаторы безопасности отклонят запрос, сервер сам повторит его на запасной модели.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError as exc:
            log.warning("Лимит запросов Anthropic: %s", exc)
            return None
        except anthropic.APIStatusError as exc:
            log.error("Ошибка Anthropic API %s: %s", exc.status_code, exc.message)
            return None
        except anthropic.APIConnectionError as exc:
            log.error("Нет соединения с Anthropic API: %s", exc)
            return None

        if response.stop_reason == "refusal":
            log.warning("Модель отказалась обрабатывать «%s»", article.title)
            return None
        if response.stop_reason == "max_tokens":
            log.warning("Ответ обрезан по max_tokens для «%s»", article.title)
            return None
        result = response.parsed_output
        if result is None:
            log.warning("Не удалось разобрать ответ модели для «%s»", article.title)
            return None
        return result

    @staticmethod
    def _build_prompt(article: Article, recently_posted: list[str]) -> str:
        posted_block = "\n".join(f"- {t}" for t in recently_posted[:30]) or "- (пока ничего)"
        return (
            f"Источник: {article.source} (тематика ленты: {article.topic_hint})\n"
            f"Дата: {article.published_iso or 'неизвестна'}\n"
            f"Ссылка: {article.url}\n\n"
            f"Заголовок: {article.title}\n\n"
            f"Текст/анонс:\n{article.summary or '(анонс отсутствует, ориентируйся на заголовок)'}\n\n"
            f"Уже опубликованные недавно темы (не дублировать):\n{posted_block}"
        )


def to_json(news: RewrittenNews) -> str:
    return json.dumps(news.model_dump(), ensure_ascii=False)


def from_json(raw: str) -> RewrittenNews:
    return RewrittenNews.model_validate_json(raw)
