import type { AlertTemplate } from '../shared/types.js';
import { BRAND_COLOR } from '../shared/brand.js';

/** Startvorlage für eigenen Code. Platzhalter: {img} {name} {user} {amount} {messageTemplate} {userMessage} {count} {months} {tier} {product} + eigene Felder */
export const DEFAULT_CUSTOM_HTML = `<div class="alert">
  <div class="media">{img}</div>
  <div class="title">{messageTemplate}</div>
  <div class="message">{userMessage}</div>
</div>`;

export const DEFAULT_CUSTOM_CSS = `.alert { display: flex; flex-direction: column; align-items: center; gap: 12px; font-family: sans-serif; color: #fff; text-align: center; }
.title { font-size: 56px; font-weight: 800; text-shadow: 0 2px 8px rgba(0,0,0,.7); }
.title .hl { color: #9373c5; }
.message { font-size: 28px; }
.media img, .media video { max-width: 600px; max-height: 500px; }`;

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
      highlightColor: BRAND_COLOR,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadow: true,
      intro: '',
      letterAnimation: 'wave',
      outro: '',
      effect: '',
      effectSpeed: 1,
      effectColors: 'effect',
    },
    message: { show: true, font: 'Inter', size: 28, weight: 600, color: '#ffffff', minAmount: 0, allowEmotes: true },
    tts: { enabled: false, voice: '', lang: 'de-DE', minAmount: 0, volume: 0.8, includeTemplate: false, security: 1, repetitionBlock: 0 },
    custom: { enabled: false, html: DEFAULT_CUSTOM_HTML, css: DEFAULT_CUSTOM_CSS, js: '', fields: '{}' },
    animation: { in: 'fadeInUp', out: 'fadeOut', speedMs: 800 },
    duration: 8000,
    textDelay: 0,
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Ergänzt ältere oder unvollständige Templates um alle neuen Felder (z. B. TTS, eigener Code). */
export function withTemplateDefaults(t: DeepPartial<AlertTemplate> & { id: string; name: string }): AlertTemplate {
  const d = defaultTemplate(t.id, t.name, '');
  const merge = (base: any, over: any): any => {
    if (over === undefined) return base;
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      const out: any = { ...base };
      for (const k of Object.keys(over ?? {})) out[k] = merge(base[k], over[k]);
      return out;
    }
    return over;
  };
  return merge(d, t) as AlertTemplate;
}
