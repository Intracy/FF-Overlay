import Fastify, { type FastifyRequest } from 'fastify';
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
import { chatRoutes } from './routes/chat.js';
import { projectRoutes } from './routes/projects.js';
import { ProjectManager, scopedContext, type ProjectRuntime } from './projects.js';
import { setSystemDb } from './apps.js';
import type { AppContext } from './context.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { connectionRoutes } from './routes/connections.js';
import { mediaRoutes } from './routes/media.js';
import { wsRoutes } from './routes/ws.js';
import { widgetRoutes } from './routes/widgets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Gebautes Frontend: dist/web (relativ zu dist/server bzw. server/src) */
const webDir = [path.resolve(here, '../web'), path.resolve(here, '../../dist/web')].find((d) => fs.existsSync(path.join(d, 'index.html')));

export async function buildApp(opts: { dbFile?: string; logger?: boolean; projectsDir?: string } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const systemDb = openDb(opts.dbFile ?? config.dbFile);
  setSystemDb(systemDb);
  const projects = new ProjectManager(systemDb, app.log, opts.projectsDir);
  const ctx: AppContext = scopedContext(projects);
  const resolveProject = (req: FastifyRequest): ProjectRuntime => {
    const header = req.headers['x-ff-project'];
    const query = (req.query as { p?: string } | undefined)?.p;
    const fromCookie = req.cookies?.ffp;
    for (const id of [Array.isArray(header) ? header[0] : header, query, fromCookie]) {
      const rt = projects.get(id);
      if (rt) return rt;
    }
    const hook = /^\/hooks\/([^/?]+)/.exec(req.url);
    if (hook) return projects.byHookToken(decodeURIComponent(hook[1]!)) ?? projects.default;
    return projects.default;
  };

  await app.register(fastifyCookie, { secret: config.appSecret });
  await app.register(fastifyMultipart);
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  // Jede Anfrage läuft im Kontext ihres Projekts (Header x-ff-project, ?p=, Cookie ffp oder Webhook-Adresse)
  app.addHook('onRequest', (req, _reply, done) => {
    projects.als.run(resolveProject(req), done);
  });

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
  await app.register(async (i) => wsRoutes(i, projects, resolveProject));
  await app.register(async (i) => widgetRoutes(i, ctx));
  await app.register(async (i) => chatRoutes(i, ctx));
  await app.register(async (i) => projectRoutes(i, projects));

  fs.mkdirSync(config.mediaDir, { recursive: true });
  await app.register(fastifyStatic, { root: config.mediaDir, prefix: '/media/', decorateReply: false, maxAge: '7d' });

  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, prefix: '/', wildcard: true });
    // SPA-Fallback fürs Dashboard (Client-Routing)
    app.setNotFoundHandler((req, reply) => {
      const p = req.url.split('?')[0]!;
      if (req.method === 'GET' && !/^\/(api|ws|hooks|auth|media|overlay|widget)\b/.test(p)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Nicht gefunden' });
    });
  } else {
    app.log.warn('Kein gebautes Frontend gefunden – im Entwicklungsmodus läuft es über Vite (npm run dev).');
  }

  app.addHook('onClose', async () => {
    await projects.disposeAll();
  });

  return { app, ctx, projects };
}
