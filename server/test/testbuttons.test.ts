import { describe, expect, it } from 'vitest';
import { sampleEvent, satisfyConditions } from '../src/alertbox.js';
import { evaluateCondition } from '../src/rules/engine.js';
import { widgetTest } from '../src/shared/widgetTest.js';
import { WIDGET_INFO, type WidgetType } from '../src/shared/widgets.js';
import { WIDGET_DEFAULTS } from '../src/shared/widgets.js';
import type { Condition } from '../src/shared/types.js';

const ctx = { largestAmountThisStream: 0, hasPreviousFromUser: false, random: () => 0 };

describe('„Diesen Alert testen“', () => {
  it('erfüllt die Bedingungen der Variante im Beispiel-Event', () => {
    const cases: Array<[Parameters<typeof sampleEvent>, Condition[]]> = [
      [['donation'], [{ field: 'amount.value', op: 'gte', value: 250 }]],
      [['donation'], [{ field: 'amount.value', op: 'between', value: 20, value2: 30 }]],
      [['subscription', 'resub'], [{ field: 'months', op: 'gte', value: 24 }]],
      [['subscription', 'sub'], [{ field: 'tier', op: 'eq', value: '3000' }]],
      [['cheer'], [{ field: 'count', op: 'lte', value: 99 }]],
      [['donation'], [{ field: 'message', op: 'contains', value: 'hallo' }]],
      [['follow'], [{ field: 'message', op: 'notEmpty' }]],
      [['donation'], [{ field: 'message', op: 'empty' }]],
    ];
    for (const [args, conds] of cases) {
      const e = satisfyConditions(sampleEvent(...args), conds);
      for (const c of conds) expect(evaluateCondition(c, e, ctx), `${args.join('/')} ${c.field} ${c.op}`).toBe(true);
    }
  });

  it('lässt das Beispiel-Event ohne Bedingungen unverändert', () => {
    const e = sampleEvent('donation');
    expect(satisfyConditions(e, [])).toEqual(e);
  });
});

describe('„Dieses Widget testen“', () => {
  it('liefert für jeden Widget-Typ einen passenden Test', () => {
    for (const type of Object.keys(WIDGET_INFO) as WidgetType[]) {
      const t = widgetTest(type, (WIDGET_DEFAULTS as Record<string, () => unknown>)[type]!(), () => 0.3);
      expect(t.label, type).toBeTruthy();
      if (t.kind === 'event') expect(t.event.type, type).toBeTruthy();
    }
  });

  it('richtet sich nach den Einstellungen', () => {
    expect(widgetTest('goal', { goalType: 'follow' }).kind === 'event' && (widgetTest('goal', { goalType: 'follow' }) as any).event.type).toBe('follow');
    expect((widgetTest('label', { kind: 'latest_cheer' }) as any).event.type).toBe('cheer');
    expect((widgetTest('timer', { secondsPerFollow: 0, secondsPerSub: 60 }) as any).event).toMatchObject({ type: 'subscription', subtype: 'sub' });
    expect((widgetTest('event_list', { types: ['raid'] }) as any).event.type).toBe('raid');
    expect((widgetTest('bp_poll', { options: [{}, {}] }, () => 0.9) as any).event.message).toBe('#2');
    expect(widgetTest('credits', {}).kind).toBe('credits');
  });
});
