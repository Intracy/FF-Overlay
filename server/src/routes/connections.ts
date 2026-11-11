import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
import { encrypt, randomKey, safeEqual } from '../lib/crypto.js';
import { isAuthenticated, requireAuth } from './auth.js';
import { authorizeUrl, exchangeCode, validateToken } from '../connectors/twitch/auth.js';
import type { TwitchConnectionData } from '../connectors/twitch/eventsub.js';
import { parseFundraisingEventId, type BetterplaceConnectionData } from '../connectors/betterplace.js';
import { normalizeWebhook, webhookBody, type WebhookConnectionData } from '../connectors/webhook.js';

/** Entfernt Geheimnisse, bevor Verbindungsdaten ans Dashboard gehen. */
function publicConnection(c: store.ConnectionRow) {
  const d = c.data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (c.platform === 'twitch') Object.assign(safe, { login: d.login, scopes: d.scopes });
  if (c.platform === 'betterplace') Object.assign(safe, { fundraisingEventId: d.fundraisingEventId });
  if (c.platform === 'webhook') Object.assign(safe, { url: `${config.publicUrl}/hooks/${d.token}` });
  return { id: c.id, platform: c.platform, label: c.label, enabled: c.enabled, data: safe };
}

const oauthStates = new Map<string, number>();

export async function connectionRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, connectors, pipeline } = ctx;

  // ---------- Öffentlich: eingehende Webhooks ----------
  app.post<{ Params: { token: string } }>('/hooks/:token', async (req, reply) => {
    const conn = store.connections
      .list(db)
      .find((c) => c.platform === 'webhook' && c.enabled && safeEqual(String((c.data as unknown as WebhookConnectionData).token), req.params.token));
    if (!conn) return reply.code(404).send({ error: 'unbekannter Webhook' });
    const parsed = webhookBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'ungültiger Body', issues: parsed.error.issues });
    const event = normalizeWebhook(parsed.data, conn.id);
    pipeline.ingest(event);
    return { ok: true, id: event.id };
  });

  // ---------- Twitch OAuth ----------
  app.get('/auth/twitch/start', async (req, reply) => {
    if (!isAuthenticated(req)) return reply.redirect('/login');
    if (!config.twitch.clientId || !config.twitch.clientSecret)
      return reply.code(400).send('TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET sind nicht gesetzt (siehe README).');
    const state = randomKey(16);
    oauthStates.set(state, Date.now() + 10 * 60_000);
    return reply.redirect(authorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/auth/twitch/callback',
    async (req, reply) => {
      if (!isAuthenticated(req)) return reply.redirect('/login');
      const { code, state, error, error_description } = req.query;
      const valid = state && (oauthStates.get(state) ?? 0) > Date.now();
      if (state) oauthStates.delete(state);
      if (error) return reply.redirect(`/connections?error=${encodeURIComponent(error_description || error)}`);
      if (!code || !valid) return reply.redirect('/connections?error=Ungültige+OAuth-Antwort');
      try {
        const tokens = await exchangeCode(code);
        const me = await validateToken(tokens.accessToken);
        if (!me) throw new Error('Token ungültig');
        const existing = store.connections.list(db).find((c) => c.platform === 'twitch' && (c.data as unknown as TwitchConnectionData).userId === me.user_id);
        const id = existing?.id ?? nanoid(10);
        const data: TwitchConnectionData = {
          userId: me.user_id, login: me.login, accessToken: encrypt(tokens.accessToken), refreshToken: encrypt(tokens.refreshToken),
          expiresAt: tokens.expiresAt, scopes: tokens.scopes,
        };
        store.connections.save(db, { id, platform: 'twitch', label: `Twitch @${me.login}`, data: data as never, enabled: true });
        await connectors.restart(id);
        return reply.redirect('/connections?connected=twitch');
      } catch (err) {
        req.log.error({ err }, 'Twitch-OAuth fehlgeschlagen');
        return reply.redirect(`/connections?error=${encodeURIComponent(String(err))}`);
      }
    },
  );

  // ---------- Verwaltung (Dashboard) ----------
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/api/connections', async () => ({
      connections: store.connections.list(db).map(publicConnection),
      status: connectors.statuses(),
      twitchConfigured: !!(config.twitch.clientId && config.twitch.clientSecret),
      twitchRedirectUri: `${config.publicUrl}/auth/twitch/callback`,
    }));

    r.post<{ Body: { input: string; label?: string } }>('/api/connections/betterplace', async (req, reply) => {
      const id = parseFundraisingEventId(String(req.body?.input ?? ''));
      if (!id) return reply.code(400).send({ error: 'Keine Spendenaktions-ID erkannt' });
      const data: BetterplaceConnectionData = { fundraisingEventId: id, seen: [], primed: false };
      const conn = { id: nanoid(10), platform: 'betterplace', label: req.body.label?.slice(0, 80) || `betterplace #${id}`, data: data as never, enabled: true };
      store.connections.save(db, conn);
      await connectors.restart(conn.id);
      return publicConnection(conn);
    });

    r.post<{ Body: { label?: string } }>('/api/connections/webhook', async (req) => {
      const conn = { id: nanoid(10), platform: 'webhook', label: req.body?.label?.slice(0, 80) || 'Webhook', data: { token: randomKey(24) } as never, enabled: true };
      store.connections.save(db, conn);
      connectors.statuses();
      return publicConnection(conn);
    });

    r.patch<{ Params: { id: string }; Body: { enabled?: boolean; label?: string } }>('/api/connections/:id', async (req, reply) => {
      const c = store.connections.get(db, req.params.id);
      if (!c) return reply.code(404).send({ error: 'Verbindung nicht gefunden' });
      if (typeof req.body?.enabled === 'boolean') c.enabled = req.body.enabled;
      if (req.body?.label) c.label = req.body.label.slice(0, 80);
      store.connections.save(db, c);
      await connectors.restart(c.id);
      return publicConnection(c);
    });

    r.post<{ Params: { id: string } }>('/api/connections/:id/restart', async (req) => {
      await connectors.restart(req.params.id);
      return { ok: true };
    });

    r.delete<{ Params: { id: string } }>('/api/connections/:id', async (req) => {
      await connectors.stop(req.params.id);
      return { ok: store.connections.remove(db, req.params.id) };
    });
  });
}
