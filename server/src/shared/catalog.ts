// Alert-Katalog nach dem Vorbild der Streamlabs-Alert-Box: Event-Typen, Gruppen,
// Standardvorlagen, Test-Events und die Bedingungen für „Variation hinzufügen“.
// Reine Daten – wird von Backend und Dashboard benutzt.

import type { Condition, EventType, NormalizedEvent } from './types.js';

export type PresetValue = 'number' | 'text' | 'tier' | 'frequency' | null;

export interface VariationPreset {
  id: string;
  /** Beschriftung wie in Streamlabs, `<x>` = Eingabewert */
  label: string;
  value: PresetValue;
  build: (v: string | number) => Condition[];
}

export interface CatalogEntry {
  key: string;
  group: 'Twitch' | 'YouTube' | 'Spenden' | 'Sonstiges';
  label: string;
  trigger: { type: EventType; subtype?: string };
  defaultFormat: string;
  sample: Partial<NormalizedEvent>;
  presets: VariationPreset[];
}

/** Häufigkeit wie bei Streamlabs („Randomly“) → Wahrscheinlichkeit in % */
export const FREQUENCIES: Array<{ label: string; percent: number }> = [
  { label: 'Sehr selten', percent: 10 },
  { label: 'Selten', percent: 25 },
  { label: 'Als Vorgabe', percent: 50 },
  { label: 'Häufig', percent: 75 },
  { label: 'Sehr häufig', percent: 90 },
];

export const TIERS = [
  { value: '1000', label: 'Tier 1' },
  { value: '2000', label: 'Tier 2' },
  { value: '3000', label: 'Tier 3' },
];

const random: VariationPreset = {
  id: 'random', label: 'Zufällig (ersetzt den Standard-Alert)', value: 'frequency',
  build: (v) => [{ field: '', op: 'random', value: Number(v) || 50 }],
};
const num = (id: string, label: string, field: string, op: 'gte' | 'eq'): VariationPreset => ({
  id, label, value: 'number', build: (v) => [{ field, op, value: Number(v) }],
});

export const CATALOG: CatalogEntry[] = [
  {
    key: 'follow', group: 'Twitch', label: 'Follows', trigger: { type: 'follow' },
    defaultFormat: '{user} folgt jetzt!', sample: {},
    presets: [random, { id: 'first', label: 'Erstes Event dieses Users', value: null, build: () => [{ field: '', op: 'firstFromUser' }] }],
  },
  {
    key: 'sub', group: 'Twitch', label: 'Abonnements', trigger: { type: 'subscription', subtype: 'sub' },
    defaultFormat: '{user} hat abonniert ({tier})!', sample: { tier: '1000', months: 1 },
    presets: [random, { id: 'tier', label: 'Abo-Stufe ist <x>', value: 'tier', build: (v) => [{ field: 'tier', op: 'eq', value: String(v) }] }],
  },
  {
    key: 'resub', group: 'Twitch', label: 'Resubs', trigger: { type: 'subscription', subtype: 'resub' },
    defaultFormat: '{user} ist seit {months} Monaten dabei!', sample: { tier: '1000', months: 14, streakMonths: 6, message: 'Grüße in den Chat! Kappa' },
    presets: [
      random,
      num('min_months', 'Monate abonniert mindestens <x>', 'months', 'gte'),
      num('exact_months', 'Monate abonniert genau <x>', 'months', 'eq'),
      num('min_streak', 'Monate in Folge (Streak) mindestens <x>', 'streakMonths', 'gte'),
      { id: 'tier', label: 'Abo-Stufe ist <x>', value: 'tier', build: (v) => [{ field: 'tier', op: 'eq', value: String(v) }] },
    ],
  },
  {
    key: 'gift', group: 'Twitch', label: 'Gift-Subs', trigger: { type: 'subscription', subtype: 'gift' },
    defaultFormat: '{gifter} verschenkt {count} Subs!', sample: { tier: '1000', count: 5, gifter: 'TestViewer' },
    presets: [
      random,
      num('min_gifts', 'Mindestens <x> Subs auf einmal verschenkt', 'count', 'gte'),
      { id: 'anon', label: 'Anonym verschenkt', value: null, build: () => [{ field: 'isAnonymous', op: 'eq', value: 'true' }] },
      { id: 'tier', label: 'Abo-Stufe ist <x>', value: 'tier', build: (v) => [{ field: 'tier', op: 'eq', value: String(v) }] },
    ],
  },
  {
    key: 'cheer', group: 'Twitch', label: 'Bits', trigger: { type: 'cheer' },
    defaultFormat: '{user} cheert {amount}!', sample: { count: 500, amount: { value: 500, currency: 'BITS' }, message: 'Cheer500 Weiter so!' },
    presets: [random, num('min_bits', 'Bits mindestens <x>', 'count', 'gte'), num('exact_bits', 'Bits genau <x>', 'count', 'eq')],
  },
  {
    key: 'power_up', group: 'Twitch', label: 'Power-Ups', trigger: { type: 'power_up' },
    defaultFormat: '{user} löst {product} aus ({count} Bits)!', sample: { product: 'Emote vergrößern', count: 50, amount: { value: 50, currency: 'BITS' } },
    presets: [random, { id: 'specific', label: 'Bestimmtes Power-Up: <x>', value: 'text', build: (v) => [{ field: 'product', op: 'eq', value: String(v) }] }],
  },
  {
    key: 'raid', group: 'Twitch', label: 'Raids', trigger: { type: 'raid' },
    defaultFormat: '{user} raidet mit {count} Leuten!', sample: { count: 42 },
    presets: [random, num('min_raiders', 'Raid-Größe mindestens <x>', 'count', 'gte')],
  },
  {
    key: 'redemption', group: 'Twitch', label: 'Kanalpunkte', trigger: { type: 'redemption' },
    defaultFormat: '{user} löst {product} ein', sample: { product: 'Hydrate!', count: 500 },
    presets: [
      random,
      { id: 'reward', label: 'Belohnung heißt <x>', value: 'text', build: (v) => [{ field: 'product', op: 'eq', value: String(v) }] },
      num('min_cost', 'Kosten mindestens <x> Punkte', 'count', 'gte'),
    ],
  },
  {
    key: 'charity', group: 'Twitch', label: 'Charity-Spenden', trigger: { type: 'charity' },
    defaultFormat: '{user} spendet {amount} für den guten Zweck!', sample: { amount: { value: 10, currency: 'EUR' } },
    presets: [random, num('min_amount', 'Betrag mindestens <x>', 'amount.value', 'gte'), num('exact_amount', 'Betrag genau <x>', 'amount.value', 'eq')],
  },
  {
    key: 'yt_superchat', group: 'YouTube', label: 'Super Chats', trigger: { type: 'superchat', subtype: 'chat' },
    defaultFormat: '{user} schickt einen Super Chat über {amount}!', sample: { amount: { value: 10, currency: 'EUR' }, message: 'Grüße aus Nürnberg!', tier: '3' },
    presets: [
      random,
      num('min_amount', 'Betrag mindestens <x>', 'amount.value', 'gte'),
      num('exact_amount', 'Betrag genau <x>', 'amount.value', 'eq'),
      { id: 'largest', label: 'Größter Betrag dieses Streams', value: null, build: () => [{ field: '', op: 'largestOfStream' }] },
      { id: 'message', label: 'Nachricht enthält <x>', value: 'text', build: (v) => [{ field: 'message', op: 'contains', value: String(v) }] },
    ],
  },
  {
    key: 'yt_supersticker', group: 'YouTube', label: 'Super Sticker', trigger: { type: 'superchat', subtype: 'sticker' },
    defaultFormat: '{user} schickt einen Super Sticker ({amount})!', sample: { amount: { value: 5, currency: 'EUR' }, product: 'Winkende Katze' },
    presets: [random, num('min_amount', 'Betrag mindestens <x>', 'amount.value', 'gte')],
  },
  {
    key: 'yt_member', group: 'YouTube', label: 'Neue Mitglieder', trigger: { type: 'membership', subtype: 'new' },
    defaultFormat: '{user} ist jetzt Mitglied ({tier})!', sample: { tier: 'Mitglied', product: 'Mitglied' },
    presets: [random, { id: 'level', label: 'Mitgliedsstufe ist <x>', value: 'text', build: (v) => [{ field: 'tier', op: 'eq', value: String(v) }] }],
  },
  {
    key: 'yt_milestone', group: 'YouTube', label: 'Mitglieds-Meilensteine', trigger: { type: 'membership', subtype: 'milestone' },
    defaultFormat: '{user} ist seit {months} Monaten Mitglied!', sample: { months: 12, tier: 'Mitglied', message: 'Ein Jahr schon!' },
    presets: [random, num('min_months', 'Monate mindestens <x>', 'months', 'gte'), num('exact_months', 'Monate genau <x>', 'months', 'eq')],
  },
  {
    key: 'yt_gift', group: 'YouTube', label: 'Verschenkte Mitgliedschaften', trigger: { type: 'membership', subtype: 'gift' },
    defaultFormat: '{user} verschenkt {count} Mitgliedschaften!', sample: { count: 5, tier: 'Mitglied' },
    presets: [random, num('min_gifts', 'Mindestens <x> auf einmal verschenkt', 'count', 'gte')],
  },
  {
    key: 'yt_subscriber', group: 'YouTube', label: 'Abonnent:innen', trigger: { type: 'subscriber' },
    defaultFormat: '{user} hat abonniert!', sample: {},
    presets: [random],
  },
  {
    key: 'donation', group: 'Spenden', label: 'Spendenalert mit GIFs & Sounds', trigger: { type: 'donation' },
    defaultFormat: '{user} spendet {amount}!', sample: { amount: { value: 10, currency: 'EUR' }, message: 'Für den guten Zweck!' },
    presets: [
      random,
      num('min_amount', 'Spendenbetrag mindestens <x>', 'amount.value', 'gte'),
      num('exact_amount', 'Spendenbetrag genau <x>', 'amount.value', 'eq'),
      { id: 'largest', label: 'Größte Spende dieses Streams', value: null, build: () => [{ field: '', op: 'largestOfStream' }] },
      { id: 'message', label: 'Nachricht enthält <x>', value: 'text', build: (v) => [{ field: 'message', op: 'contains', value: String(v) }] },
    ],
  },
  {
    key: 'milestone', group: 'Spenden', label: 'Milestone erreicht', trigger: { type: 'milestone' },
    defaultFormat: 'Milestone {amount} erreicht: {product}!', sample: { amount: { value: 500, currency: 'EUR' }, product: 'Bonus-Song', user: { name: 'Community' } },
    presets: [
      random,
      num('min_amount', 'Milestone-Betrag mindestens <x>', 'amount.value', 'gte'),
      num('exact_amount', 'Milestone-Betrag genau <x>', 'amount.value', 'eq'),
      { id: 'text', label: 'Milestone-Text enthält <x>', value: 'text', build: (v) => [{ field: 'product', op: 'contains', value: String(v) }] },
    ],
  },
  {
    key: 'custom', group: 'Sonstiges', label: 'Eigene Events (Webhook)', trigger: { type: 'custom' },
    defaultFormat: '{user}: {message}', sample: { message: 'Eigenes Event' },
    presets: [random, { id: 'subtype', label: 'Text enthält <x>', value: 'text', build: (v) => [{ field: 'message', op: 'contains', value: String(v) }] }],
  },
];

export const catalogKey = (trigger: { type: string; subtype?: string }) =>
  CATALOG.find((c) => c.trigger.type === trigger.type && (c.trigger.subtype ?? '') === (trigger.subtype ?? ''))?.key ??
  CATALOG.find((c) => c.trigger.type === trigger.type && !c.trigger.subtype)?.key;

/** Ordnet ein Event dem Katalog zu (für den Ereignisfilter). Gift-Empfänger zählen zu „gift“. */
export function eventCatalogKey(e: Pick<NormalizedEvent, 'type' | 'subtype'>): string | undefined {
  if (e.type === 'subscription') return e.subtype === 'resub' ? 'resub' : e.subtype === 'sub' ? 'sub' : 'gift';
  if (e.type === 'membership' && e.subtype === 'gift_recipient') return 'yt_gift';
  return catalogKey({ type: e.type, subtype: e.subtype });
}

/** Erkennt, mit welchem Preset eine Variante gebaut wurde (für die Bearbeitung). */
export function detectPreset(entry: CatalogEntry, conditions: Condition[]): { preset: VariationPreset; value: string | number } | null {
  for (const p of entry.presets) {
    const probe = p.value === 'number' || p.value === 'frequency' ? Number(conditions[0]?.value ?? 0) : String(conditions[0]?.value ?? '');
    const built = p.build(probe);
    if (JSON.stringify(built) === JSON.stringify(conditions)) return { preset: p, value: probe };
  }
  return null;
}
