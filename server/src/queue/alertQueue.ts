import type { AlertPayload, QueueState } from '../shared/types.js';
import { segmentsToText } from '../templates/render.js';

export type FinishReason = 'played' | 'skipped' | 'rejected';

export interface QueueDeps {
  overlayId: string;
  /** Verbundene Overlay-Instanzen (z. B. OBS + Vorschau) */
  connections: () => number;
  send: (msg: unknown) => void;
  alertDelay: () => number;
  /** Moderationsverzögerung in ms: 0 = aus, -1 = bis zur Freigabe */
  moderationDelay?: () => number;
  /** Streamlabs „Alert-Parry“: neuer Alert unterbricht den laufenden nach `delay` ms */
  interrupt?: () => { enabled: boolean; delay: number };
  onStateChange: (state: QueueState) => void;
  onFinished: (eventId: string, how: FinishReason) => void;
  onHeld?: (eventId: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  now?: () => number;
}

interface Held {
  alert: AlertPayload;
  releaseAt: number | null;
  timer: unknown;
}

/**
 * Warteschlange pro Overlay. Sie liegt bewusst im Backend (siehe Konzept „Overlay-Seite“):
 * Pause, Skip, Moderation und Repeat wirken sofort, und mehrere offene Overlays bleiben synchron.
 */
export class AlertQueue {
  private items: AlertPayload[] = [];
  private held = new Map<string, Held>();
  private current: AlertPayload | null = null;
  private timeout: unknown = null;
  private gapTimer: unknown = null;
  private interruptTimer: unknown = null;
  paused = false;
  muted = false;
  volume = 1;

  constructor(private deps: QueueDeps) {}

  private setTimer(fn: () => void, ms: number) {
    return (this.deps.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms);
  }
  private clearTimer(h: unknown) {
    if (h) (this.deps.clearTimer ?? ((x) => clearTimeout(x as NodeJS.Timeout)))(h);
  }
  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Neuer Alert: ggf. erst in die Moderation, sonst direkt in die Warteschlange. */
  enqueue(alert: AlertPayload, opts: { skipModeration?: boolean } = {}) {
    const delay = opts.skipModeration ? 0 : this.deps.moderationDelay?.() ?? 0;
    if (delay !== 0) {
      const releaseAt = delay > 0 ? this.now() + delay : null;
      const timer = delay > 0 ? this.setTimer(() => this.approve(alert.itemId), delay) : null;
      this.held.set(alert.itemId, { alert, releaseAt, timer });
      this.deps.onHeld?.(alert.eventId);
      this.emitState();
      return;
    }
    this.items.push(alert);
    this.maybeInterrupt();
    this.emitState();
    this.next();
  }

  /** Moderation: Alert freigeben (vorzeitig oder nach Ablauf der Verzögerung). */
  approve(itemId: string) {
    const h = this.held.get(itemId);
    if (!h) return false;
    this.clearTimer(h.timer);
    this.held.delete(itemId);
    this.enqueue(h.alert, { skipModeration: true });
    return true;
  }

  /** Moderation: Alert ablehnen. */
  reject(itemId: string) {
    const h = this.held.get(itemId);
    if (!h) return false;
    this.clearTimer(h.timer);
    this.held.delete(itemId);
    this.deps.onFinished(h.alert.eventId, 'rejected');
    this.emitState();
    return true;
  }

  private maybeInterrupt() {
    const cfg = this.deps.interrupt?.();
    if (!cfg?.enabled || !this.current || this.interruptTimer || this.paused) return;
    const target = this.current.itemId;
    this.interruptTimer = this.setTimer(() => {
      this.interruptTimer = null;
      if (this.current?.itemId !== target || !this.items.length) return;
      this.deps.send({ t: 'alert.skip', itemId: target });
      this.finish(target, 'played', true);
    }, Math.max(0, cfg.delay));
  }

  /** Spielt den nächsten Alert, wenn nichts läuft, nicht pausiert ist und ein Overlay verbunden ist. */
  next() {
    if (this.current || this.paused || this.gapTimer || !this.items.length) return;
    if (this.deps.connections() === 0) return; // wartet, bis ein Overlay verbunden ist
    const alert = this.items.shift()!;
    this.current = alert;
    this.deps.send({ t: 'alert.show', alert });
    const t = alert.template;
    const maxMs = t.duration + t.textDelay + t.animation.speedMs * 2 + 5000 + (alert.tts ? 30_000 : 0) + (t.text.effect ? 22_000 : 0);
    this.timeout = this.setTimer(() => this.finish(alert.itemId, 'played'), maxMs);
    if (this.items.length) this.maybeInterrupt();
    this.emitState();
  }

  /** Overlay meldet: Alert fertig abgespielt. */
  done(itemId: string) {
    this.finish(itemId, 'played');
  }

  private finish(itemId: string, how: 'played' | 'skipped', noGap = false) {
    if (!this.current || this.current.itemId !== itemId) return;
    const finished = this.current;
    this.clearTimer(this.timeout);
    this.clearTimer(this.interruptTimer);
    this.timeout = null;
    this.interruptTimer = null;
    this.current = null;
    this.deps.onFinished(finished.eventId, how);
    if (noGap) {
      this.next();
    } else {
      const gap = Math.max(0, this.deps.alertDelay());
      this.gapTimer = this.setTimer(() => {
        this.gapTimer = null;
        this.next();
      }, gap);
    }
    this.emitState();
  }

  skip() {
    if (!this.current) return;
    this.deps.send({ t: 'alert.skip', itemId: this.current.itemId });
    this.finish(this.current.itemId, 'skipped');
  }

  pause() {
    this.paused = true;
    this.emitState();
  }

  resume() {
    this.paused = false;
    this.emitState();
    this.next();
  }

  clear() {
    const dropped = this.items.splice(0);
    for (const a of dropped) this.deps.onFinished(a.eventId, 'skipped');
    this.emitState();
  }

  setAudio(muted: boolean, volume: number) {
    this.muted = muted;
    this.volume = volume;
    this.deps.send({ t: 'state', muted, volume });
    this.emitState();
  }

  /** Neues Overlay verbunden → ggf. wartende Alerts starten. */
  onConnectionChange() {
    this.emitState();
    this.next();
  }

  state(): QueueState {
    const brief = (a: AlertPayload) => ({ itemId: a.itemId, eventId: a.eventId, title: segmentsToText(a.title) });
    return {
      overlayId: this.deps.overlayId,
      paused: this.paused,
      muted: this.muted,
      volume: this.volume,
      playing: this.current ? brief(this.current) : null,
      pending: this.items.map(brief),
      held: [...this.held.values()].map((h) => ({ ...brief(h.alert), message: h.alert.message, releaseAt: h.releaseAt })),
      connections: this.deps.connections(),
    };
  }

  private emitState() {
    this.deps.onStateChange(this.state());
  }

  dispose() {
    this.clearTimer(this.timeout);
    this.clearTimer(this.gapTimer);
    this.clearTimer(this.interruptTimer);
    for (const h of this.held.values()) this.clearTimer(h.timer);
  }
}
