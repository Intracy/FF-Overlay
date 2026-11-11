# FF-Overlay

Selbst gehostetes Stream-Alert-System: Events von **Twitch**, **betterplace** und **eigenen Webhooks** laufen durch eine **Regel-Engine** und erscheinen als animierte Alerts in einer **Browserquelle** (OBS, vMix, Streamlabs Desktop …). Konfiguriert wird alles in einem Web-Dashboard.

Das Projekt setzt Phase 1 (MVP) des Konzepts „Stream-Alert-System“ um, ergänzt um betterplace-Polling und generische Webhooks.

```
Twitch EventSub ─┐
betterplace API ─┼─► Connectoren ─► Event-Normalizer ─► Filter ─► Regel-Engine ─► Alert-Queue ─► Overlay (OBS)
Webhooks ────────┘                                                                    ▲
                                                Dashboard (REST + WebSocket) ─────────┘
```

## Funktionen

**Quellen**
- **Twitch** über EventSub-WebSocket (funktioniert hinter NAT, kein öffentlicher Webhook nötig): Follow, Sub, Resub (Monate, Streak, Nachricht), Gift-Subs inkl. anonym, Bits, Raids, Kanalpunkte, Stream online/offline. OAuth mit automatischem Token-Refresh, Reconnect nach Twitch-Vorgaben.
- **betterplace** Spendenaktionen über die Public API v4 (Polling ≥ 15 s mit ETag, Duplikat-Filter; vorhandene Spenden lösen beim Einrichten keinen Alert aus).
- **Eigene Webhooks** für Ko-fi, Streamer.bot, Zapier oder eigene Tools.

**Regeln** (mehr als Streamlabs: beliebig viele UND-Bedingungen pro Regel)
- Auslöser: Event-Typ + optional Subtyp (Sub/Resub/Gift) und Plattform
- Bedingungen: mindestens, höchstens, genau, nicht, zwischen, enthält, Regex, leer/nicht leer, **größter Betrag dieses Streams**, **erstes Event dieses Users**, **Zufall in %**
- Priorität (höchste gewinnt) und Gewichtung (Zufall unter Gleichen), „nur wenn live“
- Begründung im Event-Log: *„Regel ‚Große Spende‘, weil amount.value ≥ 50“* und ein Prüf-Werkzeug „Welche Regel greift?“

**Alert-Designs**
- GIFs und Sticker direkt über **GIPHY** suchen (Proxy, Key bleibt auf dem Server), eigene Uploads (GIF, PNG, WebP, WebM mit Transparenz, MP4, Sounds)
- Text mit Platzhaltern `{user} {amount} {count} {months} {streak} {tier} {product} {gifter} {message}` (`{name}` funktioniert wie bei Streamlabs), Akzentfarbe für Name/Betrag, Kontur, Schatten, Google Fonts
- Ein-/Ausblend-Animationen mit Animate.css-Namen (Fade, Zoom, Bounce, Slide, Flip, Rotate, Specials), Text-Intro/-Outro und Buchstaben-Animationen (Welle, Hüpfen, Pulsieren, Gummiband, Tada, Wackeln, Schwanken)
- Layouts (Bild über/unter Text, Bild links, nur Text) oder manuelle Positionierung in %
- Live-Vorschau im Editor mit exakt derselben Render-Logik wie im Overlay

**Live-Steuerung**
- Event-Feed mit Filtern, Lesebestätigung, Replay, Popout-Fenster
- Pro Overlay: Pause/Fortsetzen, Skip, Stumm, Master-Lautstärke, Queue leeren, Browserquellen neu laden, Anzeige verbundener Quellen
- Test-Alerts für jeden Event-Typ, die durch dieselben Filter und Regeln laufen

**Weiteres**
- Mehrere Overlays mit eigener URL, Queue und eigenen Regeln
- Globale Filter: Mindestbetrag, Sperrliste, Schimpfwort-Filter (zensieren oder ausblenden; Namen werden anonymisiert)
- Gift-Bündelung: Einzel-Subs der Gift-Empfänger erscheinen nur im Log, der Alert kommt vom Gift-Event
- Event-Log wird nach `EVENT_RETENTION_DAYS` (Standard 30) gelöscht

## Schnellstart

Voraussetzung: Node.js ≥ 22 (macOS: `brew install node`).

**Zum Ausprobieren – ein Befehl:**

```bash
./scripts/start-local.sh        # oder: npm run local
```

Das Skript legt beim ersten Start eine `.env` an, installiert die Abhängigkeiten, baut alles, startet auf http://localhost:3000 und öffnet das Dashboard direkt – ohne Login. Mit `--dev` startet es stattdessen den Entwicklungsmodus mit Hot Reload.

**Manuell:**

```bash
cp .env.example .env      # Werte eintragen
npm install
npm run dev               # Backend :3000 + Dashboard mit Hot Reload :5173
```

Dashboard: http://localhost:5173 (ohne `ADMIN_PASSWORD` ohne Login).
Beim ersten Start legt FF-Overlay ein „Haupt-Overlay“ mit Standard-Designs und -Regeln an.

Produktion ohne Docker:

```bash
npm run build && NODE_ENV=production npm start   # alles auf Port 3000
```

### Docker (z. B. auf dem NAS)

```bash
cp .env.example .env      # APP_SECRET, PUBLIC_URL und ggf. ADMIN_PASSWORD setzen
docker compose up -d --build
```

Daten (SQLite-Datenbank + Uploads) liegen in `./data`. Backup = diesen Ordner sichern.

## Einrichtung

### Overlay in OBS
1. Dashboard → **Overlays** → URL kopieren (sie enthält einen geheimen Key – nicht im Stream zeigen).
2. OBS → Quelle hinzufügen → **Browser** → URL einfügen, 1920 × 1080.
3. „Audio über OBS steuern“ aktivieren, damit Alert-Sounds im Mixer landen.
4. Hängt man `&debug=1` an die URL, zeigt die Quelle ihren Verbindungsstatus.

Ist der Key einmal sichtbar geworden: **Key erneuern** – alte Quellen werden sofort getrennt.

### Twitch
1. App anlegen unter https://dev.twitch.tv/console/apps
2. OAuth-Redirect-URL: `<PUBLIC_URL>/auth/twitch/callback` (z. B. `http://localhost:3000/auth/twitch/callback`)
3. `TWITCH_CLIENT_ID` und `TWITCH_CLIENT_SECRET` in `.env` eintragen, neu starten
4. Dashboard → **Verbindungen** → „Mit Twitch verbinden“ (mit dem Broadcaster-Account)

Benötigte Scopes: `moderator:read:followers`, `channel:read:subscriptions`, `bits:read`, `channel:read:redemptions`.

### GIPHY
Key unter https://developers.giphy.com/dashboard/ anlegen und als `GIPHY_API_KEY` setzen. Neue Keys sind Beta-Keys (100 Aufrufe/Stunde); für mehr ein Production-Upgrade beantragen. Die Kennzeichnung „Powered By GIPHY“ ist im Picker enthalten.

### betterplace
Dashboard → **Verbindungen** → Link oder ID der Spendenaktion einfügen. Die Public API ist laut betterplace auf dem Weg zur Deprecation; für Charity-Streams bietet betterplace auch Spenden-Webhooks an (charitystream@betterplace.org) – die lassen sich später als eigener Connector ergänzen.

### Eigener Webhook

```bash
curl -X POST "<Webhook-URL aus dem Dashboard>" \
  -H 'content-type: application/json' \
  -d '{"type":"donation","user":"Max","amount":5,"currency":"EUR","message":"Danke!"}'
```

Felder: `type` (follow, subscription, cheer, donation, raid, redemption, custom), `subtype`, `user`, `amount`, `currency`, `message`, `count`, `months`, `tier`, `product`, optional `id` (zum Deduplizieren).

## Umgebungsvariablen

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `PUBLIC_URL` | ja | Öffentliche Basis-URL (für Overlay-URLs und Twitch-OAuth) |
| `ADMIN_PASSWORD` | – | Passwort fürs Dashboard; leer = kein Login. Setzen, sobald das Dashboard außerhalb deines Rechners erreichbar ist |
| `APP_SECRET` | in Produktion | ≥ 32 Zeichen; signiert Cookies und verschlüsselt OAuth-Tokens (AES-256-GCM) |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | für Twitch | Twitch-App |
| `GIPHY_API_KEY` | für GIPHY | GIPHY-Suche |
| `PORT` | – | Standard 3000 |
| `DATA_DIR` | – | Standard `./data` |
| `BETTERPLACE_POLL_SECONDS` | – | Standard 20, minimal 15 |
| `EVENT_RETENTION_DAYS` | – | Standard 30 |

## Projektstruktur

```
server/src/
  index.ts, app.ts          Start & Fastify-Setup (REST, WebSocket, statische Dateien)
  shared/types.ts           Gemeinsame Typen für Backend, Dashboard, Overlay
  connectors/               twitch/ (OAuth, EventSub, Normalisierung), betterplace.ts, webhook.ts, manager.ts
  events/pipeline.ts        Filter → Regel-Engine → Queue, Event-Log, Stream-Session
  rules/engine.ts           Bedingungen, Priorität, Gewichtung, Begründung
  queue/alertQueue.ts       Warteschlange pro Overlay (Pause, Skip, Timeout)
  templates/render.ts       Platzhalter → Text-Segmente (Overlay setzt nur Text, kein HTML)
  routes/                   auth, api, connections (+ Twitch-OAuth, Webhooks), media (+ GIPHY-Proxy), ws
  db.ts                     SQLite-Schema & Zugriff
server/test/                Vitest: Engine, Normalisierung, Queue, API inkl. WebSocket-Ende-zu-Ende
web/
  index.html, dashboard/    React-Dashboard
  overlay/                  Browserquelle + gemeinsamer Renderer (auch für die Editor-Vorschau)
  shared/animations.ts      Animationslisten
```

## Entwicklung

```bash
npm test          # Vitest
npm run typecheck # Backend + Frontend
npm run build     # dist/web + dist/server
```

## Entscheidungen

- **SQLite statt PostgreSQL** (abweichend vom Konzept): Single-User, eine Datei, kein zusätzlicher Dienst – ideal zum Selbsthosten auf NAS oder Mini-Server. Regeln und Designs liegen als JSON; ein späterer Wechsel auf PostgreSQL betrifft nur `db.ts`.
- **Queue im Backend**: Pause, Skip und Replay wirken sofort, mehrere Browserquellen bleiben synchron. Kommt von einer Quelle kein „fertig“, gibt ein Timeout die Queue frei.
- **Twitch per WebSocket statt Webhook**: kein öffentlicher HTTPS-Endpunkt nötig.
- **Sicherheit**: Overlay-Key pro Overlay (rotierbar), optionaler Dashboard-Login (signiertes Cookie, Rate-Limit), verschlüsselte Tokens, Medien-URLs nur `https://` oder eigene Uploads, Zuschauertexte nur als Text gerendert.

## Noch offen (Phase 2/3 des Konzepts)

- YouTube Live (Super Chat, Mitglieder), TTS, Moderations-Verzögerung mit Freigabe
- Safe Mode gegen Hate-Raids, globale Bearbeitung „auf alle anwenden“, umschaltbare Profile
- betterplace-Webhook-Connector, ausgehende Aktionen (z. B. OBS-Szenenwechsel per obs-websocket)
- Weitere Widgets (Spendenziel, Event-Liste, Abspann), eigener HTML/CSS/JS-Code in einem Sandbox-Frame
