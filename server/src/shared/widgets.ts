// Widgets nach dem Vorbild der Streamlabs-Widgets, die auf dieselben Events reagieren wie die Alert-Box.
// Reine Daten und Typen – Backend, Dashboard und Widget-Seite benutzen diese Datei.

export type WidgetType = 'event_list' | 'goal' | 'label' | 'timer' | 'credits' | 'boss' | 'ticker';

export interface TextStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
}

export interface EventListSettings {
  style: 'carbon' | 'chevrons' | 'crisscross' | 'slick' | 'fiber' | 'hearts' | 'honeycomb' | 'retro' | 'solid' | 'stripes';
  themeColor: string;
  text: TextStyle;
  /** Katalog-Schlüssel (follow, sub, resub, gift, cheer, …) */
  types: string[];
  minBits: number;
  minRaiders: number;
  maxEvents: number;
  flipX: boolean;
  flipY: boolean;
  /** Beim Laden die letzten Events aus dem Log zeigen */
  keepHistory: boolean;
  /** Sekunden bis ein Eintrag ausblendet (0 = nie) */
  fadeTime: number;
  animIn: string;
  animOut: string;
  speedMs: number;
}

export type GoalType = 'donation' | 'follow' | 'sub' | 'cheer' | 'charity';

export interface GoalSettings {
  goalType: GoalType;
  title: string;
  target: number;
  /** Manueller Startwert (z. B. Spenden, die schon vor dem Stream eingegangen sind) */
  startValue: number;
  /** Ab hier zählen Events (ISO-Datum) */
  startedAt: string;
  /** Optionales Enddatum (ISO) */
  endsAt: string;
  /** Welche Subs zählen (wie bei Streamlabs) */
  includeSubs: boolean;
  includeResubs: boolean;
  includeGifts: boolean;
  layout: 'standard' | 'condensed';
  barColor: string;
  barBgColor: string;
  barThickness: number;
  barTextColor: string;
  text: TextStyle;
}

export type LabelKind =
  | 'latest_follower' | 'latest_sub' | 'latest_resub' | 'latest_gifter' | 'latest_cheer' | 'latest_donation' | 'latest_raid'
  | 'latest_redemption' | 'latest_charity'
  | 'top_donation' | 'top_donor' | 'top_cheer' | 'top_cheerer' | 'top_gifter'
  | 'total_donations' | 'total_bits' | 'total_charity' | 'count_follows' | 'count_subs' | 'count_gifted';

export interface LabelSettings {
  kind: LabelKind;
  period: 'session' | 'today' | 'week' | 'month';
  /** Platzhalter: {name} {amount} {count} {months} {message} */
  format: string;
  /** Text, solange es noch keinen Wert gibt */
  empty: string;
  align: 'left' | 'center' | 'right';
  text: TextStyle;
  shadow: boolean;
}

export interface TimerSettings {
  startMinutes: number;
  /** Obergrenze für die Restzeit in Minuten (0 = unbegrenzt) */
  maxMinutes: number;
  secondsPerFollow: number;
  secondsPerSub: number;
  secondsPerResub: number;
  secondsPerGiftedSub: number;
  secondsPer100Bits: number;
  secondsPerDonationUnit: number;
  secondsPerRaid: number;
  secondsPerRedemption: number;
  /** Nur zählen, während der Timer läuft */
  onlyWhileRunning: boolean;
  showAdded: boolean;
  endText: string;
  text: TextStyle;
  shadow: boolean;
}

export interface TimerState {
  running: boolean;
  /** Ende in ms (wenn running) */
  endsAt: number;
  /** Restzeit in ms (wenn pausiert) */
  remaining: number;
}

export interface CreditsSettings {
  theme: 'crawl' | 'default' | 'stars';
  title: string;
  subtitle: string;
  text: TextStyle;
  headingColor: string;
  include: { follows: boolean; subs: boolean; donations: boolean; cheers: boolean; raids: boolean; gifters: boolean; charity: boolean };
  headings: { follows: string; subs: string; donations: string; cheers: string; raids: string; gifters: string; charity: string };
  showAmounts: boolean;
  loop: boolean;
  loopDelay: number;
  mode: 'speed' | 'duration';
  speed: number;
  duration: number;
  playOnLoad: boolean;
  /** OBS: abspielen, wenn die Quelle sichtbar wird (Szenenwechsel) */
  playOnVisible: boolean;
}

export interface BossSettings {
  startHp: number;
  mode: 'fixed' | 'incremental' | 'overkill';
  overkillMultiplier: number;
  overkillMin: number;
  incrAmount: number;
  damagePerFollow: number;
  damagePerSub: number;
  damagePerBit: number;
  damagePerDonationUnit: number;
  damagePerRaider: number;
  /** Eigene Events des Bosses heilen ihn */
  bossHeal: boolean;
  initialName: string;
  barColor: string;
  barBgColor: string;
  barTextColor: string;
  text: TextStyle;
  killAnimation: string;
}

export interface BossState {
  name: string;
  hp: number;
  maxHp: number;
  lastDamage: { by: string; amount: number; at: number } | null;
}

export interface TickerSettings {
  types: string[];
  maxItems: number;
  /** Platzhalter: {name} {amount} {message} {type} */
  format: string;
  speed: number;
  text: TextStyle;
  amountColor: string;
  separator: string;
}

export interface WidgetSettingsMap {
  event_list: EventListSettings;
  goal: GoalSettings;
  label: LabelSettings;
  timer: TimerSettings;
  credits: CreditsSettings;
  boss: BossSettings;
  ticker: TickerSettings;
}

export interface Widget<T extends WidgetType = WidgetType> {
  id: string;
  type: T;
  name: string;
  key: string;
  settings: WidgetSettingsMap[T];
  /** Laufzeitzustand (Timer, Boss) */
  state: unknown;
  /** Hintergrund nur für die Vorschau */
  previewBackground: string;
}

/** Ein Eintrag der Ereignisliste (vom Server aufbereitet) */
export interface ListEntry {
  id: string;
  /** Katalog-Schlüssel (follow, sub, gift, …) */
  key: string;
  name: string;
  detail: string;
  isTest: boolean;
  at: string;
}

/** Was eine Widget-Seite zum Rendern bekommt */
export type WidgetData =
  | { type: 'event_list'; entries: ListEntry[] }
  | { type: 'goal'; current: number; target: number; currency: string; percent: number; endsAt: string; ended: boolean }
  | { type: 'label'; text: string }
  | { type: 'timer'; state: TimerState; lastAdded: { seconds: number; reason: string; at: number } | null; serverNow: number }
  | { type: 'credits'; sections: Array<{ key: string; heading: string; lines: string[] }> }
  | { type: 'boss'; state: BossState; serverNow: number }
  | { type: 'ticker'; items: Array<{ id: string; name: string; amount: string; message: string; type: string }> };

export type ServerToWidget =
  | { t: 'snapshot'; widget: Omit<Widget, 'key' | 'state'>; data: WidgetData }
  | { t: 'credits.roll' }
  | { t: 'reload' };

const text = (size: number, weight = 700): TextStyle => ({ font: 'Poppins', size, weight, color: '#ffffff' });
const ALL_TYPES = ['follow', 'sub', 'resub', 'gift', 'cheer', 'power_up', 'raid', 'redemption', 'charity', 'donation', 'custom'];

export const WIDGET_DEFAULTS: { [K in WidgetType]: () => WidgetSettingsMap[K] } = {
  event_list: () => ({
    style: 'crisscross', themeColor: '#777777', text: text(32, 600), types: ALL_TYPES.filter((t) => t !== 'raid' && t !== 'custom'),
    minBits: 0, minRaiders: 0, maxEvents: 4, flipX: false, flipY: false, keepHistory: true, fadeTime: 0,
    animIn: 'bounceIn', animOut: 'fadeOutDown', speedMs: 1000,
  }),
  goal: () => ({
    goalType: 'donation', title: 'Spendenziel', target: 1000, startValue: 0, startedAt: new Date().toISOString(), endsAt: '',
    includeSubs: true, includeResubs: false, includeGifts: true, layout: 'standard',
    barColor: '#46e65a', barBgColor: '#dddddd', barThickness: 48, barTextColor: '#000000', text: text(28, 700),
  }),
  label: () => ({ kind: 'latest_follower', period: 'session', format: '{name}', empty: '–', align: 'left', text: text(36, 700), shadow: true }),
  timer: () => ({
    startMinutes: 60, maxMinutes: 0, secondsPerFollow: 10, secondsPerSub: 300, secondsPerResub: 300, secondsPerGiftedSub: 300,
    secondsPer100Bits: 60, secondsPerDonationUnit: 60, secondsPerRaid: 0, secondsPerRedemption: 0, onlyWhileRunning: true,
    showAdded: true, endText: 'Zeit abgelaufen!', text: text(72, 800), shadow: true,
  }),
  credits: () => ({
    theme: 'crawl', title: 'Danke fürs Zuschauen!', subtitle: '', text: text(28, 600), headingColor: '#ffb703',
    include: { follows: true, subs: true, donations: true, cheers: true, raids: true, gifters: true, charity: true },
    headings: { follows: 'Neue Follower', subs: 'Abonnenten', donations: 'Spender', cheers: 'Bits', raids: 'Raids', gifters: 'Gift-Subs verschenkt', charity: 'Charity-Spenden' },
    showAmounts: true, loop: false, loopDelay: 1, mode: 'duration', speed: 60, duration: 30, playOnLoad: false, playOnVisible: true,
  }),
  boss: () => ({
    startHp: 1000, mode: 'fixed', overkillMultiplier: 2, overkillMin: 1000, incrAmount: 200,
    damagePerFollow: 5, damagePerSub: 300, damagePerBit: 1, damagePerDonationUnit: 200, damagePerRaider: 0, bossHeal: true,
    initialName: 'Streamer', barColor: '#46e65a', barBgColor: '#0c3416', barTextColor: '#ffffff', text: text(24, 700), killAnimation: 'hinge',
  }),
  ticker: () => ({ types: ['donation', 'charity', 'cheer'], maxItems: 10, format: '{name}: {amount}', speed: 80, text: text(32, 700), amountColor: '#32c3a6', separator: '•' }),
};

export const WIDGET_INFO: Record<WidgetType, { label: string; description: string; width: number; height: number }> = {
  event_list: { label: 'Ereignisliste', description: 'Die neuesten Events deines Kanals im Stream', width: 500, height: 400 },
  goal: { label: 'Ziel', description: 'Fortschrittsbalken für Spenden, Follower, Subs, Bits oder Charity', width: 800, height: 160 },
  label: { label: 'Stream-Label', description: 'Text wie letzter Follower, Top-Spender oder Spendensumme', width: 600, height: 80 },
  timer: { label: 'Subathon-Timer', description: 'Countdown, der durch Follows, Subs, Bits und Spenden verlängert wird', width: 600, height: 160 },
  credits: { label: 'End-Credits', description: 'Abspann mit allen Unterstützern der Session', width: 1920, height: 1080 },
  boss: { label: 'Stream-Boss', description: 'Viewer kämpfen per Follow, Sub, Bits und Spende um den Titel', width: 600, height: 160 },
  ticker: { label: 'Spenden-Ticker', description: 'Laufband mit den letzten Spenden und Cheers', width: 1920, height: 70 },
};

export const LABEL_KINDS: Record<LabelKind, string> = {
  latest_follower: 'Letzter Follower',
  latest_sub: 'Letzter Abonnent',
  latest_resub: 'Letzter Resub',
  latest_gifter: 'Letzter Sub-Schenker',
  latest_cheer: 'Letzter Cheer',
  latest_donation: 'Letzte Spende',
  latest_raid: 'Letzter Raid',
  latest_redemption: 'Letzte Kanalpunkte-Einlösung',
  latest_charity: 'Letzte Charity-Spende',
  top_donation: 'Höchste Einzelspende',
  top_donor: 'Top-Spender (Summe)',
  top_cheer: 'Höchster Einzel-Cheer',
  top_cheerer: 'Top-Cheerer (Summe)',
  top_gifter: 'Top-Sub-Schenker',
  total_donations: 'Spendensumme',
  total_bits: 'Bits gesamt',
  total_charity: 'Charity-Summe',
  count_follows: 'Anzahl neuer Follower',
  count_subs: 'Anzahl neuer Subs',
  count_gifted: 'Anzahl verschenkter Subs',
};

export const LIST_STYLES: Array<EventListSettings['style']> = ['carbon', 'chevrons', 'crisscross', 'slick', 'fiber', 'hearts', 'honeycomb', 'retro', 'solid', 'stripes'];
