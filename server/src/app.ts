import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { openDb } from './db.js';
import * as store from './db.js';
import { Hub } from './ws/hub.js';
import { Pipeline } from './events/pipeline.js';
import { ConnectorManager } from './connectors/manager.js';
import type { AppContext } from './context.js';
import { seedIfEmpty } from './seed.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { connectionRoutes } from './routes/connections.js';
import { mediaRoutes } from './routes/media.js';
import { wsRoutes } from './routes/ws.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Gebautes Frontend: dist/web (relativ zu dist/server bzw. server/src) */
const webDir = [path.resolve(here, '../web'), path.resolve(here, '../../dist/web')].find((d) => fs.existsSync(path.join(d, 'index.html')));

export async function buildApp(opts: { dbFile?: string; logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const db = openDb(opts.dbFile ?? config.dbFile);
  seedIfEmpty(db);
  const hub = new Hub();
  const pipeline = new Pipeline(db, hub);
  const connectors: ConnectorManager = new ConnectorManager(db, {
    emit: (event) => pipeline.ingest(event),
    onStatus: () => hub.broadcastDashboard({ t: 'connectors', status: connectors.statuses() }),
    log: app.log,
  });
  const ctx: AppContext = { db, hub, pipeline, connectors };

  await app.register(fastifyCookie, { secret: config.appSecret });
  await app.register(fastifyMultipart);
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Ungültige Eingabe', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'Serverfehler');
    return reply.code(status).send({ error: status >= 500 ? 'Interner Fehler' : (err as Error).message });
  });

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(async (i) => connectionRoutes(i, ctx));
  await app.register(async (i) => apiRoutes(i, ctx));
  await app.register(async (i) => mediaRoutes(i, ctx));
  await app.register(async (i) => wsRoutes(i, ctx));

  fs.mkdirSync(config.mediaDir, { recursive: true });
  await app.register(fastifyStatic, { root: config.mediaDir, prefix: '/media/', decorateReply: false, maxAge: '7d' });

  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', wildcard: true });
    // SPA-Fallback fürs Dashboard (Client-Routing)
    app.setNotFoundHandler((req, reply) => {
      const p = req.url.split('?')[0]!;
      if (req.method === 'GET' && !/^\/(api|ws|hooks|auth|media|overlay)\b/.test(p)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Nicht gefunden' });
    });
  } else {
    app.log.warn('Kein gebautes Frontend gefunden – im Entwicklungsmodus läuft es über Vite (npm run dev).');
  }

  // Aufräumen: Event-Log nach Aufbewahrungsfrist löschen (Datenschutz)
  const purge = () => store.events.purgeOlderThan(db, config.eventRetentionDays);
  purge();
  const purgeTimer = setInterval(purge, 6 * 3600_000);
  app.addHook('onClose', async () => {
    clearInterval(purgeTimer);
    await connectors.stopAll();
    db.close();
  });

  return { app, ctx };
}
