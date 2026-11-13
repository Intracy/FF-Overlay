import type { ConnectorStatus, NormalizedEvent } from '../shared/types.js';
import type { ChatMessage, ChatRemoval } from '../shared/chat.js';

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
  /** Chat-Nachricht für die Chat-Overlays */
  chat?: (message: ChatMessage) => void;
  /** Nachrichten entfernen (auf der Plattform gelöscht, Nutzer gebannt, Chat geleert) */
  chatRemove?: (removal: ChatRemoval) => void;
  log: { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
}
