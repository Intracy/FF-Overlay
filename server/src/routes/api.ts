import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
import { overlayPatchSchema, ruleSchema, settingsSchema, templateSchema, testEventSchema } from '../schemas.js';
import { requireAuth } from './auth.js';
import { sampleEvent } from '../seed.js';
import { selectRule } from '../rules/engine.js';
import { buildAlert, defaultTemplate } from '../templates/render.js';
import type { EventType, NormalizedEvent } from '../shared/types.js';

export const overlayUrl = (o: { id: string; key: string }) => `${config.publicUrl}/overlay/?id=${o.id}&key=${o.key}`;

export async function apiRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, pipeline, hub } = ctx;
  app.addHook('preHandler', requireAuth);

  // ---------- Overlays & Live-Steuerung ----------
  app.get('/api/overlays', async () => store.overlays.list(db).map((o) => ({ ...o, url: overlayUrl(o) })));

  app.post<{ Body: { name?: string } }>('/api/overlays', async (req) => {
    const o = store.overlays.create(db, String(req.body?.name || 'Neues Overlay').slice(0, 80));
    return { ...o, url: overlayUrl(o) };
  });

  app.patch<{ Params: { id: string } }>('/api/overlays/:id', async (req, reply) => {
    const patch = overlayPatchSchema.parse(req.body);
    const o = store.overlays.update(db, req.params.id, patch);
    if (!o) return reply.code(404).send({ error: 'Overlay nicht gefunden' });
    if (patch.muted !== undefined || patch.volume !== undefined) pipeline.queue(o.id)?.setAudio(o.muted, o.volume);
    return { ...o, url: overlayUrl(o) };
  });

  app.post<{ Params: { id: string } }>('/api/overlays/:id/rotate-key', async (req, reply) => {
    const o = store.overlays.rotateKey(db, req.params.id);
    if (!o) return reply.code(404).send({ error: 'Overlay nicht gefunden' });
    hub.closeOverlay(o.id, 'Key erneuert');
    return { ...o, url: overlayUrl(o) };
  });

  app.delete<{ Params: { id: string } }>('/api/overlays/:id', async (req) => {
    hub.closeOverlay(req.params.id, 'Overlay gelöscht');
    pipeline.dropQueue(req.params.id);
    return { ok: store.overlays.remove(db, req.params.id) };
  });

  app.get('/api/queues', async () => pipeline.allQueueStates());

  app.post<{ Params: { id: string; action: string } }>('/api/overlays/:id/queue/:action', async (req, reply) => {
    const q = pipeline.queue(req.params.id);
    if (!q) return reply.code(404).send({ error: 'Overlay nicht gefunden' });
    switch (req.params.action) {
      case 'pause': q.pause(); break;
      case 'resume': q.resume(); break;
      case 'skip': q.skip(); break;
      case 'clear': q.clear(); break;
      case 'reload': hub.sendOverlay(req.params.id, { t: 'reload' }); break;
      default: return reply.code(400).send({ error: 'Unbekannte Aktion' });
    }
    return q.state();
  });

  // ---------- Templates ----------
  app.get('/api/templates', async () => store.templates.list(db));
  app.post<{ Body: { name?: string; copyFrom?: string } }>('/api/templates', async (req) => {
    const src = req.body?.copyFrom ? store.templates.get(db, req.body.copyFrom) : undefined;
    const t = src
      ? { ...structuredClone(src), id: nanoid(10), name: `${src.name} (Kopie)` }
      : defaultTemplate(nanoid(10), String(req.body?.name || 'Neues Template').slice(0, 80), '{user} – danke!');
    return store.templates.save(db, t);
  });
  app.put<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
    const t = templateSchema.parse({ ...(req.body as object), id: req.params.id });
    return store.templates.save(db, t);
  });
  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    if (store.rules.usesTemplate(db, req.params.id)) return reply.code(409).send({ error: 'Template wird noch von einer Regel benutzt' });
    return { ok: store.templates.remove(db, req.params.id) };
  });
  /** Template direkt auf einem Overlay testen (ohne Regel-Engine). */
  app.post<{ Params: { id: string }; Body: { overlayId: string; type?: EventType; subtype?: string } }>(
    '/api/templates/:id/test',
    async (req, reply) => {
      const t = store.templates.get(db, req.params.id);
      const q = pipeline.queue(req.body?.overlayId);
      if (!t || !q) return reply.code(404).send({ error: 'Template oder Overlay nicht gefunden' });
      q.enqueue(buildAlert(t, sampleEvent(req.body.type ?? 'donation', req.body.subtype)));
      return { ok: true };
    },
  );

  // ---------- Regeln ----------
  app.get<{ Querystring: { overlayId?: string } }>('/api/rules', async (req) => store.rules.list(db, req.query.overlayId));
  app.post('/api/rules', async (req) => store.rules.save(db, ruleSchema.parse({ ...(req.body as object), id: nanoid(10) })));
  app.put<{ Params: { id: string } }>('/api/rules/:id', async (req) => store.rules.save(db, ruleSchema.parse({ ...(req.body as object), id: req.params.id })));
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req) => ({ ok: store.rules.remove(db, req.params.id) }));

  /** Trockenlauf: Welche Regel würde für dieses Test-Event greifen? */
  app.post('/api/rules/explain', async (req) => {
    const body = testEventSchema.parse(req.body);
    const event = toTestEvent(body);
    return store.overlays.list(db).map((o) => {
      const m = selectRule(store.rules.list(db, o.id), event, {
        isLive: pipeline.session.live, largestAmountThisStream: pipeline.session.largestAmount, hasPreviousFromUser: false, random: Math.random,
      });
      return { overlayId: o.id, overlay: o.name, rule: m?.rule.name ?? null, reason: m?.reason ?? 'keine passende Regel' };
    });
  });

  // ---------- Events ----------
  app.get<{ Querystring: { limit?: string; before?: string; types?: string; platforms?: string } }>('/api/events', async (req) =>
    store.events.list(db, {
      limit: req.query.limit ? Number(req.query.limit) : 100,
      before: req.query.before,
      types: req.query.types?.split(',').filter(Boolean),
      platforms: req.query.platforms?.split(',').filter(Boolean),
    }),
  );
  app.post('/api/events/test', async (req) => {
    const event = toTestEvent(testEventSchema.parse(req.body));
    pipeline.ingest(event);
    return { ok: true, id: event.id };
  });
  app.post<{ Params: { id: string }; Body: { overlayId?: string } }>('/api/events/:id/replay', async (req, reply) => {
    if (!pipeline.replay(req.params.id, req.body?.overlayId)) return reply.code(404).send({ error: 'Event nicht gefunden oder keine passende Regel' });
    return { ok: true };
  });
  app.post<{ Body: { ids: string[] | 'all'; read?: boolean } }>('/api/events/read', async (req) => {
    store.events.markRead(db, req.body.ids === 'all' ? 'all' : (req.body.ids ?? []).slice(0, 500), req.body.read ?? true);
    return { ok: true };
  });

  // ---------- Einstellungen & Session ----------
  app.get('/api/settings', async () => store.settings.global(db));
  app.put('/api/settings', async (req) => {
    const s = settingsSchema.parse(req.body);
    store.settings.set(db, 'global', s);
    return s;
  });
  app.get('/api/session', async () => pipeline.session);
  app.post('/api/session/reset', async () => {
    pipeline.resetSession();
    return pipeline.session;
  });
}

function toTestEvent(b: ReturnType<typeof testEventSchema.parse>): NormalizedEvent {
  const overrides: Partial<NormalizedEvent> = {};
  if (b.user) overrides.user = { name: b.user };
  if (b.amount != null) overrides.amount = { value: b.amount, currency: b.type === 'cheer' ? 'BITS' : 'EUR' };
  if (b.count != null) overrides.count = b.count;
  if (b.months != null) overrides.months = b.months;
  if (b.message != null) overrides.message = b.message;
  if (b.type === 'subscription' && b.subtype === 'gift' && b.user) overrides.gifter = b.user;
  return sampleEvent(b.type, b.subtype, overrides);
}
