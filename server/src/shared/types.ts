// Gemeinsame Typen für Backend, Dashboard und Overlay.
// Das Dashboard importiert diese Datei nur als Typen (kein Laufzeitcode).

export type Platform = 'twitch' | 'youtube' | 'betterplace' | 'webhook' | 'test';

export type EventType =
  | 'follow'
  | 'subscription'
  | 'cheer'
  | 'donation'
  | 'raid'
  | 'redemption'
  | 'power_up'
  | 'charity'
  | 'milestone'
  /** YouTube: Super Chat (subtype chat) und Super Sticker (subtype sticker) */
  | 'superchat'
  /** YouTube-Mitgliedschaften: new, milestone, gift, gift_recipient */
  | 'membership'
  /** Neue:r YouTube-Abonnent:in (nur öffentliche Abos) */
  | 'subscriber'
  | 'stream_status'
  | 'custom';

/** Twitch-Emote in einer Nachricht (Positionen in Zeichen, inklusive Ende). */
export interface EmotePosition {
  id: string;
  begin: number;
  end: number;
}

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
  /** Emotes in `message` (nur Twitch) */
  emotes?: EmotePosition[];
  /** Von Spender*innen freigegebenes Video (betterplace „streaming_shareable_media“, nur moderierte Aktionen) */
  media?: { videoUrl: string; videoStart: number };
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
  /** Profil (Streamlabs: „Thema“), zu dem die Regel gehört */
  profileId?: string;
  /** Standard-Alert eines Event-Typs oder Variante (Streamlabs-Begriff) */
  kind?: 'default' | 'variation';
}

export interface Profile {
  id: string;
  overlayId: string;
  name: string;
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
    /** Animation Library: Text-Effekt (text-effects.colorion.co), leer = keiner */
    effect: string;
    /** Tempo des Text-Effekts (1 = normal) */
    effectSpeed: number;
    /** Farben des Effekts: Originalfarben oder eigene Text-/Akzentfarbe */
    effectColors: 'effect' | 'text';
  };
  message: { show: boolean; font: string; size: number; weight: number; color: string; minAmount: number; allowEmotes: boolean };
  /** Text-to-Speech im Overlay (Web Speech API der Browserquelle) */
  tts: {
    enabled: boolean;
    /** Name der Stimme (leer = Standardstimme der Sprache) */
    voice: string;
    lang: string;
    minAmount: number;
    volume: number;
    /** Nachrichtenvorlage mit vorlesen */
    includeTemplate: boolean;
    /** Spam-Sicherheit: 0 aus, 1 niedrig, 2 mittel, 3 hoch */
    security: number;
    /** Ein Wort höchstens so oft vorlesen (0 = aus) */
    repetitionBlock: number;
  };
  /** Eigener Code in einem Sandbox-Frame */
  custom: { enabled: boolean; html: string; css: string; js: string; fields: string };
  /** enabled = Ein-/Ausblend-, Text-Intro/-Outro- und Buchstaben-Animationen verwenden (unabhängig von der Animation Library) */
  animation: { enabled: boolean; in: string; out: string; speedMs: number };
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
export type MessagePart = { text: string } | { emote: string; name: string };

export interface AlertPayload {
  itemId: string;
  eventId: string;
  template: AlertTemplate;
  title: TextSegment[];
  message?: string;
  /** Nachricht mit Emotes, wenn das Design Emotes erlaubt */
  messageParts?: MessagePart[];
  /** Fertig gefilterter Vorlesetext */
  tts?: string;
  /** Werte für Platzhalter im eigenen Code */
  tokens: Record<string, string>;
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
  /** Moderationsverzögerung in ms: 0 = aus, -1 = unbegrenzt (bis Freigabe) */
  moderationDelay: number;
  /** Streamlabs „Alert-Parry“: neue Alerts unterbrechen den laufenden */
  interruptMode: boolean;
  interruptDelay: number;
  /** Ereignisfilter: Schlüssel aus dem Alert-Katalog, die dieses Overlay ignoriert */
  disabledTypes: string[];
  activeProfileId: string;
  /** Hintergrund der Vorschau im Editor */
  previewBackground: string;
  /** Hochkant-Variante (9:16, 1080 × 1920) derselben Alerts */
  portrait: PortraitLayout;
}

/**
 * Darstellung im Hochformat: dieselben Alerts wie im Querformat, aber größer skaliert und
 * mit Sicherheitsabständen, damit sie auf dem Handy (TikTok, Shorts, Reels) gut lesbar sind.
 */
export interface PortraitLayout {
  /** Skalierung der Alerts in % (100 = wie im Querformat) */
  scale: number;
  /** Vertikale Lage */
  align: 'top' | 'center' | 'bottom';
  /** Sicherheitsabstand oben/unten in % der Höhe (Bedienelemente der Apps) */
  safeTop: number;
  safeBottom: number;
  /** Bild links neben Text im Hochformat untereinander anordnen */
  stackSideBySide: boolean;
}

export type EventStatus = 'queued' | 'held' | 'played' | 'filtered' | 'suppressed' | 'no_rule' | 'skipped' | 'rejected';

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
  /** Wartet auf Moderation; releaseAt null = unbegrenzt */
  held: Array<{ itemId: string; eventId: string; title: string; message?: string; releaseAt: number | null }>;
  connections: number;
}

export interface GlobalSettings {
  minDonationAmount: number;
  blockedUsers: string[];
  badWords: string[];
  badWordMode: 'censor' | 'hide';
  /** Eingebaute Liste gängiger Schimpfwörter zusätzlich verwenden */
  useDefaultBadWords: boolean;
  /** Namen mit Schimpfwörtern durch „Anonym“ ersetzen */
  anonymizeNames: boolean;
  /** Filter auch auf das Event-Log anwenden */
  censorEventLog: boolean;
  /** Session (größte Spende) bei Stream-Start automatisch zurücksetzen */
  autoResetSession: boolean;
  /** betterplace-Widgets zeigen Beispieldaten (wie der Test-Modus bei betterplace) */
  betterplaceTestMode: boolean;
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
