import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { MIGRATIONS } from '../src/db.js';
import type { AppContext } from '../src/context.js';
import type { EventLogEntry, NormalizedEvent } from '../src/shared/types.js';
import { WIDGET_DEFAULTS } from '../src/shared/widgets.js';
import {
  bossDamage, bossHit, bossInitial, creditsSections, goalValue, labelText, listFilter, timerAdd, timerInitial, timerRemaining, timerSecondsFor,
} from '../src/widgets/compute.js';
import { mergeSettings } from '../src/widgets/schemas.js';

let n = 0;
const ev = (p: Partial<NormalizedEvent> & Pick<NormalizedEvent, 'type'>): NormalizedEvent => ({
  id: `e${++n}`, platform: 'twitch', user: { name: 'Anna' }, receivedAt: new Date().toISOString(), ...p,
});
const entry = (e: NormalizedEvent): EventLogEntry => ({ id: e.id, event: e, status: 'played', reason: '', read: false, createdAt: e.receivedAt });
const eur = (value: number) => ({ value, currency: 'EUR' });

const log: EventLogEntry[] = [
  ev({ type: 'follow', user: { name: 'Ben' } }),
  ev({ type: 'donation', user: { name: 'Anna' }, amount: eur(5) }),
  ev({ type: 'donation', user: { name: 'Carl' }, amount: eur(20) }),
  ev({ type: 'donation', user: { name: 'Anna' }, amount: eur(18) }),
  ev({ type: 'cheer', user: { name: 'Dora' }, count: 300 }),
  ev({ type: 'subscription', subtype: 'sub', user: { name: 'Emil' } }),
  ev({ type: 'subscription', subtype: 'resub', user: { name: 'Fritz' }, months: 4 }),
  ev({ type: 'subscription', subtype: 'gift', user: { name: 'Gina' }, gifter: 'Gina', count: 5 }),
  ev({ type: 'raid', user: { name: 'Hans' }, count: 42 }),
].map(entry);

describe('Ziele', () => {
  it('summiert je nach Art', () => {
    const g = WIDGET_DEFAULTS.goal();
    expect(goalValue({ ...g, goalType: 'donation' }, log)).toBe(43);
    expect(goalValue({ ...g, goalType: 'donation', startValue: 7 }, log)).toBe(50);
    expect(goalValue({ ...g, goalType: 'follow' }, log)).toBe(1);
    expect(goalValue({ ...g, goalType: 'cheer' }, log)).toBe(300);
    // Standard: neue Subs + Gifts, keine Resubs (wie Streamlabs)
    expect(goalValue({ ...g, goalType: 'sub' }, log)).toBe(6);
    expect(goalValue({ ...g, goalType: 'sub', includeResubs: true }, log)).toBe(7);
  });
});

describe('Stream-Labels', () => {
  const l = WIDGET_DEFAULTS.label();
  it('letzte, Top und Summen', () => {
    expect(labelText({ ...l, kind: 'latest_follower' }, log)).toBe('Ben');
    expect(labelText({ ...l, kind: 'latest_donation', format: '{name} ({amount})' }, log).replace(/ /g, ' ')).toBe('Anna (18,00 €)');
    expect(labelText({ ...l, kind: 'top_donation', format: '{name} {amount}' }, log).replace(/ /g, ' ')).toBe('Carl 20,00 €');
    expect(labelText({ ...l, kind: 'top_donor', format: '{name} {amount}' }, log).replace(/ /g, ' ')).toBe('Anna 23,00 €');
    expect(labelText({ ...l, kind: 'total_donations', format: '{amount}' }, log).replace(/ /g, ' ')).toBe('43,00 €');
    expect(labelText({ ...l, kind: 'top_gifter', format: '{name}: {count}' }, log)).toBe('Gina: 5');
    expect(labelText({ ...l, kind: 'count_gifted', format: '{count}' }, log)).toBe('5');
    expect(labelText({ ...l, kind: 'latest_resub', format: '{name} {months}' }, log)).toBe('Fritz 4');
    expect(labelText({ ...l, kind: 'latest_charity', empty: 'noch keine' }, log)).toBe('noch keine');
  });
});

describe('End-Credits', () => {
  it('gruppiert Unterstützer mit Summen', () => {
    const s = creditsSections(WIDGET_DEFAULTS.credits(), log);
    const donations = s.find((x) => x.key === 'donations')!;
    expect(donations.lines.map((l) => l.replace(/ /g, ' '))).toEqual(['Anna – 23,00 €', 'Carl – 20,00 €']);
    expect(s.find((x) => x.key === 'gifters')!.lines).toEqual(['Gina – 5×']);
    expect(s.find((x) => x.key === 'subs')!.lines).toEqual(['Emil', 'Fritz']);
    expect(s.find((x) => x.key === 'charity')).toBeUndefined();
    const noAmounts = creditsSections({ ...WIDGET_DEFAULTS.credits(), showAmounts: false, include: { ...WIDGET_DEFAULTS.credits().include, follows: false } }, log);
    expect(noAmounts.find((x) => x.key === 'follows')).toBeUndefined();
    expect(noAmounts.find((x) => x.key === 'donations')!.lines).toEqual(['Anna', 'Carl']);
  });
});

describe('Ereignisliste', () => {
  it('filtert Typen und Mindestwerte', () => {
    const s = { ...WIDGET_DEFAULTS.event_list(), minBits: 500 };
    expect(listFilter(s, log[0]!.event)).toBe(true); // Follow
    expect(listFilter(s, log[4]!.event)).toBe(false); // 300 Bits < 500
    expect(listFilter(s, log[8]!.event)).toBe(false); // Raid standardmäßig aus
  });
});

describe('Subathon-Timer', () => {
  const s = { ...WIDGET_DEFAULTS.timer(), startMinutes: 10, maxMinutes: 15 };
  it('verlängert je Event und respektiert die Obergrenze', () => {
    expect(timerSecondsFor(s, log[7]!.event).seconds).toBe(5 * 300); // 5 Gift-Subs
    expect(timerSecondsFor(s, log[4]!.event).seconds).toBe(180); // 300 Bits
    expect(timerSecondsFor(s, log[2]!.event).seconds).toBe(1200); // 20 €
    let t = timerInitial(s);
    expect(t.remaining).toBe(600_000);
    t = timerAdd(s, t, 60_000, 0);
    expect(t.remaining).toBe(660_000);
    t = timerAdd(s, t, 3_600_000, 0);
    expect(t.remaining).toBe(900_000); // gedeckelt auf 15 min
    const running = { running: true, endsAt: 1000 + 300_000, remaining: 0 };
    expect(timerRemaining(running, 101_000)).toBe(200_000);
    expect(timerAdd(s, running, 10_000, 101_000).endsAt).toBe(101_000 + 210_000);
  });
});

describe('Stream-Boss', () => {
  const s = { ...WIDGET_DEFAULTS.boss(), startHp: 100, damagePerSub: 30 };
  it('Schaden, Heilung und neuer Boss je Modus', () => {
    let b = bossInitial(s);
    expect(bossDamage(s, log[7]!.event)).toBe(150); // 5 Gift-Subs
    let r = bossHit(s, b, 'Anna', 40, 1);
    expect(r.state.hp).toBe(60);
    r = bossHit(s, r.state, 'Streamer', 25, 2); // Boss heilt sich selbst
    expect(r.state.hp).toBe(85);
    r = bossHit(s, r.state, 'Ben', 100, 3);
    expect(r.defeated).toBe(true);
    expect(r.state).toMatchObject({ name: 'Ben', hp: 100, maxHp: 100 });
    b = r.state;
    r = bossHit({ ...s, mode: 'incremental', incrAmount: 50 }, b, 'Carl', 500, 4);
    expect(r.state).toMatchObject({ name: 'Carl', hp: 150, maxHp: 150 });
    r = bossHit({ ...s, mode: 'overkill', overkillMultiplier: 2, overkillMin: 10 }, b, 'Dora', 160, 5);
    expect(r.state).toMatchObject({ name: 'Dora', maxHp: 120 }); // 60 Überschaden × 2
    expect(bossHit({ ...s, bossHeal: false }, b, 'Ben', 10, 6).state).toBe(b);
  });
});

describe('Einstellungen', () => {
  it('validiert und führt Teil-Updates zusammen', () => {
    const cur = WIDGET_DEFAULTS.goal();
    const merged = mergeSettings('goal', cur, { title: 'Neu', text: { size: 40 } }) as typeof cur;
    expect(merged.title).toBe('Neu');
    expect(merged.text).toMatchObject({ size: 40, font: cur.text.font });
    expect(() => mergeSettings('goal', cur, { barColor: 'red;}<script>' })).toThrow();
    expect(() => mergeSettings('event_list', WIDGET_DEFAULTS.event_list(), { animIn: 'x;y' })).toThrow();
  });
});

describe('Migration v4', () => {
  it('legt die Widget-Tabelle an', () => {
    const db = new Database(':memory:');
    for (const m of MIGRATIONS) typeof m === 'string' ? db.exec(m) : m(db);
    const cols = (db.prepare('PRAGMA table_info(widgets)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'type', 'key', 'settings', 'state', 'preview_bg']));
  });
});

describe('Widget-API', () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  beforeAll(async () => {
    config.adminPassword = '';
    ({ app, ctx } = await buildApp({ dbFile: ':memory:', logger: false }));
  });
  afterAll(async () => {
    await app.close();
    config.adminPassword = 'pw';
  });
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object });

  it('Timer und Ziel reagieren auf Events, Testdaten lassen sich entfernen', async () => {
    const timer = (await call('POST', '/api/widgets', { type: 'timer' })).json();
    expect(timer.url).toContain(`/widget/?id=${timer.id}&key=`);
    const goal = (await call('POST', '/api/widgets', { type: 'goal' })).json();
    expect((await call('PATCH', `/api/widgets/${goal.id}`, { settings: { target: 100 } })).statusCode).toBe(200);
    expect((await call('PATCH', `/api/widgets/${goal.id}`, { settings: { goalType: 'nope' } })).statusCode).toBe(400);

    await call('POST', `/api/widgets/${timer.id}/timer`, { action: 'start' });
    await call('POST', '/api/events/test', { type: 'donation', amount: 25 });
    const t = (await call('GET', `/api/widgets/${timer.id}`)).json();
    expect(t.data.state.running).toBe(true);
    expect(t.data.lastAdded.seconds).toBe(25 * 60);
    expect(t.data.state.endsAt - Date.now()).toBeGreaterThan(60 * 60_000 + 24 * 60_000);

    const g = (await call('GET', `/api/widgets/${goal.id}`)).json();
    expect(g.data).toMatchObject({ current: 25, target: 100, percent: 25 });

    expect((await call('DELETE', '/api/events/test')).json().removed).toBeGreaterThan(0);
    expect((await call('GET', `/api/widgets/${goal.id}`)).json().data.current).toBe(0);
    expect(ctx.widgets).toBeTruthy();
  });

  it('Widget-Socket verlangt den Key', async () => {
    const w = (await call('POST', '/api/widgets', { type: 'label' })).json();
    await app.ready();
    const closed = new Promise<number>((r) => void app.injectWS(`/ws/widget/${w.id}?key=falsch`, {}, { onInit: (s) => s.on('close', (code) => r(code)) }));
    expect(await closed).toBe(4001);
    let ws!: import('ws').WebSocket;
    const first = new Promise<any>((r) => {
      void app.injectWS(`/ws/widget/${w.id}?key=${w.key}`, {}, { onInit: (s) => { ws = s; s.once('message', (d) => r(JSON.parse(d.toString()))); } });
    });
    const msg = await first;
    expect(msg).toMatchObject({ t: 'snapshot', data: { type: 'label' } });
    expect(msg.widget.key).toBeUndefined();
    ws.terminate();
  });
});
