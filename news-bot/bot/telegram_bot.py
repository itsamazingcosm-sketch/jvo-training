"""Telegram-бот: команды, подписки, автоматическая публикация."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter, TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

from .config import Settings
from .formatter import HELP_TEXT, format_news
from .pipeline import Post, build_digest
from .rewriter import Rewriter, from_json
from .storage import Storage

log = logging.getLogger(__name__)


class NewsBot:
    def __init__(self, settings: Settings, storage: Storage, rewriter: Rewriter):
        self.settings = settings
        self.storage = storage
        self.rewriter = rewriter
        self.bot = Bot(settings.telegram_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        self.dp = Dispatcher()
        self.router = Router()
        self.dp.include_router(self.router)
        self._run_lock = asyncio.Lock()
        self._register_handlers()

    # --- команды ---------------------------------------------------------
    def _register_handlers(self) -> None:
        r = self.router

        @r.message(CommandStart())
        async def start(message: Message) -> None:
            await message.answer("Привет! " + HELP_TEXT)

        @r.message(Command("help"))
        async def help_cmd(message: Message) -> None:
            await message.answer(HELP_TEXT)

        @r.message(Command("subscribe"))
        async def subscribe(message: Message) -> None:
            if self.storage.subscribe(message.chat.id):
                await message.answer("Готово: буду присылать выпуски автоматически. Отписаться — /unsubscribe.")
            else:
                await message.answer("Вы уже подписаны.")

        @r.message(Command("unsubscribe"))
        async def unsubscribe(message: Message) -> None:
            if self.storage.unsubscribe(message.chat.id):
                await message.answer("Отписал. Вернуться — /subscribe.")
            else:
                await message.answer("Вы и не были подписаны.")

        @r.message(Command("status"))
        async def status(message: Message) -> None:
            run = self.storage.last_run()
            if run is None:
                await message.answer("Сборов ещё не было. Нажмите /news.")
                return
            text = (
                f"Последний сбор: {run['started_at']}\n"
                f"Лент прочитано статей: {run['fetched']}, новых кандидатов: {run['candidates']}, "
                f"опубликовано: {run['posted']}"
            )
            if run["error"]:
                text += f"\nОшибка: {run['error']}"
            text += f"\nПодписчиков: {len(self.storage.subscribers())}"
            await message.answer(text)

        @r.message(Command("news"))
        async def news(message: Message) -> None:
            if self._run_lock.locked():
                await message.answer("Выпуск уже собирается, пришлю через минуту.")
                return
            await message.answer("Собираю свежие новости, это займёт около минуты…")
            posts = await self.run_digest(targets=[message.chat.id], post_to_channel=False)
            if not posts:
                last = self.storage.last_posted(limit=3)
                if last:
                    await message.answer("Новых новостей по теме пока нет. Вот последние из выпуска:")
                    for row in last:
                        try:
                            news_obj = from_json(row["rewritten_json"])
                        except ValueError:
                            continue
                        await self._send(message.chat.id, format_news(news_obj, url=row["url"], source=row["source"]))
                else:
                    await message.answer("Пока ничего подходящего не нашёл. Попробуйте позже.")

        @r.message(Command("run"), F.from_user)
        async def run_now(message: Message) -> None:
            if message.from_user.id not in self.settings.admin_ids:
                await message.answer("Эта команда только для администраторов.")
                return
            await message.answer("Запускаю плановый выпуск для канала и подписчиков…")
            posts = await self.run_digest()
            await message.answer(f"Готово, опубликовано новостей: {len(posts)}.")

    # --- публикация ------------------------------------------------------
    async def _send(self, chat_id: int | str, text: str) -> bool:
        try:
            await self.bot.send_message(chat_id, text, disable_web_page_preview=False)
            return True
        except TelegramRetryAfter as exc:
            await asyncio.sleep(exc.retry_after + 1)
            try:
                await self.bot.send_message(chat_id, text)
                return True
            except Exception as exc2:  # noqa: BLE001
                log.warning("Не удалось отправить в %s после паузы: %s", chat_id, exc2)
                return False
        except TelegramForbiddenError:
            log.info("Чат %s заблокировал бота — удаляю из подписчиков", chat_id)
            if isinstance(chat_id, int):
                self.storage.unsubscribe(chat_id)
            return False
        except TelegramBadRequest as exc:
            log.warning("Telegram отклонил сообщение для %s: %s", chat_id, exc)
            return False

    async def run_digest(self, targets: list[int | str] | None = None, post_to_channel: bool = True) -> list[Post]:
        """Собирает выпуск и рассылает его. Возвращает список опубликованных постов."""
        async with self._run_lock:
            run_id = self.storage.start_run()
            try:
                result = await build_digest(
                    self.storage,
                    self.rewriter,
                    max_items=self.settings.max_items_per_digest,
                    max_age_hours=self.settings.max_article_age_hours,
                )
            except Exception as exc:  # noqa: BLE001
                log.exception("Сбор выпуска упал")
                self.storage.finish_run(run_id, 0, 0, 0, error=str(exc)[:500])
                return []

            recipients: list[int | str] = list(targets) if targets is not None else list(self.storage.subscribers())
            if post_to_channel and self.settings.channel_id:
                recipients.insert(0, self.settings.channel_id)

            posted = 0
            for post in result.posts:
                text = format_news(post.news, post.article)
                delivered = False
                for chat_id in recipients:
                    delivered |= await self._send(chat_id, text)
                    await asyncio.sleep(0.1)
                self.storage.set_status(post.article.id, "posted" if delivered or not recipients else "failed")
                posted += 1
            self.storage.finish_run(run_id, result.fetched, result.candidates, posted)
            log.info("Выпуск готов: %d новостей, получателей %d", posted, len(recipients))
            return result.posts

    # --- планировщик -----------------------------------------------------
    async def scheduler(self) -> None:
        hours = self.settings.digest_interval_hours
        if hours <= 0:
            log.info("Автопубликация отключена (DIGEST_INTERVAL_HOURS=0)")
            return
        interval = hours * 3600
        log.info("Автопубликация каждые %d ч.", hours)
        while True:
            started = datetime.now(timezone.utc)
            try:
                await self.run_digest()
            except Exception:  # noqa: BLE001
                log.exception("Плановый выпуск упал")
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            await asyncio.sleep(max(60.0, interval - elapsed))

    async def start(self) -> None:
        me = await self.bot.get_me()
        log.info("Бот @%s запущен", me.username)
        scheduler_task = asyncio.create_task(self.scheduler())
        try:
            await self.dp.start_polling(self.bot, allowed_updates=["message"])
        finally:
            scheduler_task.cancel()
            await self.bot.session.close()
