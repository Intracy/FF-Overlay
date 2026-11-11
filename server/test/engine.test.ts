import { describe, expect, it } from 'vitest';
import { evaluateCondition, selectRule, type RuleContext } from '../src/rules/engine.js';
import type { NormalizedEvent, Rule } from '../src/shared/types.js';

const ctx = (p: Partial<RuleContext> = {}): RuleContext => ({
  isLive: true, largestAmountThisStream: 0, hasPreviousFromUser: false, random: () => 0.5, ...p,
});

const donation = (value: number, extra: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  id: 'e1', platform: 'betterplace', type: 'donation', user: { name: 'Max' },
  amount: { value, currency: 'EUR' }, receivedAt: '2026-11-11T20:00:00Z', ...extra,
});

const rule = (p: Partial<Rule>): Rule => ({
  id: p.name ?? 'r', overlayId: 'o', name: 'r', trigger: { type: 'donation' }, conditions: [],
  priority: 10, weight: 1, templateId: 't', enabled: true, onlyWhenLive: false, ...p,
});

describe('evaluateCondition', () => {
  it('vergleicht Zahlen', () => {
    expect(evaluateCondition({ field: 'amount.value', op: 'gte', value: 50 }, donation(50), ctx())).toBe(true);
    expect(evaluateCondition({ field: 'amount.value', op: 'gte', value: 50 }, donation(49.99), ctx())).toBe(false);
    expect(evaluateCondition({ field: 'amount.value', op: 'between', value: 10, value2: 20 }, donation(15), ctx())).toBe(true);
  });

  it('vergleicht Text ohne Groß/Kleinschreibung', () => {
    const e = donation(5, { message: 'Hallo FrankenFinals!' });
    expect(evaluateCondition({ field: 'message', op: 'contains', value: 'frankenfinals' }, e, ctx())).toBe(true);
    expect(evaluateCondition({ field: 'user.name', op: 'eq', value: 'max' }, e, ctx())).toBe(true);
    expect(evaluateCondition({ field: 'message', op: 'regex', value: '^hallo' }, e, ctx())).toBe(true);
    expect(evaluateCondition({ field: 'message', op: 'regex', value: '(' }, e, ctx())).toBe(false);
  });

  it('prüft leer/nicht leer', () => {
    expect(evaluateCondition({ field: 'message', op: 'empty' }, donation(5), ctx())).toBe(true);
    expect(evaluateCondition({ field: 'message', op: 'notEmpty' }, donation(5, { message: 'x' }), ctx())).toBe(true);
  });

  it('erkennt die größte Spende des Streams', () => {
    const c = { field: '', op: 'largestOfStream' as const };
    expect(evaluateCondition(c, donation(30), ctx({ largestAmountThisStream: 20 }))).toBe(true);
    expect(evaluateCondition(c, donation(20), ctx({ largestAmountThisStream: 20 }))).toBe(false);
  });

  it('nutzt Zufall in Prozent', () => {
    const c = { field: '', op: 'random' as const, value: 30 };
    expect(evaluateCondition(c, donation(1), ctx({ random: () => 0.2 }))).toBe(true);
    expect(evaluateCondition(c, donation(1), ctx({ random: () => 0.5 }))).toBe(false);
  });
});

describe('selectRule', () => {
  const rules = [
    rule({ name: 'Spende', priority: 10 }),
    rule({ name: 'Große Spende', priority: 100, conditions: [{ field: 'amount.value', op: 'gte', value: 50 }] }),
    rule({ name: 'Riesig mit Nachricht', priority: 200, conditions: [
      { field: 'amount.value', op: 'gte', value: 500 },
      { field: 'message', op: 'notEmpty' },
    ] }),
  ];

  it('nimmt die höchste Priorität unter den Treffern', () => {
    expect(selectRule(rules, donation(10), ctx())?.rule.name).toBe('Spende');
    expect(selectRule(rules, donation(60), ctx())?.rule.name).toBe('Große Spende');
  });

  it('verknüpft mehrere Bedingungen mit UND', () => {
    expect(selectRule(rules, donation(600), ctx())?.rule.name).toBe('Große Spende');
    expect(selectRule(rules, donation(600, { message: 'Wow' }), ctx())?.rule.name).toBe('Riesig mit Nachricht');
  });

  it('begründet die Auswahl', () => {
    expect(selectRule(rules, donation(60), ctx())?.reason).toContain('amount.value ≥ 50');
  });

  it('ignoriert deaktivierte Regeln, fremde Trigger und „nur live“ offline', () => {
    const r = [
      rule({ name: 'aus', enabled: false }),
      rule({ name: 'follow', trigger: { type: 'follow' } }),
      rule({ name: 'live', onlyWhenLive: true }),
    ];
    expect(selectRule(r, donation(5), ctx({ isLive: false }))).toBeNull();
    expect(selectRule(r, donation(5), ctx({ isLive: true }))?.rule.name).toBe('live');
  });

  it('achtet auf Subtyp und Plattform', () => {
    const r = [rule({ name: 'gift', trigger: { type: 'subscription', subtype: 'gift', platform: 'twitch' } })];
    const ev = { ...donation(0), type: 'subscription' as const, platform: 'twitch' as const };
    expect(selectRule(r, { ...ev, subtype: 'gift' }, ctx())?.rule.name).toBe('gift');
    expect(selectRule(r, { ...ev, subtype: 'resub' }, ctx())).toBeNull();
    expect(selectRule(r, { ...ev, subtype: 'gift', platform: 'webhook' }, ctx())).toBeNull();
  });

  it('wählt bei gleicher Priorität nach Gewicht', () => {
    const r = [rule({ name: 'A', weight: 1 }), rule({ name: 'B', weight: 3 })];
    expect(selectRule(r, donation(1), ctx({ random: () => 0.1 }))?.rule.name).toBe('A');
    expect(selectRule(r, donation(1), ctx({ random: () => 0.9 }))?.rule.name).toBe('B');
  });
});
