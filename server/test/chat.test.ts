import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { normalizeTwitchChat, twitchChatSubscriptions, TWITCH_SCOPES } from '../src/connectors/twitch/normalize.js';
import { normalizeYouTubeChat, youTubeChatRemoval } from '../src/connectors/youtube/normalize.js';
import { chatDefaults, chatVisible, sampleChatMessage, type ChatMessage } from '../src/shared/chat.js';
import { filterChat } from '../src/chat/service.js';
import { mergeSettings } from '../src/widgets/schemas.js';
import * as store from '../src/db.js';

describe('Chat: Twitch', () => {
  const event = {
    broadcaster_user_id: '1', chatter_user_id: '42', chatter_user_login: 'pixelpaula', chatter_user_name: 'PixelPaula',
    message_id: 'abc', color: '#FF7AD9', message_type: 'text',
    message: { text: 'Hallo Kappa @rubber_duck', fragments: [{ type: 'text', text: 'Hallo ' }, { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } }, { type: 'text', text: ' ' }, { type: 'mention', text: '@rubber_duck' }] },
    badges: [{ set_id: 'moderator', id: '1', info: '' }, { set_id: 'subscriber', id: '12', info: '14' }],
    cheer: null,
  };

  it('übersetzt channel.chat.message mit Emotes, Rollen und Badges', () => {
    const m = normalizeTwitchChat(event, (set, id) => (set === 'moderator' ? { url: `https://badge/${set}/${id}`, title: 'Moderator' } : undefined))!;
    expect(m.id).toBe('twc_abc');
    expect(m.user).toEqual({ id: '42', name: 'PixelPaula', color: '#FF7AD9' });
    expect(m.parts).toEqual([{ text: 'Hallo ' }, { emote: '25', name: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/2.0' }, { text: ' @rubber_duck' }]);
    expect(m.roles).toEqual(['moderator', 'subscriber']);
    expect(m.badges[0]).toEqual({ id: 'moderator/1', title: 'Moderator', url: 'https://badge/moderator/1' });
    expect(m.badges[1]!.url).toBeUndefined();
  });

  it('erkennt Bits und /me', () => {
    const m = normalizeTwitchChat({ ...event, message_type: 'action', cheer: { bits: 100 } })!;
    expect(m.amount).toBe('100 Bits');
    expect(m.action).toBe(true);
  });

  it('abonniert den Chat mit eigener Berechtigung', () => {
    expect(TWITCH_SCOPES).toContain('user:read:chat');
    expect(twitchChatSubscriptions('1').map((s) => s.type)).toEqual(['channel.chat.message', 'channel.chat.message_delete', 'channel.chat.clear', 'channel.chat.clear_user_messages']);
    expect(twitchChatSubscriptions('1')[0]!.condition).toEqual({ broadcaster_user_id: '1', user_id: '1' });
  });
});

describe('Chat: YouTube', () => {
  const author = { channelId: 'UC1', displayName: 'Kaffeekobold', profileImageUrl: 'https://yt3/x.jpg', isChatModerator: true, isChatSponsor: true };
  it('übersetzt textMessageEvent und Super Chats', () => {
    const m = normalizeYouTubeChat({ id: 'm1', snippet: { type: 'textMessageEvent', textMessageDetails: { messageText: 'Hallo 👋' } }, authorDetails: author })!;
    expect(m).toMatchObject({ id: 'ytc_m1', platform: 'youtube', text: 'Hallo 👋', roles: ['moderator', 'member'], user: { name: 'Kaffeekobold', avatar: 'https://yt3/x.jpg' } });
    const sc = normalizeYouTubeChat({ id: 'm2', snippet: { type: 'superChatEvent', superChatDetails: { amountMicros: '5000000', currency: 'EUR', amountDisplayString: '5,00 €', userComment: 'Danke!' } }, authorDetails: author })!;
    expect(sc.amount).toBe('5,00 €');
    expect(normalizeYouTubeChat({ id: 'm3', snippet: { type: 'newSponsorEvent' }, authorDetails: author })).toBeNull();
  });
  it('entfernt gelöschte Nachrichten und gebannte Nutzer', () => {
    expect(youTubeChatRemoval({ id: 'x', snippet: { type: 'messageDeletedEvent', messageDeletedDetails: { deletedMessageId: 'm1' } } })).toEqual({ ids: ['ytc_m1'] });
    expect(youTubeChatRemoval({ id: 'y', snippet: { type: 'userBannedEvent', userBannedDetails: { bannedUserDetails: { channelId: 'UC1' } } } })).toEqual({ userId: 'UC1', platform: 'youtube' });
  });
});

describe('Chat: Filter', () => {
  const msg = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ ...sampleChatMessage(0), parts: [{ text }], text, ...extra });
  it('Quellen, Befehle, Links, Bots', () => {
    const s = chatDefaults();
    expect(chatVisible(s, msg('Hallo'))).toBe(true);
    expect(chatVisible(s, msg('!discord'))).toBe(false);
    expect(chatVisible({ ...s, hideLinks: true }, msg('schau auf example.com'))).toBe(false);
    expect(chatVisible(s, msg('Hi', { user: { name: 'Nightbot' } }))).toBe(false);
    expect(chatVisible({ ...s, sources: { twitch: false, youtube: true } }, msg('Hi', { platform: 'twitch' }))).toBe(false);
    expect(chatVisible({ ...s, showHighlights: false }, msg('Hi', { amount: '100 Bits' }))).toBe(false);
  });
  it('Sperrliste und Schimpfwörter wie bei den Alerts', () => {
    const base = { blockedUsers: ['Troll'], badWords: ['doof'], badWordMode: 'censor', useDefaultBadWords: false, anonymizeNames: false } as never;
    expect(filterChat(msg('Hi', { user: { name: 'troll' } }), base)).toBeNull();
    const c = filterChat(msg('du bist doof'), base)!;
    expect(c.text).toBe('du bist ****');
    expect(c.parts).toEqual([{ text: 'du bist ****' }]);
    expect(filterChat(msg('du bist doof'), { ...(base as object), badWordMode: 'hide' } as never)).toBeNull();
  });
  it('validiert die Einstellungen', () => {
    expect(() => mergeSettings('chat', chatDefaults(), { theme: 'neon', background: { opacity: 50 } })).not.toThrow();
    expect(() => mergeSettings('chat', chatDefaults(), { sound: { url: 'javascript:alert(1)' } })).toThrow();
  });
});

describe('Chat: API und Browserquelle', () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  beforeAll(async () => {
    config.appSecret = 'test-secret-test-secret-test-secret';
    config.adminPassword = '';
    ({ app, ctx } = await buildApp({ dbFile: ':memory:', logger: false }));
    await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('schickt Nachrichten an das Chat-Overlay und entfernt sie wieder', async () => {
    const w = (await app.inject({ method: 'POST', url: '/api/widgets', payload: { type: 'chat' } })).json();
    expect(w.type).toBe('chat');
    const key = store.widgets.get(ctx.db, w.id)!.key;
    const addr = app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/widget/${w.id}?key=${key}`);
    const got: any[] = [];
    ws.on('message', (b) => got.push(JSON.parse(b.toString())));
    await new Promise((r) => ws.once('open', r));
    await new Promise((r) => setTimeout(r, 50));
    expect(got[0]).toMatchObject({ t: 'snapshot', data: { type: 'chat', messages: [], preview: false } });

    const m = sampleChatMessage(0);
    ctx.chat.ingest(m);
    ctx.chat.ingest(m); // doppelt → nur einmal
    await new Promise((r) => setTimeout(r, 50));
    expect(got.filter((x) => x.t === 'chat.message')).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/chat' })).json().map((x: ChatMessage) => x.id)).toEqual([m.id]);

    expect((await app.inject({ method: 'POST', url: '/api/chat/remove', payload: { ids: [m.id] } })).json()).toEqual({ removed: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(got.at(-1)).toEqual({ t: 'chat.remove', removal: { ids: [m.id] } });
    expect((await app.inject({ method: 'POST', url: '/api/chat/remove', payload: {} })).statusCode).toBe(400);
    ws.close();
  });

  it('zeigt mit &preview=1 Beispielnachrichten', async () => {
    const w = (await app.inject({ method: 'GET', url: '/api/widgets' })).json().find((x: { type: string }) => x.type === 'chat');
    const snap = ctx.widgets.snapshot(store.widgets.get(ctx.db, w.id)!, true);
    expect(snap.data).toMatchObject({ type: 'chat', preview: true });
    expect((snap.data as { messages: unknown[] }).messages.length).toBeGreaterThan(3);
  });
});
