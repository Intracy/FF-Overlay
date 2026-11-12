import { config } from '../../config.js';
import type { AppCredentials } from '../../apps.js';
import { TWITCH_SCOPES } from './normalize.js';

export interface TwitchTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

type App = Pick<AppCredentials, 'clientId' | 'clientSecret'>;

export const redirectUri = () => `${config.publicUrl}/auth/twitch/callback`;

/** Klassischer OAuth-Ablauf mit Weiterleitung (braucht Client-Secret und eine eingetragene Redirect-URL) */
export function authorizeUrl(app: App, state: string): string {
  const u = new URL('https://id.twitch.tv/oauth2/authorize');
  u.searchParams.set('client_id', app.clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', TWITCH_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('force_verify', 'true');
  return u.toString();
}

async function post(url: string, params: Record<string, string>) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
}

const withSecret = (app: App, params: Record<string, string>) =>
  app.clientSecret ? { client_id: app.clientId, client_secret: app.clientSecret, ...params } : { client_id: app.clientId, ...params };

function toTokens(j: { access_token: string; refresh_token: string; expires_in: number; scope?: string[] }): TwitchTokens {
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000, scopes: j.scope ?? [] };
}

async function tokenRequest(app: App, params: Record<string, string>): Promise<TwitchTokens> {
  const res = await post('https://id.twitch.tv/oauth2/token', withSecret(app, params));
  if (!res.ok) throw new Error(`Twitch-Token-Anfrage fehlgeschlagen: ${res.status} ${await res.text()}`);
  return toTokens(await res.json());
}

export const exchangeCode = (app: App, code: string) => tokenRequest(app, { code, grant_type: 'authorization_code', redirect_uri: redirectUri() });

/** Öffentliche Clients (Gerätecode) erneuern ohne Secret; Refresh-Tokens sind einmalig gültig. */
export const refreshTokens = (app: App, refreshToken: string) => tokenRequest(app, { refresh_token: refreshToken, grant_type: 'refresh_token' });

// ---------- Gerätecode-Ablauf (Device Code Grant Flow) ----------
// Funktioniert ohne Redirect-URL und ohne öffentliche Adresse: Nutzer:in öffnet twitch.tv/activate und bestätigt.

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function startTwitchDevice(app: App): Promise<DeviceStart> {
  const scopes = TWITCH_SCOPES.join(' ');
  const res = await post('https://id.twitch.tv/oauth2/device', { client_id: app.clientId, scopes, scope: scopes });
  if (!res.ok) throw new Error(`Twitch: Gerätecode nicht erhalten (${res.status}) ${await res.text()}`);
  const j = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, expiresIn: j.expires_in, interval: j.interval || 5 };
}

export type DevicePoll<T> = { status: 'pending' } | { status: 'slow_down' } | { status: 'ok'; tokens: T } | { status: 'error'; error: string };

export async function pollTwitchDevice(app: App, deviceCode: string): Promise<DevicePoll<TwitchTokens>> {
  const scopes = TWITCH_SCOPES.join(' ');
  const res = await post(
    'https://id.twitch.tv/oauth2/token',
    withSecret(app, { scopes, scope: scopes, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  );
  if (res.ok) return { status: 'ok', tokens: toTokens(await res.json()) };
  const text = await res.text();
  if (/authorization_pending/i.test(text)) return { status: 'pending' };
  if (/slow_down/i.test(text)) return { status: 'slow_down' };
  if (/access_denied|denied/i.test(text)) return { status: 'error', error: 'Zugriff auf Twitch abgelehnt' };
  if (/expired|invalid device code/i.test(text)) return { status: 'error', error: 'Code abgelaufen – bitte neu starten' };
  return { status: 'error', error: `Twitch: ${res.status} ${text.slice(0, 200)}` };
}

export async function validateToken(accessToken: string): Promise<{ user_id: string; login: string; scopes: string[] } | null> {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${accessToken}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Twitch-Validate fehlgeschlagen: ${res.status}`);
  return (await res.json()) as { user_id: string; login: string; scopes: string[] };
}
