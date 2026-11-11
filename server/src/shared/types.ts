// Gemeinsame Typen für Backend, Dashboard und Overlay.
// Das Dashboard importiert diese Datei nur als Typen (kein Laufzeitcode).

export type Platform = 'twitch' | 'betterplace' | 'webhook' | 'test';

export type EventType =
  | 'follow'
  | 'subscription'
  | 'cheer'
  | 'donation'
  | 'raid'
  | 'redemption'
  | 'stream_status'
  | 'custom';

/** Einheitliches Event-Objekt, das alle Connectoren liefern (siehe Konzept „Event-Modell“). */
export interface NormalizedEvent {
  id: string;
  platform: Platform;
  type: EventType;
  /** z. B. sub, resub, gift, community_gift, online, offline */
  subtype?: string;
  user: { id?: string; name: string; avatar?: string };
  amount?: { value: number; currency: string };
  /** Twitch-Tier: 1000, 2000, 3000 oder "prime" */
  tier?: string;
  months?: number;
  streakMonths?: number;
  /** Anzahl (Gift-Subs, Raider, Bits) */
  count?: number;
  message?: string;
  /** Name der Kanalpunkte-Belohnung o. Ä. */
  product?: string;
  gifter?: string;
  isAnonymous?: boolean;
  isTest?: boolean;
  receivedAt: string;
  raw?: unknown;
}

export type ConditionOp =
  | 'eq'
  | 'neq'
  | 'gte'
  | 'lte'
  | 'between'
  | 'contains'
  | 'regex'
  | 'empty'
  | 'notEmpty'
  | 'largestOfStream'
  | 'firstFromUser'
  | 'random';

export interface Condition {
  /** Pfad im Event, z. B. "amount.value", "tier", "months", "message" */
  field: string;
  op: ConditionOp;
  value?: string | number;
  value2?: string | number;
}

export interface RuleTrigger {
  type: EventType;
  subtype?: string;
  platform?: Platform;
}

export interface Rule {
  id: string;
  overlayId: string;
  name: string;
  trigger: RuleTrigger;
  conditions: Condition[];
  priority: number;
  weight: number;
  templateId: string;
  enabled: boolean;
  onlyWhenLive: boolean;
}

export type Layout = 'above' | 'below' | 'left' | 'textOnly';

export interface AlertTemplate {
  id: string;
  name: string;
  layout: Layout;
  positioning: {
    mode: 'preset' | 'manual';
    image: { x: number; y: number };
    text: { x: number; y: number };
  };
  media: { kind: 'none' | 'image' | 'video'; url: string; size: number; volume: number; giphyId?: string };
  sound: { url: string; volume: number };
  text: {
    format: string;
    font: string;
    size: number;
    weight: number;
    color: string;
    highlightColor: string;
    strokeColor: string;
    strokeWidth: number;
    shadow: boolean;
    /** Animate.css-Name für das Einblenden des Texts (leer = keine) */
    intro: string;
    /** Dauer-Animation pro Buchstabe: bounce, pulse, rubberBand, tada, wave, wiggle, wobble, none */
    letterAnimation: string;
    outro: string;
  };
  message: { show: boolean; font: string; size: number; weight: number; color: string; minAmount: number };
  animation: { in: string; out: string; speedMs: number };
  /** Gesamtdauer in ms */
  duration: number;
  /** Verzögerung des Texts in ms */
  textDelay: number;
}

export interface TextSegment {
  text: string;
  highlight: boolean;
}

/** Fertig aufgelöster Alert, den das Overlay nur noch abspielt. */
export interface AlertPayload {
  itemId: string;
  eventId: string;
  template: AlertTemplate;
  title: TextSegment[];
  message?: string;
}

export interface OverlayInfo {
  id: string;
  name: string;
  key: string;
  width: number;
  height: number;
  alertDelay: number;
  volume: number;
  muted: boolean;
}

export type EventStatus = 'queued' | 'played' | 'filtered' | 'suppressed' | 'no_rule' | 'skipped';

export interface EventLogEntry {
  id: string;
  event: NormalizedEvent;
  status: EventStatus;
  reason: string;
  read: boolean;
  createdAt: string;
}

export interface QueueState {
  overlayId: string;
  paused: boolean;
  muted: boolean;
  volume: number;
  playing: { itemId: string; eventId: string; title: string } | null;
  pending: Array<{ itemId: string; eventId: string; title: string }>;
  connections: number;
}

export interface GlobalSettings {
  minDonationAmount: number;
  blockedUsers: string[];
  badWords: string[];
  badWordMode: 'censor' | 'hide';
}

/** Nachrichten Backend → Overlay */
export type ServerToOverlay =
  | { t: 'hello'; overlay: OverlayInfo }
  | { t: 'alert.show'; alert: AlertPayload }
  | { t: 'alert.skip'; itemId: string }
  | { t: 'state'; muted: boolean; volume: number }
  | { t: 'reload' };

/** Nachrichten Overlay → Backend */
export type OverlayToServer =
  | { t: 'alert.started'; itemId: string }
  | { t: 'alert.done'; itemId: string }
  | { t: 'ping' };

/** Nachrichten Backend → Dashboard */
export type ServerToDashboard =
  | { t: 'event'; entry: EventLogEntry }
  | { t: 'event.update'; id: string; status: EventStatus; reason: string }
  | { t: 'queue'; state: QueueState }
  | { t: 'connectors'; status: ConnectorStatus[] };

export interface ConnectorStatus {
  id: string;
  platform: Platform;
  label: string;
  state: 'connected' | 'connecting' | 'disconnected' | 'error' | 'not_configured';
  detail?: string;
}
