import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
import { encrypt, randomKey, safeEqual } from '../lib/crypto.js';
import { isAuthenticated, requireAuth } from './auth.js';
import { authorizeUrl, exchangeCode, pollTwitchDevice, startTwitchDevice, validateToken, type TwitchTokens } from '../connectors/twitch/auth.js';
import { myChannel, pollGoogleDevice, startGoogleDevice, type GoogleTokens } from '../connectors/youtube/auth.js';
import type { YouTubeConnectionData } from '../connectors/youtube/connector.js';
import { cancelFlow, getFlow, startFlow } from '../connectors/deviceFlow.js';
import { appsView, googleApp, saveApps, twitchApp } from '../apps.js';
import { z } from 'zod';
import type { TwitchConnectionData } from '../connectors/twitch/eventsub.js';
import {
  betterplaceWebhookBody, isBetterplaceWebhook, normalizeBetterplaceWebhook, parseFundraisingEventId,
  type BetterplaceConnectionData, type BetterplaceConnector,
} from '../connectors/betterplace.js';
import { normalizeWebhook, webhookBody, type WebhookConnectionData } from '../connectors/webhook.js';

/** Entfernt Geheimnisse, bevor Verbindungsdaten ans Dashboard gehen. */
function publicConnection(c: store.ConnectionRow) {
  const d = c.data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (c.platform === 'twitch') Object.assign(safe, { login: d.login, scopes: d.scopes });
  if (c.platform === 'youtube') Object.assign(safe, { channelId: d.channelId, title: d.title });
  if (c.platform === 'betterplace')
    Object.assign(safe, {
      fundraisingEventId: d.fundraisingEventId,
      webhookUrl: d.webhookToken ? `${config.publicUrl}/hooks/${d.webhookToken}` : '',
      webhookSeenAt: d.webhookSeenAt ?? null,
      stats: d.stats ?? null,
    });
  if (c.platform === 'webhook') Object.assign(safe, { url: `${config.publicUrl}/hooks/${d.token}` });
  return { id: c.id, platform: c.platform, label: c.label, enabled: c.enabled, data: safe };
}

const oauthStates = new Map<string, number>();

export async function connectionRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, connectors, pipeline } = ctx;

  /** Twitch-Verbindung speichern (gleiches Konto → bestehende Verbindung aktualisieren) */
  async function saveTwitch(tokens: TwitchTokens) {
    const me = await validateToken(tokens.accessToken);
    if (!me) throw new Error('Twitch-Token ungültig');
    const existing = store.connections.list(db).find((c) => c.platform === 'twitch' && (c.data as unknown as TwitchConnectionData).userId === me.user_id);
    const id = existing?.id ?? nanoid(10);
    const data: TwitchConnectionData = {
      userId: me.user_id, login: me.login, accessToken: encrypt(tokens.accessToken), refreshToken: encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt, scopes: tokens.scopes.length ? tokens.scopes : me.scopes, clientId: twitchApp(db).clientId,
    };
    store.connections.save(db, { id, platform: 'twitch', label: `Twitch @${me.login}`, data: data as never, enabled: true });
    await connectors.restart(id);
    return `Twitch @${me.login}`;
  }

  async function saveYouTube(tokens: GoogleTokens) {
    if (!tokens.refreshToken) throw new Error('Google hat kein Refresh-Token geliefert – Zugriff unter myaccount.google.com/permissions entfernen und neu verbinden');
    const ch = await myChannel(tokens.accessToken);
    if (!ch) throw new Error('Dieses Google-Konto hat keinen YouTube-Kanal');
    const existing = store.connections.list(db).find((c) => c.platform === 'youtube' && (c.data as unknown as YouTubeConnectionData).channelId === ch.id);
    const id = existing?.id ?? nanoid(10);
    const prev = existing?.data as unknown as YouTubeConnectionData | undefined;
    const data: YouTubeConnectionData = {
      channelId: ch.id, title: ch.title, accessToken: encrypt(tokens.accessToken), refreshToken: encrypt(tokens.refreshToken),
      expiresAt: tokens.expiresAt, clientId: googleApp(db).clientId, seenSubscribers: prev?.seenSubscribers ?? [], subscribersPrimed: prev?.subscribersPrimed ?? false,
    };
    store.connections.save(db, { id, platform: 'youtube', label: `YouTube ${ch.title}`, data: data as never, enabled: true });
    await connectors.restart(id);
    return `YouTube ${ch.title}`;
  }

  // ---------- Öffentlich: eingehende Webhooks ----------
  app.post<{ Params: { token: string } }>('/hooks/:token', async (req, reply) => {
    const token = req.params.token;
    const conn = store.connections.list(db).find((c) => {
      if (!c.enabled) return false;
      const d = c.data as unknown as WebhookConnectionData & BetterplaceConnectionData;
      if (c.platform === 'webhook') return safeEqual(String(d.token), token);
      if (c.platform === 'betterplace') return !!d.webhookToken && safeEqual(String(d.webhookToken), token);
      return false;
    });
    if (!conn) return reply.code(404).send({ error: 'unbekannter Webhook' });

    // Spenden-Webhook von betterplace (Format donation_announced) – an jeder Webhook-URL erkannt
    if (isBetterplaceWebhook(req.body)) {
      const parsed = betterplaceWebhookBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'ungültiger betterplace-Webhook', issues: parsed.error.issues });
      const event = normalizeBetterplaceWebhook(parsed.data, conn.id);
      if (conn.platform === 'betterplace') {
        const c = store.connections.get<BetterplaceConnectionData>(db, conn.id)!;
        c.data = { ...c.data, webhookSeenAt: new Date().toISOString() };
        store.connections.save(db, c);
        (connectors.get(conn.id) as BetterplaceConnector | undefined)?.refreshStatsSoon?.();
      }
      pipeline.ingest(event);
      return { ok: true, id: event.id };
    }

    if (conn.platform !== 'webhook') return reply.code(400).send({ error: 'Erwartet wird ein betterplace-Spenden-Webhook (donation_announced)' });
    const parsed = webhookBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'ungültiger Body', issues: parsed.error.issues });
    const event = normalizeWebhook(parsed.data, conn.id);
    pipeline.ingest(event);
    return { ok: true, id: event.id };
  });

  // ---------- Twitch OAuth ----------
  app.get('/auth/twitch/start', async (req, reply) => {
    if (!isAuthenticated(req)) return reply.redirect('/login');
    const tapp = twitchApp(db);
    if (!tapp.clientId || !tapp.clientSecret)
      return reply.code(400).send('Für die Anmeldung per Weiterleitung braucht die Twitch-App ein Client-Secret. Einfacher: „Mit Twitch verbinden“ (Gerätecode).');
    const state = randomKey(16);
    oauthStates.set(state, Date.now() + 10 * 60_000);
    return reply.redirect(authorizeUrl(tapp, state));
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
        const tokens = await exchangeCode(twitchApp(db), code);
        await saveTwitch(tokens);
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
      apps: appsView(db),
      twitchRedirectUri: `${config.publicUrl}/auth/twitch/callback`,
    }));

    // ---------- App-Zugangsdaten (einmalig je Installation) ----------
    r.get('/api/apps', async () => appsView(db));
    r.put('/api/apps', async (req) => {
      const b = z
        .object({
          twitchClientId: z.string().max(100).regex(/^[a-z0-9]*$/i, 'Ungültige Client-ID').optional(),
          twitchClientSecret: z.string().max(200).optional(),
          googleClientId: z.string().max(200).regex(/^[a-z0-9.\-_]*$/i, 'Ungültige Client-ID').optional(),
          googleClientSecret: z.string().max(200).optional(),
          giphyApiKey: z.string().max(100).regex(/^[A-Za-z0-9]*$/, 'Ungültiger GIPHY-Key').optional(),
        })
        .parse(req.body);
      saveApps(db, b);
      return appsView(db);
    });

    // ---------- Anmelden per Gerätecode ----------
    r.post<{ Params: { provider: string } }>('/api/connections/:provider/device', async (req, reply) => {
      const provider = req.params.provider;
      if (provider === 'twitch') {
        const tapp = twitchApp(db);
        if (!tapp.clientId) return reply.code(400).send({ error: 'Zuerst die Twitch-Client-ID unter „App-Zugangsdaten“ eintragen' });
        const start = await startTwitchDevice(tapp);
        return startFlow('twitch', start, (code) => pollTwitchDevice(tapp, code), saveTwitch);
      }
      if (provider === 'youtube') {
        const gapp = googleApp(db);
        if (!gapp.clientId || !gapp.clientSecret) return reply.code(400).send({ error: 'Zuerst Google-Client-ID und -Secret unter „App-Zugangsdaten“ eintragen' });
        const start = await startGoogleDevice(gapp);
        return startFlow('youtube', start, (code) => pollGoogleDevice(gapp, code), saveYouTube);
      }
      return reply.code(404).send({ error: 'Unbekannter Anbieter' });
    });

    r.get<{ Params: { id: string } }>('/api/connections/device/:id', async (req, reply) => {
      const f = getFlow(req.params.id);
      if (!f) return reply.code(404).send({ error: 'Anmeldung nicht gefunden' });
      return f;
    });

    r.delete<{ Params: { id: string } }>('/api/connections/device/:id', async (req) => {
      cancelFlow(req.params.id);
      return { ok: true };
    });

    r.post<{ Body: { input: string; label?: string } }>('/api/connections/betterplace', async (req, reply) => {
      const id = parseFundraisingEventId(String(req.body?.input ?? ''));
      if (!id) return reply.code(400).send({ error: 'Keine Spendenaktions-ID erkannt' });
      const data: BetterplaceConnectionData = { fundraisingEventId: id, seen: [], primed: false, webhookToken: randomKey(24) };
      const conn = { id: nanoid(10), platform: 'betterplace', label: req.body.label?.slice(0, 80) || `betterplace #${id}`, data: data as never, enabled: true };
      store.connections.save(db, conn);
      await connectors.restart(conn.id);
      return publicConnection(conn);
    });

    /** Webhook-URL für eine betterplace-Verbindung erzeugen bzw. erneuern; mode=poll schaltet zurück auf Abfrage */
    r.post<{ Params: { id: string }; Body: { action: 'rotate' | 'poll' } }>('/api/connections/:id/betterplace', async (req, reply) => {
      const c = store.connections.get<BetterplaceConnectionData>(db, req.params.id);
      if (!c || c.platform !== 'betterplace') return reply.code(404).send({ error: 'betterplace-Verbindung nicht gefunden' });
      if (req.body?.action === 'rotate') c.data = { ...c.data, webhookToken: randomKey(24) };
      if (req.body?.action === 'poll') c.data = { ...c.data, webhookSeenAt: undefined };
      store.connections.save(db, c);
      await connectors.restart(c.id);
      return publicConnection(c);
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
