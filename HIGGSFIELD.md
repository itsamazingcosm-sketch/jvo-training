# Higgsfield в Claude Code on the web

Каждая сессия Claude Code on the web стартует в чистом контейнере, поэтому CLI, skills и вход
пропадают. Хук `.claude/hooks/session-start.sh` ставит всё заново при запуске сессии (около 10 секунд):

1. зависимости и сборка `oura-mcp`;
2. CLI `@higgsfield/cli` (бинарник скачивается через curl, штатный postinstall в этой среде зависает);
3. skills `higgsfield-ai/skills` в `~/.claude/skills` (generate, product-photoshoot, marketplace-cards,
   brandkit, soul-id, video-explainer, websites, youtube-thumbnail);
4. учётные данные из переменной окружения `HIGGSFIELD_CREDENTIALS_JSON`, если она задана.

## Что настроить один раз в окружении Claude Code on the web

Настройки окружения: https://code.claude.com/docs/en/claude-code-on-the-web

**Сетевой доступ.** Добавьте в разрешённые хосты домены Higgsfield, иначе ни вход, ни генерация не
работают (прокси отвечает `connect_rejected`):

```
higgsfield.ai
clerk.higgsfield.ai
fnf-api-gw.higgsfield.ai
fnf.higgsfield.ai
github.com
objects.githubusercontent.com
```

`github.com` и `objects.githubusercontent.com` нужны для скачивания бинарника CLI и skills.

**Учётные данные (чтобы не входить каждую сессию).** На своём компьютере:

```bash
npm i -g @higgsfield/cli
higgsfield auth login          # откроется браузер
```

Затем возьмите содержимое файла `credentials.json`:

- macOS: `~/Library/Application Support/higgsfield/credentials.json`
- Linux: `~/.config/higgsfield/credentials.json`
- Windows: `%AppData%\higgsfield\credentials.json`

и сохраните его целиком в переменную окружения `HIGGSFIELD_CREDENTIALS_JSON` в настройках окружения
(можно в base64: `base64 -i credentials.json`). Хук положит файл на место, CLI сам обновит токен по
refresh-токену.

Если переменная не задана, вход можно пройти в сессии: Claude запускает `higgsfield auth login`,
даёт ссылку, вы подтверждаете в браузере и присылаете адрес `http://localhost:8765/callback?...`,
на который вас перекинуло.

## Проверка

```bash
higgsfield version
higgsfield auth token >/dev/null && echo "вход есть"
higgsfield account status
```
