import type { DB } from '../db.js';
import * as store from '../db.js';
import type { Hub } from '../ws/hub.js';
import type { EventLogEntry, NormalizedEvent } from '../shared/types.js';
import {
  isBpType, type BossState, type BpData, type BpWidgetType, type MilestonesState, type PollState, type TimerState, type Widget, type WidgetData,
  type WidgetSettingsMap,
} from '../shared/widgets.js';
import { betterplaceSource } from '../connectors/betterplace.js';
import { buildBpData, logToDonation, mergeDonations, milestoneView, newlyReached, pollResults, sampleBpData } from './betterplace.js';
import { formatAmount } from '../templates/render.js';
import { CHAT_SAMPLES, chatVisible, sampleChatMessage, type ChatMessage } from '../shared/chat.js';
import { eventCatalogKey } from '../shared/catalog.js';
import {
  bossDamage, bossHit, bossInitial, creditsSections, eventLine, goalValue, labelText, listFilter, timerAdd, timerInitial, timerRemaining, timerSecondsFor,
} from './compute.js';

type Session = { startedAt: string | null };

/** Berechnet Widget-Daten, verarbeitet Events (Timer, Boss) und schickt Updates an die Browserquellen. */
export class WidgetService {
  private pending = new Map<string, NodeJS.Timeout>();
  private lastAdded = new Map<string, { seconds: number; reason: string; at: number }>();

  constructor(
    private db: DB,
    private hub: Hub,
    private session: () => Session,
    /** Erzeugt Events (Milestone erreicht) – läuft durch die normale Pipeline in die Alert-Box */
    private emit: (event: NormalizedEvent) => void = () => undefined,
    /** letzte Chat-Nachrichten (Chat-Overlay) */
    private chatRecent: (limit: number) => ChatMessage[] = () => [],
  ) {}

  // ---------- betterplace ----------

  private bpCache: { at: number; data: BpData; donations: ReturnType<typeof mergeDonations> } | null = null;

  /** Gemeinsame betterplace-Daten (kurz zwischengespeichert, da mehrere Widgets sie gleichzeitig brauchen) */
  bpBase() {
    if (this.bpCache && Date.now() - this.bpCache.at < 100) return this.bpCache;
    const { stats, recent } = betterplaceSource(this.db);
    const donations = mergeDonations(store.events.donations(this.db).map(logToDonation), recent);
    this.bpCache = { at: Date.now(), data: buildBpData(stats, donations), donations };
    return this.bpCache;
  }

  private bpTestMode() {
    return store.settings.global(this.db).betterplaceTestMode;
  }

  bpData(w: Widget, preview = false): BpData {
    const sample = preview || this.bpTestMode();
    const base = this.bpBase();
    const data: BpData = sample ? sampleBpData() : { ...base.data };
    if (w.type === 'bp_poll') {
      const s = w.settings as WidgetSettingsMap['bp_poll'];
      const st = w.state as PollState | null;
      data.poll = sample
        ? { title: s.title, active: true, started: true, total: 300, winnerAt: st?.winnerAt ?? 0, leader: 0,
            options: s.options.map((o, i) => ({ text: o.text, value: i === 0 ? 200 : 100 / Math.max(1, s.options.length - 1), percent: i === 0 ? 66.7 : Math.round(333 / Math.max(1, s.options.length - 1)) / 10 })) }
        : pollResults(s, base.donations, st);
    }
    if (w.type === 'bp_milestones') {
      data.milestones = milestoneView(w.settings as WidgetSettingsMap['bp_milestones'], w.state as MilestonesState | null, data.total);
    }
    // Feeds sind groß – nur mitschicken, wer sie braucht
    if (w.type !== 'bp_feed') data.feed = [];
    return data;
  }

  /** Neuer Spendenstand von der API: Widgets auffrischen, Milestones prüfen */
  onBetterplaceStats() {
    this.bpCache = null;
    this.checkMilestones(false);
    for (const w of store.widgets.list(this.db)) if (isBpType(w.type)) this.push(w.id);
  }

  /** Feiert neu erreichte Milestones über die Alert-Box (Event-Typ „milestone“). */
  checkMilestones(fromTest: boolean) {
    for (const w of store.widgets.list(this.db)) {
      if (w.type !== 'bp_milestones') continue;
      const s = w.settings as WidgetSettingsMap['bp_milestones'];
      const st = w.state as MilestonesState | null;
      const total = this.bpBase().data.total;
      const fresh = newlyReached(s, st, total);
      if (!fresh.length) continue;
      store.widgets.setState(this.db, w.id, { reached: [...(st?.reached ?? []), ...fresh.map((m) => m.amount)] } satisfies MilestonesState);
      for (const m of fresh) {
        this.emit({
          id: `ms_${w.id}_${m.amount}_${Date.now()}`, platform: fromTest ? 'test' : 'betterplace', type: 'milestone', isTest: fromTest || undefined,
          user: { name: 'Community' }, amount: { value: m.amount, currency: 'EUR' }, product: m.text, message: m.text, receivedAt: new Date().toISOString(),
        });
      }
      this.push(w.id);
    }
  }

  /** Nach dem Bearbeiten: bereits erreichte Milestones still als gefeiert markieren (kein Alert für Vergangenes) */
  syncMilestones(id: string) {
    const w = store.widgets.get(this.db, id);
    if (!w || w.type !== 'bp_milestones') return;
    this.bpCache = null;
    const s = w.settings as WidgetSettingsMap['bp_milestones'];
    const total = this.bpBase().data.total;
    store.widgets.setState(this.db, id, { reached: s.milestones.filter((m) => m.amount <= total).map((m) => m.amount) } satisfies MilestonesState);
  }

  resetMilestones(id: string) {
    const w = store.widgets.get(this.db, id);
    if (!w || w.type !== 'bp_milestones') return false;
    store.widgets.setState(this.db, id, { reached: [] } satisfies MilestonesState);
    this.push(id);
    return true;
  }

  pollWinner(id: string) {
    const w = store.widgets.get(this.db, id);
    if (!w || w.type !== 'bp_poll') return false;
    store.widgets.setState(this.db, id, { winnerAt: Date.now() } satisfies PollState);
    this.push(id);
    this.hub.sendWidget(id, { t: 'poll.winner' });
    this.hub.sendWidget(`${id}:preview`, { t: 'poll.winner' });
    return true;
  }

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

  data(w: Widget, preview = false): WidgetData {
    const now = Date.now();
    if (isBpType(w.type)) return { type: w.type as BpWidgetType, bp: this.bpData(w, preview), serverNow: now };
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
      case 'chat': {
        const s = w.settings as WidgetSettingsMap['chat'];
        const messages = preview
          ? CHAT_SAMPLES.slice(0, s.maxMessages).map((_, i) => sampleChatMessage(i))
          : this.chatRecent(100).filter((m) => chatVisible(s, m)).slice(-s.maxMessages);
        return { type: 'chat', messages, preview };
      }
      case 'ticker': {
        const s = w.settings as WidgetSettingsMap['ticker'];
        const items = store.events.recentVisible(this.db, 200).filter((x) => listFilter(s, x.event)).slice(0, s.maxItems)
          .map(({ event: e }) => ({ id: e.id, name: eventLine(e).name, amount: e.amount ? formatAmount(e) : eventLine(e).detail, message: e.message ?? '', type: e.type }));
        return { type: 'ticker', items };
      }
    }
  }

  snapshot(w: Widget, preview = false) {
    const { key: _k, state: _s, ...pub } = w;
    return { t: 'snapshot' as const, widget: pub, data: this.data(w, preview) };
  }

  /** Update an alle Quellen dieses Widgets (gebündelt, damit Event-Serien nicht flackern). */
  push(id: string) {
    if (this.pending.has(id)) return;
    this.pending.set(id, setTimeout(() => {
      this.pending.delete(id);
      const w = store.widgets.get(this.db, id);
      if (!w) return;
      this.hub.sendWidget(id, this.snapshot(w));
      // Quellen mit &preview=1 (Beispieldaten)
      if (this.hub.widgetCount(`${id}:preview`)) this.hub.sendWidget(`${id}:preview`, this.snapshot(w, true));
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
    if (e.type === 'donation' && (e.platform === 'betterplace' || e.platform === 'test')) {
      this.bpCache = null;
      this.checkMilestones(e.platform === 'test');
    }
    for (const w of store.widgets.list(this.db)) {
      if (w.type === 'chat') continue; // Chat-Overlays bekommen Nachrichten direkt vom ChatService
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
