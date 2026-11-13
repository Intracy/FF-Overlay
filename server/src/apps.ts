import type { DB } from './db.js';
import * as store from './db.js';
import { config } from './config.js';
import { decrypt, encrypt } from './lib/crypto.js';

/*
 * App-Zugangsdaten für Twitch und Google/YouTube.
 * Jede selbst gehostete Installation braucht eine eigene, kostenlose App-Registrierung (einmalig).
 * Werte aus der .env haben Vorrang; sonst werden sie im Dashboard eingetragen und hier gespeichert.
 */

interface StoredApps {
  twitchClientId?: string;
  twitchClientSecret?: string; // verschlüsselt
  googleClientId?: string;
  googleClientSecret?: string; // verschlüsselt
  giphyApiKey?: string; // verschlüsselt
}

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
  /** aus der .env (im Dashboard nicht änderbar) */
  fromEnv: boolean;
}

const KEY = 'apps';
/** App-Zugangsdaten gelten für alle Projekte und liegen in der Datenbank des Haupt-Projekts */
let systemDb: DB | null = null;
export function setSystemDb(db: DB) {
  systemDb = db;
}
const read = (db: DB) => store.settings.get<StoredApps>(systemDb ?? db, KEY, {});
const dec = (v?: string) => {
  if (!v) return '';
  try {
    return decrypt(v);
  } catch {
    return '';
  }
};

export function twitchApp(db: DB): AppCredentials {
  if (config.twitch.clientId) return { clientId: config.twitch.clientId, clientSecret: config.twitch.clientSecret, fromEnv: true };
  const s = read(db);
  return { clientId: s.twitchClientId ?? '', clientSecret: dec(s.twitchClientSecret), fromEnv: false };
}

export function googleApp(db: DB): AppCredentials {
  if (config.google.clientId) return { clientId: config.google.clientId, clientSecret: config.google.clientSecret, fromEnv: true };
  const s = read(db);
  return { clientId: s.googleClientId ?? '', clientSecret: dec(s.googleClientSecret), fromEnv: false };
}

/** GIPHY-Key (API- oder SDK-Key) – .env hat Vorrang, sonst im Dashboard hinterlegt */
export function giphyKey(db: DB): { key: string; fromEnv: boolean } {
  if (config.giphyApiKey) return { key: config.giphyApiKey, fromEnv: true };
  return { key: dec(read(db).giphyApiKey), fromEnv: false };
}

/** Für das Dashboard: nie die Secrets selbst herausgeben */
export function appsView(db: DB) {
  const t = twitchApp(db);
  const g = googleApp(db);
  const gk = giphyKey(db);
  return {
    twitch: { clientId: t.clientId, hasSecret: !!t.clientSecret, fromEnv: t.fromEnv },
    google: { clientId: g.clientId, hasSecret: !!g.clientSecret, fromEnv: g.fromEnv },
    giphy: { hasKey: !!gk.key, fromEnv: gk.fromEnv, hint: gk.key ? `…${gk.key.slice(-4)}` : '' },
  };
}

/** undefined = unverändert lassen, '' = löschen */
export function saveApps(db: DB, patch: { twitchClientId?: string; twitchClientSecret?: string; googleClientId?: string; googleClientSecret?: string; giphyApiKey?: string }) {
  const s = read(db);
  const next: StoredApps = { ...s };
  if (patch.twitchClientId !== undefined) next.twitchClientId = patch.twitchClientId.trim();
  if (patch.twitchClientSecret !== undefined) next.twitchClientSecret = patch.twitchClientSecret.trim() ? encrypt(patch.twitchClientSecret.trim()) : '';
  if (patch.googleClientId !== undefined) next.googleClientId = patch.googleClientId.trim();
  if (patch.googleClientSecret !== undefined) next.googleClientSecret = patch.googleClientSecret.trim() ? encrypt(patch.googleClientSecret.trim()) : '';
  if (patch.giphyApiKey !== undefined) next.giphyApiKey = patch.giphyApiKey.trim() ? encrypt(patch.giphyApiKey.trim()) : '';
  store.settings.set(systemDb ?? db, KEY, next);
}
