#!/usr/bin/env bash
# Startet FF-Overlay lokal zum Ausprobieren (macOS / Linux).
#   ./scripts/start-local.sh            → baut und startet auf http://localhost:3000
#   PORT=4000 ./scripts/start-local.sh  → anderer Port
#   ./scripts/start-local.sh --dev      → Entwicklungsmodus mit Hot Reload (http://localhost:5173)
# Beenden mit Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_PORT="$( [ -f .env ] && grep -E '^PORT=' .env | cut -d= -f2- || true)"
PORT="${PORT:-${ENV_PORT:-3000}}"
MODE="${1:-}"

# --- Node.js prüfen ---
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js fehlt. Installieren: https://nodejs.org (Version 22 oder neuer) oder 'brew install node'"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "✗ Node.js $(node -v) ist zu alt – bitte Version 22 oder neuer installieren."
  exit 1
fi

# --- .env beim ersten Start anlegen (zufälliges Passwort und Secret) ---
if [ ! -f .env ]; then
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(6).toString("base64url"))')"
  URL="http://localhost:$PORT"
  [ "$MODE" = "--dev" ] && URL="http://localhost:5173"
  cat > .env <<EOF
PUBLIC_URL=$URL
PORT=$PORT
ADMIN_PASSWORD=$PASSWORD
APP_SECRET=$SECRET
# Optional – für Twitch-Verbindung und GIF-Suche (siehe README):
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
GIPHY_API_KEY=
EOF
  echo "✓ .env angelegt (Passwort und Secret zufällig erzeugt)"
fi

PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"

# --- Abhängigkeiten ---
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "→ Installiere Abhängigkeiten …"
  npm install --no-audit --no-fund
fi

open_browser() {
  local url="$1"
  # warten, bis der Server antwortet
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$url" && break
    sleep 0.5
  done
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1
  fi
}

if [ "$MODE" = "--dev" ]; then
  DASH="http://localhost:5173"
  echo
  echo "  Dashboard:  $DASH"
  echo "  Passwort:   $PASSWORD"
  echo "  (Ctrl+C beendet)"
  echo
  open_browser "$DASH" &
  exec npm run dev
fi

echo "→ Baue Dashboard und Server …"
npm run build --silent

DASH="http://localhost:$PORT"
echo
echo "  Dashboard:  $DASH"
echo "  Passwort:   $PASSWORD"
echo "  Overlay-URL für OBS findest du im Dashboard unter „Overlays“."
echo "  Test-Alerts: Dashboard → Live → Test-Alerts. Daten liegen in ./data"
echo "  (Ctrl+C beendet)"
echo
open_browser "$DASH" &
PORT="$PORT" exec node dist/server/index.js
