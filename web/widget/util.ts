import type { ServerToWidget, TextStyle, Widget, WidgetData } from '../../server/src/shared/widgets';

// ---------- Hilfen für alle Widget-Renderer ----------

const loadedFonts = new Set<string>();
export function loadFont(family: string, weight: number) {
  const fam = family.trim();
  if (!fam || /^(sans-serif|serif|monospace|system-ui)$/i.test(fam) || loadedFonts.has(`${fam}:${weight}`)) return;
  loadedFonts.add(`${fam}:${weight}`);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@${weight}&display=block`;
  document.head.appendChild(link);
}

export function applyText(el: HTMLElement, t: TextStyle) {
  loadFont(t.font, t.weight);
  el.classList.add('w-text');
  el.style.setProperty('--font', `'${t.font.replace(/'/g, '')}'`);
  el.style.setProperty('--size', `${t.size}px`);
  el.style.setProperty('--weight', String(t.weight));
  el.style.setProperty('--color', t.color);
}

export function h(tag: string, cls = '', text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function animate(el: HTMLElement, name: string, ms: number): Promise<void> {
  if (!name) return Promise.resolve();
  return new Promise((resolve) => {
    el.style.setProperty('--animate-duration', `${ms}ms`);
    el.classList.add('animate__animated', `animate__${name}`);
    const done = () => {
      el.classList.remove(`animate__${name}`);
      resolve();
    };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, ms + 200);
  });
}

export const fmtNumber = (v: number, currency = '') =>
  currency ? new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v) : new Intl.NumberFormat('de-DE').format(v);

export type PubWidget = Omit<Widget, 'key' | 'state'>;

export interface Renderer {
  update(w: PubWidget, d: WidgetData): void;
  message?(m: ServerToWidget): void;
  dispose(): void;
}

/** Schrift direkt am Element setzen (für Widgets mit mehreren Textarten) */
export function font(el: HTMLElement, t: TextStyle) {
  loadFont(t.font, t.weight);
  el.style.fontFamily = `'${t.font.replace(/'/g, '')}', sans-serif`;
  el.style.fontSize = `${t.size}px`;
  el.style.fontWeight = String(t.weight);
  el.style.color = t.color;
  return el;
}

export const money = (v: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);

export type Snap<T extends WidgetData['type']> = Extract<WidgetData, { type: T }>;
export type { ServerToWidget };
