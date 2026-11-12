import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { DB } from '../db.js';
import * as store from '../db.js';
import type { ConnectorStatus, NormalizedEvent } from '../shared/types.js';
import type { Connector, ConnectorEnv } from './types.js';
import type { BpDonation } from '../shared/bpWidgets.js';

/** Offizielle Zahlen der Spendenaktion (Public API v4) */
export interface BetterplaceStats {
  title: string;
  /** Spendenstand in € */
  total: number;
  count: number;
  donors: number;
  /** Zielbetrag in € oder null */
  target: number | null;
  closed: boolean;
  /** Organisationen der unterstützten Projekte mit Logo */
  logos: Array<{ name: string; url: string }>;
  fetchedAt: string;
}

export interface BetterplaceConnectionData {
  fundraisingEventId: string;
  /** IDs bereits gesehener Spenden (die neuesten 500) */
  seen: number[];
  primed: boolean;
  /** Token für die Webhook-URL /hooks/<token> (bei betterplace unter „Spenden-Webhook“ eintragen) */
  webhookToken?: string;
  /** Zeitpunkt der letzten Webhook-Spende; ab dann kommen Spenden nur noch per Webhook (keine Doppelten) */
  webhookSeenAt?: string;
  stats?: BetterplaceStats;
  /** Die letzten 50 Spenden laut API (für Top-Listen inkl. Spenden vor dem Verbinden) */
  recent?: BpDonation[];
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

/**
 * Spenden-Webhook von betterplace (Live-Widgets → „Spenden-Webhook“), Format laut betterplace:
 * {"event_name":"donation_announced","event_version":"0.2","donation":{"sequence_number":1,"amount_in_cents":2000,
 *  "receiver":"f111","comment":"have fun","donor_display_name":"Donald Duck",
 *  "streaming_shareable_media":{"video_link":"https://youtu.be/…","video_start_time":3}}}
 * Betrag, Kommentar und Name können auf Wunsch der Spender*innen leer sein.
 */
export const betterplaceWebhookBody = z.object({
  event_name: z.literal('donation_announced'),
  event_version: z.string().max(20).optional(),
  donation: z.object({
    sequence_number: z.coerce.number().int().optional(),
    amount_in_cents: z.coerce.number().int().nullable().optional(),
    receiver: z.string().max(100).nullable().optional(),
    comment: z.string().max(5000).nullable().optional(),
    donor_display_name: z.string().max(200).nullable().optional(),
    streaming_shareable_media: z
      .object({ video_link: z.string().max(500).nullable().optional(), video_start_time: z.coerce.number().nullable().optional() })
      .nullable()
      .optional(),
  }),
});

export type BetterplaceWebhookBody = z.infer<typeof betterplaceWebhookBody>;

export const isBetterplaceWebhook = (body: unknown) =>
  !!body && typeof body === 'object' && (body as { event_name?: unknown }).event_name === 'donation_announced';

export function normalizeBetterplaceWebhook(body: BetterplaceWebhookBody, connectionId: string): NormalizedEvent {
  const d = body.donation;
  const name = d.donor_display_name?.trim();
  const media = d.streaming_shareable_media;
  return {
    id: `bpwh_${connectionId}_${d.sequence_number ?? nanoid(10)}`,
    platform: 'betterplace',
    type: 'donation',
    user: { name: name || 'Anonym' },
    isAnonymous: !name,
    amount: d.amount_in_cents != null ? { value: d.amount_in_cents / 100, currency: 'EUR' } : undefined,
    message: d.comment?.trim() || undefined,
    media: media?.video_link && /^https:\/\//.test(media.video_link) ? { videoUrl: media.video_link, videoStart: media.video_start_time ?? 0 } : undefined,
    receivedAt: new Date().toISOString(),
    raw: body,
  };
}

export function opinionToDonation(o: Opinion, eventId: string): BpDonation {
  return {
    id: `bp_${eventId}_${o.id}`, name: o.author?.name || 'Anonym', amount: o.donated_amount_in_cents != null ? o.donated_amount_in_cents / 100 : null,
    comment: o.message?.trim() ?? '', at: o.confirmed_at, isTest: false,
  };
}

/** Spendenstand, Logos und letzte Spenden der ersten aktiven betterplace-Verbindung */
export function betterplaceSource(db: DB): { stats: BetterplaceStats | null; recent: BpDonation[] } {
  const c = (store.connections.list(db) as Array<store.ConnectionRow<BetterplaceConnectionData>>).find((x) => x.platform === 'betterplace' && x.enabled);
  return { stats: c?.data.stats ?? null, recent: c?.data.recent ?? [] };
}

/** Extrahiert die ID aus einer ID oder einem Link wie https://www.betterplace.org/de/fundraising-events/12345-titel */
export function parseFundraisingEventId(input: string): string | null {
  const m = input.trim().match(/(?:fundraising-events\/)?(\d+)/);
  return m ? m[1]! : null;
}

interface ApiEvent {
  title: string;
  donated_amount_in_cents: number | null;
  donations_count: number | null;
  donor_count: number | null;
  requested_amount_in_cents: number | null;
  closed_at: string | null;
}

interface ApiProject {
  title: string;
  carrier?: { name?: string; picture?: { links?: Array<{ rel: string; href: string }> } } | null;
}

const API = 'https://api.betterplace.org/de/api_v4';

/** Rechnet die API-Antworten in unsere Statistik um (rein, testbar). */
export function toStats(ev: ApiEvent, projects: ApiProject[]): BetterplaceStats {
  const logos = projects
    .map((p) => {
      const links = p.carrier?.picture?.links ?? [];
      const url = links.find((l) => l.rel === 'original')?.href ?? links.find((l) => l.rel === 'fill_100x100')?.href;
      return url && !/\/default\//.test(url) ? { name: p.carrier?.name ?? p.title, url } : null;
    })
    .filter((x): x is { name: string; url: string } => !!x);
  return {
    title: ev.title,
    total: (ev.donated_amount_in_cents ?? 0) / 100,
    count: ev.donations_count ?? 0,
    donors: ev.donor_count ?? 0,
    target: ev.requested_amount_in_cents ? ev.requested_amount_in_cents / 100 : null,
    closed: !!ev.closed_at,
    logos,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Pollt die Public API v4 von betterplace. Die Doku bittet, aggressives Polling zu vermeiden:
 * Intervall ≥ 15 s, ETag/304 und Duplikat-Filter über die Spenden-ID.
 * Beim ersten Lauf werden vorhandene Spenden nur gemerkt, nicht als Alert ausgespielt.
 * Kommt der Spenden-Webhook an, liefert er die Spenden (sofort); das Polling holt dann nur noch Spendenstand, Ziel und Logos.
 */
export class BetterplaceConnector implements Connector {
  private timer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private etag: string | null = null;
  private lastStats = 0;
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

  private describe(conn: { data: BetterplaceConnectionData }) {
    const s = conn.data.stats;
    const parts = [`Spendenaktion ${conn.data.fundraisingEventId}`];
    if (s) parts.push(`${s.total.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} von ${s.count} Spenden${s.closed ? ' · Aktion geschlossen' : ''}`);
    parts.push(conn.data.webhookSeenAt ? 'Spenden per Webhook' : 'Spenden per Abfrage');
    return parts.join(' · ');
  }

  start() {
    this.stop();
    this.setState('connecting');
    void this.poll();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.statsTimer) clearTimeout(this.statsTimer);
    this.timer = null;
    this.statsTimer = null;
  }

  /** Nach einer Webhook-Spende den Spendenstand zeitnah neu holen (gebündelt). */
  refreshStatsSoon() {
    if (this.statsTimer) return;
    this.statsTimer = setTimeout(() => {
      this.statsTimer = null;
      void this.fetchStats(true);
    }, 4000);
  }

  async fetchStats(force = false) {
    const conn = this.conn();
    if (!conn) return;
    // Spendenstand höchstens jede Minute, außer nach einer neuen Spende
    if (!force && Date.now() - this.lastStats < 60_000) return;
    this.lastStats = Date.now();
    const id = encodeURIComponent(conn.data.fundraisingEventId);
    try {
      const [evRes, prRes] = await Promise.all([fetch(`${API}/fundraising_events/${id}.json`), fetch(`${API}/fundraising_events/${id}/featured_projects.json?per_page=20`)]);
      if (!evRes.ok) return;
      const ev = (await evRes.json()) as ApiEvent;
      const projects = prRes.ok ? ((await prRes.json()) as { data: ApiProject[] }).data : [];
      const fresh = this.conn();
      if (!fresh) return;
      fresh.data = { ...fresh.data, stats: toStats(ev, projects) };
      store.connections.save(this.db, fresh);
      this.env.onBetterplaceStats?.();
      this.setState('connected', this.describe(fresh));
    } catch (err) {
      this.env.log.warn({ err }, 'betterplace: Spendenstand nicht abrufbar');
    }
  }

  async poll() {
    const conn = this.conn();
    if (!conn) return;
    const id = conn.data.fundraisingEventId;
    const url = `${API}/fundraising_events/${encodeURIComponent(id)}/opinions.json?order=confirmed_at:DESC&per_page=50`;
    try {
      const res = await fetch(url, { headers: this.etag ? { 'If-None-Match': this.etag } : {} });
      if (res.status === 304) {
        this.setState('connected', this.describe(conn));
      } else if (!res.ok) {
        this.setState('error', `HTTP ${res.status}`);
      } else {
        this.etag = res.headers.get('etag');
        const body = (await res.json()) as { data: Opinion[] };
        const seen = new Set(conn.data.seen);
        const fresh = body.data.filter((o) => !seen.has(o.id)).reverse(); // älteste zuerst
        // Läuft der Webhook, kommen Spenden von dort – hier nur noch merken, damit nichts doppelt kommt
        if (conn.data.primed && !conn.data.webhookSeenAt) for (const o of fresh) this.env.emit(normalizeOpinion(o, id));
        conn.data = {
          ...conn.data, primed: true, seen: [...body.data.map((o) => o.id), ...conn.data.seen].slice(0, 500),
          recent: body.data.map((o) => opinionToDonation(o, id)),
        };
        store.connections.save(this.db, conn);
        this.setState('connected', this.describe(conn));
        if (fresh.length) this.lastStats = 0;
      }
      await this.fetchStats();
    } catch (err) {
      this.setState('error', String(err));
    }
    this.timer = setTimeout(() => void this.poll(), Math.max(15, this.intervalSec) * 1000);
  }
}
