import { config } from '../../config.js';
import { TWITCH_SCOPES } from './normalize.js';

export interface TwitchTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export const redirectUri = () => `${config.publicUrl}/auth/twitch/callback`;

export function authorizeUrl(state: string): string {
  const u = new URL('https://id.twitch.tv/oauth2/authorize');
  u.searchParams.set('client_id', config.twitch.clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', TWITCH_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('force_verify', 'true');
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<TwitchTokens> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.twitch.clientId, client_secret: config.twitch.clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Twitch-Token-Anfrage fehlgeschlagen: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string[] };
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000, scopes: j.scope ?? [] };
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });

export async function validateToken(accessToken: string): Promise<{ user_id: string; login: string; scopes: string[] } | null> {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${accessToken}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Twitch-Validate fehlgeschlagen: ${res.status}`);
  return (await res.json()) as { user_id: string; login: string; scopes: string[] };
}
