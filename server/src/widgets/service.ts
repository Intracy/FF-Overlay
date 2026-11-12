import type { DB } from '../db.js';
import * as store from '../db.js';
import type { Hub } from '../ws/hub.js';
import type { EventLogEntry } from '../shared/types.js';
import type { BossState, TimerState, Widget, WidgetData, WidgetSettingsMap } from '../shared/widgets.js';
import { formatAmount } from '../templates/render.js';
import { eventCatalogKey } from '../shared/catalog.js';
import {
  bossDamage, bossHit, bossInitial, creditsSections, eventLine, goalValue, labelText, listFilter, timerAdd, timerInitial, timerRemaining, timerSecondsFor,
} from './compute.js';

type Session = { startedAt: string | null };

/** Berechnet Widget-Daten, verarbeitet Events (Timer, Boss) und schickt Updates an die Browserquellen. */
export class WidgetService {
  private pending = new Map<string, NodeJS.Timeout>();
  private lastAdded = new Map<string, { seconds: number; reason: string; at: number }>();

  constructor(private db: DB, private hub: Hub, private session: () => Session) {}

  /** Beginn eines Zeitraums für Labels */
  periodStart(period: 'session' | 'today' | 'week' | 'month'): string {
    const now = new Date();
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    if (period === 'week') return new Date(Date.now() - 7 * 864e5).toISOString();
    if (period === 'month') return new Date(Date.now() - 30 * 864e5).toISOString();
    return this.session().startedAt ?? new Date(Date.now() - 12 * 3600e3).toISOString();
  }

  state<T>(w: Widget, init: () => T): T {
    return (w.state as T | null) ?? init();
  }

  data(w: Widget): WidgetData {
    const now = Date.now();
    switch (w.type) {
      case 'event_list': {
        const s = w.settings as WidgetSettingsMap['event_list'];
        const entries = store.events.recentVisible(this.db, 200).filter((x) => listFilter(s, x.event)).slice(0, s.maxEvents)
          .map(({ event: e, createdAt }) => ({ id: e.id, key: eventCatalogKey(e) ?? e.type, ...eventLine(e), isTest: !!e.isTest, at: createdAt }));
        return { type: 'event_list', entries };
      }
      case 'goal': {
        const s = w.settings as WidgetSettingsMap['goal'];
        const entries = store.events.since(this.db, s.startedAt || new Date(0).toISOString()).filter((x) => !s.endsAt || x.createdAt <= s.endsAt);
        const current = goalValue(s, entries);
        const currency = s.goalType === 'donation' || s.goalType === 'charity' ? entries.find((x) => x.event.amount && x.event.amount.currency !== 'BITS')?.event.amount?.currency ?? 'EUR' : '';
        return {
          type: 'goal', current, target: s.target, currency, endsAt: s.endsAt,
          percent: s.target > 0 ? Math.min(100, Math.round((current / s.target) * 1000) / 10) : 0,
          ended: !!s.endsAt && new Date(s.endsAt).getTime() < now,
        };
      }
      case 'label': {
        const s = w.settings as WidgetSettingsMap['label'];
        return { type: 'label', text: labelText(s, store.events.since(this.db, this.periodStart(s.period))) };
      }
      case 'timer': {
        const s = w.settings as WidgetSettingsMap['timer'];
        return { type: 'timer', state: this.state<TimerState>(w, () => timerInitial(s)), lastAdded: this.lastAdded.get(w.id) ?? null, serverNow: now };
      }
      case 'credits': {
        const s = w.settings as WidgetSettingsMap['credits'];
        return { type: 'credits', sections: creditsSections(s, store.events.since(this.db, this.periodStart('session'))) };
      }
      case 'boss': {
        const s = w.settings as WidgetSettingsMap['boss'];
        return { type: 'boss', state: this.state<BossState>(w, () => bossInitial(s)), serverNow: now };
      }
      case 'ticker': {
        const s = w.settings as WidgetSettingsMap['ticker'];
        const items = store.events.recentVisible(this.db, 200).filter((x) => listFilter(s, x.event)).slice(0, s.maxItems)
          .map(({ event: e }) => ({ id: e.id, name: eventLine(e).name, amount: e.amount ? formatAmount(e) : eventLine(e).detail, message: e.message ?? '', type: e.type }));
        return { type: 'ticker', items };
      }
    }
  }

  snapshot(w: Widget) {
    const { key: _k, state: _s, ...pub } = w;
    return { t: 'snapshot' as const, widget: pub, data: this.data(w) };
  }

  /** Update an alle Quellen dieses Widgets (gebündelt, damit Event-Serien nicht flackern). */
  push(id: string) {
    if (this.pending.has(id)) return;
    this.pending.set(id, setTimeout(() => {
      this.pending.delete(id);
      const w = store.widgets.get(this.db, id);
      if (w) this.hub.sendWidget(id, this.snapshot(w));
    }, 150));
  }

  pushAll() {
    for (const w of store.widgets.list(this.db)) this.push(w.id);
  }

  /** Neues Event im Log (gefilterte und gebündelte ignorieren). */
  onEvent(entry: EventLogEntry) {
    if (entry.status === 'filtered' || entry.status === 'suppressed' || entry.event.type === 'stream_status') {
      if (entry.event.type === 'stream_status') this.pushAll();
      return;
    }
    const e = entry.event;
    const now = Date.now();
    for (const w of store.widgets.list(this.db)) {
      if (w.type === 'timer') {
        const s = w.settings as WidgetSettingsMap['timer'];
        const t = this.state<TimerState>(w, () => timerInitial(s));
        const { seconds, reason } = timerSecondsFor(s, e);
        if (seconds <= 0 || (s.onlyWhileRunning && !t.running)) continue;
        store.widgets.setState(this.db, w.id, timerAdd(s, t, seconds * 1000, now));
        this.lastAdded.set(w.id, { seconds, reason, at: now });
      } else if (w.type === 'boss') {
        const s = w.settings as WidgetSettingsMap['boss'];
        const b = this.state<BossState>(w, () => bossInitial(s));
        const name = e.type === 'subscription' && e.subtype === 'gift' ? e.gifter ?? e.user.name : e.isAnonymous ? 'Anonym' : e.user.name;
        const { state } = bossHit(s, b, name, bossDamage(s, e), now);
        if (state !== b) store.widgets.setState(this.db, w.id, state);
      }
      this.push(w.id);
    }
  }

  dispose() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  // ---------- Steuerung aus dem Dashboard ----------

  timerControl(id: string, action: 'start' | 'pause' | 'reset' | 'add', seconds = 0) {
    const w = store.widgets.get(this.db, id);
    if (!w || w.type !== 'timer') return null;
    const s = w.settings as WidgetSettingsMap['timer'];
    const t = this.state<TimerState>(w, () => timerInitial(s));
    const now = Date.now();
    let next: TimerState = t;
    if (action === 'start' && !t.running) next = { running: true, endsAt: now + t.remaining, remaining: 0 };
    if (action === 'pause' && t.running) next = { running: false, endsAt: 0, remaining: timerRemaining(t, now) };
    if (action === 'reset') next = timerInitial(s);
    if (action === 'add') {
      next = timerAdd({ ...s, maxMinutes: 0 }, t, seconds * 1000, now);
      this.lastAdded.set(id, { seconds, reason: 'manuell', at: now });
    }
    store.widgets.setState(this.db, id, next);
    this.push(id);
    return next;
  }

  bossReset(id: string) {
    const w = store.widgets.get(this.db, id);
    if (!w || w.type !== 'boss') return null;
    const st = bossInitial(w.settings as WidgetSettingsMap['boss']);
    store.widgets.setState(this.db, id, st);
    this.push(id);
    return st;
  }
}
