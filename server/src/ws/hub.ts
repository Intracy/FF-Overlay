import type { WebSocket } from 'ws';
import type { ServerToDashboard, ServerToOverlay } from '../shared/types.js';

/** Hält alle offenen WebSocket-Verbindungen von Overlays und Dashboards. */
export class Hub {
  private overlaySockets = new Map<string, Set<WebSocket>>();
  private dashboards = new Set<WebSocket>();

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
