import type { WebSocket } from 'ws';
import type { ServerToDashboard, ServerToOverlay } from '../shared/types.js';
import type { ServerToWidget } from '../shared/widgets.js';

/** Hält alle offenen WebSocket-Verbindungen von Overlays und Dashboards. */
export class Hub {
  private overlaySockets = new Map<string, Set<WebSocket>>();
  private dashboards = new Set<WebSocket>();
  private widgetSockets = new Map<string, Set<WebSocket>>();

  addWidget(id: string, ws: WebSocket) {
    let set = this.widgetSockets.get(id);
    if (!set) this.widgetSockets.set(id, (set = new Set()));
    set.add(ws);
  }

  removeWidget(id: string, ws: WebSocket) {
    this.widgetSockets.get(id)?.delete(ws);
  }

  widgetCount(id: string) {
    return this.widgetSockets.get(id)?.size ?? 0;
  }

  sendWidget(id: string, msg: ServerToWidget) {
    const data = JSON.stringify(msg);
    for (const ws of this.widgetSockets.get(id) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  closeWidget(id: string, reason: string) {
    for (const ws of this.widgetSockets.get(id) ?? []) ws.close(4001, reason);
  }

  addOverlay(overlayId: string, ws: WebSocket) {
    let set = this.overlaySockets.get(overlayId);
    if (!set) this.overlaySockets.set(overlayId, (set = new Set()));
    set.add(ws);
  }

  removeOverlay(overlayId: string, ws: WebSocket) {
    this.overlaySockets.get(overlayId)?.delete(ws);
  }

  overlayCount(overlayId: string) {
    return this.overlaySockets.get(overlayId)?.size ?? 0;
  }

  sendOverlay(overlayId: string, msg: ServerToOverlay) {
    const data = JSON.stringify(msg);
    for (const ws of this.overlaySockets.get(overlayId) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  /** Alle Overlays dieses Overlay-Eintrags trennen (z. B. nach neuem Key). */
  closeOverlay(overlayId: string, reason: string) {
    for (const ws of this.overlaySockets.get(overlayId) ?? []) ws.close(4001, reason);
  }

  addDashboard(ws: WebSocket) {
    this.dashboards.add(ws);
  }

  removeDashboard(ws: WebSocket) {
    this.dashboards.delete(ws);
  }

  broadcastDashboard(msg: ServerToDashboard) {
    const data = JSON.stringify(msg);
    for (const ws of this.dashboards) if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
