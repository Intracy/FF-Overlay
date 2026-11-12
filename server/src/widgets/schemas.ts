import { z } from 'zod';
import type { WidgetType } from '../shared/widgets.js';
import { LABEL_KINDS, LIST_STYLES, WIDGET_INFO } from '../shared/widgets.js';

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

// ---------- betterplace ----------
const align = z.enum(['left', 'center', 'right']);
const headed = { headlineText: str(120), align, headline: text };
const pct = num(0, 100);
const isoOrEmpty2 = isoOrEmpty;

const bpAll = z.object({
  designMode: z.enum(['default', 'custom']), theme: z.enum(['standard', 'pixel', 'sakura', 'pride']),
  labels: z.object({ total: str(60), last: str(60), top: str(60) }), headline: text, data: text,
});
const bpPoll = z.object({
  title: str(200), options: z.array(z.object({ text: str(100), keywords: str(200) })).min(2).max(10), active: z.boolean(),
  startedAt: isoOrEmpty2, endedAt: isoOrEmpty2, countBy: z.enum(['amount', 'count']), progressColor: color, baseColor: color, baseOpacity: pct,
  headline: text, option: text, data: text,
});
const bpTotal = z.object({ ...headed, lines: z.enum(['single', 'multi']), data: text });
const bpLast = z.object({ ...headed, lines: z.enum(['single', 'multi']), showComment: z.boolean(), name: text, amount: text, comment: text });
const bpTop = z.object({
  ...headed, count: num(1, 25), display: z.enum(['list', 'loop']), rotateSeconds: num(1, 120), showComment: z.boolean(), name: text, amount: text, comment: text,
});
const bpLeaderboard = z.object({ ...headed, count: num(1, 25), display: z.enum(['list', 'loop']), rotateSeconds: num(1, 120), name: text, amount: text });
const bpProgress = z.object({
  ...headed, display: z.enum(['both', 'bar', 'text']), target: num(0, 1e9), barHeight: num(4, 200), progressColor: color, baseColor: color, baseOpacity: pct, data: text,
});
const bpComment = z.object({ ...headed, count: num(1, 25), rotateSeconds: num(1, 120), name: text, amount: text, comment: text });
const bpLogos = z.object({
  duration: num(1, 120), align, showNames: z.boolean(),
  extraLogos: z.string().max(4000).refine((v) => v.split('\n').every((l) => !l.trim() || /^(https:\/\/|\/media\/)/.test(l.trim())), 'Nur https://-Adressen oder eigene Uploads'),
  logoHeight: num(20, 1000), name: text,
});
const bpMilestones = z.object({
  milestones: z.array(z.object({ amount: num(0, 1e9), text: str(200) })).max(50), mode: z.enum(['display_and_alert', 'alert_only']),
  headlineText: str(120), progressColor: color, baseColor: color, text, amount: text,
});
const bpFeed = z.object({ sort: z.enum(['newest', 'highest']), showComments: z.boolean(), onlyWithAmount: z.boolean(), max: num(5, 200), name: text, amount: text, comment: text });

export const WIDGET_SCHEMAS: Record<WidgetType, z.ZodObject> = {
  event_list: eventList, goal, label, timer, credits, boss, ticker,
  bp_all: bpAll, bp_poll: bpPoll, bp_total: bpTotal, bp_last: bpLast, bp_top: bpTop, bp_leaderboard: bpLeaderboard,
  bp_progress: bpProgress, bp_comment: bpComment, bp_logos: bpLogos, bp_milestones: bpMilestones, bp_feed: bpFeed,
};

export const widgetCreateSchema = z.object({
  type: z.enum(Object.keys(WIDGET_INFO) as [WidgetType, ...WidgetType[]]),
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
