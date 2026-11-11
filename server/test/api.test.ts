import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';

let app: FastifyInstance;
let ctx: AppContext;
let cookie = '';

beforeAll(async () => {
  config.appSecret = 'test-secret-test-secret-test-secret';
  config.adminPassword = 'pw';
  ({ app, ctx } = await buildApp({ dbFile: ':memory:', logger: false }));
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
});

const api = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { cookie } });

describe('API', () => {
  it('verlangt Login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/overlays' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'falsch' } })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'pw' } });
    expect(res.statusCode).toBe(200);
    cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect((await api('GET', '/api/auth/me')).json()).toEqual({ authenticated: true });
  });

  it('legt beim ersten Start Overlay, Templates und Regeln an', async () => {
    const overlays = (await api('GET', '/api/overlays')).json();
    expect(overlays).toHaveLength(1);
    expect(overlays[0].url).toContain(`/overlay/?id=${overlays[0].id}&key=`);
    expect((await api('GET', '/api/rules')).json().length).toBeGreaterThan(5);
  });

  it('erklärt, welche Regel greift', async () => {
    const res = (await api('POST', '/api/rules/explain', { type: 'donation', amount: 75 })).json();
    expect(res[0].rule).toBe('Große Spende ab 50 €');
  });

  it('spielt ein Test-Event über WebSocket im Overlay ab', async () => {
    const [overlay] = (await api('GET', '/api/overlays')).json();
    const addr = app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/overlay/${overlay.id}?key=${overlay.key}`);
    const messages: any[] = [];
    ws.on('message', (b) => messages.push(JSON.parse(b.toString())));
    await new Promise((r) => ws.once('open', r));

    const { id } = (await api('POST', '/api/events/test', { type: 'donation', user: 'Lea', amount: 60, message: 'Für FrankenFinals!' })).json();
    await new Promise((r) => setTimeout(r, 100));
    const show = messages.find((m) => m.t === 'alert.show');
    expect(show.alert.title.map((s: { text: string }) => s.text).join('').replace(/\u00a0/g, ' ')).toBe('Lea spendet 60,00 €!');
    expect(show.alert.message).toBe('Für FrankenFinals!');
    expect(show.alert.template.name).toBe('Große Spende');

    ws.send(JSON.stringify({ t: 'alert.done', itemId: show.alert.itemId }));
    await new Promise((r) => setTimeout(r, 100));
    const ev = (await api('GET', '/api/events?limit=5')).json().find((e: { id: string }) => e.id === id);
    expect(ev.status).toBe('played');
    expect(ev.reason).toContain('Große Spende');
    ws.close();
  });

  it('weist Overlays mit falschem Key ab', async () => {
    const [overlay] = (await api('GET', '/api/overlays')).json();
    const addr = app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/overlay/${overlay.id}?key=falsch`);
    const code = await new Promise((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4001);
  });

  it('nimmt generische Webhooks an', async () => {
    const conn = (await api('POST', '/api/connections/webhook', { label: 'Ko-fi' })).json();
    const path = new URL(conn.data.url).pathname;
    const res = await app.inject({ method: 'POST', url: path, payload: { type: 'donation', user: 'Kaffee', amount: 3 } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/hooks/falsch', payload: {} })).statusCode).toBe(404);
  });

  it('validiert Templates', async () => {
    const [t] = (await api('GET', '/api/templates')).json();
    expect((await api('PUT', `/api/templates/${t.id}`, { ...t, text: { ...t.text, color: 'rot' } })).statusCode).toBe(400);
    expect((await api('PUT', `/api/templates/${t.id}`, { ...t, media: { ...t.media, url: 'javascript:alert(1)' } })).statusCode).toBe(400);
    expect((await api('PUT', `/api/templates/${t.id}`, { ...t, name: 'Neu' })).json().name).toBe('Neu');
  });

  it('filtert gesperrte Nutzer', async () => {
    await api('PUT', '/api/settings', { minDonationAmount: 0, blockedUsers: ['Troll'], badWords: [], badWordMode: 'censor' });
    const { id } = (await api('POST', '/api/events/test', { type: 'follow', user: 'troll' })).json();
    expect(ctx.pipeline).toBeTruthy();
    const ev = (await api('GET', '/api/events?limit=20')).json().find((e: { id: string }) => e.id === id);
    expect(ev.status).toBe('filtered');
  });
});
