import type { EventLogEntry, NormalizedEvent } from '../shared/types.js';
import type {
  BossSettings, BossState, CreditsSettings, EventListSettings, GoalSettings, LabelSettings, TickerSettings, TimerSettings, TimerState,
} from '../shared/widgets.js';
import { eventCatalogKey } from '../shared/catalog.js';
import { formatAmount } from '../templates/render.js';

/*
 * Reine Berechnungen für Widgets. Ziele, Labels, Credits und Listen werden aus dem Event-Log
 * berechnet (keine doppelte Buchführung); nur Timer und Boss haben einen eigenen Zustand.
 */

const amount = (e: NormalizedEvent) => e.amount?.value ?? 0;
const isDonation = (e: NormalizedEvent) => e.type === 'donation';
const isBits = (e: NormalizedEvent) => e.type === 'cheer' || e.type === 'power_up';
const giftCount = (e: NormalizedEvent) => (e.type === 'subscription' && e.subtype === 'gift' ? e.count ?? 1 : 0);

// ---------- Ereignisliste & Ticker ----------

export function listFilter(s: EventListSettings | TickerSettings, e: NormalizedEvent): boolean {
  const key = eventCatalogKey(e);
  if (!key || !s.types.includes(key)) return false;
  if ('minBits' in s && isBits(e) && (e.count ?? 0) < s.minBits) return false;
  if ('minRaiders' in s && e.type === 'raid' && (e.count ?? 0) < s.minRaiders) return false;
  return true;
}

export function eventLine(e: NormalizedEvent): { name: string; detail: string } {
  const name = e.isAnonymous ? 'Anonym' : e.user.name;
  switch (e.type) {
    case 'follow': return { name, detail: 'Follow' };
    case 'subscription':
      if (e.subtype === 'gift') return { name: e.gifter ?? name, detail: `${e.count ?? 1}× Gift-Sub` };
      if (e.subtype === 'resub') return { name, detail: `${e.months ?? ''} Monate` };
      return { name, detail: 'Sub' };
    case 'cheer': return { name, detail: `${e.count ?? 0} Bits` };
    case 'power_up': return { name, detail: e.product ?? 'Power-Up' };
    case 'raid': return { name, detail: `Raid · ${e.count ?? 0}` };
    case 'redemption': return { name, detail: e.product ?? 'Kanalpunkte' };
    case 'donation':
    case 'charity': return { name, detail: formatAmount(e) };
    case 'superchat': return { name, detail: `${e.subtype === 'sticker' ? 'Super Sticker' : 'Super Chat'} · ${formatAmount(e)}` };
    case 'membership':
      if (e.subtype === 'gift') return { name, detail: `${e.count ?? 1}× Mitgliedschaft` };
      if (e.subtype === 'milestone') return { name, detail: `Mitglied · ${e.months ?? ''} Monate` };
      return { name, detail: 'Neues Mitglied' };
    case 'subscriber': return { name, detail: 'YouTube-Abo' };
    default: return { name, detail: e.message ?? '' };
  }
}

// ---------- Ziele ----------

export function goalValue(s: GoalSettings, entries: EventLogEntry[]): number {
  let v = s.startValue;
  for (const { event: e } of entries) {
    switch (s.goalType) {
      case 'donation': if (isDonation(e)) v += amount(e); break;
      case 'charity': if (e.type === 'charity') v += amount(e); break;
      case 'cheer': if (isBits(e)) v += e.count ?? 0; break;
      case 'follow': if (e.type === 'follow') v += 1; break;
      case 'sub':
        if (e.type !== 'subscription') break;
        if (e.subtype === 'sub' && s.includeSubs) v += 1;
        if (e.subtype === 'resub' && s.includeResubs) v += 1;
        if (e.subtype === 'gift' && s.includeGifts) v += giftCount(e);
        break;
    }
  }
  return Math.round(v * 100) / 100;
}

// ---------- Stream-Labels ----------

function topBy(entries: EventLogEntry[], pick: (e: NormalizedEvent) => number, by: 'event' | 'user') {
  if (by === 'event') {
    let best: NormalizedEvent | null = null;
    for (const { event: e } of entries) if (pick(e) > 0 && (!best || pick(e) > pick(best))) best = e;
    return best ? { name: best.isAnonymous ? 'Anonym' : best.user.name, value: pick(best), event: best } : null;
  }
  const sums = new Map<string, number>();
  for (const { event: e } of entries) {
    const v = pick(e);
    if (v <= 0 || e.isAnonymous) continue;
    sums.set(e.user.name, (sums.get(e.user.name) ?? 0) + v);
  }
  const top = [...sums.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? { name: top[0], value: top[1], event: null } : null;
}

const fmtMoney = (v: number, currency = 'EUR') => {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
};

export function labelText(s: LabelSettings, entries: EventLogEntry[]): string {
  const latest = (pred: (e: NormalizedEvent) => boolean) => [...entries].reverse().find(({ event }) => pred(event))?.event;
  const fill = (vals: Record<string, string>) => s.format.replace(/\{([a-z_]+)\}/g, (m, k: string) => vals[k] ?? m);
  const fromEvent = (e: NormalizedEvent | undefined) =>
    e ? fill({
      name: e.isAnonymous ? 'Anonym' : e.user.name, amount: formatAmount(e), count: String(e.count ?? ''), months: String(e.months ?? ''),
      message: e.message ?? '', product: e.product ?? '',
    }) : s.empty;
  const fromTop = (t: ReturnType<typeof topBy>, money: boolean) =>
    t ? fill({ name: t.name, amount: money ? fmtMoney(t.value, t.event?.amount?.currency) : String(t.value), count: String(t.value), months: '', message: t.event?.message ?? '', product: '' }) : s.empty;
  const total = (v: number, money: boolean) => fill({ name: '', amount: money ? fmtMoney(v) : String(v), count: String(v), months: '', message: '', product: '' });

  switch (s.kind) {
    case 'latest_follower': return fromEvent(latest((e) => e.type === 'follow'));
    case 'latest_sub': return fromEvent(latest((e) => e.type === 'subscription' && e.subtype === 'sub'));
    case 'latest_resub': return fromEvent(latest((e) => e.type === 'subscription' && e.subtype === 'resub'));
    case 'latest_gifter': {
      const e = latest((x) => x.type === 'subscription' && x.subtype === 'gift');
      return e ? fromEvent({ ...e, user: { name: e.gifter ?? e.user.name } }) : s.empty;
    }
    case 'latest_cheer': return fromEvent(latest(isBits));
    case 'latest_donation': return fromEvent(latest(isDonation));
    case 'latest_raid': return fromEvent(latest((e) => e.type === 'raid'));
    case 'latest_redemption': return fromEvent(latest((e) => e.type === 'redemption'));
    case 'latest_charity': return fromEvent(latest((e) => e.type === 'charity'));
    case 'top_donation': return fromTop(topBy(entries, (e) => (isDonation(e) ? amount(e) : 0), 'event'), true);
    case 'top_donor': return fromTop(topBy(entries, (e) => (isDonation(e) ? amount(e) : 0), 'user'), true);
    case 'top_cheer': return fromTop(topBy(entries, (e) => (isBits(e) ? e.count ?? 0 : 0), 'event'), false);
    case 'top_cheerer': return fromTop(topBy(entries, (e) => (isBits(e) ? e.count ?? 0 : 0), 'user'), false);
    case 'top_gifter': {
      const t = topBy(entries.map((x) => ({ ...x, event: { ...x.event, user: { name: x.event.gifter ?? x.event.user.name } } })), giftCount, 'user');
      return fromTop(t, false);
    }
    case 'total_donations': return total(Math.round(entries.reduce((s2, { event }) => s2 + (isDonation(event) ? amount(event) : 0), 0) * 100) / 100, true);
    case 'total_bits': return total(entries.reduce((s2, { event }) => s2 + (isBits(event) ? event.count ?? 0 : 0), 0), false);
    case 'total_charity': return total(Math.round(entries.reduce((s2, { event }) => s2 + (event.type === 'charity' ? amount(event) : 0), 0) * 100) / 100, true);
    case 'count_follows': return total(entries.filter(({ event }) => event.type === 'follow').length, false);
    case 'count_subs': return total(entries.filter(({ event }) => event.type === 'subscription' && event.subtype !== 'gift' && event.subtype !== 'gift_recipient').length, false);
    case 'count_gifted': return total(entries.reduce((s2, { event }) => s2 + giftCount(event), 0), false);
  }
}

// ---------- End-Credits ----------

export function creditsSections(s: CreditsSettings, entries: EventLogEntry[]) {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const sums = (pred: (e: NormalizedEvent) => boolean, val: (e: NormalizedEvent) => number, fmt: (v: number) => string, nameOf = (e: NormalizedEvent) => (e.isAnonymous ? 'Anonym' : e.user.name)) => {
    const m = new Map<string, number>();
    for (const { event: e } of entries) if (pred(e)) m.set(nameOf(e), (m.get(nameOf(e)) ?? 0) + val(e));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => (s.showAmounts ? `${n} – ${fmt(v)}` : n));
  };
  const sections: Array<{ key: string; heading: string; lines: string[] }> = [];
  const add = (key: keyof CreditsSettings['include'], lines: string[]) => {
    if (s.include[key] && lines.length) sections.push({ key, heading: s.headings[key], lines });
  };
  add('follows', uniq(entries.filter(({ event }) => event.type === 'follow').map(({ event }) => event.user.name)));
  add('subs', uniq(entries.filter(({ event }) => event.type === 'subscription' && (event.subtype === 'sub' || event.subtype === 'resub')).map(({ event }) => event.user.name)));
  add('gifters', sums((e) => e.type === 'subscription' && e.subtype === 'gift', giftCount, (v) => `${v}×`, (e) => e.gifter ?? e.user.name));
  add('donations', sums(isDonation, amount, (v) => fmtMoney(v)));
  add('charity', sums((e) => e.type === 'charity', amount, (v) => fmtMoney(v)));
  add('cheers', sums(isBits, (e) => e.count ?? 0, (v) => `${v} Bits`));
  add('raids', sums((e) => e.type === 'raid', (e) => e.count ?? 0, (v) => `${v} Raider`));
  return sections;
}

// ---------- Subathon-Timer ----------

export function timerSecondsFor(s: TimerSettings, e: NormalizedEvent): { seconds: number; reason: string } {
  switch (e.type) {
    case 'follow': return { seconds: s.secondsPerFollow, reason: 'Follow' };
    case 'subscription':
      if (e.subtype === 'sub') return { seconds: s.secondsPerSub, reason: 'Sub' };
      if (e.subtype === 'resub') return { seconds: s.secondsPerResub, reason: 'Resub' };
      if (e.subtype === 'gift') return { seconds: s.secondsPerGiftedSub * (e.count ?? 1), reason: `${e.count ?? 1}× Gift-Sub` };
      return { seconds: 0, reason: '' };
    case 'cheer':
    case 'power_up': return { seconds: Math.floor(((e.count ?? 0) / 100) * s.secondsPer100Bits), reason: `${e.count} Bits` };
    case 'donation':
    case 'charity': return { seconds: Math.floor(amount(e) * s.secondsPerDonationUnit), reason: formatAmount(e) };
    case 'raid': return { seconds: s.secondsPerRaid, reason: 'Raid' };
    case 'redemption': return { seconds: s.secondsPerRedemption, reason: e.product ?? 'Kanalpunkte' };
    default: return { seconds: 0, reason: '' };
  }
}

export const timerRemaining = (t: TimerState, now: number) => (t.running ? Math.max(0, t.endsAt - now) : t.remaining);

export function timerAdd(s: TimerSettings, t: TimerState, ms: number, now: number): TimerState {
  const cap = s.maxMinutes > 0 ? s.maxMinutes * 60_000 : Infinity;
  const next = Math.max(0, Math.min(cap, timerRemaining(t, now) + ms));
  return t.running ? { ...t, endsAt: now + next } : { ...t, remaining: next };
}

export const timerInitial = (s: TimerSettings): TimerState => ({ running: false, endsAt: 0, remaining: s.startMinutes * 60_000 });

// ---------- Stream-Boss ----------

export function bossDamage(s: BossSettings, e: NormalizedEvent): number {
  switch (e.type) {
    case 'follow': return s.damagePerFollow;
    case 'subscription':
      if (e.subtype === 'gift') return s.damagePerSub * (e.count ?? 1);
      return e.subtype === 'sub' || e.subtype === 'resub' ? s.damagePerSub : 0;
    case 'cheer':
    case 'power_up': return (e.count ?? 0) * s.damagePerBit;
    case 'donation':
    case 'charity': return Math.round(amount(e) * s.damagePerDonationUnit);
    case 'raid': return (e.count ?? 0) * s.damagePerRaider;
    default: return 0;
  }
}

export const bossInitial = (s: BossSettings): BossState => ({ name: s.initialName, hp: s.startHp, maxHp: s.startHp, lastDamage: null });

/** Wendet einen Treffer an. Besiegt der Angreifer den Boss, wird er neuer Boss (Modi wie bei Streamlabs). */
export function bossHit(s: BossSettings, b: BossState, attacker: string, dmg: number, now: number): { state: BossState; defeated: boolean } {
  if (dmg <= 0) return { state: b, defeated: false };
  if (attacker === b.name) {
    if (!s.bossHeal) return { state: b, defeated: false };
    return { state: { ...b, hp: Math.min(b.maxHp, b.hp + dmg), lastDamage: { by: attacker, amount: -dmg, at: now } }, defeated: false };
  }
  const hp = b.hp - dmg;
  if (hp > 0) return { state: { ...b, hp, lastDamage: { by: attacker, amount: dmg, at: now } }, defeated: false };
  const overflow = -hp;
  const maxHp =
    s.mode === 'incremental' ? b.maxHp + s.incrAmount
      : s.mode === 'overkill' ? Math.max(s.overkillMin, Math.round(overflow * s.overkillMultiplier))
        : s.startHp;
  return { state: { name: attacker, hp: maxHp, maxHp, lastDamage: { by: attacker, amount: dmg, at: now } }, defeated: true };
}
