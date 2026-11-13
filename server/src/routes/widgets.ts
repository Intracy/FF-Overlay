import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
import { requireAuth } from './auth.js';
import { WIDGET_INFO, type Widget, type WidgetSettingsMap } from '../shared/widgets.js';
import { mergeSettings, widgetCreateSchema, widgetPatchSchema } from '../widgets/schemas.js';

export const widgetUrl = (w: { id: string; key: string }) => `${config.publicUrl}/widget/?id=${w.id}&key=${w.key}`;
const view = (w: Widget) => ({ ...w, url: widgetUrl(w) });

export async function widgetRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, hub, widgets: service } = ctx;
  app.addHook('preHandler', requireAuth);

  app.get('/api/widgets', async () => store.widgets.list(db).map(view));

  app.post('/api/widgets', async (req) => {
    const body = widgetCreateSchema.parse(req.body);
    return view(store.widgets.create(db, body.type, body.name || WIDGET_INFO[body.type].label));
  });

  app.get<{ Params: { id: string } }>('/api/widgets/:id', async (req, reply) => {
    const w = store.widgets.get(db, req.params.id);
    if (!w) return reply.code(404).send({ error: 'Widget nicht gefunden' });
    return { ...view(w), data: service.data(w) };
  });

  app.patch<{ Params: { id: string } }>('/api/widgets/:id', async (req, reply) => {
    const w = store.widgets.get(db, req.params.id);
    if (!w) return reply.code(404).send({ error: 'Widget nicht gefunden' });
    const patch = widgetPatchSchema.parse(req.body);
    let settings = patch.settings ? mergeSettings(w.type, w.settings, patch.settings) : undefined;
    // Abstimmung: Start/Ende beim Aktivieren bzw. Deaktivieren festhalten
    if (settings && w.type === 'bp_poll') {
      const before = w.settings as WidgetSettingsMap['bp_poll'];
      const after = settings as unknown as WidgetSettingsMap['bp_poll'];
      if (after.active && !before.active) settings = { ...after, startedAt: new Date().toISOString(), endedAt: '' };
      if (!after.active && before.active) settings = { ...after, endedAt: new Date().toISOString() };
    }
    const next = store.widgets.update(db, w.id, { name: patch.name, previewBackground: patch.previewBackground, settings: settings as unknown as Widget['settings'] | undefined })!;
    if (settings && w.type === 'bp_milestones') service.syncMilestones(w.id);
    service.push(w.id);
    return view(next);
  });

  app.delete<{ Params: { id: string } }>('/api/widgets/:id', async (req, reply) => {
    hub.closeWidget(req.params.id, 'Widget gelöscht');
    hub.closeWidget(`${req.params.id}:preview`, 'Widget gelöscht');
    if (!store.widgets.remove(db, req.params.id)) return reply.code(404).send({ error: 'Widget nicht gefunden' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/widgets/:id/rotate-key', async (req, reply) => {
    const w = store.widgets.rotateKey(db, req.params.id);
    if (!w) return reply.code(404).send({ error: 'Widget nicht gefunden' });
    hub.closeWidget(w.id, 'Neuer Key');
    hub.closeWidget(`${w.id}:preview`, 'Neuer Key');
    return view(w);
  });

  // ---------- Steuerung ----------
  const timerBody = z.object({ action: z.enum(['start', 'pause', 'reset', 'add']), seconds: z.number().min(-864_000).max(864_000).optional() });
  app.post<{ Params: { id: string } }>('/api/widgets/:id/timer', async (req, reply) => {
    const body = timerBody.parse(req.body);
    const state = service.timerControl(req.params.id, body.action, body.seconds ?? 0);
    if (!state) return reply.code(404).send({ error: 'Kein Timer-Widget' });
    return state;
  });

  app.post<{ Params: { id: string } }>('/api/widgets/:id/boss/reset', async (req, reply) => {
    const state = service.bossReset(req.params.id);
    if (!state) return reply.code(404).send({ error: 'Kein Boss-Widget' });
    return state;
  });

  /** Ziel neu starten: zählt ab jetzt */
  app.post<{ Params: { id: string } }>('/api/widgets/:id/goal/reset', async (req, reply) => {
    const w = store.widgets.get(db, req.params.id);
    if (!w || w.type !== 'goal') return reply.code(404).send({ error: 'Kein Ziel-Widget' });
    const next = store.widgets.update(db, w.id, { settings: { ...w.settings, startedAt: new Date().toISOString(), startValue: 0 } })!;
    service.push(w.id);
    return view(next);
  });

  app.post<{ Params: { id: string } }>('/api/widgets/:id/credits/roll', async (req, reply) => {
    const w = store.widgets.get(db, req.params.id);
    if (!w || w.type !== 'credits') return reply.code(404).send({ error: 'Kein Credits-Widget' });
    hub.sendWidget(w.id, { t: 'credits.roll' });
    return { ok: true, sources: hub.widgetCount(w.id) };
  });

  /** Widget-Daten neu an alle Browserquellen schicken (z. B. „Logos neu laden“) */
  app.post<{ Params: { id: string } }>('/api/widgets/:id/refresh', async (req, reply) => {
    if (!store.widgets.get(db, req.params.id)) return reply.code(404).send({ error: 'Widget nicht gefunden' });
    service.push(req.params.id);
    return { ok: true, sources: hub.widgetCount(req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/widgets/:id/poll/winner', async (req, reply) => {
    if (!service.pollWinner(req.params.id)) return reply.code(404).send({ error: 'Keine Abstimmung' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/widgets/:id/milestones/reset', async (req, reply) => {
    if (!service.resetMilestones(req.params.id)) return reply.code(404).send({ error: 'Kein Milestone-Widget' });
    return { ok: true };
  });

  /** Test-Events (Testknöpfe) aus Log und Widgets entfernen */
  app.delete('/api/events/test', async () => {
    const removed = store.events.removeTestData(db);
    service.pushAll();
    return { removed };
  });
}
