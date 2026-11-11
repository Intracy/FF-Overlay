import type { DB } from '../db.js';
import * as store from '../db.js';
import { config } from '../config.js';
import type { ConnectorStatus } from '../shared/types.js';
import type { Connector, ConnectorEnv } from './types.js';
import { TwitchConnector } from './twitch/eventsub.js';
import { BetterplaceConnector } from './betterplace.js';

/** Startet und verwaltet alle Connectoren aus der Tabelle `connections`. */
export class ConnectorManager {
  private running = new Map<string, Connector>();

  constructor(private db: DB, private env: ConnectorEnv) {}

  private create(id: string, platform: string): Connector | null {
    if (platform === 'twitch') return new TwitchConnector(this.db, id, this.env);
    if (platform === 'betterplace') return new BetterplaceConnector(this.db, id, this.env, config.betterplacePollSeconds);
    return null; // Webhooks brauchen keinen laufenden Prozess
  }

  async startAll() {
    for (const c of store.connections.list(this.db)) if (c.enabled) await this.restart(c.id);
  }

  async restart(id: string) {
    await this.stop(id);
    const c = store.connections.get(this.db, id);
    if (!c || !c.enabled) return;
    const connector = this.create(c.id, c.platform);
    if (!connector) return;
    this.running.set(id, connector);
    await connector.start();
    this.env.onStatus();
  }

  async stop(id: string) {
    const c = this.running.get(id);
    if (c) await c.stop();
    this.running.delete(id);
    this.env.onStatus();
  }

  async stopAll() {
    for (const id of [...this.running.keys()]) await this.stop(id);
  }

  statuses(): ConnectorStatus[] {
    return store.connections.list(this.db).map((c) => {
      const running = this.running.get(c.id);
      if (running) return running.status();
      if (c.platform === 'webhook') return { id: c.id, platform: 'webhook', label: c.label, state: c.enabled ? 'connected' : 'disconnected', detail: 'wartet auf Anfragen' };
      return { id: c.id, platform: c.platform as ConnectorStatus['platform'], label: c.label, state: 'disconnected' };
    });
  }
}
