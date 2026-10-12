import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_rss() -> bytes:
    """Фикстура RSS с датой публикации «сейчас», чтобы фильтр по свежести её пропускал."""
    now = format_datetime(datetime.now(timezone.utc))
    return (FIXTURES / "sample.xml").read_text(encoding="utf-8").replace("PUBDATE", now).encode("utf-8")
