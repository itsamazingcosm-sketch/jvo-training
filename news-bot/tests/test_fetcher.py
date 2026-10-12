from bot.fetcher import clean_text, make_id, parse_feed
from bot.sources import Source, is_relevant_by_keywords


def test_parse_feed_filters_by_keywords_and_age(sample_rss):
    src = Source("Тест", "https://example.com/rss", "ecommerce")
    articles = parse_feed(sample_rss, src, max_age_hours=36)
    titles = [a.title for a in articles]
    assert any("Wildberries" in t for t in titles)
    assert any("Ozon" in t for t in titles)
    # фестиваль шаров не проходит фильтр по ключевым словам
    assert not any("шаров" in t for t in titles)
    # старая новость отсекается по дате
    assert not any("Старая" in t for t in titles)
    assert all(a.source == "Тест" and a.topic_hint == "ecommerce" for a in articles)


def test_clean_text_strips_html():
    assert clean_text("<p>Привет, &laquo;мир&raquo;!</p>  <br/>  ещё") == "Привет, «мир»! ещё"


def test_make_id_ignores_query_string():
    assert make_id("https://a.ru/x?utm=1", "t") == make_id("https://a.ru/x", "t")
    assert make_id("https://a.ru/x", "t") != make_id("https://a.ru/y", "t")


def test_keywords():
    assert is_relevant_by_keywords("Ozon открыл новый склад")
    assert is_relevant_by_keywords("Стартап привлёк раунд инвестиций")
    assert not is_relevant_by_keywords("Погода в выходные будет солнечной")
