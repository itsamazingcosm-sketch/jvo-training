# Oura MCP-сервер

Собственный [MCP](https://modelcontextprotocol.io)-сервер для [Oura API v2](https://cloud.ouraring.com/v2/docs).
Даёт Claude (Desktop, Claude Code, любой MCP-клиент) доступ к данным кольца: готовность (readiness),
сон, HRV, пульс, активность, стресс, тренировки. Из этого собираются дашборды и разборы вида
«как прошла неделя», «стоит ли сегодня делать тяжёлую тренировку».

Стек: Node.js 20+, TypeScript, `@modelcontextprotocol/sdk`, без других зависимостей. Транспорт stdio.

В комплекте веб-дашборд (`npm run web`): страница с KPI, графиками готовности, сна, HRV, пульса покоя, фаз сна,
тренировок и стресса, таблицей по дням и входом по паролю. Разворачивается на сервере в Docker, см. ниже.

## Что умеет

| Инструмент | Что возвращает |
|---|---|
| `oura_dashboard` | Одним вызовом: по дням readiness / sleep / activity score, длительность и фазы сна, средний HRV, минимальный (покойный) пульс, отклонение температуры, шаги, калории, тренировки, стресс, SpO2. Плюс средние за период, HRV и RHR относительно среднего, подсчёт тренировочной нагрузки (минуты × интенсивность). `format=markdown` даёт компактную таблицу. |
| `oura_daily_readiness` | Readiness score и contributors (hrv_balance, resting_heart_rate, sleep_balance, recovery_index, body_temperature…) |
| `oura_daily_sleep` | Sleep score и contributors |
| `oura_sleep_periods` | Детальные периоды сна: время в кровати, deep / REM / light, эффективность, latency, средний HRV, минимальный и средний пульс, дыхание. `include_series=true` добавляет 5-минутные ряды HRV / пульса и фазы сна |
| `oura_daily_activity` | Шаги, калории, время высокой / средней / низкой активности, MET |
| `oura_workouts` | Тренировки: тип, интенсивность, время, калории, дистанция |
| `oura_sessions` | Медитации, дыхательные сессии, дневной сон |
| `oura_heart_rate` | Пульс каждые ~5 минут за интервал; `bucket_minutes=60` усредняет по часам, `source=sleep` фильтрует по источнику |
| `oura_daily_stress` | Минуты стресса и восстановления за день, итог дня |
| `oura_daily_resilience` | Уровень резилентности и его составляющие |
| `oura_daily_spo2` | SpO2 во сне и индекс дыхательных нарушений |
| `oura_vo2_max`, `oura_cardiovascular_age` | VO2 max и «сосудистый возраст» |
| `oura_sleep_time` | Рекомендуемое окно отхода ко сну |
| `oura_tags`, `oura_rest_mode_periods`, `oura_ring_configuration`, `oura_personal_info` | Теги, режим отдыха, кольцо, профиль |
| `oura_raw_get` | Любой GET к `/v2/...` с параметрами, если чего-то не хватает |

Промпты: `oura_morning_briefing` (утренний брифинг по готовности) и `oura_weekly_review` (разбор недели).

У всех «дневных» инструментов одинаковые параметры: `start_date`, `end_date` (YYYY-MM-DD), `days`
(окно, если начало не задано; по умолчанию 7), `next_token` и `max_pages` для пагинации. Без параметров
возвращаются последние 7 дней. «Сегодня» считается в часовом поясе `OURA_TIMEZONE`.

Плотные ряды (5-минутный HRV, пульс, MET, строки фаз сна) по умолчанию вырезаются, чтобы не раздувать
контекст. Их можно запросить через `include_series=true`.

## Установка

```bash
cd oura-mcp
npm install
npm run build
```

## Авторизация

Нужен токен Oura. Два варианта.

### Вариант A: готовый токен

Если у вас уже есть Personal Access Token (создавались на
[cloud.ouraring.com/personal-access-tokens](https://cloud.ouraring.com/personal-access-tokens)),
просто передайте его в `OURA_ACCESS_TOKEN`. Сервер использует его как есть.

Важно: по данным на сентябрь 2026 Oura прекратила выдачу новых Personal Access Token (примерно с
декабря 2025). Ранее выданные токены могут продолжать работать, но для новой интеграции Oura требует
OAuth2. Если страница создания PAT у вас больше не доступна, используйте вариант B.

### Вариант B: своё OAuth2-приложение (рекомендуется)

1. Создайте приложение на [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications).
   В Redirect URI укажите `http://localhost:8484/callback` (или свой, тогда задайте `OURA_REDIRECT_URI`).
2. Скопируйте Client ID и Client Secret в окружение:

   ```bash
   cp .env.example .env     # заполните OURA_CLIENT_ID и OURA_CLIENT_SECRET
   set -a; source .env; set +a
   ```

3. Один раз пройдите авторизацию:

   ```bash
   npm run auth
   ```

   В консоли появится ссылка. Откройте её, разрешите доступ, страница перекинет на localhost, и токены
   сохранятся в `~/.oura-mcp/tokens.json` (права 0600). Дальше сервер сам обновляет access token по
   refresh token: до истечения срока и при ответе 401.

4. Проверка:

   ```bash
   npm run status     # покажет источник токена и выведет personal_info
   ```

Scopes по умолчанию: `personal daily heartrate workout session tag spo2`. Меняются через `OURA_SCOPES`.
Без `personal` не будет `oura_personal_info`, без `heartrate` не будет пульса и так далее.

Переменные окружения:

| Переменная | Назначение |
|---|---|
| `OURA_ACCESS_TOKEN` | Готовый токен (PAT или access_token). Если задан, файл токенов не используется |
| `OURA_REFRESH_TOKEN` | Вместе с `OURA_ACCESS_TOKEN` и client id / secret включает автообновление |
| `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` | OAuth2-приложение |
| `OURA_REDIRECT_URI` | По умолчанию `http://localhost:8484/callback` |
| `OURA_SCOPES` | Scopes через пробел |
| `OURA_TOKEN_PATH` | Где хранить токены, по умолчанию `~/.oura-mcp/tokens.json` |
| `OURA_TIMEZONE` | IANA-зона для «сегодня», например `Europe/Moscow` |
| `PUBLIC_URL` | Публичный адрес дашборда; redirect URI = `PUBLIC_URL/callback` |
| `DOMAIN` | Домен для контейнера Caddy из docker-compose |
| `DASHBOARD_PASSWORD` | Пароль входа на дашборд |
| `SESSION_SECRET` | Секрет подписи cookie сессии |
| `PORT` | Порт веб-сервера, по умолчанию 8484 |

## Подключение к Claude

### Claude Code

```bash
claude mcp add oura -e OURA_CLIENT_ID=... -e OURA_CLIENT_SECRET=... -- node /абсолютный/путь/oura-mcp/dist/index.js
```

Или положите `examples/mcp.json` в корень проекта как `.mcp.json`.

### Claude Desktop

Добавьте блок из `examples/claude_desktop_config.json` в `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), подставив абсолютный путь
и свои ключи. Если используете вариант B, сначала выполните `npm run auth` в терминале: Claude Desktop не
умеет открывать браузер за вас, а токены он потом прочитает из `~/.oura-mcp/tokens.json`.

## Примеры запросов

- «Покажи дашборд за 14 дней таблицей» → `oura_dashboard` с `days=14`, `format=markdown`
- «Как я спал сегодня, с фазами и HRV?» → `oura_sleep_periods` с `days=1`
- «Пульс во время сна по часам за прошлую ночь» → `oura_heart_rate` с `source=sleep`, `bucket_minutes=60`
- «Какая нагрузка была на этой неделе по типам тренировок?» → `oura_workouts` или блок `training_load` в дашборде
- «Утренний брифинг» → промпт `oura_morning_briefing`

## Веб-дашборд по ссылке

Команда `oura-mcp web` поднимает HTTP-сервер: страница `/` с графиками, `/api/dashboard` с теми же
данными в JSON, `/login` с паролем, `/connect` для привязки аккаунта Oura через OAuth прямо из браузера.

Локально:

```bash
DASHBOARD_PASSWORD=секрет OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... npm run web
# открыть http://localhost:8484 -> ввести пароль -> «Подключить Oura»
```

### На VPS Beget (или любом Ubuntu / Debian) одной командой

1. **Создайте VPS** в панели Beget: образ Ubuntu 24.04 (подойдёт и готовый образ «Docker» из маркетплейса),
   минимальный тариф хватит. Вход по SSH под `root`, пароль или ключ придут в панели.
2. **Домен.** В разделе DNS Beget добавьте A-запись, например `oura.вашдомен.ru` → IP сервера. Если домен
   у другого регистратора, A-запись делается там. Подождите несколько минут, пока запись разойдётся.
3. **Приложение Oura** на [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications):
   в Redirect URIs укажите `https://oura.вашдомен.ru/callback`, скопируйте Client ID и Client Secret.
4. **На сервере** (по SSH):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/itsamazingcosm-sketch/jvo-training/claude/oura-mcp-server-p9ukul/oura-mcp/deploy/install.sh | bash
   ```

   Скрипт спросит домен, Client ID / Secret, пароль для входа и часовой пояс. Можно передать их сразу и
   ничего не вводить:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/itsamazingcosm-sketch/jvo-training/claude/oura-mcp-server-p9ukul/oura-mcp/deploy/install.sh \
     | DOMAIN=oura.вашдомен.ru OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... DASHBOARD_PASSWORD=... bash
   ```

   Затем скрипт:
   поставит Docker из репозитория Ubuntu (сайт Docker из России недоступен), подключит зеркала Docker Hub
   (`dockerhub1.beget.com`, `dockerhub.timeweb.cloud`, `mirror.gcr.io`), скачает код в `/opt/oura`,
   соберёт образ и поднимет два контейнера: дашборд и Caddy с автоматическим HTTPS-сертификатом.
   Повторный запуск той же команды обновляет код.
5. Откройте `https://oura.вашдомен.ru`, введите пароль, нажмите «Подключить Oura», разрешите доступ.

Файлы: настройки в `/opt/oura/jvo-training/oura-mcp/.env`, токены Oura и сертификаты в volume Docker.
Логи: `cd /opt/oura/jvo-training/oura-mcp && docker compose logs -f`.

Если Docker Hub всё же не тянется (ошибка `pull access denied` или таймаут на `node:22-alpine`), проверьте
`/etc/docker/daemon.json` (там должны быть зеркала из `deploy/daemon.json`) и выполните
`systemctl restart docker`.

### Вручную (Docker Compose)

То же самое руками на сервере с Docker:

```bash
git clone https://github.com/itsamazingcosm-sketch/jvo-training.git && cd jvo-training/oura-mcp
cp .env.example .env
# заполнить: DOMAIN, PUBLIC_URL=https://$DOMAIN, OURA_CLIENT_ID, OURA_CLIENT_SECRET,
#            DASHBOARD_PASSWORD, SESSION_SECRET (openssl rand -hex 32), OURA_TIMEZONE
docker compose up -d --build          # дашборд + Caddy (порты 80/443)
docker compose up -d --build oura     # только дашборд на 127.0.0.1:8484, если HTTPS делает ваш nginx/Caddy
```

Для своего прокси на хосте есть `Caddyfile.example`. Обновление: `git pull && docker compose up -d --build`.

Тот же образ можно запустить на Railway, Render, Fly.io и подобных: укажите переменные из `.env.example`,
примонтируйте volume в `/data` (или задайте `OURA_TOKEN_PATH`), а `PUBLIC_URL` поставьте равным выданному
адресу. Без volume токены пропадут при перезапуске и придётся заново нажимать «Подключить Oura».

Что важно для безопасности: `DASHBOARD_PASSWORD` обязателен, если сервер виден из интернета; `SESSION_SECRET`
нужен, чтобы сессии переживали рестарт; наружу ничего кроме HTTPS-порта не открывайте. Внутри дашборда
токены Oura никогда не отдаются в браузер, все запросы к Oura идут с сервера.

## Ограничения и заметки

- Oura ограничивает частоту запросов (порядка 5000 запросов за 5 минут). Сервер повторяет запросы при 429 и
  5xx с учётом `Retry-After`, до 3 попыток.
- Данные за текущий день появляются после синхронизации кольца с приложением Oura.
- SpO2, стресс, резилентность и VO2 max доступны не на всех кольцах и тарифах: такие коллекции вернут
  пустой список или ошибку 403, дашборд при этом отдаст остальное и перечислит недоступные коллекции.
- Токены никогда не попадают в ответы инструментов и не пишутся в stdout.
- Всё, что возвращает сервер, это данные о здоровье. Это не медицинская диагностика.

## Разработка

```bash
npm run typecheck
npm test          # node:test, сеть замокана
npm run dev       # tsc --watch
```

Структура: `src/config.ts` (env и даты), `src/auth.ts` (хранилище токенов, OAuth2, провайдеры),
`src/oura-client.ts` (HTTP, ретраи, пагинация), `src/summaries.ts` (агрегация для дашборда),
`src/server.ts` (инструменты и промпты MCP), `src/web.ts` (веб-дашборд и OAuth в браузере),
`public/index.html` (страница дашборда, без внешних библиотек), `src/index.ts` (CLI: serve / auth / status / web).
