import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { OPERATOR_ROUTES, requiredRole } from '../src/lib/permissions.js';

// Anmeldung über das FrankenFinals-Broadcast-Portal (Single Sign-on) und Rollenrechte

const SECRET = 's'.repeat(48);
let app: FastifyInstance;

/** Eintrittskarte wie das Portal sie ausstellt (server/sso.js im Portal-Repo) */
function ticket(payload: Record<string, unknown>, secret = SECRET) {
  const iat = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ v: 1, iss: 'ff-broadcast-portal', aud: 'overlay', sub: '7', email: 'lena@example.de', name: 'Lena', role: 'operator', iat, exp: iat + 60, jti: crypto.randomBytes(8).toString('hex'), ...payload })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function login(role: string) {
  const res = await app.inject({ method: 'GET', url: '/auth/portal?ticket=' + ticket({ role }) });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/');
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object, headers: { cookie } });
}

beforeAll(async () => {
  config.appSecret = 'test-secret-test-secret-test-secret';
  config.adminPassword = '';
  config.portal = { url: 'https://portal.example.de', secret: SECRET, moduleId: 'overlay', sessionHours: 12 };
  ({ app } = await buildApp({ dbFile: ':memory:', logger: false }));
});
afterAll(async () => {
  await app.close();
});

describe('Anmeldung über das Portal', () => {
  it('ohne Sitzung kein Zugriff, Passwort-Login abgeschaltet, Portal-Link bekannt', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/overlays' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: '' } })).statusCode).toBe(400);
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me' })).json();
    expect(me).toMatchObject({ authenticated: false, authRequired: true, portalLogin: 'https://portal.example.de/sso/overlay', passwordLogin: false });
  });

  it('nimmt eine gültige Eintrittskarte genau einmal an', async () => {
    const t = ticket({ role: 'editor' });
    const first = await app.inject({ method: 'GET', url: '/auth/portal?ticket=' + t });
    expect(first.statusCode).toBe(302);
    const cookie = String(first.headers['set-cookie']).split(';')[0]!;
    expect(String(first.headers['set-cookie'])).toMatch(/HttpOnly/);
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
    expect(me.user).toMatchObject({ name: 'Lena', email: 'lena@example.de', role: 'editor', roleLabel: 'Editor', via: 'portal' });
    expect((await app.inject({ method: 'GET', url: '/auth/portal?ticket=' + t })).statusCode).toBe(401);
  });

  it('lehnt falsche, abgelaufene und fremde Eintrittskarten ab', async () => {
    const past = Math.floor(Date.now() / 1000) - 120;
    for (const bad of [ticket({}, 'x'.repeat(48)), ticket({ iat: past, exp: past + 60 }), ticket({ aud: 'rundown' }), ticket({ role: 'viewer' }), 'kaputt', '']) {
      const res = await app.inject({ method: 'GET', url: '/auth/portal?ticket=' + encodeURIComponent(bad) });
      expect([401, 403]).toContain(res.statusCode);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('ein manipuliertes Sitzungs-Cookie wird nicht akzeptiert', async () => {
    const fake = 'p.' + Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 1e6 })).toString('base64url');
    const res = await app.inject({ method: 'GET', url: '/api/overlays', headers: { cookie: `ffo_session=${fake}` } });
    expect(res.statusCode).toBe(401);
  });
});

describe('Rollen', () => {
  it('Operator: steuern ja, gestalten und verwalten nein', async () => {
    const op = await login('operator');
    const [overlay] = (await op('GET', '/api/overlays')).json();
    expect((await op('POST', '/api/events/test', { type: 'follow', user: 'Max' })).statusCode).toBe(200);
    expect((await op('POST', `/api/overlays/${overlay.id}/queue/pause`)).statusCode).toBeLessThan(400);
    expect((await op('POST', '/api/templates', { name: 'Neu' })).statusCode).toBe(403);
    expect((await op('PUT', '/api/settings', {})).statusCode).toBe(403);
    expect((await op('GET', '/api/apps')).statusCode).toBe(403);
    expect((await op('POST', `/api/overlays/${overlay.id}/rotate-key`)).statusCode).toBe(403);
    expect((await op('POST', '/api/templates', { name: 'Neu' })).json().error).toMatch(/Editor/);
  });

  it('Editor: gestalten ja, Verbindungen und Einstellungen nein', async () => {
    const ed = await login('editor');
    expect((await ed('POST', '/api/templates', { name: 'Neues Design' })).statusCode).toBe(200);
    expect((await ed('PUT', '/api/settings', {})).statusCode).toBe(403);
    expect((await ed('POST', '/api/connections/webhook', { label: 'x' })).statusCode).toBe(403);
    expect((await ed('POST', '/api/projects', { name: 'x' })).statusCode).toBe(403);
    expect((await ed('GET', '/api/connections')).statusCode).toBe(200);
  });

  it('Overlay-Admin: alles', async () => {
    const ad = await login('admin');
    expect((await ad('GET', '/api/apps')).statusCode).toBe(200);
    expect((await ad('POST', '/api/connections/webhook', { label: 'Test' })).statusCode).toBe(200);
  });

  it('jede Operator-Route gibt es wirklich (Schreibfehler fallen hier auf)', () => {
    for (const r of OPERATOR_ROUTES) {
      const [method, url] = r.split(' ') as ['POST' | 'DELETE', string];
      expect(app.hasRoute({ method, url }), r).toBe(true);
    }
    expect(requiredRole('GET', '/api/widgets')).toBe('operator');
    expect(requiredRole('PATCH', '/api/widgets/:id')).toBe('editor');
    expect(requiredRole('DELETE', '/api/overlays/:id')).toBe('admin');
  });
});

describe('PORTAL_URL', async () => {
  const { normalizeBaseUrl } = await import('../src/config.js');
  it('wird auch ohne https:// oder mit Pfad/Slash zur richtigen Adresse', () => {
    expect(normalizeBaseUrl('broadcast.example.de')).toBe('https://broadcast.example.de');
    expect(normalizeBaseUrl('https://broadcast.example.de/')).toBe('https://broadcast.example.de');
    expect(normalizeBaseUrl('https://broadcast.example.de/#/')).toBe('https://broadcast.example.de');
    expect(normalizeBaseUrl('"http://localhost:3399"')).toBe('http://localhost:3399');
    expect(normalizeBaseUrl('')).toBe('');
  });
});
