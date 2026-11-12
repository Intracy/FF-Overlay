import { z } from 'zod';
import type { WidgetType } from '../shared/widgets.js';
import { LABEL_KINDS, LIST_STYLES } from '../shared/widgets.js';

const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^rgba?\([\d\s.,%]+\)$|^transparent$/, 'Ungültige Farbe');
const str = (max = 200) => z.string().max(max);
const num = (min: number, max: number) => z.number().min(min).max(max);
const anim = z.string().regex(/^[a-zA-Z]{0,40}$/);
const catalogKeys = z.array(z.string().regex(/^[a-z_]{1,30}$/)).max(20);
const isoOrEmpty = z.union([z.literal(''), z.string().datetime({ offset: true })]);

const text = z.object({ font: str(80), size: num(6, 300), weight: num(100, 900), color });

const eventList = z.object({
  style: z.enum(LIST_STYLES as [string, ...string[]]), themeColor: color, text, types: catalogKeys,
  minBits: num(0, 1e6), minRaiders: num(0, 1e6), maxEvents: num(1, 25), flipX: z.boolean(), flipY: z.boolean(),
  keepHistory: z.boolean(), fadeTime: num(0, 3600), animIn: anim, animOut: anim, speedMs: num(100, 10_000),
});

const goal = z.object({
  goalType: z.enum(['donation', 'follow', 'sub', 'cheer', 'charity']), title: str(120), target: num(0, 1e9), startValue: num(0, 1e9),
  startedAt: isoOrEmpty, endsAt: isoOrEmpty, includeSubs: z.boolean(), includeResubs: z.boolean(), includeGifts: z.boolean(),
  layout: z.enum(['standard', 'condensed']), barColor: color, barBgColor: color, barThickness: num(4, 300), barTextColor: color, text,
});

const label = z.object({
  kind: z.enum(Object.keys(LABEL_KINDS) as [string, ...string[]]), period: z.enum(['session', 'today', 'week', 'month']),
  format: str(200), empty: str(100), align: z.enum(['left', 'center', 'right']), text, shadow: z.boolean(),
});

const sec = num(0, 86_400);
const timer = z.object({
  startMinutes: num(0, 100_000), maxMinutes: num(0, 1_000_000), secondsPerFollow: sec, secondsPerSub: sec, secondsPerResub: sec,
  secondsPerGiftedSub: sec, secondsPer100Bits: sec, secondsPerDonationUnit: sec, secondsPerRaid: sec, secondsPerRedemption: sec,
  onlyWhileRunning: z.boolean(), showAdded: z.boolean(), endText: str(120), text, shadow: z.boolean(),
});

const creditKeys = ['follows', 'subs', 'donations', 'cheers', 'raids', 'gifters', 'charity'] as const;
const credits = z.object({
  theme: z.enum(['crawl', 'default', 'stars']), title: str(120), subtitle: str(200), text, headingColor: color,
  include: z.object(Object.fromEntries(creditKeys.map((k) => [k, z.boolean()])) as Record<(typeof creditKeys)[number], z.ZodBoolean>),
  headings: z.object(Object.fromEntries(creditKeys.map((k) => [k, str(80)])) as Record<(typeof creditKeys)[number], z.ZodString>),
  showAmounts: z.boolean(), loop: z.boolean(), loopDelay: num(0, 3600), mode: z.enum(['speed', 'duration']), speed: num(5, 1000),
  duration: num(3, 3600), playOnLoad: z.boolean(), playOnVisible: z.boolean(),
});

const dmg = num(0, 1e7);
const boss = z.object({
  startHp: num(1, 1e9), mode: z.enum(['fixed', 'incremental', 'overkill']), overkillMultiplier: num(0, 100), overkillMin: num(1, 1e9),
  incrAmount: num(0, 1e9), damagePerFollow: dmg, damagePerSub: dmg, damagePerBit: dmg, damagePerDonationUnit: dmg, damagePerRaider: dmg,
  bossHeal: z.boolean(), initialName: str(60), barColor: color, barBgColor: color, barTextColor: color, text, killAnimation: anim,
});

const ticker = z.object({
  types: catalogKeys, maxItems: num(1, 50), format: str(200), speed: num(10, 1000), text, amountColor: color, separator: str(10),
});

export const WIDGET_SCHEMAS: Record<WidgetType, z.ZodObject> = {
  event_list: eventList, goal, label, timer, credits, boss, ticker,
};

export const widgetCreateSchema = z.object({
  type: z.enum(['event_list', 'goal', 'label', 'timer', 'credits', 'boss', 'ticker']),
  name: str(80).optional(),
});

export const widgetPatchSchema = z.object({
  name: str(80).min(1).optional(),
  previewBackground: color.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

/** Teil-Update der Einstellungen prüfen und mit den aktuellen zusammenführen. */
export function mergeSettings(type: WidgetType, current: object, patch: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    const cur = (current as Record<string, unknown>)[k];
    merged[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? { ...cur, ...v } : v;
  }
  return WIDGET_SCHEMAS[type].parse(merged);
}
