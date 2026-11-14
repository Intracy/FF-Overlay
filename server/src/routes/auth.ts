import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';
import { atLeast, isRole, requiredRole, ROLE_LABEL, type Role } from '../lib/permissions.js';

export const SESSION_COOKIE = 'ffo_session';
const PASSWORD_SESSION = 'admin';

export interface Session {
  /** password = Notfall-Login mit ADMIN_PASSWORD, portal = über FrankenFinals Broadcast, open = ohne Login */
  kind: 'password' | 'portal' | 'open';
  role: Role;
  name: string;
  email?: string;
  exp?: number;
}

/** Anmeldung über das Portal ist eingerichtet (Schlüssel mit mindestens 32 Zeichen) */
export const portalEnabled = () => config.portal.secret.length >= 32;
/** Ohne ADMIN_PASSWORD und ohne Portal ist das Dashboard ohne Login erreichbar. */
export const authRequired = () => !!config.adminPassword || portalEnabled();

export function getSession(req: FastifyRequest): Session | null {
  if (!authRequired()) return { kind: 'open', role: 'admin', name: 'Ohne Login' };
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const r = req.unsignCookie(raw);
  if (!r.valid || !r.value) return null;
  if (r.value === PASSWORD_SESSION) return config.adminPassword ? { kind: 'password', role: 'admin', name: 'Admin (Passwort)' } : null;
  if (r.value.startsWith('p.') && portalEnabled()) {
    try {
      const s = JSON.parse(Buffer.from(r.value.slice(2), 'base64url').toString('utf8'));
      if (!isRole(s.role) || typeof s.exp !== 'number' || s.exp < Date.now()) return null;
      return { kind: 'portal', role: s.role, name: String(s.name || s.email || ''), email: String(s.email || ''), exp: s.exp };
    } catch {
      return null;
    }
  }
  return null;
}

export const isAuthenticated = (req: FastifyRequest) => !!getSession(req);

/** Anmeldung und Rolle prüfen – die nötige Rolle ergibt sich aus Methode und Route (lib/permissions.ts) */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const s = getSession(req);
  if (!s) return reply.code(401).send({ error: 'Nicht angemeldet' });
  const need = requiredRole(req.method, req.routeOptions.url ?? req.url.split('?')[0]!);
  if (!atLeast(s.role, need)) return reply.code(403).send({ error: `Dafür fehlen dir die Rechte (nötig: ${ROLE_LABEL[need]}).` });
}

const cookieOpts = (maxAgeSeconds: number) => ({
  signed: true,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.publicUrl.startsWith('https://'),
  path: '/',
  maxAge: maxAgeSeconds,
});

/* ---------- Eintrittskarte aus dem Portal prüfen (Gegenstück zu server/sso.js im Portal) */
interface Ticket { v: number; aud: string; sub: string; email: string; name: string; role: string; exp: number; jti: string }

export function verifyTicket(ticket: string, secret: string, aud: string, now = Date.now()): Ticket | null {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p: Ticket;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (p.v !== 1 || p.aud !== aud || typeof p.exp !== 'number' || p.exp * 1000 < now || !p.jti) return null;
  return p;
}

/** Jede Eintrittskarte gilt nur einmal (bis zu ihrem Ablauf gemerkt) */
const usedTickets = new Map<string, number>();
function firstUse(jti: string, expMs: number): boolean {
  const now = Date.now();
  for (const [k, until] of usedTickets) if (until < now) usedTickets.delete(k);
  if (usedTickets.has(jti)) return false;
  usedTickets.set(jti, expMs);
  return true;
}

function infoPage(reply: FastifyReply, status: number, title: string, text: string) {
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const back = config.portal.url ? `<a href="${esc(config.portal.url)}/">Zurück zum Portal</a>` : '';
  return reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · FF Overlay</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f4f4f6;font:15px/1.6 'IBM Plex Sans',system-ui,sans-serif}
.c{max-width:420px;padding:32px;border-radius:20px;background:linear-gradient(180deg,#0f0f13,#0a0a0d);border:1px solid #1c1c23;text-align:center}
h1{font-family:'Barlow Condensed','Arial Narrow',sans-serif;text-transform:uppercase;font-size:26px;margin:0 0 8px}p{color:#b4b4bf}a{color:#a78bfa}</style></head>
<body><div class="c"><h1>${esc(title)}</h1><p>${esc(text)}</p>${back}</div></body></html>`);
}

// Einfacher Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro IP in 15 Minuten.
const attempts = new Map<string, { count: number; until: number }>();

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    if (!authRequired()) return { ok: true };
    if (!config.adminPassword) return reply.code(400).send({ error: 'Anmeldung nur über das Portal möglich' });
    const a = attempts.get(req.ip);
    if (a && a.until > Date.now() && a.count >= 10) return reply.code(429).send({ error: 'Zu viele Versuche, bitte später erneut.' });
    if (!safeEqual(String(req.body?.password ?? ''), config.adminPassword)) {
      attempts.set(req.ip, { count: (a && a.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      return reply.code(401).send({ error: 'Falsches Passwort' });
    }
    attempts.delete(req.ip);
    reply.setCookie(SESSION_COOKIE, PASSWORD_SESSION, cookieOpts(60 * 60 * 24 * 30));
    return { ok: true };
  });

  /** Ziel der Portal-Kachel: Eintrittskarte prüfen und eigene Sitzung mit der Rolle aus dem Portal öffnen */
  app.get<{ Querystring: { ticket?: string } }>('/auth/portal', async (req, reply) => {
    if (!portalEnabled()) return infoPage(reply, 503, 'Nicht eingerichtet', 'Die Anmeldung über das Portal ist auf diesem Server nicht eingerichtet (PORTAL_SSO_SECRET fehlt).');
    const t = verifyTicket(req.query.ticket ?? '', config.portal.secret, config.portal.moduleId);
    if (!t) return infoPage(reply, 401, 'Anmeldung abgelaufen', 'Der Link aus dem Portal ist ungültig oder abgelaufen. Öffne die Overlay Engine bitte erneut über die Kachel im Portal.');
    if (!firstUse(t.jti, t.exp * 1000)) return infoPage(reply, 401, 'Link schon benutzt', 'Dieser Anmelde-Link wurde bereits verwendet. Öffne die Overlay Engine bitte erneut über die Kachel im Portal.');
    if (!isRole(t.role)) return infoPage(reply, 403, 'Kein Zugriff', 'Deine Rolle im Portal erlaubt keinen Zugriff auf die Overlay Engine.');
    const hours = Math.max(1, Math.min(config.portal.sessionHours || 12, 24 * 7));
    const session = { sub: t.sub, email: t.email, name: t.name, role: t.role, exp: Date.now() + hours * 3600_000 };
    reply.setCookie(SESSION_COOKIE, 'p.' + Buffer.from(JSON.stringify(session)).toString('base64url'), cookieOpts(hours * 3600));
    req.log.info({ user: t.email, role: t.role }, 'Anmeldung über das Portal');
    return reply.header('Cache-Control', 'no-store').redirect('/');
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, portalUrl: portalEnabled() ? config.portal.url || null : null };
  });

  app.get('/api/auth/me', async (req) => {
    const s = getSession(req);
    return {
      authenticated: !!s,
      authRequired: authRequired(),
      user: s ? { name: s.name, email: s.email ?? null, role: s.role, roleLabel: ROLE_LABEL[s.role], via: s.kind } : null,
      portalUrl: portalEnabled() ? config.portal.url || null : null,
      portalLogin: portalEnabled() && config.portal.url ? `${config.portal.url}/sso/${config.portal.moduleId}` : null,
      passwordLogin: !!config.adminPassword,
    };
  });
}
