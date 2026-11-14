// Rollen aus dem FrankenFinals-Broadcast-Portal und was sie im Dashboard dürfen.
//
//   operator – während des Streams: Alert Feed, Warteschlange, Test-Alerts, Widgets live steuern, Chat moderieren
//   editor   – zusätzlich alles gestalten: Alert-Box, Designs, Regeln, Widgets, Chat-Overlays, Overlays, Mediathek
//   admin    – zusätzlich Verbindungen, App-Zugangsdaten, Projekte, Einstellungen, geheime Overlay-Keys
//
// Lesen (GET) darf jede Rolle; bei Änderungen entscheidet die Tabelle unten. Neue Routen sind ohne Eintrag „editor“.

export type Role = 'operator' | 'editor' | 'admin';
export const ROLES: Role[] = ['operator', 'editor', 'admin'];
export const ROLE_LABEL: Record<Role, string> = { operator: 'Operator', editor: 'Editor', admin: 'Overlay-Admin' };
const RANK: Record<Role, number> = { operator: 1, editor: 2, admin: 3 };

export const isRole = (r: unknown): r is Role => typeof r === 'string' && r in RANK;
export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

/** Aktionen während des Streams – dürfen schon Operatoren */
export const OPERATOR_ROUTES = new Set([
  'POST /api/overlays/:id/queue/:action',
  'POST /api/overlays/:id/moderation/:itemId/:action',
  'POST /api/events/test',
  'DELETE /api/events/test',
  'POST /api/events/:id/replay',
  'POST /api/events/read',
  'POST /api/templates/:id/test',
  'POST /api/overlays/:id/test-draft',
  'POST /api/rules/explain',
  'POST /api/session/reset',
  'POST /api/widgets/:id/timer',
  'POST /api/widgets/:id/boss/reset',
  'POST /api/widgets/:id/goal/reset',
  'POST /api/widgets/:id/credits/roll',
  'POST /api/widgets/:id/refresh',
  'POST /api/widgets/:id/poll/winner',
  'POST /api/widgets/:id/milestones/reset',
  'POST /api/chat/test',
  'POST /api/chat/remove',
]);

/** Nur Overlay-Admins: Zugangsdaten, Verbindungen, Projekte, globale Einstellungen, geheime Keys */
function adminOnly(method: string, url: string): boolean {
  if (url === '/api/apps') return true; // enthält App-Zugangsdaten, auch lesend
  if (url.startsWith('/api/connections')) return method !== 'GET';
  if (url.startsWith('/api/projects')) return method !== 'GET';
  if (url === '/api/settings') return method !== 'GET';
  if (url.endsWith('/rotate-key')) return true;
  if (method === 'DELETE' && url === '/api/overlays/:id') return true;
  return false;
}

/** Mindestrolle für eine Route (url = Routen-Muster, z. B. /api/widgets/:id) */
export function requiredRole(method: string, url: string): Role {
  const m = method.toUpperCase();
  if (adminOnly(m, url)) return 'admin';
  if (m === 'GET' || m === 'HEAD') return 'operator';
  if (OPERATOR_ROUTES.has(`${m} ${url}`)) return 'operator';
  return 'editor';
}
