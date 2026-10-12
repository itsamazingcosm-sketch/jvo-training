from bot.storage import Storage


def test_remember_is_idempotent(tmp_path):
    s = Storage(tmp_path / "db.sqlite3")
    assert s.remember("a1", "https://x", "Заголовок", "Src", None) is True
    assert s.remember("a1", "https://x", "Заголовок", "Src", None) is False
    assert s.is_seen("a1")
    s.set_status("a1", "posted", '{"x": 1}')
    assert s.recent_posted_titles() == ["Заголовок"]
    assert s.last_posted()[0]["rewritten_json"] == '{"x": 1}'


def test_subscribers(tmp_path):
    s = Storage(tmp_path / "db.sqlite3")
    assert s.subscribe(1) and not s.subscribe(1)
    assert s.is_subscribed(1)
    assert s.subscribers() == [1]
    assert s.unsubscribe(1) and not s.unsubscribe(1)


def test_runs(tmp_path):
    s = Storage(tmp_path / "db.sqlite3")
    rid = s.start_run()
    s.finish_run(rid, fetched=10, candidates=3, posted=2)
    run = s.last_run()
    assert run["fetched"] == 10 and run["posted"] == 2 and run["error"] is None
