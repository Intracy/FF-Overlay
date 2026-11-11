import type { DB } from '../db.js';
import * as store from '../db.js';
import type { ConnectorStatus, NormalizedEvent } from '../shared/types.js';
import type { Connector, ConnectorEnv } from './types.js';

export interface BetterplaceConnectionData {
  fundraisingEventId: string;
  /** IDs bereits gesehener Spenden (die neuesten 500) */
  seen: number[];
  primed: boolean;
}

interface Opinion {
  id: number;
  donated_amount_in_cents: number | null;
  author: { name: string | null } | null;
  message: string | null;
  confirmed_at: string;
}

/** Normalisiert eine betterplace-„Opinion“ (Spende) – siehe sections/opinions_list.md der API-Doku. */
export function normalizeOpinion(o: Opinion, eventId: string): NormalizedEvent {
  const anonymous = !o.author?.name;
  return {
    id: `bp_${eventId}_${o.id}`,
    platform: 'betterplace',
    type: 'donation',
    user: { name: o.author?.name || 'Anonym' },
    isAnonymous: anonymous,
    amount: o.donated_amount_in_cents != null ? { value: o.donated_amount_in_cents / 100, currency: 'EUR' } : undefined,
    message: o.message?.trim() || undefined,
    receivedAt: new Date().toISOString(),
    raw: o,
  };
}

/** Extrahiert die ID aus einer ID oder einem Link wie https://www.betterplace.org/de/fundraising-events/12345-titel */
export function parseFundraisingEventId(input: string): string | null {
  const m = input.trim().match(/(?:fundraising-events\/)?(\d+)/);
  return m ? m[1]! : null;
}

/**
 * Pollt die Public API v4 von betterplace. Die Doku bittet, aggressives Polling zu vermeiden:
 * Intervall ≥ 15 s, ETag/304 und Duplikat-Filter über die Spenden-ID.
 * Beim ersten Lauf werden vorhandene Spenden nur gemerkt, nicht als Alert ausgespielt.
 */
export class BetterplaceConnector implements Connector {
  private timer: NodeJS.Timeout | null = null;
  private etag: string | null = null;
  private state: ConnectorStatus['state'] = 'disconnected';
  private detail = '';

  constructor(private db: DB, readonly id: string, private env: ConnectorEnv, private intervalSec: number) {}

  private conn() {
    return store.connections.get<BetterplaceConnectionData>(this.db, this.id);
  }

  status(): ConnectorStatus {
    const c = this.conn();
    return { id: this.id, platform: 'betterplace', label: c?.label ?? 'betterplace', state: this.state, detail: this.detail };
  }

  private setState(state: ConnectorStatus['state'], detail = '') {
    this.state = state;
    this.detail = detail;
    this.env.onStatus();
  }

  start() {
    this.stop();
    this.setState('connecting');
    void this.poll();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async poll() {
    const conn = this.conn();
    if (!conn) return;
    const id = conn.data.fundraisingEventId;
    const url = `https://api.betterplace.org/de/api_v4/fundraising_events/${encodeURIComponent(id)}/opinions.json?order=confirmed_at:DESC&per_page=50`;
    try {
      const res = await fetch(url, { headers: this.etag ? { 'If-None-Match': this.etag } : {} });
      if (res.status === 304) {
        this.setState('connected', `Spendenaktion ${id}`);
      } else if (!res.ok) {
        this.setState('error', `HTTP ${res.status}`);
      } else {
        this.etag = res.headers.get('etag');
        const body = (await res.json()) as { data: Opinion[] };
        const seen = new Set(conn.data.seen);
        const fresh = body.data.filter((o) => !seen.has(o.id)).reverse(); // älteste zuerst
        if (conn.data.primed) for (const o of fresh) this.env.emit(normalizeOpinion(o, id));
        conn.data = { ...conn.data, primed: true, seen: [...body.data.map((o) => o.id), ...conn.data.seen].slice(0, 500) };
        store.connections.save(this.db, conn);
        this.setState('connected', `Spendenaktion ${id}`);
      }
    } catch (err) {
      this.setState('error', String(err));
    }
    this.timer = setTimeout(() => void this.poll(), Math.max(15, this.intervalSec) * 1000);
  }
}
