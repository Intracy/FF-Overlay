import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { openDb, type DB } from './db.js';
import * as store from './db.js';
import { Hub } from './ws/hub.js';
import { Pipeline } from './events/pipeline.js';
import { ConnectorManager } from './connectors/manager.js';
import { ChatService } from './chat/service.js';
import { WidgetService } from './widgets/service.js';
import { seedIfEmpty } from './seed.js';
import type { AppContext } from './context.js';
import type { ConnectorStatus } from './shared/types.js';
import type { ConnectorEnv } from './connectors/types.js';
import { safeEqual } from './lib/crypto.js';

/*
 * Projekte (Overlay-Profile): komplett getrennte Alert-Systeme für verschiedene Streams.
 * Jedes Projekt hat eine eigene SQLite-Datei mit eigenen Verbindungen (Twitch/YouTube/betterplace/Webhooks),
 * Overlays, Alert-Box, Designs, Regeln, Widgets, Chat-Overlays, Mediathek, Einstellungen und Event-Log –
 * und eine eigene Laufzeit (Warteschlangen, Connectoren, WebSockets).
 * Das bisherige Setup ist das Projekt „default“ (die vorhandene Datenbank). App-Zugangsdaten (Twitch-/Google-App,
 * GIPHY) gelten für alle Projekte.
 */

export const DEFAULT_PROJECT = 'default';

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
}

export interface ProjectRuntime extends AppContext {
  id: string;
  dispose: () => Promise<void>;
}

export interface ProjectSummary extends ProjectInfo {
  isDefault: boolean;
  overlays: number;
  widgets: number;
  connections: Array<Pick<ConnectorStatus, 'platform' | 'label' | 'state'>>;
  live: boolean;
}

type Log = ConnectorEnv['log'];

const REGISTRY = 'projects';

/** Baut die Laufzeit eines Projekts (früher alles in app.ts) */
export function createRuntime(id: string, db: DB, log: Log): ProjectRuntime {
  const hub = new Hub();
  const pipeline = new Pipeline(db, hub);
  const chat = new ChatService(db, hub);
  const connectors: ConnectorManager = new ConnectorManager(db, {
    emit: (event) => pipeline.ingest(event),
    onStatus: () => hub.broadcastDashboard({ t: 'connectors', status: connectors.statuses() }),
    onBetterplaceStats: () => widgets.onBetterplaceStats(),
    chat: (message) => chat.ingest(message),
    chatRemove: (removal) => chat.remove(removal),
    log,
  });
  const widgets: WidgetService = new WidgetService(db, hub, () => pipeline.session, (event) => pipeline.ingest(event), (n) => chat.recent(n));
  pipeline.listeners.push((entry) => widgets.onEvent(entry));
  // Aufräumen: Event-Log nach Aufbewahrungsfrist löschen (Datenschutz)
  const purge = () => store.events.purgeOlderThan(db, config.eventRetentionDays);
  purge();
  const purgeTimer = setInterval(purge, 6 * 3600_000);
  return {
    id, db, hub, pipeline, connectors, widgets, chat,
    dispose: async () => {
      clearInterval(purgeTimer);
      widgets.dispose();
      await connectors.stopAll();
      db.close();
    },
  };
}

let activeManager: ProjectManager | null = null;

/** Wird eine hochgeladene Datei noch in einem anderen Projekt benutzt? (Projekt-Kopien teilen sich Dateien) */
export function mediaUsedElsewhere(url: string): boolean {
  if (!activeManager) return false;
  const current = activeManager.current();
  return activeManager.all().some((rt) => rt !== current && store.media.list(rt.db).some((m) => m.url === url));
}

export class ProjectManager {
  private runtimes = new Map<string, ProjectRuntime>();
  readonly als = new AsyncLocalStorage<ProjectRuntime>();
  private started = false;

  constructor(
    /** Datenbank des Standard-Projekts – hält auch die Projektliste und die App-Zugangsdaten */
    readonly systemDb: DB,
    private log: Log,
    private dir = path.join(config.dataDir, 'projects'),
  ) {
    activeManager = this;
    seedIfEmpty(systemDb);
    this.runtimes.set(DEFAULT_PROJECT, createRuntime(DEFAULT_PROJECT, systemDb, log));
    if (!this.list().length) this.saveList([{ id: DEFAULT_PROJECT, name: 'Haupt-Projekt', description: '', color: '#9373c5', createdAt: new Date().toISOString() }]);
    for (const p of this.list()) if (p.id !== DEFAULT_PROJECT) this.open(p.id);
  }

  list(): ProjectInfo[] {
    return store.settings.get<{ list: ProjectInfo[] }>(this.systemDb, REGISTRY, { list: [] }).list;
  }

  private saveList(list: ProjectInfo[]) {
    store.settings.set(this.systemDb, REGISTRY, { list });
  }

  info(id: string) {
    return this.list().find((p) => p.id === id);
  }

  file(id: string) {
    return path.join(this.dir, `${id}.sqlite`);
  }

  private open(id: string): ProjectRuntime {
    const existing = this.runtimes.get(id);
    if (existing) return existing;
    const db = openDb(this.file(id));
    seedIfEmpty(db);
    const rt = createRuntime(id, db, this.log);
    this.runtimes.set(id, rt);
    if (this.started) void rt.connectors.startAll();
    return rt;
  }

  get(id: string | undefined | null): ProjectRuntime | undefined {
    return id ? this.runtimes.get(id) : undefined;
  }

  get default(): ProjectRuntime {
    return this.runtimes.get(DEFAULT_PROJECT)!;
  }

  all(): ProjectRuntime[] {
    return [...this.runtimes.values()];
  }

  /** Projekt der laufenden Anfrage (oder das Standard-Projekt) */
  current(): ProjectRuntime {
    return this.als.getStore() ?? this.default;
  }

  async startAll() {
    this.started = true;
    for (const rt of this.all()) await rt.connectors.startAll();
  }

  async disposeAll() {
    for (const rt of this.all()) await rt.dispose();
    this.runtimes.clear();
  }

  // ---------- Verwalten ----------

  create(input: { name: string; description?: string; color?: string; copyFrom?: string }): ProjectInfo {
    const id = nanoid(10).replace(/[^a-zA-Z0-9_-]/g, 'x');
    fs.mkdirSync(this.dir, { recursive: true });
    const source = input.copyFrom ? this.get(input.copyFrom) : undefined;
    if (input.copyFrom && !source) throw Object.assign(new Error('Vorlage-Projekt nicht gefunden'), { statusCode: 404 });
    if (source) {
      // Kopie: Designs, Regeln, Overlays, Widgets, Chat-Overlays, Mediathek und Einstellungen übernehmen –
      // ohne Verbindungen, ohne Event-Log und mit neuen geheimen Keys
      source.db.prepare('VACUUM INTO ?').run(this.file(id));
      const db = openDb(this.file(id));
      db.prepare('DELETE FROM connections').run();
      db.prepare('DELETE FROM events').run();
      for (const o of store.overlays.list(db)) store.overlays.rotateKey(db, o.id);
      for (const w of store.widgets.list(db)) store.widgets.rotateKey(db, w.id);
      // Projektliste und App-Zugangsdaten gehören nur ins Haupt-Projekt
      db.prepare("DELETE FROM settings WHERE key IN ('projects', 'apps')").run();
      db.close();
    }
    const info: ProjectInfo = {
      id, name: input.name.trim(), description: (input.description ?? '').trim(), color: input.color || '#9373c5', createdAt: new Date().toISOString(),
    };
    this.saveList([...this.list(), info]);
    this.open(id);
    return info;
  }

  update(id: string, patch: Partial<Pick<ProjectInfo, 'name' | 'description' | 'color'>>): ProjectInfo | null {
    const list = this.list();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name.trim();
    if (patch.description !== undefined) p.description = patch.description.trim();
    if (patch.color !== undefined) p.color = patch.color;
    this.saveList(list);
    return p;
  }

  /** Projekt entfernen: Datenbank wird nicht gelöscht, sondern als Sicherung umbenannt */
  async remove(id: string): Promise<boolean> {
    if (id === DEFAULT_PROJECT) throw Object.assign(new Error('Das Haupt-Projekt kann nicht gelöscht werden'), { statusCode: 400 });
    if (!this.info(id)) return false;
    const rt = this.runtimes.get(id);
    this.runtimes.delete(id);
    await rt?.dispose();
    this.saveList(this.list().filter((p) => p.id !== id));
    const file = this.file(id);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, `${file}.geloescht-${stamp}${suffix}`);
    }
    return true;
  }

  summary(id: string): ProjectSummary | null {
    const info = this.info(id);
    const rt = this.get(id);
    if (!info || !rt) return null;
    return {
      ...info,
      isDefault: id === DEFAULT_PROJECT,
      overlays: store.overlays.list(rt.db).length,
      widgets: store.widgets.list(rt.db).length,
      connections: rt.connectors.statuses().map((c) => ({ platform: c.platform, label: c.label, state: c.state })),
      live: rt.pipeline.session.live,
    };
  }

  // ---------- Zuordnung öffentlicher Adressen ----------

  byOverlay(overlayId: string) {
    return this.all().find((rt) => !!store.overlays.get(rt.db, overlayId));
  }

  byWidget(widgetId: string) {
    return this.all().find((rt) => !!store.widgets.get(rt.db, widgetId));
  }

  /** Projekt zu einer Webhook-Adresse (/hooks/<token>) */
  byHookToken(token: string) {
    return this.all().find((rt) =>
      store.connections.list(rt.db).some((c) => {
        const d = c.data as { token?: string; webhookToken?: string };
        return (c.platform === 'webhook' && !!d.token && safeEqual(String(d.token), token))
          || (c.platform === 'betterplace' && !!d.webhookToken && safeEqual(String(d.webhookToken), token));
      }));
  }
}

/** Objekt, das jeden Zugriff an das aktuelle Projekt weiterreicht (Routen bleiben unverändert) */
function scoped<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      const target = resolve();
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(_t, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
    has(_t, prop) {
      return Reflect.has(resolve(), prop);
    },
  });
}

/** AppContext für die Routen: db, pipeline, hub … zeigen immer auf das Projekt der laufenden Anfrage */
export function scopedContext(pm: ProjectManager): AppContext {
  return {
    db: scoped(() => pm.current().db),
    hub: scoped(() => pm.current().hub),
    pipeline: scoped(() => pm.current().pipeline),
    connectors: scoped(() => pm.current().connectors),
    widgets: scoped(() => pm.current().widgets),
    chat: scoped(() => pm.current().chat),
  };
}
