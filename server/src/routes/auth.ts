import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';

export const SESSION_COOKIE = 'ffo_session';
const SESSION_VALUE = 'admin';

export function isAuthenticated(req: FastifyRequest): boolean {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return false;
  const r = req.unsignCookie(raw);
  return r.valid && r.value === SESSION_VALUE;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!isAuthenticated(req)) return reply.code(401).send({ error: 'Nicht angemeldet' });
}

// Einfacher Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro IP in 15 Minuten.
const attempts = new Map<string, { count: number; until: number }>();

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    const a = attempts.get(req.ip);
    if (a && a.until > Date.now() && a.count >= 10) return reply.code(429).send({ error: 'Zu viele Versuche, bitte später erneut.' });
    if (!safeEqual(String(req.body?.password ?? ''), config.adminPassword)) {
      attempts.set(req.ip, { count: (a && a.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      return reply.code(401).send({ error: 'Falsches Passwort' });
    }
    attempts.delete(req.ip);
    reply.setCookie(SESSION_COOKIE, SESSION_VALUE, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicUrl.startsWith('https://'),
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ authenticated: isAuthenticated(req) }));
}
