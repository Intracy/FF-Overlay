import type { Condition, NormalizedEvent, Rule } from '../shared/types.js';

/** Laufzeit-Kontext, den manche Bedingungen brauchen. */
export interface RuleContext {
  isLive: boolean;
  /** Höchster bisheriger Betrag dieses Streams (ohne das aktuelle Event) */
  largestAmountThisStream: number;
  /** Hat der Nutzer schon früher ein Event dieses Typs ausgelöst? */
  hasPreviousFromUser: boolean;
  random: () => number;
}

export interface RuleMatch {
  rule: Rule;
  reason: string;
}

export function getField(event: NormalizedEvent, path: string): unknown {
  let cur: unknown = event;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const asNumber = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const asText = (v: unknown) => (v == null ? '' : String(v));

const OP_LABEL: Record<Condition['op'], string> = {
  eq: '=', neq: '≠', gte: '≥', lte: '≤', between: 'zwischen', contains: 'enthält', regex: 'passt zu',
  empty: 'ist leer', notEmpty: 'ist nicht leer', largestOfStream: 'größter Betrag des Streams',
  firstFromUser: 'erstes Event des Users', random: 'Zufall',
};

export function describeCondition(c: Condition): string {
  switch (c.op) {
    case 'largestOfStream':
    case 'firstFromUser':
      return OP_LABEL[c.op];
    case 'random':
      return `Zufall ${c.value ?? 50} %`;
    case 'empty':
    case 'notEmpty':
      return `${c.field} ${OP_LABEL[c.op]}`;
    case 'between':
      return `${c.field} zwischen ${c.value} und ${c.value2}`;
    default:
      return `${c.field} ${OP_LABEL[c.op]} ${c.value}`;
  }
}

export function evaluateCondition(c: Condition, event: NormalizedEvent, ctx: RuleContext): boolean {
  const v = getField(event, c.field);
  switch (c.op) {
    case 'eq':
      return asText(v).toLowerCase() === asText(c.value).toLowerCase() || (!Number.isNaN(asNumber(v)) && asNumber(v) === asNumber(c.value));
    case 'neq':
      return !evaluateCondition({ ...c, op: 'eq' }, event, ctx);
    case 'gte':
      return asNumber(v) >= asNumber(c.value);
    case 'lte':
      return asNumber(v) <= asNumber(c.value);
    case 'between': {
      const n = asNumber(v);
      return n >= asNumber(c.value) && n <= asNumber(c.value2);
    }
    case 'contains':
      return asText(v).toLowerCase().includes(asText(c.value).toLowerCase());
    case 'regex':
      try {
        return new RegExp(asText(c.value), 'i').test(asText(v));
      } catch {
        return false;
      }
    case 'empty':
      return asText(v).trim() === '';
    case 'notEmpty':
      return asText(v).trim() !== '';
    case 'largestOfStream': {
      const amount = event.amount?.value ?? 0;
      return amount > 0 && amount > ctx.largestAmountThisStream;
    }
    case 'firstFromUser':
      return !ctx.hasPreviousFromUser;
    case 'random':
      return ctx.random() * 100 < asNumber(c.value ?? 50);
  }
}

export function triggerMatches(rule: Rule, event: NormalizedEvent): boolean {
  const t = rule.trigger;
  if (t.type !== event.type) return false;
  if (t.subtype && t.subtype !== event.subtype) return false;
  if (t.platform && t.platform !== event.platform && !(event.isTest && event.platform === 'test')) return false;
  return true;
}

/**
 * Wählt die passende Regel für ein Event (siehe Konzept „Auswahl-Logik“):
 * aktive Regeln mit passendem Trigger → alle Bedingungen (UND) → höchste Priorität → Zufall nach Gewicht.
 */
export function selectRule(rules: Rule[], event: NormalizedEvent, ctx: RuleContext): RuleMatch | null {
  const candidates = rules.filter(
    (r) => r.enabled && triggerMatches(r, event) && (!r.onlyWhenLive || ctx.isLive || event.isTest),
  );
  const matching = candidates.filter((r) => r.conditions.every((c) => evaluateCondition(c, event, ctx)));
  if (!matching.length) return null;

  const top = Math.max(...matching.map((r) => r.priority));
  const best = matching.filter((r) => r.priority === top);
  let chosen = best[0]!;
  if (best.length > 1) {
    const total = best.reduce((s, r) => s + Math.max(r.weight, 0), 0);
    let roll = ctx.random() * (total || best.length);
    for (const r of best) {
      roll -= total ? Math.max(r.weight, 0) : 1;
      if (roll < 0) {
        chosen = r;
        break;
      }
    }
  }
  const why = chosen.conditions.length
    ? `Regel „${chosen.name}“, weil ${chosen.conditions.map(describeCondition).join(' und ')}`
    : `Regel „${chosen.name}“ (ohne Bedingungen)`;
  const tie = best.length > 1 ? ` – per Zufall aus ${best.length} Regeln gleicher Priorität` : '';
  return { rule: chosen, reason: why + tie };
}
