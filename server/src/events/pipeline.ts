import type { DB } from '../db.js';
import * as store from '../db.js';
import type { Hub } from '../ws/hub.js';
import type { EventStatus, GlobalSettings, NormalizedEvent, QueueState } from '../shared/types.js';
import { AlertQueue } from '../queue/alertQueue.js';
import { selectRule } from '../rules/engine.js';
import { buildAlert } from '../templates/render.js';
import { eventCatalogKey } from '../shared/catalog.js';
import { DEFAULT_BAD_WORDS } from '../lib/badwords.js';

export interface StreamSession {
  live: boolean;
  startedAt: string | null;
  largestAmount: number;
}

/** Wendet die globalen Filter an. Gibt einen Grund zurück, wenn das Event gefiltert wird. */
export function applyFilters(event: NormalizedEvent, s: GlobalSettings): { event: NormalizedEvent; filtered?: string } {
  const name = event.user.name.toLowerCase();
  if (s.blockedUsers.some((u) => u.trim().toLowerCase() === name)) return { event, filtered: 'Nutzer steht auf der Sperrliste' };
  if (event.type === 'donation' && s.minDonationAmount > 0 && (event.amount?.value ?? 0) < s.minDonationAmount)
    return { event, filtered: `Spende unter Mindestbetrag (${s.minDonationAmount})` };

  const words = [...s.badWords, ...(s.useDefaultBadWords ? DEFAULT_BAD_WORDS : [])].map((w) => w.trim()).filter(Boolean);
  if (!words.length) return { event };
  // ganze Wörter (Unicode-Buchstaben als Grenze), damit z. B. „Classic“ nicht zensiert wird
  const alt = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?<!\\p{L})(?:${alt})(?!\\p{L})`, 'giu');
  const next: NormalizedEvent = { ...event, user: { ...event.user } };
  if (s.anonymizeNames && re.test(next.user.name)) next.user.name = 'Anonym';
  re.lastIndex = 0;
  if (next.message && re.test(next.message)) {
    re.lastIndex = 0;
    next.message = s.badWordMode === 'hide' ? undefined : next.message.replace(re, (m) => '*'.repeat(m.length));
    next.emotes = undefined; // Positionen stimmen nach dem Ersetzen nicht mehr sicher
  }
  return { event: next };
}

export class Pipeline {
  private queues = new Map<string, AlertQueue>();
  session: StreamSession;

  constructor(private db: DB, private hub: Hub) {
    this.session = store.settings.get<StreamSession>(db, 'session', { live: false, startedAt: null, largestAmount: 0 });
  }

  queue(overlayId: string): AlertQueue | undefined {
    const overlay = store.overlays.get(this.db, overlayId);
    if (!overlay) return undefined;
    let q = this.queues.get(overlayId);
    if (!q) {
      q = new AlertQueue({
        overlayId,
        connections: () => this.hub.overlayCount(overlayId),
        send: (msg) => this.hub.sendOverlay(overlayId, msg as never),
        alertDelay: () => store.overlays.get(this.db, overlayId)?.alertDelay ?? 2000,
        moderationDelay: () => store.overlays.get(this.db, overlayId)?.moderationDelay ?? 0,
        interrupt: () => {
          const o = store.overlays.get(this.db, overlayId);
          return { enabled: !!o?.interruptMode, delay: o?.interruptDelay ?? 500 };
        },
        onStateChange: (state: QueueState) => this.hub.broadcastDashboard({ t: 'queue', state }),
        onHeld: (eventId) => this.setStatus(eventId, 'held', 'wartet auf Moderation'),
        onFinished: (eventId, how) =>
          this.setStatus(eventId, how, how === 'played' ? 'abgespielt' : how === 'rejected' ? 'von Moderation abgelehnt' : 'übersprungen'),
      });
      q.muted = overlay.muted;
      q.volume = overlay.volume;
      this.queues.set(overlayId, q);
    }
    return q;
  }

  dropQueue(overlayId: string) {
    this.queues.get(overlayId)?.dispose();
    this.queues.delete(overlayId);
  }

  allQueueStates(): QueueState[] {
    return store.overlays.list(this.db).map((o) => this.queue(o.id)!.state());
  }

  private setStatus(id: string, status: EventStatus, reason: string) {
    const entry = store.events.get(this.db, id);
    if (!entry) return;
    // „played“ nicht durch spätere Statusmeldungen anderer Overlays überschreiben,
    // und doppelte Meldungen (mehrere Overlays) nur einmal vermerken.
    if (entry.status === 'played' && status !== 'played' && status !== 'queued') return;
    if (entry.status === status && status !== 'queued') return;
    // Die Regel-Begründung bleibt stehen, das Ergebnis wird angehängt.
    const merged = !entry.reason ? reason : entry.reason.endsWith(reason) ? entry.reason : `${entry.reason} · ${reason}`;
    store.events.setStatus(this.db, id, status, merged);
    this.hub.broadcastDashboard({ t: 'event.update', id, status, reason: merged });
  }

  private saveSession() {
    store.settings.set(this.db, 'session', this.session);
  }

  resetSession() {
    this.session = { live: this.session.live, startedAt: new Date().toISOString(), largestAmount: 0 };
    this.saveSession();
  }

  /** Einstiegspunkt für jedes Event aus jedem Connector. */
  ingest(raw: NormalizedEvent) {
    // Stream-Status pflegt nur die Session (für „größte Spende dieses Streams“ und „nur wenn live“).
    if (raw.type === 'stream_status') {
      const live = raw.subtype === 'online';
      const reset = live && store.settings.global(this.db).autoResetSession;
      this.session = live
        ? { live: true, startedAt: reset ? raw.receivedAt : this.session.startedAt ?? raw.receivedAt, largestAmount: reset ? 0 : this.session.largestAmount }
        : { ...this.session, live: false };
      this.saveSession();
    }

    // Doppelte Events (z. B. erneut zugestellte Twitch-Nachrichten) ignorieren
    if (store.events.get(this.db, raw.id)) return;

    // Gift-Bündelung: Twitch meldet pro verschenktem Sub zusätzlich ein Sub-Event des Empfängers.
    // Das Gift-Event deckt sie ab, deshalb erscheinen sie nur im Log.
    if (raw.type === 'subscription' && raw.subtype === 'gift_recipient') {
      this.log(raw, 'suppressed', 'durch Gift-Event abgedeckt');
      return;
    }

    const settings = store.settings.global(this.db);
    const { event, filtered } = applyFilters(raw, settings);
    // „Filter auf letzte Ereignisse anwenden“: sonst steht im Log das Original
    const logged = settings.censorEventLog ? event : raw;
    if (filtered) {
      this.log(logged, 'filtered', filtered);
      return;
    }

    const ctx = {
      isLive: this.session.live,
      largestAmountThisStream: this.session.largestAmount,
      hasPreviousFromUser: store.events.hasPrevious(this.db, event),
      random: Math.random,
    };
    if (event.amount && !event.isTest) {
      this.session.largestAmount = Math.max(this.session.largestAmount, event.amount.value);
      this.saveSession();
    }

    const reasons: string[] = [];
    const jobs: Array<{ overlayId: string; alert: ReturnType<typeof buildAlert> }> = [];
    const key = eventCatalogKey(event);
    for (const overlay of store.overlays.list(this.db)) {
      if (key && overlay.disabledTypes.includes(key)) {
        reasons.push(`${overlay.name}: Ereignistyp herausgefiltert`);
        continue;
      }
      const match = selectRule(store.rules.active(this.db, overlay), event, ctx);
      if (!match) continue;
      const template = store.templates.get(this.db, match.rule.templateId);
      if (!template) {
        reasons.push(`${overlay.name}: Design fehlt`);
        continue;
      }
      reasons.push(`${overlay.name}: ${match.reason}`);
      jobs.push({ overlayId: overlay.id, alert: buildAlert(template, event) });
    }

    // Erst loggen, dann einreihen – sonst können „held“/„played“ vor dem Log-Eintrag eintreffen.
    if (!jobs.length) {
      this.log(logged, 'no_rule', reasons.join('; ') || 'keine passende Regel');
      return;
    }
    this.log(logged, 'queued', reasons.join('; '));
    for (const j of jobs) this.queue(j.overlayId)!.enqueue(j.alert);
  }

  /** Spielt ein Event erneut ab (Replay aus dem Event-Log). */
  replay(eventId: string, overlayId?: string): boolean {
    const entry = store.events.get(this.db, eventId);
    if (!entry) return false;
    const ctx = { isLive: true, largestAmountThisStream: 0, hasPreviousFromUser: false, random: Math.random };
    let any = false;
    for (const overlay of store.overlays.list(this.db)) {
      if (overlayId && overlay.id !== overlayId) continue;
      const match = selectRule(store.rules.active(this.db, overlay), { ...entry.event, isTest: true }, ctx);
      const template = match && store.templates.get(this.db, match.rule.templateId);
      if (!template) continue;
      this.queue(overlay.id)!.enqueue(buildAlert(template, entry.event), { skipModeration: true });
      any = true;
    }
    if (any) this.setStatus(eventId, 'queued', 'erneut abgespielt');
    return any;
  }

  private log(event: NormalizedEvent, status: EventStatus, reason: string) {
    const entry = store.events.insert(this.db, event, status, reason);
    this.hub.broadcastDashboard({ t: 'event', entry });
  }
}
