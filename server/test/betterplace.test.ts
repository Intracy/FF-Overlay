import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import * as store from '../src/db.js';
import type { AppContext } from '../src/context.js';
import { betterplaceWebhookBody, normalizeBetterplaceWebhook, toStats } from '../src/connectors/betterplace.js';
import { buildBpData, mergeDonations, milestoneView, newlyReached, pollOptionFor, pollResults } from '../src/widgets/betterplace.js';
import { BP_DEFAULTS, type BpDonation } from '../src/shared/bpWidgets.js';
import { mergeSettings } from '../src/widgets/schemas.js';

// Beispiel von der betterplace-Seite „Spenden-Webhook“
const EXAMPLE = {
  event_name: 'donation_announced',
  event_version: '0.2',
  donation: {
    sequence_number: 1,
    amount_in_cents: 2000,
    receiver: 'f111',
    comment: 'have fun',
    donor_display_name: 'Donald Duck',
    streaming_shareable_media: { video_link: 'https://youtu.be/3-DkrkkPC4o?si=H8BSSAFllHx7LgbZ', video_start_time: 3 },
  },
};

const don = (id: string, name: string, amount: number | null, comment = '', at = '2026-12-24T18:00:00.000Z', isTest = false): BpDonation => ({ id, name, amount, comment, at, isTest });

describe('betterplace-Webhook', () => {
  it('normalisiert das Beispiel von betterplace', () => {
    const e = normalizeBetterplaceWebhook(betterplaceWebhookBody.parse(EXAMPLE), 'c1');
    expect(e).toMatchObject({
      id: 'bpwh_c1_1', platform: 'betterplace', type: 'donation', user: { name: 'Donald Duck' }, isAnonymous: false,
      amount: { value: 20, currency: 'EUR' }, message: 'have fun', media: { videoUrl: 'https://youtu.be/3-DkrkkPC4o?si=H8BSSAFllHx7LgbZ', videoStart: 3 },
    });
  });

  it('verborgene Angaben: kein Name, kein Betrag, kein Kommentar', () => {
    const e = normalizeBetterplaceWebhook(
      betterplaceWebhookBody.parse({ event_name: 'donation_announced', donation: { sequence_number: 7, amount_in_cents: null, comment: null, donor_display_name: null } }),
      'c1',
    );
    expect(e.user.name).toBe('Anonym');
    expect(e.isAnonymous).toBe(true);
    expect(e.amount).toBeUndefined();
    expect(e.message).toBeUndefined();
  });

  it('API-Antworten → Statistik mit Logos', () => {
    const s = toStats(
      { title: 'Aktion', donated_amount_in_cents: 123456, donations_count: 12, donor_count: 9, requested_amount_in_cents: 500000, closed_at: null },
      [{ title: 'Projekt', carrier: { name: 'HORIZONT e.V.', picture: { links: [{ rel: 'original', href: 'https://betterplace-assets.betterplace.org/x.png' }] } } },
        { title: 'Ohne Logo', carrier: { name: 'X', picture: { links: [{ rel: 'original', href: 'https://betterplace-assets.betterplace.org/assets/default/a.svg' }] } } }],
    );
    expect(s).toMatchObject({ total: 1234.56, count: 12, donors: 9, target: 5000, closed: false, logos: [{ name: 'HORIZONT e.V.' }] });
  });
});

describe('betterplace-Widget-Daten', () => {
  it('führt Webhook- und API-Spenden ohne Doppelte zusammen', () => {
    const log = [don('bpwh_c_2', 'Anna', 20, 'hi', '2026-12-24T18:05:00.000Z')];
    const recent = [don('bp_1_99', 'Anna', 20, 'hi', '2026-12-24T18:05:01.000Z'), don('bp_1_98', 'Ben', 5, '', '2026-12-24T17:00:00.000Z')];
    const merged = mergeDonations(log, recent);
    expect(merged.map((d) => d.id)).toEqual(['bpwh_c_2', 'bp_1_98']);
  });

  it('Spendenstand: offizieller Stand + neue Webhook-Spenden + Tests; Top-Listen', () => {
    const stats = { title: 'A', total: 100, count: 4, donors: 3, target: 1000, closed: false, logos: [], fetchedAt: '2026-12-24T18:00:00.000Z' };
    const d = buildBpData(stats, [
      don('test_1', 'Tester', 10, '', '2026-12-24T19:00:00.000Z', true),
      don('bpwh_c_3', 'Carl', 50, 'super', '2026-12-24T18:30:00.000Z'),
      don('bp_1_5', 'Carl', 30, '', '2026-12-24T17:30:00.000Z'), // schon im offiziellen Stand enthalten
      don('bpwh_c_1', 'Anonym', null, '', '2026-12-24T17:00:00.000Z'),
    ]);
    expect(d.total).toBe(160);
    expect(d.count).toBe(6);
    expect(d.last?.name).toBe('Tester');
    expect(d.top.map((x) => x.amount)).toEqual([50, 30, 10]);
    expect(d.leaders[0]).toEqual({ name: 'Carl', amount: 80 });
    expect(d.comments.map((x) => x.id)).toEqual(['bpwh_c_3']);
  });

  it('Abstimmung per Spendenkommentar', () => {
    const s = { ...BP_DEFAULTS.bp_poll(), options: [{ text: 'Pizza', keywords: 'salami' }, { text: 'Sushi', keywords: '' }], active: true, startedAt: '2026-12-24T18:00:00.000Z' };
    expect(pollOptionFor(s, '#2 bitte')).toBe(1);
    expect(pollOptionFor(s, '1')).toBe(0);
    expect(pollOptionFor(s, 'Ich will SALAMI')).toBe(0);
    expect(pollOptionFor(s, 'sushi!')).toBe(1);
    expect(pollOptionFor(s, 'egal')).toBeNull();
    const r = pollResults(s, [
      don('a', 'A', 30, '#1', '2026-12-24T18:10:00.000Z'),
      don('b', 'B', 10, 'sushi', '2026-12-24T18:11:00.000Z'),
      don('c', 'C', 99, '#2', '2026-12-24T17:00:00.000Z'), // vor dem Start
    ], null);
    expect(r.options.map((o) => o.value)).toEqual([30, 10]);
    expect(r.options[0]!.percent).toBe(75);
    expect(r.leader).toBe(0);
    expect(pollResults({ ...s, countBy: 'count' }, [don('a', 'A', 30, '#1', '2026-12-24T18:10:00.000Z')], null).options[0]!.value).toBe(1);
  });

  it('Milestones: nächster Milestone und neu erreichte', () => {
    const s = { ...BP_DEFAULTS.bp_milestones(), milestones: [{ amount: 500, text: 'B' }, { amount: 100, text: 'A' }] };
    expect(milestoneView(s, null, 150)).toMatchObject({ next: { amount: 500 }, previous: 100 });
    expect(newlyReached(s, { reached: [] }, 600).map((m) => m.amount)).toEqual([100, 500]);
    expect(newlyReached(s, { reached: [100] }, 600).map((m) => m.amount)).toEqual([500]);
    expect(milestoneView(s, null, 600).next).toBeNull();
  });

  it('validiert Einstellungen (z. B. Logos nur per https)', () => {
    expect(() => mergeSettings('bp_logos', BP_DEFAULTS.bp_logos(), { extraLogos: 'javascript:alert(1)' })).toThrow();
    expect(mergeSettings('bp_logos', BP_DEFAULTS.bp_logos(), { extraLogos: 'https://example.org/a.png\n/media/x.png' })).toBeTruthy();
    expect(() => mergeSettings('bp_poll', BP_DEFAULTS.bp_poll(), { options: [{ text: 'nur eine', keywords: '' }] })).toThrow();
  });
});

describe('betterplace Ende-zu-Ende', () => {
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
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object });

  it('Webhook → Spendenalert, Spendenstand und Milestone-Alert', async () => {
    // betterplace-Verbindung ohne laufende Abfrage anlegen (kein Netz im Test)
    const id = 'bpconn';
    store.connections.save(ctx.db, { id, platform: 'betterplace', label: 'Test', enabled: true, data: { fundraisingEventId: '55552', seen: [], primed: true, webhookToken: 'tok123' } });
    const total = (await call('POST', '/api/widgets', { type: 'bp_total' })).json();
    const ms = (await call('POST', '/api/widgets', { type: 'bp_milestones' })).json();
    await call('PATCH', `/api/widgets/${ms.id}`, { settings: { milestones: [{ amount: 15, text: 'Bonus-Song' }] } });

    expect((await call('POST', '/hooks/falsch', EXAMPLE)).statusCode).toBe(404);
    const res = await call('POST', '/hooks/tok123', EXAMPLE);
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(`bpwh_${id}_1`);
    // gleiche laufende Nummer → kein zweiter Alert
    await call('POST', '/hooks/tok123', EXAMPLE);

    const events = store.events.list(ctx.db, { limit: 20 });
    expect(events.filter((e) => e.event.type === 'donation')).toHaveLength(1);
    const milestone = events.find((e) => e.event.type === 'milestone');
    expect(milestone?.event).toMatchObject({ amount: { value: 15 }, product: 'Bonus-Song', platform: 'betterplace' });

    const t = (await call('GET', `/api/widgets/${total.id}`)).json();
    expect(t.data.bp).toMatchObject({ total: 20, count: 1, last: { name: 'Donald Duck', amount: 20, comment: 'have fun' } });
    const conn = store.connections.get<{ webhookSeenAt?: string }>(ctx.db, id)!;
    expect(conn.data.webhookSeenAt).toBeTruthy();

    // Test-Modus: Beispieldaten
    await call('PUT', '/api/settings', { betterplaceTestMode: true });
    expect((await call('GET', `/api/widgets/${total.id}`)).json().data.bp.preview).toBe(true);
    await call('PUT', '/api/settings', { betterplaceTestMode: false });
  });

  it('auch ein normaler Webhook versteht das betterplace-Format', async () => {
    const wh = (await call('POST', '/api/connections/webhook', { label: 'W' })).json();
    const token = String(wh.data.url).split('/hooks/')[1];
    const r = await call('POST', `/hooks/${token}`, { ...EXAMPLE, donation: { ...EXAMPLE.donation, sequence_number: 42 } });
    expect(r.json().id).toBe(`bpwh_${wh.id}_42`);
  });

  it('Abstimmung: Start beim Aktivieren, Stimmen per Kommentar, Gewinnanimation', async () => {
    const poll = (await call('POST', '/api/widgets', { type: 'bp_poll' })).json();
    await call('PATCH', `/api/widgets/${poll.id}`, { settings: { active: true } });
    const started = (await call('GET', `/api/widgets/${poll.id}`)).json();
    expect(started.settings.startedAt).toBeTruthy();
    await call('POST', '/api/events/test', { type: 'donation', amount: 25, message: '#2' });
    const after = (await call('GET', `/api/widgets/${poll.id}`)).json();
    expect(after.data.bp.poll.options[1].value).toBe(25);
    expect((await call('POST', `/api/widgets/${poll.id}/poll/winner`)).statusCode).toBe(200);
  });
});
