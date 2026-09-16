#!/usr/bin/env bash
# Установка Oura-дашборда на VPS (Ubuntu / Debian) одной командой.
# Запуск на сервере (под root или пользователем с sudo):
#   curl -fsSL https://raw.githubusercontent.com/itsamazingcosm-sketch/jvo-training/claude/oura-mcp-server-p9ukul/oura-mcp/deploy/install.sh | bash
# Скрипт идемпотентный: повторный запуск обновит код и перезапустит контейнер, .env не тронет.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/itsamazingcosm-sketch/jvo-training.git}"
BRANCH="${BRANCH:-claude/oura-mcp-server-p9ukul}"
INSTALL_DIR="${INSTALL_DIR:-/opt/oura}"
APP_DIR="$INSTALL_DIR/jvo-training/oura-mcp"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || { echo "Нужен root или sudo"; exit 1; }
  SUDO="sudo"
fi

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ask() { # ask VAR "Вопрос" [default] [secret]
  local var="$1" prompt="$2" def="${3:-}" secret="${4:-}" val
  if [ -n "$def" ]; then prompt="$prompt [$def]"; fi
  if [ -n "$secret" ]; then read -r -s -p "$prompt: " val </dev/tty; echo; else read -r -p "$prompt: " val </dev/tty; fi
  val="${val:-$def}"
  printf -v "$var" '%s' "$val"
}

say "Пакеты: git, curl, Docker, Caddy"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! docker compose version >/dev/null 2>&1; then
  $SUDO apt-get install -y -qq docker-compose-plugin >/dev/null
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq caddy >/dev/null
fi

say "Код: $REPO_URL ($BRANCH) -> $APP_DIR"
$SUDO mkdir -p "$INSTALL_DIR"
$SUDO chown "$(id -u):$(id -g)" "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/jvo-training/.git" ]; then
  git -C "$INSTALL_DIR/jvo-training" fetch -q origin "$BRANCH"
  git -C "$INSTALL_DIR/jvo-training" checkout -q "$BRANCH"
  git -C "$INSTALL_DIR/jvo-training" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR/jvo-training"
fi
cd "$APP_DIR"

if [ ! -f .env ]; then
  say "Настройки (сохранятся в $APP_DIR/.env)"
  echo "Client ID и Client Secret: https://cloud.ouraring.com/oauth/applications"
  ask DOMAIN "Домен дашборда (уже направлен на этот сервер), напр. oura.example.com"
  ask OURA_CLIENT_ID "OURA_CLIENT_ID"
  ask OURA_CLIENT_SECRET "OURA_CLIENT_SECRET" "" secret
  ask DASHBOARD_PASSWORD "Пароль для входа на дашборд" "" secret
  ask OURA_TIMEZONE "Часовой пояс" "Europe/Moscow"
  SESSION_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  umask 077
  cat > .env <<ENV
OURA_CLIENT_ID=$OURA_CLIENT_ID
OURA_CLIENT_SECRET=$OURA_CLIENT_SECRET
PUBLIC_URL=https://$DOMAIN
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
SESSION_SECRET=$SESSION_SECRET
OURA_TIMEZONE=$OURA_TIMEZONE
OURA_SCOPES=personal daily heartrate workout session tag spo2
ENV
  umask 022
else
  echo ".env уже есть, оставляю как есть"
fi
DOMAIN="$(sed -n 's#^PUBLIC_URL=https\?://##p' .env | head -1)"
[ -n "$DOMAIN" ] || { echo "В .env нет PUBLIC_URL"; exit 1; }

say "Caddy: HTTPS для $DOMAIN -> 127.0.0.1:8484"
printf '%s {\n    reverse_proxy 127.0.0.1:8484\n}\n' "$DOMAIN" | $SUDO tee /etc/caddy/Caddyfile >/dev/null
$SUDO systemctl enable --now caddy >/dev/null 2>&1 || true
$SUDO systemctl reload caddy || $SUDO systemctl restart caddy

say "Сборка и запуск контейнера"
$SUDO docker compose up -d --build

sleep 3
if curl -fsS http://127.0.0.1:8484/healthz >/dev/null; then
  say "Готово: https://$DOMAIN"
  cat <<MSG

Дальше:
  1. В приложении Oura (https://cloud.ouraring.com/oauth/applications) в Redirect URIs
     должно быть ровно:  https://$DOMAIN/callback
  2. Откройте https://$DOMAIN, введите пароль, нажмите «Подключить Oura», разрешите доступ.
  3. Сертификат Caddy выпускает 10-30 секунд после первого запроса; порты 80 и 443 должны быть открыты.

Команды:
  логи:        cd $APP_DIR && sudo docker compose logs -f
  обновление:  bash $APP_DIR/deploy/install.sh
  перезапуск:  cd $APP_DIR && sudo docker compose restart
  изменить настройки: nano $APP_DIR/.env && cd $APP_DIR && sudo docker compose up -d
MSG
else
  echo "Контейнер не отвечает на /healthz. Логи:"
  $SUDO docker compose logs --tail=50
  exit 1
fi
