import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { ProjectManager } from '../src/projects.js';

let app: FastifyInstance;
let projects: ProjectManager;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffo-projects-'));

beforeAll(async () => {
  config.appSecret = 'test-secret-test-secret-test-secret';
  config.adminPassword = '';
  ({ app, projects } = await buildApp({ dbFile: ':memory:', logger: false, projectsDir: dir }));
  await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const api = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, project?: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: project ? { 'x-ff-project': project } : {} });

describe('Projekte (Overlay-Profile)', () => {
  let second = '';

  it('hat zuerst nur das Haupt-Projekt', async () => {
    const r = (await api('GET', '/api/projects')).json();
    expect(r.current).toBe('default');
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({ id: 'default', isDefault: true, overlays: 1 });
  });

  it('legt ein neues, getrenntes Projekt an', async () => {
    const res = await api('POST', '/api/projects', undefined, { name: 'Charity-Stream', color: '#22c55e', description: 'Spendenmarathon' });
    expect(res.statusCode).toBe(201);
    second = res.json().id;
    expect(fs.existsSync(path.join(dir, `${second}.sqlite`))).toBe(true);
    expect((await api('GET', '/api/projects', second)).json().current).toBe(second);

    // eigene Overlays: Änderung im zweiten Projekt betrifft das Haupt-Projekt nicht
    const [o1] = (await api('GET', '/api/overlays')).json();
    const [o2] = (await api('GET', '/api/overlays', second)).json();
    expect(o1.id).not.toBe(o2.id);
    await api('PATCH', `/api/overlays/${o2.id}`, second, { name: 'Charity-Overlay' });
    expect((await api('GET', '/api/overlays')).json()[0].name).toBe('Haupt-Overlay');
    expect((await api('GET', '/api/overlays', second)).json()[0].name).toBe('Charity-Overlay');

    // eigene Verbindungen und Webhooks
    const hook = (await api('POST', '/api/connections/webhook', second, { label: 'Ko-fi' })).json();
    expect((await api('GET', '/api/connections')).json().connections.filter((c: { platform: string }) => c.platform === 'webhook')).toHaveLength(0);
    const hookPath = new URL(hook.data.url).pathname;
    const res2 = await app.inject({ method: 'POST', url: hookPath, payload: { type: 'donation', user: 'Kaffee', amount: 3 } });
    expect(res2.statusCode).toBe(200);
    const evMain = (await api('GET', '/api/events?limit=50')).json();
    const evSecond = (await api('GET', '/api/events?limit=50', second)).json();
    expect(evSecond.some((e: { event: { user: { name: string } } }) => e.event.user.name === 'Kaffee')).toBe(true);
    expect(evMain.some((e: { event: { user: { name: string } } }) => e.event.user.name === 'Kaffee')).toBe(false);
  });

  it('spielt Test-Alerts nur im Overlay des eigenen Projekts', async () => {
    const [o2] = (await api('GET', '/api/overlays', second)).json();
    const [o1] = (await api('GET', '/api/overlays')).json();
    const addr = app.server.address() as { port: number };
    const open = (o: { id: string; key: string }) => {
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/overlay/${o.id}?key=${o.key}`);
      const msgs: any[] = [];
      ws.on('message', (b) => msgs.push(JSON.parse(b.toString())));
      return { ws, msgs, ready: new Promise((r) => ws.once('open', r)) };
    };
    const a = open(o1);
    const b = open(o2);
    await Promise.all([a.ready, b.ready]);
    await api('POST', '/api/events/test', second, { type: 'follow', user: 'NurImZweiten' });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.msgs.some((m) => m.t === 'alert.show')).toBe(true);
    expect(a.msgs.some((m) => m.t === 'alert.show')).toBe(false);
    a.ws.close();
    b.ws.close();
  });

  it('kopiert Designs und Regeln ohne Verbindungen und mit neuen Keys', async () => {
    const copy = (await api('POST', '/api/projects', undefined, { name: 'Kopie', copyFrom: second })).json();
    const [src] = (await api('GET', '/api/overlays', second)).json();
    const [dst] = (await api('GET', '/api/overlays', copy.id)).json();
    expect(dst.name).toBe('Charity-Overlay');
    expect(dst.key).not.toBe(src.key);
    expect((await api('GET', '/api/connections', copy.id)).json().connections).toHaveLength(0);
    expect((await api('GET', '/api/events?limit=5', copy.id)).json()).toHaveLength(0);
  });

  it('benennt um und löscht (Datenbank bleibt als Sicherung)', async () => {
    expect((await api('PATCH', `/api/projects/${second}`, undefined, { name: 'Marathon' })).json().name).toBe('Marathon');
    expect((await api('DELETE', '/api/projects/default')).statusCode).toBe(400);
    expect((await api('DELETE', `/api/projects/${second}`)).json()).toEqual({ ok: true });
    expect(fs.readdirSync(dir).some((f) => f.startsWith(`${second}.sqlite.geloescht-`))).toBe(true);
    expect((await api('GET', '/api/projects')).json().projects.map((p: { id: string }) => p.id)).not.toContain(second);
    // unbekanntes Projekt → Haupt-Projekt
    expect((await api('GET', '/api/projects', second)).json().current).toBe('default');
  });

  it('App-Zugangsdaten gelten für alle Projekte', async () => {
    const id = (await api('GET', '/api/projects')).json().projects.find((p: { isDefault: boolean }) => !p.isDefault).id;
    await api('PUT', '/api/apps', id, { twitchClientId: 'abc123' });
    expect((await api('GET', '/api/apps')).json().twitch.clientId).toBe('abc123');
    expect(projects.list().length).toBeGreaterThan(1);
  });
});
