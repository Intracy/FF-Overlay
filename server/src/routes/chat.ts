import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuth } from './auth.js';
import { sampleChatMessage } from '../shared/chat.js';

/** Chat-Overlay: Verlauf, Testnachrichten und Moderation aus dem Dashboard */
export async function chatRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Querystring: { limit?: string } }>('/api/chat', async (req) => ctx.chat.recent(Math.min(200, Math.max(1, Number(req.query.limit) || 50))));

  app.post('/api/chat/test', async (req) => {
    const b = z.object({ platform: z.enum(['twitch', 'youtube']).optional(), count: z.number().int().min(1).max(10).optional() }).parse(req.body ?? {});
    const count = b.count ?? 4;
    for (let i = 0; i < count; i++) {
      // kurz nacheinander, damit die Einblend-Animation sichtbar ist
      setTimeout(() => ctx.chat.ingest(sampleChatMessage(undefined, b.platform)), i * 700);
    }
    return { ok: true, count };
  });

  app.post('/api/chat/remove', async (req) => {
    const r = z.object({
      ids: z.array(z.string().max(200)).max(200).optional(),
      userId: z.string().max(200).optional(),
      platform: z.enum(['twitch', 'youtube', 'test']).optional(),
      all: z.boolean().optional(),
    }).refine((x) => x.all || x.ids?.length || x.userId, 'Was soll entfernt werden?').parse(req.body);
    return { removed: ctx.chat.remove(r) };
  });
}
