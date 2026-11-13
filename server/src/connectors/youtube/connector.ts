import type { DB } from '../../db.js';
import * as store from '../../db.js';
import { config } from '../../config.js';
import { googleApp } from '../../apps.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import type { ConnectorStatus } from '../../shared/types.js';
import type { Connector, ConnectorEnv } from '../types.js';
import { refreshGoogle } from './auth.js';
import { normalizeSubscriber, normalizeYouTube, normalizeYouTubeChat, youTubeChatRemoval, type YtChatMessage, type YtSubscriber } from './normalize.js';

export interface YouTubeConnectionData {
  channelId: string;
  title: string;
  accessToken: string; // verschlüsselt
  refreshToken: string; // verschlüsselt
  expiresAt: number;
  clientId: string;
  /** zuletzt gesehene Abonnent:innen (Kanal-IDs), damit nichts doppelt kommt */
  seenSubscribers: string[];
  subscribersPrimed: boolean;
}

const API = 'https://www.googleapis.com/youtube/v3';

class ApiError extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) {
    super(message);
  }
}

/**
 * YouTube-Live über die Data API v3 (kein Webhook/WebSocket für Super Chats verfügbar):
 * – jede Minute: läuft gerade ein Livestream? (liveBroadcasts, 1 Einheit)
 * – während des Streams: Live-Chat abfragen (5 Einheiten), Tempo laut pollingIntervalMillis, mind. YOUTUBE_CHAT_POLL_SECONDS
 * – alle 2 Minuten: neue öffentliche Abos (subscriptions?myRecentSubscribers, 1 Einheit)
 * Beim Start werden vorhandene Nachrichten und Abos nur gemerkt, nicht als Alert ausgespielt.
 */
export class YouTubeConnector implements Connector {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private state: ConnectorStatus['state'] = 'disconnected';
  private detail = '';
  private liveChatId: string | null = null;
  private pageToken: string | null = null;
  private chatPrimed = false;
  private nextBroadcastCheck = 0;
  private nextSubscriberCheck = 0;

  constructor(private db: DB, readonly id: string, private env: ConnectorEnv) {}

  private conn() {
    return store.connections.get<YouTubeConnectionData>(this.db, this.id);
  }

  status(): ConnectorStatus {
    const c = this.conn();
    return { id: this.id, platform: 'youtube', label: c ? `YouTube ${c.data.title}` : 'YouTube', state: this.state, detail: this.detail };
  }

  private setState(state: ConnectorStatus['state'], detail = '') {
    if (state === this.state && detail === this.detail) return;
    this.state = state;
    this.detail = detail;
    this.env.onStatus();
  }

  private app() {
    const current = googleApp(this.db);
    const id = this.conn()?.data.clientId ?? current.clientId;
    return { clientId: id, clientSecret: id === current.clientId ? current.clientSecret : '' };
  }

  start() {
    this.stopped = false;
    if (!this.app().clientId) return this.setState('not_configured', 'Google-App fehlt (Verbindungen → App-Zugangsdaten)');
    this.setState('connecting');
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setState('disconnected');
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  async accessToken(): Promise<string> {
    const conn = this.conn();
    if (!conn) throw new Error('YouTube-Verbindung fehlt');
    if (conn.data.expiresAt - Date.now() > 60_000) return decrypt(conn.data.accessToken);
    const t = await refreshGoogle(this.app(), decrypt(conn.data.refreshToken));
    conn.data = { ...conn.data, accessToken: encrypt(t.accessToken), refreshToken: encrypt(t.refreshToken), expiresAt: t.expiresAt };
    store.connections.save(this.db, conn);
    return t.accessToken;
  }

  private async api<T>(path: string): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
      const reason = body.error?.errors?.[0]?.reason ?? '';
      throw new ApiError(res.status, reason, body.error?.message ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async tick() {
    let wait = 60_000;
    try {
      const now = Date.now();
      if (now >= this.nextBroadcastCheck) {
        this.nextBroadcastCheck = now + (this.liveChatId ? 120_000 : 60_000);
        await this.checkBroadcast();
      }
      if (now >= this.nextSubscriberCheck) {
        this.nextSubscriberCheck = now + 120_000;
        await this.checkSubscribers();
      }
      if (this.liveChatId) wait = await this.pollChat();
      else wait = Math.max(1000, Math.min(this.nextBroadcastCheck, this.nextSubscriberCheck) - Date.now());
      this.setState('connected', this.liveChatId ? `${this.conn()?.data.title}: live – Chat wird gelesen` : `${this.conn()?.data.title}: wartet auf Livestream`);
    } catch (err) {
      if (err instanceof ApiError && (err.reason === 'quotaExceeded' || err.reason === 'rateLimitExceeded')) {
        this.setState('error', 'YouTube-Kontingent für heute aufgebraucht – Abfrage pausiert (siehe README)');
        wait = 15 * 60_000;
      } else if (err instanceof ApiError && (err.reason === 'liveChatEnded' || err.reason === 'liveChatNotFound' || err.reason === 'liveChatDisabled')) {
        this.endChat();
        wait = 5_000;
      } else {
        this.setState('error', String(err instanceof Error ? err.message : err));
        wait = 60_000;
      }
      this.env.log.warn({ err }, 'YouTube');
    }
    this.schedule(wait);
  }

  private async checkBroadcast() {
    const j = await this.api<{ items?: Array<{ id: string; snippet: { liveChatId?: string; title: string } }> }>(
      '/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&maxResults=5',
    );
    const live = j.items?.find((b) => b.snippet.liveChatId);
    if (live && live.snippet.liveChatId !== this.liveChatId) {
      this.liveChatId = live.snippet.liveChatId!;
      this.pageToken = null;
      this.chatPrimed = false;
      this.env.emit({ id: `yt_online_${live.id}`, platform: 'youtube', type: 'stream_status', subtype: 'online', user: { name: this.conn()?.data.title ?? 'YouTube' }, receivedAt: new Date().toISOString() });
    } else if (!live && this.liveChatId) this.endChat();
  }

  private endChat() {
    if (!this.liveChatId) return;
    this.env.emit({ id: `yt_offline_${this.liveChatId}_${Date.now()}`, platform: 'youtube', type: 'stream_status', subtype: 'offline', user: { name: this.conn()?.data.title ?? 'YouTube' }, receivedAt: new Date().toISOString() });
    this.liveChatId = null;
    this.pageToken = null;
  }

  /** Liest neue Chat-Nachrichten; gibt die Wartezeit bis zur nächsten Abfrage zurück. */
  private async pollChat(): Promise<number> {
    const q = new URLSearchParams({ liveChatId: this.liveChatId!, part: 'snippet,authorDetails', maxResults: '2000' });
    if (this.pageToken) q.set('pageToken', this.pageToken);
    const j = await this.api<{ items: YtChatMessage[]; nextPageToken: string; pollingIntervalMillis: number; offlineAt?: string }>(`/liveChat/messages?${q}`);
    this.pageToken = j.nextPageToken;
    if (this.chatPrimed) {
      for (const m of j.items) {
        const e = normalizeYouTube(m);
        if (e) this.env.emit(e);
      }
    }
    // Chat-Overlay: beim ersten Abruf die letzten 20 Nachrichten als Verlauf, danach alles Neue
    for (const m of this.chatPrimed ? j.items : j.items.slice(-20)) {
      const removal = youTubeChatRemoval(m);
      if (removal) this.env.chatRemove?.(removal);
      else {
        const c = normalizeYouTubeChat(m);
        if (c) this.env.chat?.(c);
      }
    }
    this.chatPrimed = true;
    if (j.offlineAt) this.endChat();
    return Math.max(j.pollingIntervalMillis ?? 5000, config.youtubeChatPollSeconds * 1000);
  }

  private async checkSubscribers() {
    const conn = this.conn();
    if (!conn) return;
    const j = await this.api<{ items?: YtSubscriber[] }>('/subscriptions?part=subscriberSnippet&myRecentSubscribers=true&maxResults=50');
    const items = j.items ?? [];
    const seen = new Set(conn.data.seenSubscribers ?? []);
    const fresh = items.filter((s) => !seen.has(s.subscriberSnippet.channelId)).reverse(); // älteste zuerst
    if (conn.data.subscribersPrimed) for (const s of fresh) this.env.emit(normalizeSubscriber(s));
    conn.data = {
      ...conn.data,
      subscribersPrimed: true,
      seenSubscribers: [...items.map((s) => s.subscriberSnippet.channelId), ...(conn.data.seenSubscribers ?? [])].filter((v, i, a) => a.indexOf(v) === i).slice(0, 500),
    };
    store.connections.save(this.db, conn);
  }
}
