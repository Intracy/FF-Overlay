import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { ProjectManager, ProjectRuntime } from '../projects.js';
import * as store from '../db.js';
import { safeEqual } from '../lib/crypto.js';
import { isAuthenticated } from './auth.js';
import type { OverlayToServer } from '../shared/types.js';

/** WebSockets laufen außerhalb des Anfrage-Kontexts weiter – deshalb hier das Projekt fest zuordnen */
export async function wsRoutes(app: FastifyInstance, projects: ProjectManager, resolve: (req: FastifyRequest) => ProjectRuntime) {

  /** Overlay-Browserquelle: authentifiziert sich mit dem geheimen Key aus der URL. */
  app.get<{ Params: { id: string }; Querystring: { key?: string } }>('/ws/overlay/:id', { websocket: true }, (socket, req) => {
    // Browserquelle: Projekt ergibt sich aus der Overlay-ID (alte URLs funktionieren weiter)
    const rt = projects.byOverlay(req.params.id);
    const overlay = rt ? store.overlays.get(rt.db, req.params.id) : undefined;
    if (!rt || !overlay || !safeEqual(String(req.query.key ?? ''), overlay.key)) {
      socket.close(4001, 'Ungültiger Overlay-Key');
      return;
    }
    const { hub, pipeline } = rt;
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
  app.get<{ Params: { id: string }; Querystring: { key?: string; preview?: string } }>('/ws/widget/:id', { websocket: true }, (socket, req) => {
    const rt = projects.byWidget(req.params.id);
    const widget = rt ? store.widgets.get(rt.db, req.params.id) : undefined;
    if (!rt || !widget || !safeEqual(String(req.query.key ?? ''), widget.key)) {
      socket.close(4001, 'Ungültiger Widget-Key');
      return;
    }
    // &preview=1 zeigt Beispieldaten (wie bei betterplace)
    const channel = req.query.preview === '1' ? `${widget.id}:preview` : widget.id;
    const { hub } = rt;
    hub.addWidget(channel, socket);
    socket.send(JSON.stringify(rt.widgets.snapshot(widget, channel !== widget.id)));
    socket.on('message', (buf) => {
      if (buf.toString() === '{"t":"ping"}') socket.send('{"t":"pong"}');
    });
    socket.on('close', () => hub.removeWidget(channel, socket));
  });

  /** Dashboard: Live-Feed, Queue-Status, Connector-Status. Authentifiziert über das Session-Cookie. */
  app.get('/ws/dashboard', { websocket: true }, (socket, req) => {
    if (!isAuthenticated(req)) {
      socket.close(4001, 'Nicht angemeldet');
      return;
    }
    const { hub, pipeline, connectors } = resolve(req);
    hub.addDashboard(socket);
    for (const state of pipeline.allQueueStates()) socket.send(JSON.stringify({ t: 'queue', state }));
    socket.send(JSON.stringify({ t: 'connectors', status: connectors.statuses() }));
    socket.on('close', () => hub.removeDashboard(socket));
  });
}
