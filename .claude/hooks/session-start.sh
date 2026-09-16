#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Готовит окружение: зависимости oura-mcp, CLI Higgsfield, skills Higgsfield и учётные данные.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
log() { echo "[session-start] $*"; }

# ---------- 1. oura-mcp: зависимости и сборка ----------
if [ -f "$ROOT/oura-mcp/package.json" ]; then
  log "oura-mcp: npm install"
  (cd "$ROOT/oura-mcp" && npm install --no-audit --no-fund --loglevel=error && npm run build --silent)
fi

# ---------- 2. Higgsfield CLI ----------
# Штатный postinstall качает бинарник с GitHub через Node без учёта прокси и зависает,
# поэтому ставим пакет без скриптов и скачиваем бинарник curl'ом (он прокси понимает).
if ! command -v higgsfield >/dev/null 2>&1 || ! higgsfield version >/dev/null 2>&1; then
  log "higgsfield: установка CLI"
  npm install -g @higgsfield/cli --ignore-scripts --no-audit --no-fund --loglevel=error
  PKG_DIR="$(npm root -g)/@higgsfield/cli"
  VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
  case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) ARCH=amd64;; esac
  TARBALL="hf_${VERSION}_linux_${ARCH}.tar.gz"
  mkdir -p "$PKG_DIR/vendor"
  curl -fsSL --retry 3 -o "$PKG_DIR/vendor/$TARBALL" \
    "https://github.com/higgsfield-ai/cli/releases/download/v${VERSION}/${TARBALL}"
  tar -xzf "$PKG_DIR/vendor/$TARBALL" -C "$PKG_DIR/vendor" hf
  chmod 755 "$PKG_DIR/vendor/hf"
  rm -f "$PKG_DIR/vendor/$TARBALL"
  printf '{\n  "install_method": "npm",\n  "package_manager": "npm",\n  "package_name": "@higgsfield/cli",\n  "version": "%s"\n}\n' "$VERSION" > "$PKG_DIR/vendor/install.json"
fi
log "higgsfield: $(higgsfield version 2>/dev/null | head -1)"

# ---------- 3. Skills Higgsfield для Claude Code ----------
if [ ! -f "$HOME/.claude/skills/higgsfield-generate/SKILL.md" ]; then
  log "higgsfield: установка skills"
  (cd /tmp && npx -y skills@latest add higgsfield-ai/skills -g -a claude-code -s '*' -y >/dev/null 2>&1) \
    || log "higgsfield: skills не установились (проверьте доступ к github.com)"
fi

# ---------- 4. Учётные данные Higgsfield ----------
# Переменная окружения HIGGSFIELD_CREDENTIALS_JSON: содержимое credentials.json с машины, где
# выполнен `higgsfield auth login` (можно как есть или в base64). Хранится в настройках
# окружения Claude Code on the web, не в репозитории.
CRED_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/higgsfield"
if [ -n "${HIGGSFIELD_CREDENTIALS_JSON:-}" ]; then
  mkdir -p "$CRED_DIR"
  if printf '%s' "$HIGGSFIELD_CREDENTIALS_JSON" | grep -q '^{'; then
    printf '%s\n' "$HIGGSFIELD_CREDENTIALS_JSON" > "$CRED_DIR/credentials.json"
  else
    printf '%s' "$HIGGSFIELD_CREDENTIALS_JSON" | base64 -d > "$CRED_DIR/credentials.json"
  fi
  chmod 600 "$CRED_DIR/credentials.json"
  if higgsfield auth token >/dev/null 2>&1; then
    log "higgsfield: учётные данные восстановлены"
  else
    log "higgsfield: учётные данные не приняты, нужен новый вход"
  fi
else
  log "higgsfield: HIGGSFIELD_CREDENTIALS_JSON не задана, вход потребуется вручную"
fi
