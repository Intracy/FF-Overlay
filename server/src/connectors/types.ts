import type { ConnectorStatus, NormalizedEvent } from '../shared/types.js';

export interface Connector {
  readonly id: string;
  status(): ConnectorStatus;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface ConnectorEnv {
  emit: (event: NormalizedEvent) => void;
  onStatus: () => void;
  /** Neuer Spendenstand von betterplace (Widgets aktualisieren, Milestones prüfen) */
  onBetterplaceStats?: () => void;
  log: { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
}
