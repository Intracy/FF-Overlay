import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import * as store from '../db.js';
import { config } from '../config.js';
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

  app.delete<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    const m = store.media.get(db, req.params.id);
    if (m?.source === 'upload') fs.rmSync(path.join(config.mediaDir, path.basename(m.url)), { force: true });
    return { ok: store.media.remove(db, req.params.id) };
  });

  // GIPHY-Proxy: der API-Key bleibt auf dem Server.
  app.get<{ Querystring: { q?: string; kind?: string; offset?: string } }>('/api/giphy/search', async (req, reply) => {
    if (!config.giphyApiKey) return reply.code(501).send({ error: 'GIPHY_API_KEY ist nicht gesetzt' });
    const kind = req.query.kind === 'stickers' ? 'stickers' : 'gifs';
    const q = (req.query.q ?? '').trim().slice(0, 50);
    const u = new URL(`https://api.giphy.com/v1/${kind}/${q ? 'search' : 'trending'}`);
    u.searchParams.set('api_key', config.giphyApiKey);
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
