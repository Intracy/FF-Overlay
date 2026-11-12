import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  AlertTemplate,
  Profile,
  EventLogEntry,
  EventStatus,
  GlobalSettings,
  NormalizedEvent,
  OverlayInfo,
  Rule,
} from './shared/types.js';
import { randomKey } from './lib/crypto.js';
import { withTemplateDefaults } from './templates/defaults.js';
import { WIDGET_DEFAULTS, type Widget, type WidgetType } from './shared/widgets.js';

export type DB = Database.Database;

type Migration = string | ((db: Database.Database) => void);

export const MIGRATIONS: Migration[] = [
  `CREATE TABLE overlays (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL,
     width INTEGER NOT NULL DEFAULT 1920, height INTEGER NOT NULL DEFAULT 1080,
     alert_delay INTEGER NOT NULL DEFAULT 2000, volume REAL NOT NULL DEFAULT 1, muted INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL);
   CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE rules (id TEXT PRIMARY KEY, overlay_id TEXT NOT NULL REFERENCES overlays(id) ON DELETE CASCADE,
     data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX rules_overlay ON rules(overlay_id);
   CREATE TABLE events (id TEXT PRIMARY KEY, platform TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
     status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   CREATE INDEX events_created ON events(created_at);
   CREATE TABLE connections (id TEXT PRIMARY KEY, platform TEXT NOT NULL, label TEXT NOT NULL, data TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
   CREATE TABLE media (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL,
     source TEXT NOT NULL, giphy_id TEXT, created_at TEXT NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // v2: Overlay-Optionen (Moderation, Alert-Parry, Ereignisfilter …) und Profile („Themen“)
  `ALTER TABLE overlays ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
   CREATE TABLE profiles (id TEXT PRIMARY KEY, overlay_id TEXT NOT NULL REFERENCES overlays(id) ON DELETE CASCADE,
     name TEXT NOT NULL, created_at TEXT NOT NULL);`,
  // v3: bestehende Overlays bekommen ein Standard-Profil, Regeln werden zugeordnet
  (db) => {
    const ovs = db.prepare('SELECT id, options FROM overlays').all() as Array<{ id: string; options: string }>;
    for (const o of ovs) {
      const pid = nanoid(10);
      db.prepare('INSERT INTO profiles (id, overlay_id, name, created_at) VALUES (?,?,?,?)').run(pid, o.id, 'Standard', new Date().toISOString());
      db.prepare('UPDATE overlays SET options=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(o.options), activeProfileId: pid }), o.id);
      const rs = db.prepare('SELECT id, data FROM rules WHERE overlay_id=?').all(o.id) as Array<{ id: string; data: string }>;
      for (const r of rs) {
        const rule = JSON.parse(r.data) as Rule;
        rule.profileId = pid;
        rule.kind = rule.conditions.length ? 'variation' : 'default';
        db.prepare('UPDATE rules SET data=? WHERE id=?').run(JSON.stringify(rule), r.id);
      }
    }
  },
  // v4: Widgets (Ereignisliste, Ziele, Labels, Timer, Credits, Boss, Ticker)
  `CREATE TABLE widgets (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL,
     settings TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'null', preview_bg TEXT NOT NULL DEFAULT '#2b2f36', created_at TEXT NOT NULL);`,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    const m = MIGRATIONS[i]!;
    if (typeof m === 'string') db.exec(m);
    else m(db);
    db.pragma(`user_version = ${i + 1}`);
    db.exec('COMMIT');
  }
  return db;
}

const now = () => new Date().toISOString();

// ---------- Overlays ----------

interface OverlayRow {
  id: string; name: string; key: string; width: number; height: number;
  alert_delay: number; volume: number; muted: number; options: string;
}
type OverlayOptions = Pick<OverlayInfo, 'moderationDelay' | 'interruptMode' | 'interruptDelay' | 'disabledTypes' | 'activeProfileId' | 'previewBackground' | 'portrait'>;
export const PORTRAIT_DEFAULTS: OverlayInfo['portrait'] = { scale: 160, align: 'top', safeTop: 12, safeBottom: 22, stackSideBySide: true };
const OPTION_DEFAULTS: OverlayOptions = {
  moderationDelay: 0, interruptMode: false, interruptDelay: 500, disabledTypes: [], activeProfileId: '', previewBackground: '#2b2f36',
  portrait: PORTRAIT_DEFAULTS,
};
const OPTION_KEYS = Object.keys(OPTION_DEFAULTS) as Array<keyof OverlayOptions>;
const toOverlay = (r: OverlayRow): OverlayInfo => {
  const opts = JSON.parse(r.options || '{}') as Partial<OverlayOptions>;
  return {
    id: r.id, name: r.name, key: r.key, width: r.width, height: r.height,
    alertDelay: r.alert_delay, volume: r.volume, muted: !!r.muted,
    ...OPTION_DEFAULTS, ...opts, portrait: { ...PORTRAIT_DEFAULTS, ...opts.portrait },
  };
};

export const overlays = {
  list: (db: DB) => (db.prepare('SELECT * FROM overlays ORDER BY created_at').all() as OverlayRow[]).map(toOverlay),
  get: (db: DB, id: string) => {
    const r = db.prepare('SELECT * FROM overlays WHERE id = ?').get(id) as OverlayRow | undefined;
    return r ? toOverlay(r) : undefined;
  },
  create: (db: DB, name: string): OverlayInfo => {
    const id = nanoid(10);
    db.prepare('INSERT INTO overlays (id, name, key, created_at) VALUES (?, ?, ?, ?)').run(id, name, randomKey(), now());
    const profile = profiles.create(db, id, 'Standard');
    return overlays.update(db, id, { activeProfileId: profile.id })!;
  },
  update: (db: DB, id: string, patch: Partial<Omit<OverlayInfo, 'id' | 'key' | 'portrait'>> & { portrait?: Partial<OverlayInfo['portrait']> }) => {
    const cur = overlays.get(db, id);
    if (!cur) return undefined;
    const n = { ...cur, ...patch, portrait: { ...cur.portrait, ...patch.portrait } };
    const options = Object.fromEntries(OPTION_KEYS.map((k) => [k, n[k]]));
    db.prepare('UPDATE overlays SET name=?, width=?, height=?, alert_delay=?, volume=?, muted=?, options=? WHERE id=?')
      .run(n.name, n.width, n.height, n.alertDelay, n.volume, n.muted ? 1 : 0, JSON.stringify(options), id);
    return overlays.get(db, id);
  },
  rotateKey: (db: DB, id: string) => {
    db.prepare('UPDATE overlays SET key=? WHERE id=?').run(randomKey(), id);
    return overlays.get(db, id);
  },
  remove: (db: DB, id: string) => db.prepare('DELETE FROM overlays WHERE id=?').run(id).changes > 0,
};

// ---------- Profile (Streamlabs: „Themen“) ----------

export const profiles = {
  list: (db: DB, overlayId: string) =>
    (db.prepare('SELECT id, overlay_id, name FROM profiles WHERE overlay_id=? ORDER BY created_at').all(overlayId) as Array<{ id: string; overlay_id: string; name: string }>)
      .map((r): Profile => ({ id: r.id, overlayId: r.overlay_id, name: r.name })),
  get: (db: DB, id: string) => {
    const r = db.prepare('SELECT id, overlay_id, name FROM profiles WHERE id=?').get(id) as { id: string; overlay_id: string; name: string } | undefined;
    return r ? ({ id: r.id, overlayId: r.overlay_id, name: r.name } as Profile) : undefined;
  },
  create: (db: DB, overlayId: string, name: string): Profile => {
    const id = nanoid(10);
    db.prepare('INSERT INTO profiles (id, overlay_id, name, created_at) VALUES (?,?,?,?)').run(id, overlayId, name, now());
    return { id, overlayId, name };
  },
  rename: (db: DB, id: string, name: string) => db.prepare('UPDATE profiles SET name=? WHERE id=?').run(name, id).changes > 0,
  remove: (db: DB, id: string) => {
    for (const r of rules.list(db).filter((x) => x.profileId === id)) rules.remove(db, r.id);
    return db.prepare('DELETE FROM profiles WHERE id=?').run(id).changes > 0;
  },
};

// ---------- Templates ----------

export const templates = {
  list: (db: DB) =>
    (db.prepare('SELECT data FROM templates ORDER BY name').all() as { data: string }[]).map(
      (r) => withTemplateDefaults(JSON.parse(r.data)),
    ),
  get: (db: DB, id: string) => {
    const r = db.prepare('SELECT data FROM templates WHERE id=?').get(id) as { data: string } | undefined;
    return r ? withTemplateDefaults(JSON.parse(r.data)) : undefined;
  },
  save: (db: DB, t: AlertTemplate) => {
    db.prepare(
      'INSERT INTO templates (id, name, data, updated_at) VALUES (@id, @name, @data, @at) ' +
        'ON CONFLICT(id) DO UPDATE SET name=@name, data=@data, updated_at=@at',
    ).run({ id: t.id, name: t.name, data: JSON.stringify(t), at: now() });
    return t;
  },
  remove: (db: DB, id: string) => db.prepare('DELETE FROM templates WHERE id=?').run(id).changes > 0,
};

// ---------- Rules ----------

export const rules = {
  /** Regeln des aktiven Profils eines Overlays */
  active: (db: DB, overlay: OverlayInfo) => rules.list(db, overlay.id).filter((r) => !r.profileId || r.profileId === overlay.activeProfileId),
  list: (db: DB, overlayId?: string) => {
    const rows = (overlayId
      ? db.prepare('SELECT data FROM rules WHERE overlay_id=?').all(overlayId)
      : db.prepare('SELECT data FROM rules').all()) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Rule).sort((a, b) => b.priority - a.priority);
  },
  get: (db: DB, id: string) => {
    const r = db.prepare('SELECT data FROM rules WHERE id=?').get(id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Rule) : undefined;
  },
  save: (db: DB, rule: Rule) => {
    db.prepare(
      'INSERT INTO rules (id, overlay_id, data, updated_at) VALUES (@id, @o, @data, @at) ' +
        'ON CONFLICT(id) DO UPDATE SET overlay_id=@o, data=@data, updated_at=@at',
    ).run({ id: rule.id, o: rule.overlayId, data: JSON.stringify(rule), at: now() });
    return rule;
  },
  remove: (db: DB, id: string) => db.prepare('DELETE FROM rules WHERE id=?').run(id).changes > 0,
  usesTemplate: (db: DB, templateId: string) => rules.list(db).some((r) => r.templateId === templateId),
};

// ---------- Events ----------

interface EventRow { id: string; data: string; status: EventStatus; reason: string; read: number; created_at: string }
const toEntry = (r: EventRow): EventLogEntry => ({
  id: r.id, event: JSON.parse(r.data), status: r.status, reason: r.reason, read: !!r.read, createdAt: r.created_at,
});

export const events = {
  insert: (db: DB, e: NormalizedEvent, status: EventStatus, reason: string): EventLogEntry => {
    const at = now();
    db.prepare('INSERT INTO events (id, platform, type, data, status, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(e.id, e.platform, e.type, JSON.stringify(e), status, reason, at);
    return { id: e.id, event: e, status, reason, read: false, createdAt: at };
  },
  setStatus: (db: DB, id: string, status: EventStatus, reason: string) =>
    db.prepare('UPDATE events SET status=?, reason=? WHERE id=?').run(status, reason, id),
  get: (db: DB, id: string) => {
    const r = db.prepare('SELECT * FROM events WHERE id=?').get(id) as EventRow | undefined;
    return r ? toEntry(r) : undefined;
  },
  list: (db: DB, opts: { limit?: number; before?: string; types?: string[]; platforms?: string[] } = {}) => {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.before) { where.push('created_at < ?'); args.push(opts.before); }
    if (opts.types?.length) { where.push(`type IN (${opts.types.map(() => '?').join(',')})`); args.push(...opts.types); }
    if (opts.platforms?.length) { where.push(`platform IN (${opts.platforms.map(() => '?').join(',')})`); args.push(...opts.platforms); }
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
    args.push(Math.min(opts.limit ?? 100, 500));
    return (db.prepare(sql).all(...args) as EventRow[]).map(toEntry);
  },
  markRead: (db: DB, ids: string[] | 'all', read = true) => {
    if (ids === 'all') db.prepare('UPDATE events SET read=?').run(read ? 1 : 0);
    else for (const id of ids) db.prepare('UPDATE events SET read=? WHERE id=?').run(read ? 1 : 0, id);
  },
  /** Hat dieser Nutzer auf dieser Plattform schon einmal ein Event dieses Typs ausgelöst? */
  hasPrevious: (db: DB, e: NormalizedEvent) =>
    !!db.prepare(
      `SELECT 1 FROM events WHERE platform=? AND type=? AND id<>? AND json_extract(data,'$.user.name')=? COLLATE NOCASE LIMIT 1`,
    ).get(e.platform, e.type, e.id, e.user.name),
  /** Events seit einem Zeitpunkt (älteste zuerst), ohne gefilterte und gebündelte */
  since: (db: DB, iso: string, limit = 5000) =>
    (db.prepare(`SELECT * FROM events WHERE created_at >= ? AND status NOT IN ('filtered','suppressed','rejected') ORDER BY created_at ASC LIMIT ?`).all(iso, limit) as EventRow[]).map(toEntry),
  /** Neueste Events (neueste zuerst), ohne gefilterte und gebündelte */
  recentVisible: (db: DB, limit: number) =>
    (db.prepare(`SELECT * FROM events WHERE status NOT IN ('filtered','suppressed','rejected') AND type <> 'stream_status' ORDER BY created_at DESC LIMIT ?`).all(limit) as EventRow[]).map(toEntry),
  /** Spenden von betterplace und Test-Spenden (neueste zuerst) */
  donations: (db: DB, limit = 2000) =>
    (db.prepare(`SELECT * FROM events WHERE type = 'donation' AND platform IN ('betterplace','test') AND status NOT IN ('filtered','suppressed','rejected') ORDER BY created_at DESC LIMIT ?`).all(limit) as EventRow[]).map(toEntry),
  removeTestData: (db: DB) => db.prepare(`DELETE FROM events WHERE platform = 'test'`).run().changes,
  purgeOlderThan: (db: DB, days: number) =>
    db.prepare('DELETE FROM events WHERE created_at < ?').run(new Date(Date.now() - days * 864e5).toISOString()).changes,
};

// ---------- Connections ----------

export interface ConnectionRow<T = unknown> {
  id: string; platform: string; label: string; data: T; enabled: boolean;
}

export const connections = {
  list: (db: DB) =>
    (db.prepare('SELECT * FROM connections').all() as Array<{ id: string; platform: string; label: string; data: string; enabled: number }>)
      .map((r) => ({ ...r, data: JSON.parse(r.data), enabled: !!r.enabled }) as ConnectionRow),
  get: <T = unknown>(db: DB, id: string) => connections.list(db).find((c) => c.id === id) as ConnectionRow<T> | undefined,
  save: <T>(db: DB, c: ConnectionRow<T>) => {
    db.prepare(
      'INSERT INTO connections (id, platform, label, data, enabled, updated_at) VALUES (@id,@p,@l,@d,@e,@at) ' +
        'ON CONFLICT(id) DO UPDATE SET label=@l, data=@d, enabled=@e, updated_at=@at',
    ).run({ id: c.id, p: c.platform, l: c.label, d: JSON.stringify(c.data), e: c.enabled ? 1 : 0, at: now() });
  },
  remove: (db: DB, id: string) => db.prepare('DELETE FROM connections WHERE id=?').run(id).changes > 0,
};

// ---------- Media ----------

export interface MediaAsset {
  id: string; name: string; kind: 'image' | 'video' | 'audio'; url: string; source: 'upload' | 'giphy'; giphyId?: string; createdAt: string;
}

export const media = {
  list: (db: DB) =>
    (db.prepare('SELECT * FROM media ORDER BY created_at DESC').all() as Array<Record<string, string>>).map(
      (r) => ({ id: r.id, name: r.name, kind: r.kind, url: r.url, source: r.source, giphyId: r.giphy_id ?? undefined, createdAt: r.created_at }) as MediaAsset,
    ),
  add: (db: DB, m: Omit<MediaAsset, 'id' | 'createdAt'>): MediaAsset => {
    const asset = { ...m, id: nanoid(12), createdAt: now() };
    db.prepare('INSERT INTO media (id, name, kind, url, source, giphy_id, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(asset.id, asset.name, asset.kind, asset.url, asset.source, asset.giphyId ?? null, asset.createdAt);
    return asset;
  },
  get: (db: DB, id: string) => media.list(db).find((m) => m.id === id),
  remove: (db: DB, id: string) => db.prepare('DELETE FROM media WHERE id=?').run(id).changes > 0,
};

// ---------- Widgets ----------

interface WidgetRow { id: string; type: WidgetType; name: string; key: string; settings: string; state: string; preview_bg: string }
const toWidget = (r: WidgetRow): Widget => ({
  id: r.id, type: r.type, name: r.name, key: r.key,
  // neue Felder späterer Versionen werden mit den Standardwerten ergänzt
  settings: { ...WIDGET_DEFAULTS[r.type](), ...JSON.parse(r.settings) },
  state: JSON.parse(r.state), previewBackground: r.preview_bg,
});

export const widgets = {
  list: (db: DB) => (db.prepare('SELECT * FROM widgets ORDER BY created_at').all() as WidgetRow[]).map(toWidget),
  get: (db: DB, id: string) => {
    const r = db.prepare('SELECT * FROM widgets WHERE id=?').get(id) as WidgetRow | undefined;
    return r ? toWidget(r) : undefined;
  },
  create: (db: DB, type: WidgetType, name: string): Widget => {
    const id = nanoid(10);
    db.prepare('INSERT INTO widgets (id, type, name, key, settings, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, type, name, randomKey(), JSON.stringify(WIDGET_DEFAULTS[type]()), now());
    return widgets.get(db, id)!;
  },
  update: (db: DB, id: string, patch: { name?: string; settings?: unknown; previewBackground?: string }) => {
    const cur = widgets.get(db, id);
    if (!cur) return undefined;
    db.prepare('UPDATE widgets SET name=?, settings=?, preview_bg=? WHERE id=?')
      .run(patch.name ?? cur.name, JSON.stringify(patch.settings ?? cur.settings), patch.previewBackground ?? cur.previewBackground, id);
    return widgets.get(db, id);
  },
  setState: (db: DB, id: string, state: unknown) => db.prepare('UPDATE widgets SET state=? WHERE id=?').run(JSON.stringify(state), id),
  rotateKey: (db: DB, id: string) => {
    db.prepare('UPDATE widgets SET key=? WHERE id=?').run(randomKey(), id);
    return widgets.get(db, id);
  },
  remove: (db: DB, id: string) => db.prepare('DELETE FROM widgets WHERE id=?').run(id).changes > 0,
};

// ---------- Settings ----------

export const DEFAULT_SETTINGS: GlobalSettings = {
  minDonationAmount: 0,
  blockedUsers: [],
  badWords: [],
  badWordMode: 'censor',
  useDefaultBadWords: false,
  anonymizeNames: true,
  censorEventLog: true,
  autoResetSession: true,
  betterplaceTestMode: false,
};

export const settings = {
  get: <T>(db: DB, key: string, fallback: T): T => {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return r ? ({ ...fallback, ...JSON.parse(r.value) } as T) : fallback;
  },
  set: (db: DB, key: string, value: unknown) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value)),
  global: (db: DB) => settings.get<GlobalSettings>(db, 'global', DEFAULT_SETTINGS),
};
