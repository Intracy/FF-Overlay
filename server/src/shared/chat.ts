import { BRAND_COLOR } from './brand.js';

// Chat-Overlay: Nachrichten aus dem Twitch- und YouTube-Chat in einer Browserquelle.
// Reine Daten und Typen – Backend, Dashboard und Widget-Seite benutzen diese Datei.

export type ChatPlatform = 'twitch' | 'youtube' | 'test';

export type ChatRole = 'broadcaster' | 'moderator' | 'vip' | 'subscriber' | 'member' | 'verified';

export type ChatPart = { text: string } | { emote: string; name: string; url: string };

export interface ChatBadge {
  id: string;
  title: string;
  /** Bild (Twitch-Badges); ohne Bild zeigt das Overlay ein Symbol */
  url?: string;
}

export interface ChatMessage {
  id: string;
  platform: ChatPlatform;
  user: { id?: string; name: string; color?: string; avatar?: string };
  roles: ChatRole[];
  badges: ChatBadge[];
  /** Text und Emotes in Reihenfolge */
  parts: ChatPart[];
  /** reiner Text (Filter, Befehle) */
  text: string;
  /** /me-Nachricht */
  action?: boolean;
  /** Bits, Super Chat, Super Sticker: formatierter Betrag */
  amount?: string;
  receivedAt: string;
  isTest?: boolean;
}

/** Entfernen aus allen Chat-Overlays (Moderation auf der Plattform oder im Dashboard) */
export interface ChatRemoval {
  ids?: string[];
  userId?: string;
  platform?: ChatPlatform;
  all?: boolean;
}

export interface ChatTextStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
}

export type ChatTheme = 'clean' | 'boxed' | 'bubble' | 'card' | 'outline' | 'neon' | 'glass' | 'minimal';

export interface ChatSettings {
  sources: { twitch: boolean; youtube: boolean };
  theme: ChatTheme;
  /** 'up' = neue Nachrichten unten, ältere wandern nach oben (wie im Chat); 'down' = neue oben */
  direction: 'up' | 'down';
  align: 'left' | 'right';
  /** Name und Nachricht in einer Zeile */
  inline: boolean;
  maxMessages: number;
  /** Sekunden bis eine Nachricht ausblendet (0 = nie) */
  hideAfter: number;
  /** Sekunden Verzögerung zum Moderieren (gelöschte Nachrichten erscheinen nie) */
  delay: number;
  name: ChatTextStyle;
  nameColor: 'user' | 'platform' | 'custom';
  message: ChatTextStyle;
  /** Akzentfarbe: Erwähnungen, Beträge, Rahmen */
  highlightColor: string;
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
  background: { color: string; opacity: number; radius: number; padding: number; gap: number };
  showPlatform: boolean;
  showBadges: boolean;
  showAvatar: boolean;
  /** Emote-Größe in % der Textgröße */
  emoteSize: number;
  animIn: string;
  animOut: string;
  speedMs: number;
  /** Text-Effekt aus der Animation Library für den Namen ('' = keiner) */
  nameEffect: string;
  effectSpeed: number;
  effectColors: 'effect' | 'text';
  /** Super Chats, Super Sticker und Bits im Chat zeigen und hervorheben */
  showHighlights: boolean;
  hideCommands: boolean;
  hideLinks: boolean;
  /** Ausgeblendete Nutzer:innen (Bots), eine pro Zeile */
  hiddenUsers: string;
  sound: { url: string; volume: number };
}

export const CHAT_THEMES: Array<{ id: ChatTheme; label: string }> = [
  { id: 'clean', label: 'Klar (nur Text)' },
  { id: 'boxed', label: 'Kästen' },
  { id: 'bubble', label: 'Sprechblasen' },
  { id: 'card', label: 'Karten mit Akzentkante' },
  { id: 'outline', label: 'Umrandet' },
  { id: 'neon', label: 'Neon' },
  { id: 'glass', label: 'Milchglas' },
  { id: 'minimal', label: 'Minimal (Name über Text)' },
];

export const PLATFORM_COLORS: Record<ChatPlatform, string> = { twitch: '#9146ff', youtube: '#ff3b3b', test: BRAND_COLOR };

export const DEFAULT_HIDDEN_USERS = ['Nightbot', 'StreamElements', 'Streamlabs', 'Moobot', 'Fossabot', 'Streamer.bot', 'Sery_Bot', 'WizeBot'].join('\n');

export const chatDefaults = (): ChatSettings => ({
  sources: { twitch: true, youtube: true },
  theme: 'bubble',
  direction: 'up',
  align: 'left',
  inline: false,
  maxMessages: 8,
  hideAfter: 0,
  delay: 0,
  name: { font: 'Poppins', size: 22, weight: 800, color: BRAND_COLOR },
  nameColor: 'user',
  message: { font: 'Poppins', size: 24, weight: 500, color: '#ffffff' },
  highlightColor: BRAND_COLOR,
  strokeWidth: 0,
  strokeColor: '#000000',
  shadow: true,
  background: { color: '#15121d', opacity: 78, radius: 16, padding: 14, gap: 10 },
  showPlatform: true,
  showBadges: true,
  showAvatar: false,
  emoteSize: 140,
  animIn: 'fadeInUp',
  animOut: 'fadeOut',
  speedMs: 500,
  nameEffect: '',
  effectSpeed: 1,
  effectColors: 'text',
  showHighlights: true,
  hideCommands: true,
  hideLinks: false,
  hiddenUsers: DEFAULT_HIDDEN_USERS,
  sound: { url: '', volume: 0.4 },
});

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|de|net|org|tv|gg|io|ly|me)\b\S*/i;

/** Ob eine Nachricht im Chat-Overlay mit diesen Einstellungen erscheint */
export function chatVisible(s: Pick<ChatSettings, 'sources' | 'showHighlights' | 'hideCommands' | 'hideLinks' | 'hiddenUsers'>, m: ChatMessage): boolean {
  if (m.platform === 'twitch' && !s.sources.twitch) return false;
  if (m.platform === 'youtube' && !s.sources.youtube) return false;
  if (m.amount && !s.showHighlights) return false;
  if (s.hideCommands && /^\s*!/.test(m.text)) return false;
  if (s.hideLinks && URL_RE.test(m.text)) return false;
  const hidden = s.hiddenUsers.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (hidden.includes(m.user.name.toLowerCase())) return false;
  return true;
}

// ---------- Beispielnachrichten (Vorschau und „Diesen Chat testen“) ----------

const KAPPA = 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0';
const HEART = 'https://static-cdn.jtvnw.net/emoticons/v2/9/default/dark/2.0';

type Sample = Omit<ChatMessage, 'id' | 'receivedAt' | 'isTest'>;

export const CHAT_SAMPLES: Sample[] = [
  { platform: 'twitch', user: { name: 'PixelPaula', color: '#ff7ad9' }, roles: ['subscriber'], badges: [{ id: 'subscriber', title: 'Abonnent' }], parts: [{ text: 'Hallo Chat! Was für ein Stream heute ' }, { emote: '9', name: '<3', url: HEART }], text: 'Hallo Chat! Was für ein Stream heute <3' },
  { platform: 'youtube', user: { name: 'Kaffeekobold' }, roles: ['member'], badges: [{ id: 'member', title: 'Mitglied' }], parts: [{ text: 'Grüße aus Nürnberg 👋' }], text: 'Grüße aus Nürnberg 👋' },
  { platform: 'twitch', user: { name: 'rubber_duck', color: '#4ff8ff' }, roles: ['moderator'], badges: [{ id: 'moderator', title: 'Moderator' }], parts: [{ text: '@PixelPaula gleich geht es los ' }, { emote: '25', name: 'Kappa', url: KAPPA }], text: '@PixelPaula gleich geht es los Kappa' },
  { platform: 'youtube', user: { name: 'Lea' }, roles: [], badges: [], parts: [{ text: 'Für den guten Zweck! 💜' }], text: 'Für den guten Zweck! 💜', amount: '10,00 €' },
  { platform: 'twitch', user: { name: 'Nachteule', color: '#ffb703' }, roles: ['vip'], badges: [{ id: 'vip', title: 'VIP' }], parts: [{ text: 'Der Sound ist mega heute' }], text: 'Der Sound ist mega heute' },
  { platform: 'twitch', user: { name: 'Bergziege', color: '#7cfc00' }, roles: [], badges: [], parts: [{ text: 'Cheer100 Weiter so!' }], text: 'Cheer100 Weiter so!', amount: '100 Bits' },
  { platform: 'youtube', user: { name: 'FrankenFinals' }, roles: ['moderator', 'verified'], badges: [{ id: 'moderator', title: 'Moderator' }, { id: 'verified', title: 'Verifiziert' }], parts: [{ text: 'Willkommen alle zusammen! Haltet euch an die Chatregeln 🙌' }], text: 'Willkommen alle zusammen! Haltet euch an die Chatregeln 🙌' },
  { platform: 'twitch', user: { name: 'Unicorn', color: '#ff4fd8' }, roles: ['subscriber'], badges: [{ id: 'subscriber', title: 'Abonnent' }], parts: [{ text: 'GG! ' }, { emote: '25', name: 'Kappa', url: KAPPA }, { text: ' ' }, { emote: '25', name: 'Kappa', url: KAPPA }], text: 'GG! Kappa Kappa' },
];

let sampleCounter = 0;
export function sampleChatMessage(index?: number, platform?: 'twitch' | 'youtube'): ChatMessage {
  const pool = platform ? CHAT_SAMPLES.filter((s) => s.platform === platform) : CHAT_SAMPLES;
  const s = pool[(index ?? sampleCounter++) % pool.length]!;
  return { ...structuredClone(s), id: `test_chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, receivedAt: new Date().toISOString(), isTest: true };
}
