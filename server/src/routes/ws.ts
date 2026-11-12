import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { safeEqual } from '../lib/crypto.js';
import { isAuthenticated } from './auth.js';
import type { OverlayToServer } from '../shared/types.js';

export async function wsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, hub, pipeline, connectors } = ctx;

  /** Overlay-Browserquelle: authentifiziert sich mit dem geheimen Key aus der URL. */
  app.get<{ Params: { id: string }; Querystring: { key?: string } }>('/ws/overlay/:id', { websocket: true }, (socket, req) => {
    const overlay = store.overlays.get(db, req.params.id);
    if (!overlay || !safeEqual(String(req.query.key ?? ''), overlay.key)) {
      socket.close(4001, 'Ungültiger Overlay-Key');
      return;
    }
    const queue = pipeline.queue(overlay.id)!;
    hub.addOverlay(overlay.id, socket);
    socket.send(JSON.stringify({ t: 'hello', overlay: { ...overlay, key: '' } }));
    socket.send(JSON.stringify({ t: 'state', muted: queue.muted, volume: queue.volume }));
    queue.onConnectionChange();

    socket.on('message', (buf) => {
      let msg: OverlayToServer;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.t === 'alert.done') queue.done(msg.itemId);
      else if (msg.t === 'ping') socket.send(JSON.stringify({ t: 'pong' }));
    });
    socket.on('close', () => {
      hub.removeOverlay(overlay.id, socket);
      queue.onConnectionChange();
    });
  });

  /** Widget-Browserquelle (Ereignisliste, Ziel, Label, Timer, …) */
  app.get<{ Params: { id: string }; Querystring: { key?: string } }>('/ws/widget/:id', { websocket: true }, (socket, req) => {
    const widget = store.widgets.get(db, req.params.id);
    if (!widget || !safeEqual(String(req.query.key ?? ''), widget.key)) {
      socket.close(4001, 'Ungültiger Widget-Key');
      return;
    }
    hub.addWidget(widget.id, socket);
    socket.send(JSON.stringify(ctx.widgets.snapshot(widget)));
    socket.on('message', (buf) => {
      if (buf.toString() === '{"t":"ping"}') socket.send('{"t":"pong"}');
    });
    socket.on('close', () => hub.removeWidget(widget.id, socket));
  });

  /** Dashboard: Live-Feed, Queue-Status, Connector-Status. Authentifiziert über das Session-Cookie. */
  app.get('/ws/dashboard', { websocket: true }, (socket, req) => {
    if (!isAuthenticated(req)) {
      socket.close(4001, 'Nicht angemeldet');
      return;
    }
    hub.addDashboard(socket);
    for (const state of pipeline.allQueueStates()) socket.send(JSON.stringify({ t: 'queue', state }));
    socket.send(JSON.stringify({ t: 'connectors', status: connectors.statuses() }));
    socket.on('close', () => hub.removeDashboard(socket));
  });
}
