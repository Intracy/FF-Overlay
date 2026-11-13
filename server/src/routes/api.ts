import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
import { overlayPatchSchema, ruleSchema, settingsSchema, templateSchema, testEventSchema } from '../schemas.js';
import { requireAuth } from './auth.js';
import { addVariation, alertboxView, applyGlobalEdit, createProfile, ensureDefault, GLOBAL_EDIT_GROUPS, removeRule, sampleEvent, satisfyConditions, type GlobalEditGroup } from '../alertbox.js';
import { z } from 'zod';
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
    if (patch.activeProfileId && store.profiles.get(db, patch.activeProfileId)?.overlayId !== req.params.id)
      return reply.code(400).send({ error: 'Profil gehört nicht zu diesem Overlay' });
    const o = store.overlays.update(db, req.params.id, patch);
    if (!o) return reply.code(404).send({ error: 'Overlay nicht gefunden' });
    if (patch.muted !== undefined || patch.volume !== undefined) pipeline.queue(o.id)?.setAudio(o.muted, o.volume);
    // Browserquellen bekommen neue Darstellungs-Einstellungen (z. B. Hochformat) sofort
    if (patch.portrait) ctx.hub.sendOverlay(o.id, { t: 'hello', overlay: { ...o, key: '' } });
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

  // ---------- Moderation (Streamlabs: „Alert-Moderationsverzögerung“) ----------
  app.post<{ Params: { id: string; itemId: string; action: 'approve' | 'reject' } }>('/api/overlays/:id/moderation/:itemId/:action', async (req, reply) => {
    const q = pipeline.queue(req.params.id);
    if (!q) return reply.code(404).send({ error: 'Overlay nicht gefunden' });
    const ok = req.params.action === 'approve' ? q.approve(req.params.itemId) : req.params.action === 'reject' ? q.reject(req.params.itemId) : false;
    if (!ok) return reply.code(404).send({ error: 'Alert wartet nicht (mehr) auf Moderation' });
    return q.state();
  });

  // ---------- Alert-Box (Streamlabs-Struktur) ----------
  const overlayOr404 = (id: string) => {
    const o = store.overlays.get(db, id);
    if (!o) throw Object.assign(new Error('Overlay nicht gefunden'), { statusCode: 404 });
    return o;
  };

  app.get<{ Params: { id: string } }>('/api/overlays/:id/alertbox', async (req) => alertboxView(db, overlayOr404(req.params.id)));

  app.post<{ Params: { id: string; key: string } }>('/api/overlays/:id/alertbox/:key/enable', async (req) =>
    ensureDefault(db, overlayOr404(req.params.id), req.params.key));

  app.post<{ Params: { id: string; key: string } }>('/api/overlays/:id/alertbox/:key/variations', async (req) => {
    const b = z.object({
      name: z.string().min(1).max(80), copyCurrent: z.boolean().default(true),
      presetId: z.string().max(40).optional(), value: z.union([z.string().max(200), z.number()]).optional(),
    }).parse(req.body);
    return addVariation(db, overlayOr404(req.params.id), req.params.key, b);
  });

  app.delete<{ Params: { ruleId: string } }>('/api/alertbox/rules/:ruleId', async (req) => ({ ok: removeRule(db, req.params.ruleId) }));

  app.post<{ Params: { id: string } }>('/api/overlays/:id/global-edit', async (req) => {
    const b = z.object({ group: z.enum(Object.keys(GLOBAL_EDIT_GROUPS) as [GlobalEditGroup, ...GlobalEditGroup[]]), values: templateSchema.omit({ id: true, name: true }) }).parse(req.body);
    const n = applyGlobalEdit(db, overlayOr404(req.params.id), b.group, { ...b.values, id: '', name: '' });
    return { updated: n };
  });

  // ---------- Profile (Streamlabs: „Themen“) ----------
  app.get<{ Params: { id: string } }>('/api/overlays/:id/profiles', async (req) => store.profiles.list(db, overlayOr404(req.params.id).id));
  app.post<{ Params: { id: string } }>('/api/overlays/:id/profiles', async (req) => {
    const b = z.object({ name: z.string().min(1).max(80), copy: z.boolean().default(true), activate: z.boolean().default(true) }).parse(req.body);
    const o = overlayOr404(req.params.id);
    const p = createProfile(db, o, b.name, b.copy);
    if (b.activate) store.overlays.update(db, o.id, { activeProfileId: p.id });
    return p;
  });
  app.patch<{ Params: { profileId: string } }>('/api/profiles/:profileId', async (req, reply) => {
    const b = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    if (!store.profiles.rename(db, req.params.profileId, b.name)) return reply.code(404).send({ error: 'Profil nicht gefunden' });
    return store.profiles.get(db, req.params.profileId);
  });
  app.delete<{ Params: { profileId: string } }>('/api/profiles/:profileId', async (req, reply) => {
    const p = store.profiles.get(db, req.params.profileId);
    if (!p) return reply.code(404).send({ error: 'Profil nicht gefunden' });
    const all = store.profiles.list(db, p.overlayId);
    if (all.length <= 1) return reply.code(409).send({ error: 'Das letzte Profil kann nicht gelöscht werden' });
    const o = overlayOr404(p.overlayId);
    if (o.activeProfileId === p.id) store.overlays.update(db, o.id, { activeProfileId: all.find((x) => x.id !== p.id)!.id });
    return { ok: store.profiles.remove(db, p.id) };
  });

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

  /** „Diesen Alert testen“: den gerade bearbeiteten (auch ungespeicherten) Entwurf sofort im Overlay abspielen */
  app.post<{ Params: { id: string } }>('/api/overlays/:id/test-draft', async (req, reply) => {
    const b = z.object({
      template: templateSchema,
      type: z.string().max(40).optional(),
      subtype: z.string().max(40).optional(),
      conditions: ruleSchema.shape.conditions.optional(),
    }).parse(req.body);
    const q = pipeline.queue(req.params.id);
    if (!q) return reply.code(404).send({ error: 'Overlay nicht gefunden' });
    const event = satisfyConditions(sampleEvent((b.type ?? 'donation') as EventType, b.subtype || undefined), b.conditions ?? []);
    q.enqueue(buildAlert(b.template, event));
    return { ok: true };
  });

  // ---------- Regeln ----------
  app.get<{ Querystring: { overlayId?: string } }>('/api/rules', async (req) => {
    const o = req.query.overlayId ? store.overlays.get(db, req.query.overlayId) : undefined;
    return o ? store.rules.active(db, o) : store.rules.list(db);
  });
  app.post('/api/rules', async (req) => {
    const r = ruleSchema.parse({ ...(req.body as object), id: nanoid(10) });
    r.profileId ??= store.overlays.get(db, r.overlayId)?.activeProfileId;
    r.kind ??= r.conditions.length ? 'variation' : 'default';
    return store.rules.save(db, r);
  });
  app.put<{ Params: { id: string } }>('/api/rules/:id', async (req) => store.rules.save(db, ruleSchema.parse({ ...(req.body as object), id: req.params.id })));
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req) => ({ ok: store.rules.remove(db, req.params.id) }));

  /** Trockenlauf: Welche Regel würde für dieses Test-Event greifen? */
  app.post('/api/rules/explain', async (req) => {
    const body = testEventSchema.parse(req.body);
    const event = toTestEvent(body);
    return store.overlays.list(db).map((o) => {
      const m = selectRule(store.rules.active(db, o), event, {
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
    const s = { ...store.settings.global(db), ...settingsSchema.partial().parse(req.body) };
    store.settings.set(db, 'global', s);
    ctx.widgets.pushAll();
    return s;
  });
  app.get('/api/session', async () => pipeline.session);
  app.post('/api/session/reset', async () => {
    pipeline.resetSession();
    ctx.widgets.pushAll();
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
  if (b.product != null) overrides.product = b.product;
  if (b.type === 'subscription' && b.subtype === 'gift' && b.user) overrides.gifter = b.user;
  return sampleEvent(b.type, b.subtype, overrides);
}
