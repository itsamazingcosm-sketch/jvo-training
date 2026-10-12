"""Источники новостей (RSS) и тематические ключевые слова.

Список можно свободно менять: добавляйте/убирайте ленты, бот подхватит их при следующем запуске.
Поле `topic` — подсказка модели, к какой теме относится лента по умолчанию.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    topic: str  # ecommerce | retail | saas | tech | ai | mixed


SOURCES: list[Source] = [
    # E-commerce / retail
    Source("Retail.ru", "https://www.retail.ru/rss/", "retail"),
    Source("New Retail", "https://new-retail.ru/rss/", "retail"),
    Source("Shopolog", "https://www.shopolog.ru/rss/", "ecommerce"),
    Source("E-pepper", "https://e-pepper.ru/rss/", "ecommerce"),
    Source("Oborot.ru", "https://oborot.ru/rss/", "ecommerce"),
    Source("Retailer.ru", "https://retailer.ru/feed/", "retail"),
    # Технологии / SaaS / стартапы
    Source("CNews", "https://www.cnews.ru/inc/rss/news.xml", "tech"),
    Source("TAdviser", "https://www.tadviser.ru/xml/tadviser.xml", "saas"),
    Source("RB.RU", "https://rb.ru/feeds/all/", "mixed"),
    Source("vc.ru", "https://vc.ru/rss", "mixed"),
    Source("Хайтек", "https://hightech.fm/feed", "tech"),
    Source("Коммерсантъ · Hi-Tech", "https://www.kommersant.ru/RSS/section-hitech.xml", "tech"),
    Source("Ведомости · Технологии", "https://www.vedomosti.ru/rss/rubric/technology", "tech"),
    # AI
    Source("Хабр · ИИ", "https://habr.com/ru/rss/hub/artificial_intelligence/all/?fl=ru", "ai"),
    Source("Хабр · Новости", "https://habr.com/ru/rss/news/?fl=ru", "tech"),
]

# Ключевые слова для первичного отбора (нижний регистр). Статья проходит фильтр,
# если в заголовке или описании встречается хотя бы одно слово из списка.
# Окончательную проверку на релевантность делает модель.
KEYWORDS: tuple[str, ...] = (
    # ecommerce / retail
    "e-commerce", "ecommerce", "екоммерс", "e-com", "онлайн-торгов", "интернет-магазин",
    "маркетплейс", "wildberries", "ozon", "озон", "яндекс маркет", "яндекс.маркет", "мегамаркет",
    "avito", "авито", "lamoda", "ламода", "ритейл", "retail", "ретейл", "торгов", "магазин",
    "продаж", "покупател", "селлер", "продавц", "x5", "магнит", "лента", "вкусвилл", "самокат",
    "доставк", "логистик", "склад", "фулфилмент", "pvz", "пвз", "fmcg", "дрогери", "d2c",
    "цены", "инфляц", "спрос", "чек", "касс", "эквайринг", "оплат", "сбп", "рассрочк", "bnpl",
    # saas / tech
    "saas", "подписк", "облак", "cloud", "crm", "erp", "b2b", "платформ", "сервис", "api",
    "стартап", "инвестиц", "раунд", "it", "ит-", "софт", "по ", "цифров", "автоматизац",
    "no-code", "low-code", "1с", "битрикс", "импортозамещ", "реестр по", "минцифры",
    "кибер", "данн", "big data", "аналитик", "финтех", "банк", "сбер", "яндекс", "vk", "mts", "мтс",
    # ai
    "ии", "искусственн", "нейросет", "нейронн", "ai", "ml", "машинн", "llm", "gpt", "gigachat",
    "yandexgpt", "алиса", "чат-бот", "chatbot", "агент", "генератив", "рекомендательн",
    "компьютерное зрение", "распознаван",
)


def is_relevant_by_keywords(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in KEYWORDS)
