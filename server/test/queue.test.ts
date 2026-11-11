import { describe, expect, it } from 'vitest';
import { AlertQueue } from '../src/queue/alertQueue.js';
import { defaultTemplate } from '../src/templates/render.js';
import type { AlertPayload } from '../src/shared/types.js';

/** Manuelle Uhr, damit die Tests ohne echte Wartezeiten laufen. */
function harness(connections = 1) {
  const timers: Array<{ fn: () => void; at: number; id: number }> = [];
  let now = 0;
  let nextId = 1;
  const sent: any[] = [];
  const finished: Array<[string, string]> = [];
  const q = new AlertQueue({
    overlayId: 'o', connections: () => connections, send: (m) => sent.push(m), alertDelay: () => 1000,
    onStateChange: () => {}, onFinished: (id, how) => finished.push([id, how]),
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ fn, at: now + ms, id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  return { q, sent, finished, advance, setConnections: (n: number) => (connections = n) };
}

const alert = (n: number): AlertPayload => ({ itemId: `i${n}`, eventId: `e${n}`, template: defaultTemplate('t', 't', ''), title: [{ text: `A${n}`, highlight: false }] });

describe('AlertQueue', () => {
  it('spielt nacheinander mit Pause dazwischen', () => {
    const h = harness();
    h.q.enqueue(alert(1));
    h.q.enqueue(alert(2));
    expect(h.sent.filter((m) => m.t === 'alert.show')).toHaveLength(1);
    h.q.done('i1');
    expect(h.finished).toEqual([['e1', 'played']]);
    h.advance(999);
    expect(h.sent.filter((m) => m.t === 'alert.show')).toHaveLength(1);
    h.advance(1);
    expect(h.sent.filter((m) => m.t === 'alert.show').map((m) => m.alert.itemId)).toEqual(['i1', 'i2']);
  });

  it('wartet ohne verbundenes Overlay', () => {
    const h = harness(0);
    h.q.enqueue(alert(1));
    expect(h.sent).toHaveLength(0);
    h.setConnections(1);
    h.q.onConnectionChange();
    expect(h.sent[0].t).toBe('alert.show');
  });

  it('Pause, Skip und Timeout', () => {
    const h = harness();
    h.q.pause();
    h.q.enqueue(alert(1));
    expect(h.sent).toHaveLength(0);
    h.q.resume();
    h.q.skip();
    expect(h.sent.map((m) => m.t)).toEqual(['alert.show', 'alert.skip']);
    expect(h.finished).toEqual([['e1', 'skipped']]);
    h.q.enqueue(alert(2));
    h.advance(1000); // Pause nach Skip
    h.advance(60_000); // Overlay meldet nie „done“ → Timeout gibt frei
    expect(h.finished.at(-1)).toEqual(['e2', 'played']);
  });

  it('ignoriert „done“ für fremde Items', () => {
    const h = harness();
    h.q.enqueue(alert(1));
    h.q.done('falsch');
    expect(h.q.state().playing?.itemId).toBe('i1');
  });
});
