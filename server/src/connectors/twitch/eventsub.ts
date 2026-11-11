import WebSocket from 'ws';
import type { DB } from '../../db.js';
import * as store from '../../db.js';
import { config } from '../../config.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import type { ConnectorStatus } from '../../shared/types.js';
import type { Connector, ConnectorEnv } from '../types.js';
import { refreshTokens, type TwitchTokens } from './auth.js';
import { normalizeTwitch, twitchSubscriptions } from './normalize.js';

export interface TwitchConnectionData {
  userId: string;
  login: string;
  accessToken: string; // verschlüsselt
  refreshToken: string; // verschlüsselt
  expiresAt: number;
  scopes: string[];
}

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';

/**
 * Twitch EventSub über WebSocket (passt zum Selbsthosting hinter NAT).
 * Ablauf: verbinden → session_welcome → Subscriptions anlegen → Notifications empfangen.
 * Reconnect: bei session_reconnect neue Verbindung öffnen, Welcome abwarten, dann alte schließen.
 */
export class TwitchConnector implements Connector {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private keepaliveMs = 40_000;
  private watchdog: NodeJS.Timeout | null = null;
  private retry = 0;
  private stopped = false;
  private seen = new Set<string>();
  private state: ConnectorStatus['state'] = 'disconnected';
  private detail = '';

  constructor(private db: DB, readonly id: string, private env: ConnectorEnv) {}

  private data() {
    return store.connections.get<TwitchConnectionData>(this.db, this.id)?.data;
  }

  status(): ConnectorStatus {
    const d = this.data();
    return { id: this.id, platform: 'twitch', label: d ? `Twitch @${d.login}` : 'Twitch', state: this.state, detail: this.detail };
  }

  private setState(state: ConnectorStatus['state'], detail = '') {
    this.state = state;
    this.detail = detail;
    this.env.onStatus();
  }

  async start() {
    this.stopped = false;
    if (!config.twitch.clientId) return this.setState('not_configured', 'TWITCH_CLIENT_ID fehlt');
    this.connect(EVENTSUB_URL, false);
  }

  stop() {
    this.stopped = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }

  /** Gültiges Access-Token holen, bei Bedarf erneuern. */
  async accessToken(): Promise<string> {
    const conn = store.connections.get<TwitchConnectionData>(this.db, this.id);
    if (!conn) throw new Error('Twitch-Verbindung fehlt');
    if (conn.data.expiresAt - Date.now() > 60_000) return decrypt(conn.data.accessToken);
    const t: TwitchTokens = await refreshTokens(decrypt(conn.data.refreshToken));
    conn.data = { ...conn.data, accessToken: encrypt(t.accessToken), refreshToken: encrypt(t.refreshToken), expiresAt: t.expiresAt, scopes: t.scopes };
    store.connections.save(this.db, conn);
    return t.accessToken;
  }

  private async helix(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await this.accessToken();
    const res = await fetch(`https://api.twitch.tv/helix${path}`, {
      ...init,
      headers: { 'Client-Id': config.twitch.clientId, Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    if (res.status === 401 && !retried) {
      const conn = store.connections.get<TwitchConnectionData>(this.db, this.id)!;
      conn.data.expiresAt = 0; // Refresh erzwingen
      store.connections.save(this.db, conn);
      return this.helix(path, init, true);
    }
    return res;
  }

  private connect(url: string, isReconnect: boolean) {
    if (this.stopped) return;
    this.setState('connecting');
    const previous = this.ws;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('message', (buf) => {
      this.kick();
      let msg: any;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      const type = msg?.metadata?.message_type;
      if (type === 'session_welcome') {
        this.sessionId = msg.payload.session.id;
        this.keepaliveMs = (msg.payload.session.keepalive_timeout_seconds ?? 30) * 1000 + 10_000;
        this.retry = 0;
        if (isReconnect && previous) {
          previous.removeAllListeners('close');
          previous.close();
          this.setState('connected');
        } else {
          void this.subscribeAll();
        }
      } else if (type === 'session_reconnect') {
        this.connect(msg.payload.session.reconnect_url, true);
      } else if (type === 'notification') {
        const id = msg.metadata.message_id as string;
        if (this.seen.has(id)) return;
        this.seen.add(id);
        if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
        const event = normalizeTwitch(msg.payload.subscription.type, msg.payload.event, id, msg.metadata.message_timestamp);
        if (event) this.env.emit(event);
      } else if (type === 'revocation') {
        this.setState('error', `Subscription widerrufen: ${msg.payload.subscription.type} (${msg.payload.subscription.status}) – bitte neu verbinden`);
      }
    });

    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      if (this.watchdog) clearTimeout(this.watchdog);
      if (this.stopped) return;
      this.setState('connecting', `Verbindung getrennt (${code}), neuer Versuch …`);
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(EVENTSUB_URL, false), delay);
    });

    ws.on('error', (err) => this.env.log.warn({ err: String(err) }, 'Twitch EventSub WebSocket-Fehler'));
  }

  /** Watchdog: kommt im Keepalive-Fenster nichts, gilt die Verbindung als tot. */
  private kick() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.env.log.warn({}, 'Twitch EventSub: Keepalive verpasst, verbinde neu');
      this.ws?.terminate();
    }, this.keepaliveMs);
  }

  private async subscribeAll() {
    const d = this.data();
    if (!d || !this.sessionId) return;
    const failures: string[] = [];
    for (const sub of twitchSubscriptions(d.userId)) {
      try {
        const res = await this.helix('/eventsub/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ ...sub, transport: { method: 'websocket', session_id: this.sessionId } }),
        });
        if (!res.ok && res.status !== 409) failures.push(`${sub.type}: ${res.status}`);
      } catch (err) {
        failures.push(`${sub.type}: ${String(err)}`);
      }
    }
    if (failures.length) {
      this.env.log.warn({ failures }, 'Twitch: einige Subscriptions fehlgeschlagen');
      this.setState('error', `Nicht abonniert: ${failures.join(', ')}`);
    } else {
      this.setState('connected');
    }
  }
}
