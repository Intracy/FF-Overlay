import type { EventLogEntry } from '../shared/types.js';
import type { BetterplaceStats } from '../connectors/betterplace.js';
import {
  BP_SAMPLE, type BpData, type BpDonation, type BpMilestonesSettings, type BpPollSettings, type MilestonesState, type PollState,
} from '../shared/bpWidgets.js';

/*
 * Reine Berechnungen für die betterplace-Widgets.
 * Quellen: offizielle Zahlen der Spendenaktion (API), die letzten Spenden laut API und
 * die Spenden im Event-Log (Webhook bzw. Abfrage, plus Test-Spenden aus dem Dashboard).
 */

export function logToDonation(e: EventLogEntry): BpDonation {
  const ev = e.event;
  return {
    id: ev.id,
    name: ev.isAnonymous ? 'Anonym' : ev.user.name,
    amount: ev.amount ? ev.amount.value : null,
    comment: ev.message ?? '',
    at: e.createdAt,
    isTest: ev.platform === 'test',
  };
}

const sig = (d: BpDonation) => `${d.name.toLowerCase()}|${d.amount ?? ''}|${d.comment.trim().toLowerCase()}`;

/** Führt Log-Spenden und API-Spenden zusammen (gleiche Spende per Webhook und API nur einmal), neueste zuerst. */
export function mergeDonations(log: BpDonation[], recent: BpDonation[]): BpDonation[] {
  const ids = new Set(log.map((d) => d.id));
  const sigs = new Map<string, number>();
  for (const d of log) if (!d.isTest) sigs.set(sig(d), (sigs.get(sig(d)) ?? 0) + 1);
  const extra: BpDonation[] = [];
  for (const d of recent) {
    if (ids.has(d.id)) continue;
    const n = sigs.get(sig(d)) ?? 0;
    if (n > 0) {
      sigs.set(sig(d), n - 1);
      continue;
    }
    extra.push(d);
  }
  return [...log, ...extra].sort((a, b) => b.at.localeCompare(a.at));
}

const round = (v: number) => Math.round(v * 100) / 100;

export function buildBpData(stats: BetterplaceStats | null, donations: BpDonation[]): BpData {
  const tests = donations.filter((d) => d.isTest);
  const real = donations.filter((d) => !d.isTest);
  const sum = (xs: BpDonation[]) => round(xs.reduce((s, d) => s + (d.amount ?? 0), 0));
  let total: number;
  let count: number;
  let donors: number;
  if (stats) {
    // offizieller Stand + was seit der letzten Abfrage per Webhook kam + Test-Spenden
    const after = real.filter((d) => d.at > stats.fetchedAt && d.id.startsWith('bpwh_'));
    total = round(stats.total + sum(after) + sum(tests));
    count = stats.count + after.length + tests.length;
    donors = stats.donors + new Set([...after, ...tests].map((d) => d.name)).size;
  } else {
    total = sum(donations);
    count = donations.length;
    donors = new Set(donations.map((d) => d.name)).size;
  }
  const withAmount = donations.filter((d) => d.amount != null);
  const byName = new Map<string, number>();
  for (const d of withAmount) if (d.name !== 'Anonym') byName.set(d.name, round((byName.get(d.name) ?? 0) + d.amount!));
  return {
    preview: false,
    title: stats?.title ?? '',
    total,
    count,
    donors,
    target: stats?.target ?? null,
    last: donations[0] ?? null,
    top: [...withAmount].sort((a, b) => b.amount! - a.amount! || a.at.localeCompare(b.at)).slice(0, 25),
    leaders: [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, amount]) => ({ name, amount })),
    comments: donations.filter((d) => d.comment).slice(0, 25),
    feed: donations.slice(0, 200),
    logos: stats?.logos ?? [],
  };
}

export function sampleBpData(): BpData {
  return { preview: true, ...BP_SAMPLE };
}

// ---------- Abstimmung ----------

/** Welche Option meint ein Spendenkommentar? „#2“, „2“ am Anfang, Optionstext oder Stichwort. */
export function pollOptionFor(s: Pick<BpPollSettings, 'options'>, comment: string): number | null {
  const c = comment.trim().toLowerCase();
  if (!c) return null;
  const num = c.match(/(?:^|\s)#\s*(\d{1,2})\b/) ?? c.match(/^(\d{1,2})(?:\b|$)/);
  if (num) {
    const i = Number(num[1]) - 1;
    if (i >= 0 && i < s.options.length) return i;
  }
  for (let i = 0; i < s.options.length; i++) {
    const o = s.options[i]!;
    const words = [o.text, ...o.keywords.split(',')].map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2);
    if (words.some((w) => c.includes(w))) return i;
  }
  return null;
}

export function pollResults(s: BpPollSettings & { endedAt?: string }, donations: BpDonation[], state: PollState | null): NonNullable<BpData['poll']> {
  const values = s.options.map(() => 0);
  if (s.startedAt) {
    for (const d of donations) {
      if (d.at < s.startedAt || (s.endedAt && d.at > s.endedAt)) continue;
      const i = pollOptionFor(s, d.comment);
      if (i == null) continue;
      values[i] = round(values[i]! + (s.countBy === 'count' ? 1 : d.amount ?? 0));
    }
  }
  const total = round(values.reduce((a, b) => a + b, 0));
  const max = Math.max(...values, 0);
  return {
    title: s.title,
    active: s.active,
    started: !!s.startedAt,
    total,
    options: s.options.map((o, i) => ({ text: o.text, value: values[i]!, percent: total > 0 ? Math.round((values[i]! / total) * 1000) / 10 : 0 })),
    winnerAt: state?.winnerAt ?? 0,
    leader: total > 0 ? values.indexOf(max) : null,
  };
}

// ---------- Milestones ----------

export function milestoneView(s: BpMilestonesSettings, state: MilestonesState | null, total: number): NonNullable<BpData['milestones']> {
  const list = [...s.milestones].sort((a, b) => a.amount - b.amount);
  const reached = new Set(state?.reached ?? []);
  const next = list.find((m) => m.amount > total) ?? null;
  const previous = [...list].reverse().find((m) => m.amount <= total)?.amount ?? 0;
  return { list: list.map((m) => ({ ...m, reached: reached.has(m.amount) || m.amount <= total })), next, previous };
}

/** Neu erreichte Milestones (aufsteigend), die noch nicht gefeiert wurden */
export function newlyReached(s: BpMilestonesSettings, state: MilestonesState | null, total: number) {
  const reached = new Set(state?.reached ?? []);
  return [...s.milestones].sort((a, b) => a.amount - b.amount).filter((m) => m.amount <= total && !reached.has(m.amount));
}
