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

**Alert-Box im Aufbau von Streamlabs** (Menüpunkt „Alert-Box“)
- Navigation wie Streamlabs: *Allgemeine Einstellungen*, *Globale Bearbeitung*, dann pro Plattform jeder Event-Typ mit Standard-Alert und Varianten („Variation hinzufügen“ mit Standard- oder aktuellen Einstellungen, „Variationen verwalten“ mit Reihenfolge, Pausieren, Löschen)
- Varianten-Bedingungen aus dem Streamlabs-Katalog: zufällig mit Häufigkeit (sehr selten … sehr häufig), Betrag/Bits/Monate/Streak mindestens oder genau, Abo-Stufe, Mindestanzahl Gift-Subs, anonym verschenkt, Raid-Größe, bestimmtes Power-Up, Belohnungsname, größte Spende des Streams
- **Themen** (Profile): mehrere komplette Alert-Box-Konfigurationen pro Overlay, umschaltbar, als Kopie oder leer anlegbar
- **Ereignisse filtern** pro Overlay und **Test**-Menü für jeden Event-Typ
- **Allgemeine Einstellungen**: Alert-Verzögerung, **Moderationsverzögerung** (Sekunden oder unbegrenzt, Freigabe/Ablehnen im Alert Feed), **Alert-Parry** (neuer Alert unterbricht den laufenden), Vorschau-Hintergrund, Session-Reset bei Stream-Start, Schimpfwort-Filter (Sternchen oder ausblenden, Standardliste, Namen anonymisieren, auf Event-Log anwenden, eigene Wörter, Blacklist)
- **Globale Bearbeitung**: Allgemein, Animationen, Bild, Video-Lautstärke, Positionierung, Sound, Schrift, Nachrichtenschrift und TTS mit „Auf alle Alerts anwenden“
- Pro Alert: **Text-in-Sprache** (Stimme, Sprache, Mindestbetrag, Spam-Sicherheit aus/niedrig/mittel/hoch, Wiederholungssperre, Lautstärke, Vorlage mitlesen), **Twitch-Emotes** in Nachrichten, **eigenes HTML/CSS/JS** mit eigenen Feldern in einem abgeschotteten Sandbox-Frame
- Zusätzliche Twitch-Events: **Power-Ups** und **Charity-Spenden**

**Widgets wie bei Streamlabs** (Menüpunkt „Widgets“, jedes mit eigener Browserquellen-URL)
- **Ereignisliste**: die letzten Events im Stream, 10 Stile (Carbon, Chevrons, Crisscross, Slick, Fiber, Hearts, Honeycomb, Retro, Solid, Stripes), Themenfarbe, Event-Typen, Mindest-Bits/-Raider, max. Einträge, Ausblendzeit, Spiegeln, Ein-/Ausblend-Animation
- **Ziel**: Fortschrittsbalken für Spenden, Charity, Bits, Follower oder Subs (Subs/Resubs/Gifts wählbar), Startwert, Start- und Enddatum, Standard- oder Kompakt-Layout, Farben; „Neu starten“
- **Stream-Label**: 20 Labels wie letzter Follower/Sub/Spender, höchste Spende, Top-Spender, Top-Sub-Schenker, Spendensumme, Bits gesamt – für Session, heute, 7 oder 30 Tage, mit eigenem Format
- **Subathon-Timer**: Startzeit, Obergrenze, Sekunden je Follow/Sub/Resub/Gift-Sub/100 Bits/1 €/Raid/Kanalpunkte, zeigt hinzugefügte Zeit; Start, Pause, Zurücksetzen und Zeit ± im Dashboard
- **End-Credits**: Abspann der Session (Follower, Abonnenten, Sub-Schenker, Spender, Charity, Bits, Raids) als Klassisch, Weltraum-Crawl oder Sternenhimmel; Dauer oder Tempo, Schleife, Start per Knopf, beim Laden oder wenn die Quelle in OBS sichtbar wird
- **Stream-Boss**: Zuschauer machen mit Follows, Subs, Bits, Spenden und Raids Schaden; wer den Boss besiegt, wird neuer Boss (feste, steigende oder Overkill-HP), Selbstheilung, Besiegt-Animation
- **Spenden-Ticker**: Laufband mit den letzten Spenden und Cheers
- Test-Knöpfe direkt am Widget und „Testdaten entfernen“, damit Tests nicht in Zielen und Credits bleiben

**Regeln** (mehr als Streamlabs: beliebig viele UND-Bedingungen pro Regel; unter „Regeln (erweitert)“)
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

**Alert Feed (Live-Steuerung)**
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

### Widgets in OBS
Dashboard → **Widgets** → Widget anlegen, einstellen, **Speichern** → URL kopieren und als eigene Browserquelle einfügen (die passende Größe steht unter der URL). Änderungen erscheinen sofort in OBS, ohne die Quelle neu zu laden. Für die End-Credits in den Eigenschaften der Browserquelle „Quelle beim Ausblenden herunterfahren“ **aus** lassen; mit „Abspielen, wenn die Quelle sichtbar wird“ starten sie beim Szenenwechsel.

### Twitch
1. App anlegen unter https://dev.twitch.tv/console/apps
2. OAuth-Redirect-URL: `<PUBLIC_URL>/auth/twitch/callback` (z. B. `http://localhost:3000/auth/twitch/callback`)
3. `TWITCH_CLIENT_ID` und `TWITCH_CLIENT_SECRET` in `.env` eintragen, neu starten
4. Dashboard → **Verbindungen** → „Mit Twitch verbinden“ (mit dem Broadcaster-Account)

Benötigte Scopes: `moderator:read:followers`, `channel:read:subscriptions`, `bits:read`, `channel:read:redemptions`, `channel:read:charity`.
Wer Twitch vor dem Update verbunden hat, muss einmal **neu verbinden**, damit Charity-Spenden ankommen.

### Text-in-Sprache
TTS nutzt die Sprachausgabe der Browserquelle (Web Speech API). Welche Stimmen es gibt, hängt vom Rechner ab, auf dem OBS läuft (macOS und Windows bringen deutsche Stimmen mit). Die Stimmenliste im Dashboard zeigt die Stimmen des Rechners, auf dem das Dashboard offen ist; fehlt die gewählte Stimme in OBS, wird die Standardstimme der Sprache genutzt.

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
  widgets/                  Berechnung (Ziele, Labels, Credits, Timer, Boss), Service mit Live-Updates, Validierung
  shared/widgets.ts         Widget-Typen und Standardwerte
  routes/                   auth, api, connections (+ Twitch-OAuth, Webhooks), media (+ GIPHY-Proxy), widgets, ws
  db.ts                     SQLite-Schema & Zugriff
server/test/                Vitest: Engine, Normalisierung, Queue, Widgets, API inkl. WebSocket-Ende-zu-Ende
web/
  index.html, dashboard/    React-Dashboard
  overlay/                  Browserquelle + gemeinsamer Renderer (auch für die Editor-Vorschau)
  widget/                   Browserquelle für alle Widgets
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
- **Widgets rechnen aus dem Event-Log**: Ziele, Labels, Credits, Liste und Ticker werden bei jeder Änderung neu aus dem Log berechnet (keine doppelte Zählung, Testdaten lassen sich sauber entfernen). Nur Timer und Boss haben eigenen Zustand.
- **Queue im Backend**: Pause, Skip und Replay wirken sofort, mehrere Browserquellen bleiben synchron. Kommt von einer Quelle kein „fertig“, gibt ein Timeout die Queue frei.
- **Twitch per WebSocket statt Webhook**: kein öffentlicher HTTPS-Endpunkt nötig.
- **Sicherheit**: Overlay-Key pro Overlay (rotierbar), optionaler Dashboard-Login (signiertes Cookie, Rate-Limit), verschlüsselte Tokens, Medien-URLs nur `https://` oder eigene Uploads, Zuschauertexte nur als Text gerendert.

## Noch offen (Phase 2/3 des Konzepts)

- YouTube Live (Super Chat, Mitglieder), Cloud-Stimmen für TTS (z. B. Amazon Polly wie bei Streamlabs)
- Safe Mode gegen Hate-Raids
- Von Streamlabs bewusst nicht übernommen: Facebook/X/TikTok-Events, Merch, Cloudbot-Einlösungen, Twitch-Clips bei Großspenden, Zuschauer-GIFs vor Spenden (braucht eine eigene Spendenseite)
- betterplace-Webhook-Connector, ausgehende Aktionen (z. B. OBS-Szenenwechsel per obs-websocket)
- Weitere Streamlabs-Widgets, die einen Chat-Anschluss brauchen: Chat-Box, Emote-Wand, Tip-Jar, Umfragen, Chat-Highlights
