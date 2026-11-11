import type { AlertTemplate, NormalizedEvent, TextSegment } from '../shared/types.js';
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

export function buildAlert(template: AlertTemplate, event: NormalizedEvent) {
  const title = renderFormat(template.text.format, event);
  const amount = event.amount?.value ?? 0;
  const showMessage =
    template.message.show && !!event.message?.trim() && (template.message.minAmount <= 0 || amount >= template.message.minAmount);
  return {
    itemId: nanoid(12),
    eventId: event.id,
    template,
    title,
    message: showMessage ? event.message!.trim() : undefined,
  };
}

export function defaultTemplate(id: string, name: string, format: string): AlertTemplate {
  return {
    id,
    name,
    layout: 'above',
    positioning: { mode: 'preset', image: { x: 50, y: 40 }, text: { x: 50, y: 75 } },
    media: { kind: 'none', url: '', size: 60, volume: 1 },
    sound: { url: '', volume: 0.6 },
    text: {
      format,
      font: 'Poppins',
      size: 56,
      weight: 800,
      color: '#ffffff',
      highlightColor: '#ffb703',
      strokeColor: '#000000',
      strokeWidth: 0,
      shadow: true,
      intro: '',
      letterAnimation: 'wave',
      outro: '',
    },
    message: { show: true, font: 'Inter', size: 28, weight: 600, color: '#ffffff', minAmount: 0 },
    animation: { in: 'fadeInUp', out: 'fadeOut', speedMs: 800 },
    duration: 8000,
    textDelay: 0,
  };
}
