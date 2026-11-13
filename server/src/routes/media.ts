import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
import { giphyKey } from '../apps.js';
import { requireAuth } from './auth.js';

const ALLOWED: Record<string, { ext: string; kind: 'image' | 'video' | 'audio' }> = {
  'image/gif': { ext: '.gif', kind: 'image' },
  'image/png': { ext: '.png', kind: 'image' },
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/webp': { ext: '.webp', kind: 'image' },
  'image/apng': { ext: '.apng', kind: 'image' },
  'video/webm': { ext: '.webm', kind: 'video' },
  'video/mp4': { ext: '.mp4', kind: 'video' },
  'audio/mpeg': { ext: '.mp3', kind: 'audio' },
  'audio/ogg': { ext: '.ogg', kind: 'audio' },
  'audio/wav': { ext: '.wav', kind: 'audio' },
  'audio/x-wav': { ext: '.wav', kind: 'audio' },
  'audio/webm': { ext: '.weba', kind: 'audio' },
};

interface GiphyItem {
  id: string;
  title: string;
  images: Record<string, { url?: string; webp?: string; mp4?: string; width?: string; height?: string }>;
}

/** Reduziert ein GIPHY-Objekt auf das, was Picker und Overlay brauchen. */
function mapGiphy(g: GiphyItem) {
  const original = g.images.original ?? {};
  const preview = g.images.fixed_width ?? g.images.fixed_width_downsampled ?? original;
  return {
    id: g.id,
    title: g.title,
    preview: preview.webp || preview.url || '',
    // WebP behält Transparenz (wichtig für Sticker) und ist kleiner als GIF
    url: original.webp || original.url || '',
    width: Number(original.width ?? 0),
    height: Number(original.height ?? 0),
  };
}

interface MyInstant {
  name: string;
  slug: string;
  sound: string;
  color?: string;
  description?: string;
  tags?: string;
}

/** MP3 erkennen: ID3-Tag oder MPEG-Frame-Sync */
export const looksLikeMp3 = (b: Buffer) => b.length > 4 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0));

/** Nur MP3s direkt von myinstants.com zulassen (kein beliebiger Download über den Server) */
export function isMyInstantsSound(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^(www\.)?myinstants\.com$/.test(u.hostname) && u.pathname.startsWith('/media/sounds/') && u.pathname.endsWith('.mp3');
  } catch {
    return false;
  }
}

export async function mediaRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  fs.mkdirSync(config.mediaDir, { recursive: true });
  app.addHook('preHandler', requireAuth);

  app.get('/api/media', async () => store.media.list(db));

  app.post('/api/media/upload', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 50 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'Keine Datei' });
    const type = ALLOWED[file.mimetype];
    if (!type) return reply.code(415).send({ error: `Dateityp ${file.mimetype} nicht erlaubt` });
    const name = `${nanoid(16)}${type.ext}`;
    await streamPipeline(file.file, fs.createWriteStream(path.join(config.mediaDir, name)));
    if (file.file.truncated) {
      fs.rmSync(path.join(config.mediaDir, name), { force: true });
      return reply.code(413).send({ error: 'Datei größer als 50 MB' });
    }
    return store.media.add(db, { name: file.filename.slice(0, 120), kind: type.kind, url: `/media/${name}`, source: 'upload' });
  });

  app.post('/api/media/giphy', async (req) => {
    const b = z.object({ id: z.string().max(100), title: z.string().max(200), url: z.string().url().startsWith('https://') }).parse(req.body);
    const existing = store.media.list(db).find((m) => m.giphyId === b.id);
    return existing ?? store.media.add(db, { name: b.title || 'GIPHY', kind: 'image', url: b.url, source: 'giphy', giphyId: b.id });
  });

  // ---------- MyInstants (Sound-Buttons) ----------
  // Suche über die öffentliche API (https://www.myinstants.com/api/v1/), 10 Treffer pro Seite.
  app.get<{ Querystring: { q?: string; page?: string } }>('/api/myinstants/search', async (req, reply) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    const page = Math.max(1, Math.min(500, Number(req.query.page) || 1));
    const u = new URL('https://www.myinstants.com/api/v1/instants/');
    u.searchParams.set('name', q);
    u.searchParams.set('page', String(page));
    u.searchParams.set('format', 'json');
    let res: Response;
    try {
      res = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': 'FF-Overlay (self-hosted stream alerts)' }, signal: AbortSignal.timeout(10_000) });
    } catch {
      return reply.code(502).send({ error: 'MyInstants ist nicht erreichbar' });
    }
    if (res.status === 404) return { items: [], count: 0, page, hasMore: false };
    if (!res.ok) return reply.code(502).send({ error: `MyInstants antwortet mit ${res.status}` });
    const j = (await res.json()) as { count: number; next: string | null; results: MyInstant[] };
    const items = (j.results ?? []).filter((r) => isMyInstantsSound(r.sound)).map((r) => ({
      slug: r.slug, name: r.name, sound: r.sound, color: /^[0-9a-f]{6}$/i.test(r.color ?? '') ? `#${r.color}` : '#ff0000',
      description: r.description ?? '', tags: r.tags ?? '',
    }));
    return { items, count: j.count ?? items.length, page, hasMore: !!j.next };
  });

  /** Sound von MyInstants in die eigene Mediathek laden (läuft dann lokal, ohne Abhängigkeit von MyInstants) */
  app.post('/api/media/myinstants', async (req, reply) => {
    const b = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,200}$/i), name: z.string().max(200), sound: z.string().url() }).parse(req.body);
    if (!isMyInstantsSound(b.sound)) return reply.code(400).send({ error: 'Nur Sounds von myinstants.com' });
    const file = `mi_${b.slug.toLowerCase()}.mp3`;
    const url = `/media/${file}`;
    const existing = store.media.list(db).find((m) => m.url === url);
    if (existing) return existing;
    let res: Response;
    try {
      res = await fetch(b.sound, { headers: { 'User-Agent': 'FF-Overlay (self-hosted stream alerts)' }, signal: AbortSignal.timeout(20_000) });
    } catch {
      return reply.code(502).send({ error: 'Sound konnte nicht geladen werden' });
    }
    if (!res.ok) return reply.code(502).send({ error: `MyInstants antwortet mit ${res.status}` });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) return reply.code(413).send({ error: 'Sound größer als 10 MB' });
    if (!looksLikeMp3(buf)) return reply.code(502).send({ error: 'Die Datei ist kein MP3' });
    fs.writeFileSync(path.join(config.mediaDir, file), buf);
    return store.media.add(db, { name: b.name.slice(0, 120) || b.slug, kind: 'audio', url, source: 'myinstants' });
  });

  app.delete<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    const m = store.media.get(db, req.params.id);
    if (m?.source === 'upload' || m?.source === 'myinstants') fs.rmSync(path.join(config.mediaDir, path.basename(m.url)), { force: true });
    return { ok: store.media.remove(db, req.params.id) };
  });

  // GIPHY-Proxy: der API-Key bleibt auf dem Server.
  app.get<{ Querystring: { q?: string; kind?: string; offset?: string } }>('/api/giphy/search', async (req, reply) => {
    const giphy = giphyKey(db).key;
    if (!giphy) return reply.code(501).send({ error: 'Kein GIPHY-Key hinterlegt (Verbindungen → App-Zugangsdaten)' });
    const kind = req.query.kind === 'stickers' ? 'stickers' : 'gifs';
    const q = (req.query.q ?? '').trim().slice(0, 50);
    const u = new URL(`https://api.giphy.com/v1/${kind}/${q ? 'search' : 'trending'}`);
    u.searchParams.set('api_key', giphy);
    if (q) u.searchParams.set('q', q);
    u.searchParams.set('limit', '24');
    u.searchParams.set('offset', String(Math.min(Number(req.query.offset ?? 0) || 0, 499)));
    u.searchParams.set('rating', 'pg-13');
    u.searchParams.set('lang', 'de');
    const res = await fetch(u);
    if (!res.ok) return reply.code(502).send({ error: `GIPHY antwortet mit ${res.status}` });
    const j = (await res.json()) as { data: GiphyItem[]; pagination?: { total_count: number; offset: number } };
    return { items: j.data.map(mapGiphy), pagination: j.pagination };
  });
}
