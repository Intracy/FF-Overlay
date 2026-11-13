import { CATALOG } from './catalog.js';
import type { WidgetType } from './widgets.js';

/*
 * „Dieses Widget testen“: passendes Test-Event je Widget-Typ und Einstellungen,
 * damit genau das bearbeitete Widget sichtbar reagiert (Liste bekommt einen Eintrag, Ziel steigt, Timer läuft hoch …).
 * Wird vom Dashboard an POST /api/events/test geschickt.
 */

export interface WidgetTestEvent {
  type: string;
  subtype?: string;
  user?: string;
  amount?: number;
  count?: number;
  message?: string;
}

export type WidgetTest =
  | { kind: 'event'; event: WidgetTestEvent; label: string }
  | { kind: 'credits'; label: string }
  | { kind: 'reload'; label: string };

const NAMES = ['Maxi H.', 'rubber duck', 'Unicorn<3', 'Pixelpaula', 'TestViewer', 'Kaffeekobold'];
const pick = <T,>(list: T[], rnd: () => number) => list[Math.floor(rnd() * list.length) % list.length]!;

const BY_KEY: Record<string, WidgetTestEvent> = {
  follow: { type: 'follow' },
  sub: { type: 'subscription', subtype: 'sub' },
  resub: { type: 'subscription', subtype: 'resub' },
  gift: { type: 'subscription', subtype: 'gift', count: 5 },
  cheer: { type: 'cheer', count: 500 },
  donation: { type: 'donation', amount: 10 },
  charity: { type: 'charity', amount: 10 },
  raid: { type: 'raid', count: 42 },
  redemption: { type: 'redemption' },
};

function fromCatalog(key: string): { event: WidgetTestEvent; label: string } {
  const c = CATALOG.find((x) => x.key === key) ?? CATALOG.find((x) => x.key === 'follow')!;
  return { event: BY_KEY[c.key] ?? { type: c.trigger.type, subtype: c.trigger.subtype }, label: c.label };
}

const LABEL_EVENT: Record<string, string> = {
  latest_follower: 'follow', count_follows: 'follow', latest_sub: 'sub', count_subs: 'sub', latest_resub: 'resub',
  latest_gifter: 'gift', top_gifter: 'gift', count_gifted: 'gift', latest_cheer: 'cheer', top_cheer: 'cheer', top_cheerer: 'cheer',
  total_bits: 'cheer', latest_donation: 'donation', top_donation: 'donation', top_donor: 'donation', total_donations: 'donation',
  latest_raid: 'raid', latest_redemption: 'redemption', latest_charity: 'charity', total_charity: 'charity',
};

const GOAL_EVENT: Record<string, string> = { donation: 'donation', follow: 'follow', sub: 'sub', cheer: 'cheer', charity: 'charity' };

/** erste Event-Art mit Wirkung > 0, sonst die erste der Liste */
function firstActive(s: Record<string, unknown>, pairs: Array<[string, string]>): string {
  return (pairs.find(([field]) => Number(s[field]) > 0) ?? pairs[0]!)[1];
}

export function widgetTest(type: WidgetType, settings: unknown, rnd: () => number = Math.random): WidgetTest {
  const s = (settings ?? {}) as Record<string, unknown>;
  const user = pick(NAMES, rnd);
  const withUser = (x: { event: WidgetTestEvent; label: string }): WidgetTest => ({ kind: 'event', event: { ...x.event, user }, label: x.label });
  switch (type) {
    case 'event_list':
    case 'ticker': {
      const types = Array.isArray(s.types) ? (s.types as string[]) : [];
      return withUser(fromCatalog(types.length ? pick(types, rnd) : 'follow'));
    }
    case 'goal':
      return withUser(fromCatalog(GOAL_EVENT[String(s.goalType)] ?? 'donation'));
    case 'label':
      return withUser(fromCatalog(LABEL_EVENT[String(s.kind)] ?? 'follow'));
    case 'timer':
      return withUser(fromCatalog(firstActive(s, [
        ['secondsPerFollow', 'follow'], ['secondsPerSub', 'sub'], ['secondsPerResub', 'resub'], ['secondsPerGiftedSub', 'gift'],
        ['secondsPer100Bits', 'cheer'], ['secondsPerDonationUnit', 'donation'], ['secondsPerRaid', 'raid'], ['secondsPerRedemption', 'redemption'],
      ])));
    case 'boss':
      return withUser(fromCatalog(firstActive(s, [
        ['damagePerFollow', 'follow'], ['damagePerSub', 'sub'], ['damagePerBit', 'cheer'], ['damagePerDonationUnit', 'donation'], ['damagePerRaider', 'raid'],
      ])));
    case 'credits':
      return { kind: 'credits', label: 'Credits abspielen' };
    case 'bp_logos':
      return { kind: 'reload', label: 'Logos neu laden' };
    case 'bp_poll': {
      const options = Array.isArray(s.options) ? (s.options as unknown[]) : [];
      const n = 1 + Math.floor(rnd() * Math.max(1, options.length));
      return { kind: 'event', event: { type: 'donation', user, amount: pick([5, 10, 25, 50], rnd), message: `#${n}` }, label: `Testspende für Option #${n}` };
    }
    case 'bp_milestones': {
      const ms = Array.isArray(s.milestones) ? (s.milestones as Array<{ amount: number }>) : [];
      const step = ms.length ? Math.max(5, Math.min(...ms.map((m) => Number(m.amount) || 0).filter((a) => a > 0), 250) / 2) : 25;
      return { kind: 'event', event: { type: 'donation', user, amount: Math.round(step), message: 'Auf zum nächsten Meilenstein!' }, label: `Testspende ${Math.round(step)} €` };
    }
    default: {
      // übrige betterplace-Widgets: Spende mit Kommentar
      const amount = pick([5, 10, 25, 50, 100], rnd);
      return { kind: 'event', event: { type: 'donation', user, amount, message: pick(['Weiter so!', 'Für den guten Zweck 💜', 'Grüße aus dem Chat!'], rnd) }, label: `Testspende ${amount} €` };
    }
  }
}
