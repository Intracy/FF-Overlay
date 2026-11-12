import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { normalizeSubscriber, normalizeYouTube } from '../src/connectors/youtube/normalize.js';
import { eventCatalogKey } from '../src/shared/catalog.js';
import { twitchApp, googleApp } from '../src/apps.js';
import type { AppContext } from '../src/context.js';

const author = { channelId: 'UC1', displayName: 'Anna', profileImageUrl: 'https://yt3.ggpht.com/a.jpg' };

describe('YouTube-Normalisierung', () => {
  it('Super Chat und Super Sticker', () => {
    const chat = normalizeYouTube({ id: 'm1', snippet: { type: 'superChatEvent', superChatDetails: { amountMicros: '5000000', currency: 'EUR', userComment: 'Hallo!', tier: 2 } }, authorDetails: author })!;
    expect(chat).toMatchObject({ id: 'yt_m1', platform: 'youtube', type: 'superchat', subtype: 'chat', amount: { value: 5, currency: 'EUR' }, message: 'Hallo!', user: { name: 'Anna' } });
    expect(eventCatalogKey(chat)).toBe('yt_superchat');
    const sticker = normalizeYouTube({ id: 'm2', snippet: { type: 'superStickerEvent', superStickerDetails: { amountMicros: '1990000', currency: 'USD', superStickerMetadata: { altText: 'Katze' } } }, authorDetails: author })!;
    expect(sticker).toMatchObject({ subtype: 'sticker', amount: { value: 1.99, currency: 'USD' }, product: 'Katze' });
    expect(eventCatalogKey(sticker)).toBe('yt_supersticker');
  });

  it('Mitgliedschaften und Abos', () => {
    const m = normalizeYouTube({ id: 'm3', snippet: { type: 'newSponsorEvent', newSponsorDetails: { memberLevelName: 'Gold', isUpgrade: false } }, authorDetails: author })!;
    expect(m).toMatchObject({ type: 'membership', subtype: 'new', tier: 'Gold' });
    const ms = normalizeYouTube({ id: 'm4', snippet: { type: 'memberMilestoneChatEvent', memberMilestoneChatDetails: { memberMonth: 12, userComment: 'Ein Jahr' } }, authorDetails: author })!;
    expect(ms).toMatchObject({ subtype: 'milestone', months: 12, message: 'Ein Jahr' });
    const g = normalizeYouTube({ id: 'm5', snippet: { type: 'membershipGiftingEvent', membershipGiftingDetails: { giftMembershipsCount: 5 } }, authorDetails: author })!;
    expect(g).toMatchObject({ subtype: 'gift', count: 5 });
    expect(eventCatalogKey(g)).toBe('yt_gift');
    expect(normalizeYouTube({ id: 'm6', snippet: { type: 'textMessageEvent', displayMessage: 'hi' }, authorDetails: author })).toBeNull();
    expect(normalizeSubscriber({ subscriberSnippet: { channelId: 'UC9', title: 'Ben' } })).toMatchObject({ id: 'ytsub_UC9', type: 'subscriber', user: { name: 'Ben' } });
  });
});

describe('App-Zugangsdaten und Gerätecode', () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  const realFetch = globalThis.fetch;
  beforeAll(async () => {
    config.adminPassword = '';
    config.twitch.clientId = '';
    ({ app, ctx } = await buildApp({ dbFile: ':memory:', logger: false }));
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await app.close();
    config.adminPassword = 'pw';
  });

  it('speichert Client-IDs, gibt Secrets nicht heraus', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/apps', payload: { twitchClientId: 'abc123', googleClientId: '1-x.apps.googleusercontent.com', googleClientSecret: 'GOCSPX-geheim' } });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toContain('geheim');
    expect(r.json().google.hasSecret).toBe(true);
    expect(twitchApp(ctx.db).clientId).toBe('abc123');
    expect(googleApp(ctx.db).clientSecret).toBe('GOCSPX-geheim');
    expect((await app.inject({ method: 'PUT', url: '/api/apps', payload: { twitchClientId: 'a b"<' } })).statusCode).toBe(400);
  });

  it('Twitch-Gerätecode: Code anzeigen, warten, verbinden', { timeout: 15_000 }, async () => {
    let polls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/oauth2/device')) return json(200, { device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH', expires_in: 1800, interval: 2 });
      if (u.endsWith('/oauth2/token')) return ++polls < 2 ? json(400, { status: 400, message: 'authorization_pending' }) : json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 14000, scope: ['bits:read'] });
      if (u.endsWith('/oauth2/validate')) return json(200, { user_id: '42', login: 'tobias', scopes: ['bits:read'] });
      return json(500, {});
    }) as typeof fetch;
    const start = await app.inject({ method: 'POST', url: '/api/connections/twitch/device' });
    expect(start.json()).toMatchObject({ userCode: 'ABCD-EFGH', status: 'pending' });
    // Intervall mindestens 2 s: nach zwei Abfragen (ausstehend, dann fertig) ist die Verbindung da
    let st = await app.inject({ method: 'GET', url: `/api/connections/device/${start.json().id}` });
    for (let i = 0; i < 30 && st.json().status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      st = await app.inject({ method: 'GET', url: `/api/connections/device/${start.json().id}` });
    }
    expect(st.json()).toMatchObject({ status: 'done', label: 'Twitch @tobias' });
    const conns = (await app.inject({ method: 'GET', url: '/api/connections' })).json();
    expect(conns.connections.find((c: { platform: string }) => c.platform === 'twitch').data.login).toBe('tobias');
    await ctx.connectors.stopAll();
  });
});
