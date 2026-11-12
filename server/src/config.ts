import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

// .env aus dem Projektordner laden (Node ≥ 22). Bereits gesetzte Umgebungsvariablen haben Vorrang.
if (!process.env.VITEST && fs.existsSync('.env')) process.loadEnvFile('.env');

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

const dataDir = path.resolve(env('DATA_DIR', './data'));

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  /** Öffentliche Basis-URL, z. B. https://alerts.example.de – nötig für OAuth-Redirects */
  publicUrl: env('PUBLIC_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/$/, ''),
  dataDir,
  dbFile: path.join(dataDir, 'ff-overlay.sqlite'),
  mediaDir: path.join(dataDir, 'media'),
  /** Passwort für das Dashboard (Single-User). Leer = kein Login. */
  adminPassword: env('ADMIN_PASSWORD'),
  /** Geheimnis für Cookies und Token-Verschlüsselung. Muss in Produktion gesetzt sein. */
  appSecret: env('APP_SECRET'),
  twitch: {
    clientId: env('TWITCH_CLIENT_ID'),
    clientSecret: env('TWITCH_CLIENT_SECRET'),
  },
  /** Google-OAuth-Client vom Typ „Fernseher und Geräte mit begrenzter Eingabe“ (YouTube) */
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
  },
  /** Mindestabstand der YouTube-Chat-Abfrage in Sekunden (Kontingent: 5 Einheiten pro Abfrage, 10.000 pro Tag) */
  youtubeChatPollSeconds: Number(env('YOUTUBE_CHAT_POLL_SECONDS', '8')),
  giphyApiKey: env('GIPHY_API_KEY'),
  betterplacePollSeconds: Number(env('BETTERPLACE_POLL_SECONDS', '20')),
  eventRetentionDays: Number(env('EVENT_RETENTION_DAYS', '30')),
  isProduction: env('NODE_ENV') === 'production',
};

export function assertConfig(log: (msg: string) => void): void {
  if (!config.appSecret) {
    if (config.isProduction) throw new Error('APP_SECRET muss in Produktion gesetzt sein (mind. 32 Zeichen).');
    config.appSecret = crypto.randomBytes(32).toString('hex');
    log('APP_SECRET nicht gesetzt – nutze einen zufälligen Wert. Logins und gespeicherte Tokens überleben keinen Neustart.');
  }
  if (!config.adminPassword) {
    log('ADMIN_PASSWORD nicht gesetzt – Dashboard ist OHNE Passwort erreichbar. Nur im lokalen Netz verwenden.');
  }
}
