#!/usr/bin/env bash
# Установка Oura-дашборда на VPS (Ubuntu / Debian, в т.ч. Beget) одной командой.
# Запуск на сервере под root (или пользователем с sudo):
#   curl -fsSL https://raw.githubusercontent.com/itsamazingcosm-sketch/jvo-training/claude/oura-mcp-server-p9ukul/oura-mcp/deploy/install.sh | bash
# Скрипт идемпотентный: повторный запуск обновит код и перезапустит контейнеры, .env не тронет.
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

say "Пакеты: git, curl"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git curl ca-certificates >/dev/null

# ---------- Docker ----------
# download.docker.com и Docker Hub из России недоступны, поэтому ставим Docker из репозитория
# дистрибутива и подключаем зеркала Docker Hub (Beget, Timeweb, Google).
if ! command -v docker >/dev/null; then
  say "Docker из репозитория дистрибутива"
  $SUDO apt-get install -y -qq docker.io >/dev/null || {
    echo "docker.io не установился, пробую get.docker.com"
    curl -fsSL https://get.docker.com | $SUDO sh
  }
fi
if ! docker compose version >/dev/null 2>&1; then
  say "Docker Compose v2"
  $SUDO apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 \
    || $SUDO apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 \
    || {
      echo "Пакета compose нет, скачиваю плагин с GitHub"
      arch="$(uname -m)"; case "$arch" in x86_64) arch=x86_64;; aarch64|arm64) arch=aarch64;; esac
      $SUDO mkdir -p /usr/local/lib/docker/cli-plugins
      $SUDO curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$arch" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
      $SUDO chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    }
fi
if [ ! -f /etc/docker/daemon.json ]; then
  say "Зеркала Docker Hub (/etc/docker/daemon.json)"
  $SUDO mkdir -p /etc/docker
  cat <<'JSON' | $SUDO tee /etc/docker/daemon.json >/dev/null
{
  "registry-mirrors": [
    "https://dockerhub1.beget.com",
    "https://dockerhub.timeweb.cloud",
    "https://mirror.gcr.io"
  ]
}
JSON
  $SUDO systemctl restart docker
fi
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null

# ---------- код ----------
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

# ---------- настройки ----------
if [ ! -f .env ]; then
  say "Настройки (сохранятся в $APP_DIR/.env)"
  echo "Client ID и Client Secret: https://cloud.ouraring.com/oauth/applications"
  ask DOMAIN "Домен дашборда (A-запись уже указывает на этот сервер), напр. oura.example.com"
  ask OURA_CLIENT_ID "OURA_CLIENT_ID"
  ask OURA_CLIENT_SECRET "OURA_CLIENT_SECRET" "" secret
  ask DASHBOARD_PASSWORD "Пароль для входа на дашборд" "" secret
  ask OURA_TIMEZONE "Часовой пояс" "Europe/Moscow"
  SESSION_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
OURA_CLIENT_ID=$OURA_CLIENT_ID
OURA_CLIENT_SECRET=$OURA_CLIENT_SECRET
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
SESSION_SECRET=$SESSION_SECRET
OURA_TIMEZONE=$OURA_TIMEZONE
OURA_SCOPES=personal daily heartrate workout session tag spo2
ENV
  umask 022
else
  echo ".env уже есть, оставляю как есть"
  grep -q '^DOMAIN=' .env || { d="$(sed -n 's#^PUBLIC_URL=https\?://##p' .env | head -1)"; echo "DOMAIN=$d" >> .env; }
fi
DOMAIN="$(sed -n 's#^DOMAIN=##p' .env | head -1)"
[ -n "$DOMAIN" ] || { echo "В .env нет DOMAIN"; exit 1; }

# ---------- firewall ----------
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  say "ufw: открываю 80 и 443"
  $SUDO ufw allow 80/tcp >/dev/null; $SUDO ufw allow 443/tcp >/dev/null; $SUDO ufw allow 443/udp >/dev/null
fi

# ---------- запуск ----------
say "Сборка и запуск (oura + caddy)"
$SUDO docker compose up -d --build

for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS http://127.0.0.1:8484/healthz >/dev/null 2>&1 && ok=1 && break
  sleep 2
done
if [ "${ok:-}" = 1 ]; then
  say "Готово: https://$DOMAIN"
  cat <<MSG

Дальше:
  1. В приложении Oura (https://cloud.ouraring.com/oauth/applications) в Redirect URIs
     должно быть ровно:  https://$DOMAIN/callback
  2. Откройте https://$DOMAIN, введите пароль, нажмите «Подключить Oura», разрешите доступ.
  3. Сертификат выпускается 10-30 секунд после первого открытия сайта; нужны открытые порты 80 и 443
     и A-запись $DOMAIN -> IP этого сервера.

Команды:
  логи:        cd $APP_DIR && docker compose logs -f
  обновление:  bash $APP_DIR/deploy/install.sh
  перезапуск:  cd $APP_DIR && docker compose restart
  настройки:   nano $APP_DIR/.env && cd $APP_DIR && docker compose up -d
MSG
else
  echo "Контейнер oura не отвечает на /healthz. Логи:"
  $SUDO docker compose logs --tail=50
  exit 1
fi
