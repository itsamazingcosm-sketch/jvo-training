import asyncio
from datetime import datetime, timezone

from bot.fetcher import Article
from bot.formatter import format_news
from bot.pipeline import build_digest
from bot.rewriter import Opportunity, RewrittenNews, Rewriter, from_json, to_json
from bot.storage import Storage


class FakeRewriter(Rewriter):
    """Подменяет вызов модели заранее заготовленными ответами."""

    def __init__(self, answers: dict[str, RewrittenNews | None]):
        self.answers = answers
        self.calls: list[str] = []

    async def rewrite(self, article, recently_posted=None):
        self.calls.append(article.title)
        return self.answers.get(article.id)


def art(i: str, title: str) -> Article:
    return Article(
        id=i, title=title, url=f"https://example.com/{i}", summary="…", source="Тест",
        topic_hint="ecommerce", published_at=datetime.now(timezone.utc),
    )


def news(relevant=True, tone="negative") -> RewrittenNews:
    return RewrittenNews(
        relevant=relevant, topic="ecommerce", original_tone=tone,
        headline="Wildberries удвоил штрафы за просрочку поставок",
        summary="С 1 ноября штраф за просрочку поставки на склад вырастет вдвое.",
        opportunities=[
            Opportunity(point="Селлерам стоит перейти на модель FBS.", why="Штрафы касаются только поставок на склад маркетплейса."),
            Opportunity(point="Логистическим сервисам — запустить гарантию слота.", why="Спрос на точную доставку вырастет."),
        ] if relevant else [],
        audience="селлерам маркетплейсов",
    )


def test_build_digest_dedupes_and_filters(tmp_path):
    storage = Storage(tmp_path / "db.sqlite3")
    a1, a2, a3 = art("1", "Штрафы WB"), art("2", "Фестиваль шаров"), art("3", "Сбой у модели")
    rewriter = FakeRewriter({"1": news(), "2": news(relevant=False), "3": None})

    result = asyncio.run(build_digest(storage, rewriter, max_items=5, max_age_hours=36, articles=[a1, a2, a3]))
    assert result.fetched == 3 and result.candidates == 3
    assert [p.article.id for p in result.posts] == ["1"]
    assert sorted(rewriter.calls) == ["Сбой у модели", "Фестиваль шаров", "Штрафы WB"]

    # повторный запуск с теми же статьями — ничего нового, модель не вызывается
    rewriter.calls.clear()
    result2 = asyncio.run(build_digest(storage, rewriter, max_items=5, max_age_hours=36, articles=[a1, a2, a3]))
    assert result2.candidates == 0 and result2.posts == [] and rewriter.calls == []


def test_build_digest_respects_max_items(tmp_path):
    storage = Storage(tmp_path / "db.sqlite3")
    arts = [art(str(i), f"Новость {i}") for i in range(4)]
    rewriter = FakeRewriter({a.id: news() for a in arts})
    result = asyncio.run(build_digest(storage, rewriter, max_items=2, max_age_hours=36, articles=arts))
    assert len(result.posts) == 2


def test_format_news_html():
    text = format_news(news(), art("1", "x"))
    assert text.startswith("🛒 <b>Wildberries удвоил штрафы")
    assert "<b>Что случилось.</b>" in text
    assert "1. Селлерам стоит перейти на модель FBS." in text
    assert '<a href="https://example.com/1">Источник: Тест</a>' in text
    assert len(text) <= 4096


def test_json_roundtrip():
    n = news()
    assert from_json(to_json(n)) == n
