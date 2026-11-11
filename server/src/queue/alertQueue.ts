import type { AlertPayload, QueueState } from '../shared/types.js';
import { segmentsToText } from '../templates/render.js';

export interface QueueDeps {
  overlayId: string;
  /** Verbundene Overlay-Instanzen (z. B. OBS + Vorschau) */
  connections: () => number;
  send: (msg: unknown) => void;
  alertDelay: () => number;
  onStateChange: (state: QueueState) => void;
  onFinished: (eventId: string, how: 'played' | 'skipped') => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/**
 * Warteschlange pro Overlay. Sie liegt bewusst im Backend (siehe Konzept „Overlay-Seite“):
 * Pause, Skip und Repeat wirken sofort, und mehrere offene Overlays bleiben synchron.
 */
export class AlertQueue {
  private items: AlertPayload[] = [];
  private current: AlertPayload | null = null;
  private timeout: unknown = null;
  private gapTimer: unknown = null;
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

  enqueue(alert: AlertPayload) {
    this.items.push(alert);
    this.emitState();
    this.next();
  }

  /** Spielt den nächsten Alert, wenn nichts läuft, nicht pausiert ist und ein Overlay verbunden ist. */
  next() {
    if (this.current || this.paused || this.gapTimer || !this.items.length) return;
    if (this.deps.connections() === 0) return; // wartet, bis ein Overlay verbunden ist
    const alert = this.items.shift()!;
    this.current = alert;
    this.deps.send({ t: 'alert.show', alert });
    const t = alert.template;
    const maxMs = t.duration + t.textDelay + t.animation.speedMs * 2 + 5000;
    this.timeout = this.setTimer(() => this.finish(alert.itemId, 'played'), maxMs);
    this.emitState();
  }

  /** Overlay meldet: Alert fertig abgespielt. */
  done(itemId: string) {
    this.finish(itemId, 'played');
  }

  private finish(itemId: string, how: 'played' | 'skipped') {
    if (!this.current || this.current.itemId !== itemId) return;
    const finished = this.current;
    this.clearTimer(this.timeout);
    this.timeout = null;
    this.current = null;
    this.deps.onFinished(finished.eventId, how);
    const gap = Math.max(0, this.deps.alertDelay());
    this.gapTimer = this.setTimer(() => {
      this.gapTimer = null;
      this.next();
    }, gap);
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
      connections: this.deps.connections(),
    };
  }

  private emitState() {
    this.deps.onStateChange(this.state());
  }

  dispose() {
    this.clearTimer(this.timeout);
    this.clearTimer(this.gapTimer);
  }
}
