// Widgets nach dem Vorbild der betterplace-Livestream-Alerts
// (secure.betterplace.org → Spendenaktion → „Alerts für deinen Charity Stream“).
// Reine Daten und Typen – Backend, Dashboard und Widget-Seite benutzen diese Datei.

import { BRAND_COLOR } from './brand.js';
import type { TextStyle } from './widgets.js';

export type BpWidgetType =
  | 'bp_all'
  | 'bp_poll'
  | 'bp_total'
  | 'bp_last'
  | 'bp_top'
  | 'bp_leaderboard'
  | 'bp_progress'
  | 'bp_comment'
  | 'bp_logos'
  | 'bp_milestones'
  | 'bp_feed';

export type Align = 'left' | 'center' | 'right';

/** Gemeinsame Felder: Überschrift wie bei betterplace (Text, Ausrichtung, Schrift) */
interface Headed {
  headlineText: string;
  align: Align;
  headline: TextStyle;
}

export interface BpAllSettings {
  /** Default-Design mit Themes oder selbst gestaltete Schriften */
  designMode: 'default' | 'custom';
  theme: 'standard' | 'pixel' | 'sakura' | 'pride';
  labels: { total: string; last: string; top: string };
  headline: TextStyle;
  data: TextStyle;
}

export interface PollOption {
  text: string;
  /** Zusätzliche Stichwörter im Spendenkommentar, durch Komma getrennt (#1, #2 … gehen immer) */
  keywords: string;
}

export interface BpPollSettings {
  title: string;
  options: PollOption[];
  /** Nur aktive Abstimmungen zählen Spenden */
  active: boolean;
  /** Ab wann Spenden zählen (wird beim Aktivieren gesetzt) */
  startedAt: string;
  /** Ende der Abstimmung (beim Deaktivieren gesetzt, leer = läuft) */
  endedAt: string;
  countBy: 'amount' | 'count';
  progressColor: string;
  baseColor: string;
  /** Transparenz der Basisfarbe in % (0 = deckend) */
  baseOpacity: number;
  headline: TextStyle;
  option: TextStyle;
  data: TextStyle;
}

export interface BpTotalSettings extends Headed {
  lines: 'single' | 'multi';
  data: TextStyle;
}

export interface BpLastSettings extends Headed {
  lines: 'single' | 'multi';
  showComment: boolean;
  name: TextStyle;
  amount: TextStyle;
  comment: TextStyle;
}

export interface BpTopSettings extends Headed {
  count: number;
  display: 'list' | 'loop';
  rotateSeconds: number;
  showComment: boolean;
  name: TextStyle;
  amount: TextStyle;
  comment: TextStyle;
}

export interface BpLeaderboardSettings extends Headed {
  count: number;
  display: 'list' | 'loop';
  rotateSeconds: number;
  name: TextStyle;
  amount: TextStyle;
}

export interface BpProgressSettings extends Headed {
  display: 'both' | 'bar' | 'text';
  /** Zielbetrag in €; 0 = Zielbetrag der Spendenaktion von betterplace */
  target: number;
  barHeight: number;
  progressColor: string;
  baseColor: string;
  baseOpacity: number;
  data: TextStyle;
}

export interface BpCommentSettings extends Headed {
  /** Wie viele der letzten Kommentare nacheinander gezeigt werden */
  count: number;
  rotateSeconds: number;
  name: TextStyle;
  amount: TextStyle;
  comment: TextStyle;
}

export interface BpLogosSettings {
  /** Sekunden pro Logo */
  duration: number;
  align: Align;
  showNames: boolean;
  /** Logos der Organisationen kommen automatisch von betterplace; hier zusätzliche Bild-URLs (eine pro Zeile) */
  extraLogos: string;
  logoHeight: number;
  name: TextStyle;
}

export interface Milestone {
  amount: number;
  text: string;
}

export interface BpMilestonesSettings {
  milestones: Milestone[];
  /** „Nächster Milestone“-Anzeige + Alert oder nur Alert (Alert läuft über die Alert-Box) */
  mode: 'display_and_alert' | 'alert_only';
  headlineText: string;
  progressColor: string;
  baseColor: string;
  text: TextStyle;
  amount: TextStyle;
}

export interface BpFeedSettings {
  sort: 'newest' | 'highest';
  showComments: boolean;
  onlyWithAmount: boolean;
  max: number;
  name: TextStyle;
  amount: TextStyle;
  comment: TextStyle;
}

export interface BpSettingsMap {
  bp_all: BpAllSettings;
  bp_poll: BpPollSettings;
  bp_total: BpTotalSettings;
  bp_last: BpLastSettings;
  bp_top: BpTopSettings;
  bp_leaderboard: BpLeaderboardSettings;
  bp_progress: BpProgressSettings;
  bp_comment: BpCommentSettings;
  bp_logos: BpLogosSettings;
  bp_milestones: BpMilestonesSettings;
  bp_feed: BpFeedSettings;
}

/** Laufzeitzustand des Milestone-Widgets: bereits gefeierte Beträge */
export interface MilestonesState {
  reached: number[];
}

/** Laufzeitzustand der Abstimmung: Gewinnanimation */
export interface PollState {
  winnerAt: number;
}

export interface BpDonation {
  id: string;
  name: string;
  /** null = Betrag verborgen */
  amount: number | null;
  comment: string;
  at: string;
  isTest: boolean;
}

/** Was eine betterplace-Widget-Seite zum Rendern bekommt */
export interface BpData {
  /** Test-Modus bzw. &preview=1: Beispieldaten */
  preview: boolean;
  title: string;
  total: number;
  count: number;
  donors: number;
  /** Zielbetrag in € oder null */
  target: number | null;
  last: BpDonation | null;
  top: BpDonation[];
  leaders: Array<{ name: string; amount: number }>;
  comments: BpDonation[];
  feed: BpDonation[];
  logos: Array<{ name: string; url: string }>;
  poll?: { title: string; active: boolean; started: boolean; total: number; options: Array<{ text: string; value: number; percent: number }>; winnerAt: number; leader: number | null };
  milestones?: { list: Array<Milestone & { reached: boolean }>; next: Milestone | null; previous: number };
}

const t = (size: number, weight = 700, color = '#ffffff', font = 'Fira Sans'): TextStyle => ({ font, size, weight, color });
const ACCENT = BRAND_COLOR;

export const BP_DEFAULTS: { [K in BpWidgetType]: () => BpSettingsMap[K] } = {
  bp_all: () => ({
    designMode: 'default', theme: 'standard', labels: { total: 'Spendenstand', last: 'Letzte Spende', top: 'Top-Spende' },
    headline: t(16), data: t(16),
  }),
  bp_poll: () => ({
    title: 'Was soll als Nächstes passieren?', options: [{ text: 'Option A', keywords: '' }, { text: 'Option B', keywords: '' }],
    active: false, startedAt: '', endedAt: '', countBy: 'amount', progressColor: ACCENT, baseColor: '#ffffff', baseOpacity: 80,
    headline: t(24), option: t(16, 400), data: t(16, 400),
  }),
  bp_total: () => ({ headlineText: 'Spendenstand', align: 'center', lines: 'multi', headline: t(32), data: t(32, 700, '#ffffff', 'Montserrat') }),
  bp_last: () => ({
    headlineText: 'Letzte Spende', align: 'center', lines: 'multi', showComment: true,
    headline: t(32), name: t(18, 400), amount: t(24, 700, ACCENT), comment: t(18, 400),
  }),
  bp_top: () => ({
    headlineText: 'Top-Spenden', align: 'left', count: 3, display: 'loop', rotateSeconds: 5, showComment: false,
    headline: t(32), name: t(18, 400), amount: t(24, 700, ACCENT), comment: t(18, 400),
  }),
  bp_leaderboard: () => ({
    headlineText: 'Top Spender*in', align: 'left', count: 1, display: 'list', rotateSeconds: 5,
    headline: t(32), name: t(24), amount: t(24, 700, ACCENT),
  }),
  bp_progress: () => ({
    headlineText: 'Fortschritt zum Ziel', align: 'center', display: 'both', target: 0, barHeight: 28,
    progressColor: ACCENT, baseColor: '#ffffff', baseOpacity: 0, headline: t(16), data: t(16),
  }),
  bp_comment: () => ({
    headlineText: '', align: 'center', count: 1, rotateSeconds: 8,
    headline: t(32), name: t(14, 700, '#ffffff', 'Montserrat'), amount: t(32, 700, ACCENT), comment: t(18, 400, '#ffffff', 'Montserrat'),
  }),
  bp_logos: () => ({ duration: 5, align: 'center', showNames: false, extraLogos: '', logoHeight: 120, name: t(18) }),
  bp_milestones: () => ({
    milestones: [{ amount: 100, text: 'Wir singen ein Weihnachtslied' }, { amount: 500, text: 'Bonus-Song' }],
    mode: 'display_and_alert', headlineText: 'Nächster Milestone', progressColor: ACCENT, baseColor: '#2a2238', text: t(16, 400), amount: t(24),
  }),
  bp_feed: () => ({ sort: 'newest', showComments: true, onlyWithAmount: false, max: 50, name: t(16), amount: t(16, 700, ACCENT), comment: t(14, 400) }),
};

export const BP_INFO: Record<BpWidgetType, { label: string; description: string; width: number; height: number }> = {
  bp_all: { label: 'All-Inclusive-Alert', description: 'Spendenstand, letzte Spende und Top-Spende in einer Browserquelle', width: 900, height: 140 },
  bp_poll: { label: 'Abstimmung mit Spenden', description: 'Die Community stimmt per Spende ab, was im Stream passiert', width: 600, height: 300 },
  bp_total: { label: 'Spendenstand', description: 'Zeigt den aktuellen Spendenstand der Aktion', width: 500, height: 140 },
  bp_last: { label: 'Letzte Spende', description: 'Die letzte Spende mit Name, Betrag und Kommentar', width: 500, height: 160 },
  bp_top: { label: 'Top-Spende', description: 'Die höchsten Spenden als Liste oder nacheinander', width: 900, height: 300 },
  bp_leaderboard: { label: 'Leaderboard der Spender*innen', description: 'Wer insgesamt am meisten gespendet hat', width: 600, height: 300 },
  bp_progress: { label: 'Fortschrittsbalken', description: 'Fortschritt zum Zielbetrag der Spendenaktion', width: 800, height: 120 },
  bp_comment: { label: 'Letzter Kommentar', description: 'Spenden mit Kommentar nacheinander anzeigen', width: 500, height: 150 },
  bp_logos: { label: 'Logos der Organisationen', description: 'Für welche Organisationen gesammelt wird, im Endlos-Loop', width: 500, height: 200 },
  bp_milestones: { label: 'Milestones', description: 'Zwischenziele mit Anzeige des nächsten Milestones und Alert', width: 700, height: 120 },
  bp_feed: { label: 'Live Spenden-Feed', description: 'Alle Spenden mit Spendenstand – auch als Dock für OBS', width: 500, height: 700 },
};

export const BP_TYPES = Object.keys(BP_INFO) as BpWidgetType[];
export const isBpType = (t: string): t is BpWidgetType => t.startsWith('bp_');

/** Beispieldaten für Test-Modus und Vorschau (wie bei betterplace) */
export const BP_SAMPLE: Pick<BpData, 'title' | 'total' | 'count' | 'donors' | 'target' | 'last' | 'top' | 'leaders' | 'comments' | 'feed' | 'logos'> = (() => {
  const d = (id: string, name: string, amount: number | null, comment: string, minutes: number): BpDonation => ({
    id, name, amount, comment, at: new Date(Date.UTC(2026, 11, 24, 18, minutes)).toISOString(), isTest: true,
  });
  const feed = [
    d('s5', 'rubber duck', 50, 'I like this event', 50),
    d('s4', 'Maxi H.', 250, 'Yeah weiter so!', 40),
    d('s3', 'Anonym', null, '', 30),
    d('s2', 'Unicorn<3', 13.37, 'Für die Kinder ❤', 20),
    d('s1', 'Maxi M.', 15000, '', 10),
  ];
  return {
    title: 'Beispiel-Spendenaktion',
    total: 15313.37,
    count: 5,
    donors: 4,
    target: 20000,
    last: feed[0]!,
    top: [...feed].filter((x) => x.amount != null).sort((a, b) => b.amount! - a.amount!),
    leaders: [{ name: 'Maxi M.', amount: 15000 }, { name: 'Maxi H.', amount: 250 }, { name: 'rubber duck', amount: 50 }],
    comments: feed.filter((x) => x.comment),
    feed,
    logos: [],
  };
})();
