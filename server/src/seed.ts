import { nanoid } from 'nanoid';
import type { DB } from './db.js';
import * as store from './db.js';
import type { EventType, NormalizedEvent, Rule } from './shared/types.js';
import { defaultTemplate } from './templates/render.js';

/** Legt beim ersten Start ein Overlay mit sinnvollen Standard-Regeln an. */
export function seedIfEmpty(db: DB) {
  if (store.overlays.list(db).length) return;
  const overlay = store.overlays.create(db, 'Haupt-Overlay');

  const tpl = (name: string, format: string, patch: (t: ReturnType<typeof defaultTemplate>) => void = () => {}) => {
    const t = defaultTemplate(nanoid(10), name, format);
    patch(t);
    return store.templates.save(db, t);
  };

  const follow = tpl('Follow', '{user} folgt jetzt!', (t) => (t.animation.in = 'bounceIn'));
  const sub = tpl('Sub', '{user} hat abonniert ({tier})!');
  const resub = tpl('Resub', '{user} ist seit {months} Monaten dabei!');
  const gift = tpl('Gift-Subs', '{gifter} verschenkt {count} Subs!', (t) => (t.animation.in = 'zoomIn'));
  const cheer = tpl('Cheer', '{user} cheert {amount}!');
  const raid = tpl('Raid', '{user} raidet mit {count} Leuten!', (t) => (t.animation.in = 'slideInDown'));
  const redemption = tpl('Kanalpunkte', '{user} löst {product} ein', (t) => (t.text.letterAnimation = 'none'));
  const donation = tpl('Spende', '{user} spendet {amount}!');
  const bigDonation = tpl('Große Spende', '{user} spendet {amount}!', (t) => {
    t.animation.in = 'tada';
    t.text.size = 72;
    t.text.letterAnimation = 'rubberBand';
    t.duration = 12000;
  });

  const rule = (name: string, type: EventType, templateId: string, extra: Partial<Rule> = {}) =>
    store.rules.save(db, {
      id: nanoid(10), overlayId: overlay.id, name, trigger: { type }, conditions: [], priority: 10, weight: 1,
      templateId, enabled: true, onlyWhenLive: false, ...extra,
    });

  rule('Follow', 'follow', follow.id);
  rule('Sub', 'subscription', sub.id, { trigger: { type: 'subscription', subtype: 'sub' } });
  rule('Resub', 'subscription', resub.id, { trigger: { type: 'subscription', subtype: 'resub' } });
  rule('Gift-Subs', 'subscription', gift.id, { trigger: { type: 'subscription', subtype: 'gift' } });
  rule('Cheer', 'cheer', cheer.id);
  rule('Raid', 'raid', raid.id);
  rule('Kanalpunkte', 'redemption', redemption.id);
  rule('Spende', 'donation', donation.id);
  rule('Große Spende ab 50 €', 'donation', bigDonation.id, {
    priority: 100,
    conditions: [{ field: 'amount.value', op: 'gte', value: 50 }],
  });
}

/** Beispiel-Events für die Test-Buttons im Dashboard. */
export function sampleEvent(type: EventType, subtype?: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const base: NormalizedEvent = {
    id: `test_${nanoid(12)}`, platform: 'test', type, subtype, isTest: true,
    user: { name: 'TestViewer' }, receivedAt: new Date().toISOString(),
  };
  const presets: Partial<Record<string, Partial<NormalizedEvent>>> = {
    follow: {},
    'subscription:sub': { tier: '1000', months: 1 },
    'subscription:resub': { tier: '1000', months: 14, streakMonths: 6, message: 'Grüße in den Chat!' },
    'subscription:gift': { tier: '1000', count: 5, gifter: 'TestViewer' },
    cheer: { count: 500, amount: { value: 500, currency: 'BITS' }, message: 'Cheer500 Weiter so!' },
    raid: { count: 42 },
    redemption: { product: 'Hydrate!', count: 500 },
    donation: { amount: { value: 10, currency: 'EUR' }, message: 'Für den guten Zweck!' },
  };
  const key = subtype ? `${type}:${subtype}` : type;
  return { ...base, ...(presets[key] ?? presets[type] ?? {}), ...overrides };
}
