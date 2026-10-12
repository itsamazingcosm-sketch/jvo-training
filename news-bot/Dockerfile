FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bot ./bot

ENV PYTHONUNBUFFERED=1 DB_PATH=/data/newsbot.sqlite3
VOLUME ["/data"]

CMD ["python", "-m", "bot.main"]
