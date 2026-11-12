import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AlertQueue } from '../src/queue/alertQueue.js';
import { buildAlert, messageParts, sanitizeTts } from '../src/templates/render.js';
import { defaultTemplate, withTemplateDefaults } from '../src/templates/defaults.js';
import { fragmentEmotes, normalizeTwitch } from '../src/connectors/twitch/normalize.js';
import { MIGRATIONS, openDb } from '../src/db.js';
import * as store from '../src/db.js';
import { addVariation, alertboxView, applyGlobalEdit, createProfile, ensureDefault } from '../src/alertbox.js';
import { CATALOG, detectPreset, eventCatalogKey } from '../src/shared/catalog.js';
import { applyFilters } from '../src/events/pipeline.js';
import type { AlertPayload } from '../src/shared/types.js';

function harness(opts: { moderation?: number; interrupt?: boolean } = {}) {
  const timers: Array<{ fn: () => void; at: number; id: number }> = [];
  let now = 0;
  let nextId = 1;
  const sent: any[] = [];
  const finished: Array<[string, string]> = [];
  const q = new AlertQueue({
    overlayId: 'o', connections: () => 1, send: (m) => sent.push(m), alertDelay: () => 1000,
    moderationDelay: () => opts.moderation ?? 0,
    interrupt: () => ({ enabled: !!opts.interrupt, delay: 500 }),
    onStateChange: () => {}, onFinished: (id, how) => finished.push([id, how]),
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ fn, at: now + ms, id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
  });
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { q, sent, finished, advance };
}

const alert = (n: number): AlertPayload => ({
  itemId: `i${n}`, eventId: `e${n}`, template: defaultTemplate('t', 't', ''), title: [{ text: `A${n}`, highlight: false }], tokens: {},
});
const shows = (sent: any[]) => sent.filter((m) => m.t === 'alert.show').map((m) => m.alert.itemId);

describe('Moderationsverzögerung', () => {
  it('gibt nach Ablauf automatisch frei', () => {
    const h = harness({ moderation: 5000 });
    h.q.enqueue(alert(1));
    expect(shows(h.sent)).toEqual([]);
    expect(h.q.state().held[0]).toMatchObject({ itemId: 'i1', releaseAt: 5000 });
    h.advance(5000);
    expect(shows(h.sent)).toEqual(['i1']);
  });

  it('unbegrenzt wartet auf Freigabe, Ablehnen verwirft', () => {
    const h = harness({ moderation: -1 });
    h.q.enqueue(alert(1));
    h.q.enqueue(alert(2));
    h.advance(600_000);
    expect(shows(h.sent)).toEqual([]);
    expect(h.q.reject('i1')).toBe(true);
    expect(h.finished).toEqual([['e1', 'rejected']]);
    expect(h.q.approve('i2')).toBe(true);
    expect(shows(h.sent)).toEqual(['i2']);
    expect(h.q.state().held).toEqual([]);
  });
});

describe('Alert-Parry (Unterbrechung)', () => {
  it('neuer Alert unterbricht den laufenden nach der Verzögerung, ohne Pause', () => {
    const h = harness({ interrupt: true });
    h.q.enqueue(alert(1));
    h.q.enqueue(alert(2));
    h.advance(499);
    expect(shows(h.sent)).toEqual(['i1']);
    h.advance(1);
    expect(h.sent.find((m) => m.t === 'alert.skip')?.itemId).toBe('i1');
    expect(shows(h.sent)).toEqual(['i1', 'i2']);
  });

  it('ohne Parry wird gewartet', () => {
    const h = harness();
    h.q.enqueue(alert(1));
    h.q.enqueue(alert(2));
    h.advance(3000);
    expect(shows(h.sent)).toEqual(['i1']);
  });
});

describe('Text-to-Speech-Filter', () => {
  it('Stufen der Spam-Sicherheit', () => {
    expect(sanitizeTts('Schau www.spam.de an', 1, 0)).toBe('Schau an');
    expect(sanitizeTts('Hallooooooo hallo hallo hallo', 2, 0)).toBe('Hallooo hallo hallo');
    expect(sanitizeTts('Hi ♥♥ ✨ du!', 3, 0)).toBe('Hi du!');
    expect(sanitizeTts('a b a b a b', 0, 2)).toBe('a b a b');
  });

  it('liest nur ab Mindestbetrag und optional mit Vorlage', () => {
    const t = withTemplateDefaults({ ...defaultTemplate('t', 't', '{user} spendet {amount}'), tts: { ...defaultTemplate('t', 't', '').tts, enabled: true, minAmount: 5, includeTemplate: true } });
    const ev = { id: 'x', platform: 'test' as const, type: 'donation' as const, user: { name: 'Max' }, amount: { value: 10, currency: 'EUR' }, message: 'Danke!', receivedAt: '' };
    expect(buildAlert(t, ev).tts?.replace(/ /g, ' ')).toBe('Max spendet 10,00 €. Danke!');
    expect(buildAlert(t, { ...ev, amount: { value: 2, currency: 'EUR' } }).tts).toBeUndefined();
  });
});

describe('Emotes', () => {
  it('teilt Nachrichten in Text und Emotes', () => {
    expect(messageParts('Hallo Kappa du', [{ id: '25', begin: 6, end: 10 }])).toEqual([
      { text: 'Hallo ' }, { emote: '25', name: 'Kappa' }, { text: ' du' },
    ]);
  });

  it('berechnet Positionen aus Twitch-Fragments', () => {
    expect(fragmentEmotes([{ type: 'text', text: 'Hi ' }, { type: 'emote', text: 'Kappa', emote: { id: '25' } }])).toEqual([{ id: '25', begin: 3, end: 7 }]);
  });

  it('Alert enthält Emote-Teile nur wenn erlaubt', () => {
    const ev = { id: 'x', platform: 'twitch' as const, type: 'subscription' as const, subtype: 'resub', user: { name: 'A' }, message: 'GG Kappa', emotes: [{ id: '25', begin: 3, end: 7 }], receivedAt: '' };
    const t = defaultTemplate('t', 't', '{user}');
    expect(buildAlert(t, ev).messageParts).toHaveLength(2);
    expect(buildAlert({ ...t, message: { ...t.message, allowEmotes: false } }, ev).messageParts).toBeUndefined();
  });
});

describe('Neue Twitch-Events', () => {
  it('Power-Ups aus channel.bits.use, normale Cheers werden ignoriert', () => {
    expect(normalizeTwitch('channel.bits.use', { type: 'cheer', bits: 100 }, 'a')).toBeNull();
    expect(normalizeTwitch('channel.bits.use', { type: 'power_up', bits: 50, user_name: 'X', power_up: { type: 'gigantify_an_emote' } }, 'b'))
      .toMatchObject({ type: 'power_up', product: 'Emote vergrößern', count: 50 });
  });

  it('Charity-Spenden mit Nachkommastellen', () => {
    expect(normalizeTwitch('channel.charity_campaign.donate', { user_name: 'Y', charity_name: 'Tafel', amount: { value: 1550, decimal_places: 2, currency: 'EUR' } }, 'c'))
      .toMatchObject({ type: 'charity', amount: { value: 15.5, currency: 'EUR' }, product: 'Tafel' });
  });
});

describe('Katalog', () => {
  it('ordnet Events dem Ereignisfilter zu', () => {
    expect(eventCatalogKey({ type: 'subscription', subtype: 'gift_recipient' })).toBe('gift');
    expect(eventCatalogKey({ type: 'subscription', subtype: 'resub' })).toBe('resub');
    expect(eventCatalogKey({ type: 'power_up' })).toBe('power_up');
  });

  it('erkennt Presets wieder', () => {
    const donation = CATALOG.find((c) => c.key === 'donation')!;
    const p = donation.presets.find((x) => x.id === 'min_amount')!;
    expect(detectPreset(donation, p.build(50))).toMatchObject({ preset: { id: 'min_amount' }, value: 50 });
    expect(detectPreset(donation, [{ field: 'message', op: 'regex', value: 'x' }])).toBeNull();
  });
});

describe('Filter-Optionen', () => {
  const ev = { id: 'x', platform: 'twitch' as const, type: 'donation' as const, user: { name: 'Fuck_Name' }, message: 'classic shit', receivedAt: '' };
  const base = { minDonationAmount: 0, blockedUsers: [], badWords: [], badWordMode: 'censor' as const, useDefaultBadWords: true, anonymizeNames: true, censorEventLog: true, autoResetSession: true };
  it('Standardliste, ganze Wörter, Namen anonymisieren', () => {
    const r = applyFilters(ev, base).event;
    expect(r.message).toBe('classic ****');
    expect(r.user.name).toBe('Anonym'); // Unterstrich ist kein Buchstabe → Treffer
  });
  it('Namen bleiben, wenn Anonymisieren aus ist', () => {
    expect(applyFilters({ ...ev, user: { name: 'fuck' } }, { ...base, anonymizeNames: false }).event.user.name).toBe('fuck');
    expect(applyFilters({ ...ev, user: { name: 'fuck' } }, base).event.user.name).toBe('Anonym');
  });
});

describe('Alert-Box, Profile, globale Bearbeitung', () => {
  it('Standard-Alerts, Varianten und Profile', () => {
    const db = openDb(':memory:');
    const o = store.overlays.create(db, 'Test');
    ensureDefault(db, o, 'cheer');
    const v = addVariation(db, o, 'cheer', { name: 'Große Cheers', copyCurrent: true, presetId: 'min_bits', value: 1000 });
    expect(v.conditions).toEqual([{ field: 'count', op: 'gte', value: 1000 }]);
    const view = alertboxView(db, o);
    const cheer = view.entries.find((e) => e.key === 'cheer')!;
    expect(cheer.default?.rule.kind).toBe('default');
    expect(cheer.variations.map((x) => x.rule.name)).toEqual(['Große Cheers']);

    // Profil als Kopie, Umschalten wirkt sich auf aktive Regeln aus
    const p2 = createProfile(db, o, 'Charity-Stream', true);
    const o2 = store.overlays.update(db, o.id, { activeProfileId: p2.id })!;
    const active = store.rules.active(db, o2);
    expect(active).toHaveLength(2);
    expect(active.every((r) => r.profileId === p2.id)).toBe(true);
    // Kopie hat eigene Designs
    expect(active.map((r) => r.templateId)).not.toContain(v.templateId);

    // Globale Bearbeitung trifft nur das aktive Profil
    const values = { ...defaultTemplate('x', 'x', ''), sound: { url: '/media/x.mp3', volume: 0.3 } };
    expect(applyGlobalEdit(db, o2, 'sound', values)).toBe(2);
    expect(store.templates.get(db, active[0]!.templateId)!.sound.url).toBe('/media/x.mp3');
    expect(store.templates.get(db, v.templateId)!.sound.url).toBe('');
  });

  it('migriert eine Datenbank aus Version 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffo-'));
    const file = path.join(dir, 'old.sqlite');
    const old = new Database(file);
    old.exec(MIGRATIONS[0] as string);
    old.pragma('user_version = 1');
    old.prepare("INSERT INTO overlays (id, name, key, created_at) VALUES ('o1','Alt','k','2026-01-01')").run();
    old.prepare("INSERT INTO templates (id, name, data, updated_at) VALUES ('t1','Alt', ?, '2026-01-01')").run(JSON.stringify({ id: 't1', name: 'Alt', text: { format: '{user}!' } }));
    old.prepare("INSERT INTO rules (id, overlay_id, data, updated_at) VALUES ('r1','o1', ?, '2026-01-01')").run(JSON.stringify({ id: 'r1', overlayId: 'o1', name: 'R', trigger: { type: 'follow' }, conditions: [], priority: 10, weight: 1, templateId: 't1', enabled: true, onlyWhenLive: false }));
    old.close();

    const db = openDb(file);
    const o = store.overlays.get(db, 'o1')!;
    expect(o.activeProfileId).toBeTruthy();
    expect(o.moderationDelay).toBe(0);
    expect(store.rules.active(db, o)[0]).toMatchObject({ profileId: o.activeProfileId, kind: 'default' });
    const t = store.templates.get(db, 't1')!;
    expect(t.text.format).toBe('{user}!');
    expect(t.tts.enabled).toBe(false);
    db.close();
  });
});

describe('Hochformat 9:16', () => {
  it('speichert Teil-Updates der Hochformat-Einstellungen und behält den Rest', async () => {
    const { openDb, overlays, PORTRAIT_DEFAULTS } = await import('../src/db.js');
    const db = openDb(':memory:');
    const o = overlays.create(db, 'Test');
    expect(o.portrait).toEqual(PORTRAIT_DEFAULTS);
    const u = overlays.update(db, o.id, { portrait: { scale: 200 } })!;
    expect(u.portrait).toEqual({ ...PORTRAIT_DEFAULTS, scale: 200 });
    const { overlayPatchSchema } = await import('../src/schemas.js');
    expect(() => overlayPatchSchema.parse({ portrait: { scale: 9999 } })).toThrow();
    expect(overlayPatchSchema.parse({ portrait: { align: 'bottom' } }).portrait).toEqual({ align: 'bottom' });
  });
});
