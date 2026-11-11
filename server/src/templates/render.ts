import type { AlertPayload, AlertTemplate, EmotePosition, MessagePart, NormalizedEvent, TextSegment } from '../shared/types.js';
import { nanoid } from 'nanoid';

const TIER_LABEL: Record<string, string> = { '1000': 'Tier 1', '2000': 'Tier 2', '3000': 'Tier 3', prime: 'Prime' };

export function formatAmount(event: NormalizedEvent): string {
  if (!event.amount) return event.count != null ? String(event.count) : '';
  const { value, currency } = event.amount;
  if (currency === 'BITS') return `${value} Bits`;
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

/** Werte für Platzhalter. {name} ist ein Alias für {user} (kompatibel zu Streamlabs-Vorlagen). */
export function tokenValues(event: NormalizedEvent): Record<string, string> {
  const user = event.isAnonymous ? 'Anonym' : event.user.name;
  return {
    user,
    name: user,
    amount: formatAmount(event),
    count: event.count != null ? String(event.count) : '',
    months: event.months != null ? String(event.months) : '',
    streak: event.streakMonths != null ? String(event.streakMonths) : '',
    tier: event.tier ? TIER_LABEL[event.tier] ?? event.tier : '',
    message: event.message ?? '',
    product: event.product ?? '',
    reward: event.product ?? '',
    gifter: event.gifter ?? '',
    platform: event.platform,
  };
}

/** Diese Platzhalter werden im Alert in der Akzentfarbe hervorgehoben. */
const HIGHLIGHT = new Set(['user', 'name', 'amount', 'count', 'months', 'streak', 'tier', 'product', 'reward', 'gifter']);

/**
 * Löst eine Vorlage wie „{user} hat {amount} gespendet!“ in Segmente auf.
 * Das Overlay setzt die Segmente nur als Text ein (textContent) – nie als HTML.
 */
export function renderFormat(format: string, event: NormalizedEvent): TextSegment[] {
  const values = tokenValues(event);
  const segments: TextSegment[] = [];
  const re = /\{([a-zA-Z_]+)\}/g;
  let last = 0;
  for (let m = re.exec(format); m; m = re.exec(format)) {
    if (m.index > last) segments.push({ text: format.slice(last, m.index), highlight: false });
    const key = m[1]!;
    if (key in values) {
      if (values[key]) segments.push({ text: values[key]!, highlight: HIGHLIGHT.has(key) });
    } else {
      segments.push({ text: m[0], highlight: false });
    }
    last = m.index + m[0].length;
  }
  if (last < format.length) segments.push({ text: format.slice(last), highlight: false });
  return segments.filter((s) => s.text !== '');
}

export function segmentsToText(segments: TextSegment[]): string {
  return segments.map((s) => s.text).join('');
}

/** Teilt eine Nachricht in Text und Twitch-Emotes (Positionen in Zeichen, inkl. Ende). */
export function messageParts(message: string, emotes: EmotePosition[] | undefined): MessagePart[] {
  const chars = Array.from(message);
  const sorted = [...(emotes ?? [])].filter((e) => e.begin >= 0 && e.end < chars.length && e.begin <= e.end).sort((a, b) => a.begin - b.begin);
  const parts: MessagePart[] = [];
  let pos = 0;
  for (const e of sorted) {
    if (e.begin < pos) continue;
    if (e.begin > pos) parts.push({ text: chars.slice(pos, e.begin).join('') });
    parts.push({ emote: e.id, name: chars.slice(e.begin, e.end + 1).join('') });
    pos = e.end + 1;
  }
  if (pos < chars.length) parts.push({ text: chars.slice(pos).join('') });
  return parts;
}

/**
 * Spam-Sicherheit für Text-to-Speech (Stufen wie bei Streamlabs: aus, niedrig, mittel, hoch).
 * niedrig: Links entfernen · mittel: + Zeichen-/Wortwiederholungen kürzen · hoch: + nur Buchstaben, Ziffern, Satzzeichen
 */
export function sanitizeTts(text: string, security: number, repetitionBlock: number): string {
  let t = text.normalize('NFC');
  if (security >= 1) t = t.replace(/https?:\/\/\S+|www\.\S+/gi, '');
  if (security >= 2) {
    t = t.replace(/(.)\1{3,}/gu, '$1$1$1');
    t = t.replace(/\b(\S+)(\s+\1\b){2,}/giu, '$1 $1');
  }
  if (security >= 3) t = t.replace(/[^\p{L}\p{N}\s.,!?;:'"€$%&()-]/gu, '');
  if (repetitionBlock > 0) {
    const counts = new Map<string, number>();
    t = t.split(/(\s+)/).filter((w) => {
      if (!w.trim()) return true;
      const k = w.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)! <= repetitionBlock;
    }).join('');
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function buildAlert(template: AlertTemplate, event: NormalizedEvent): AlertPayload {
  const title = renderFormat(template.text.format, event);
  const amount = event.amount?.value ?? 0;
  const msg = event.message?.trim() ?? '';
  const showMessage = template.message.show && !!msg && (template.message.minAmount <= 0 || amount >= template.message.minAmount);

  let tts: string | undefined;
  const tt = template.tts;
  if (tt.enabled && (tt.minAmount <= 0 || amount >= tt.minAmount)) {
    const raw = [tt.includeTemplate ? segmentsToText(title) : '', msg].filter(Boolean).join('. ');
    tts = sanitizeTts(raw, tt.security, tt.repetitionBlock) || undefined;
  }

  const values = tokenValues(event);
  return {
    itemId: nanoid(12),
    eventId: event.id,
    template,
    title,
    message: showMessage ? msg : undefined,
    messageParts: showMessage && template.message.allowEmotes && event.emotes?.length ? messageParts(msg, event.emotes) : undefined,
    tts,
    tokens: { ...values, messageTemplate: segmentsToText(title), userMessage: showMessage ? msg : '' },
  };
}

export { defaultTemplate } from './defaults.js';
