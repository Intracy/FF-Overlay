import type { AppCredentials } from '../../apps.js';
import type { DeviceStart, DevicePoll } from '../twitch/auth.js';

/*
 * Google-OAuth im Gerätecode-Ablauf („OAuth 2.0 for TV and Limited-Input Device Applications“).
 * Erlaubt die Scopes youtube und youtube.readonly – ohne Redirect-URL, also auch im Heimnetz/NAS.
 */

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

type App = Pick<AppCredentials, 'clientId' | 'clientSecret'>;

async function post(url: string, params: Record<string, string>) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
}

export async function startGoogleDevice(app: App): Promise<DeviceStart> {
  const res = await post('https://oauth2.googleapis.com/device/code', { client_id: app.clientId, scope: YOUTUBE_SCOPES.join(' ') });
  if (!res.ok) throw new Error(`Google: Gerätecode nicht erhalten (${res.status}) ${await res.text()}`);
  const j = (await res.json()) as { device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number };
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_url, expiresIn: j.expires_in, interval: j.interval || 5 };
}

export async function pollGoogleDevice(app: App, deviceCode: string): Promise<DevicePoll<GoogleTokens>> {
  const res = await post('https://oauth2.googleapis.com/token', {
    client_id: app.clientId, client_secret: app.clientSecret, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (res.ok && j.access_token) {
    return { status: 'ok', tokens: { accessToken: j.access_token, refreshToken: j.refresh_token ?? '', expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000, scopes: (j.scope ?? '').split(' ') } };
  }
  if (j.error === 'authorization_pending') return { status: 'pending' };
  if (j.error === 'slow_down') return { status: 'slow_down' };
  if (j.error === 'access_denied') return { status: 'error', error: 'Zugriff auf YouTube abgelehnt' };
  if (j.error === 'expired_token') return { status: 'error', error: 'Code abgelaufen – bitte neu starten' };
  return { status: 'error', error: `Google: ${j.error_description || j.error || res.status}` };
}

export async function refreshGoogle(app: App, refreshToken: string): Promise<GoogleTokens> {
  const res = await post('https://oauth2.googleapis.com/token', { client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google-Token-Erneuerung fehlgeschlagen: ${j.error ?? res.status}`);
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? refreshToken, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000, scopes: (j.scope ?? '').split(' ') };
}

/** Eigener Kanal des angemeldeten Kontos */
export async function myChannel(accessToken: string): Promise<{ id: string; title: string } | null> {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`YouTube: Kanal nicht abrufbar (${res.status}) ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string } }> };
  const c = j.items?.[0];
  return c ? { id: c.id, title: c.snippet.title } : null;
}
