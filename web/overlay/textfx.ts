import '../vendor/colorion-text-effects/effects.css';
import { TEXT_EFFECTS, TEXT_EFFECT_CATEGORIES, type TextEffectInfo } from '../vendor/colorion-text-effects/catalog';

/*
 * „Animation Library“: 123 CSS-Text-Effekte von text-effects.colorion.co (MIT, ckissi/colorion-text-effects).
 * Der Effekt läuft direkt auf dem Alert-Titel – mit Schrift, Größe, Stärke, Farbe, Akzentfarbe, Kontur, Schatten,
 * Emojis und Buchstaben-Animation aus den Alert-Einstellungen. Die Effekte malen mit drei Farben:
 * --ink = Textfarbe, --ink-2/--ink-3 = Akzente (Original Magenta/Cyan oder die eigene Akzentfarbe).
 */

export { TEXT_EFFECTS, TEXT_EFFECT_CATEGORIES, type TextEffectInfo };
export const TEXT_EFFECT_IDS = new Set(TEXT_EFFECTS.map((e) => e.id));
export const textEffect = (id: string | undefined) => (id ? TEXT_EFFECTS.find((e) => e.id === id) : undefined);

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const segment = (s: string) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

export const ORIGINAL_ACCENTS = { ink2: '#FF4FD8', ink3: '#4FF8FF' };

export interface TextFxStyle {
  color: string;
  highlightColor: string;
  /** 'effect' = Originalakzente des Effekts (Magenta/Cyan), 'text' = eigene Akzentfarbe */
  colors: 'effect' | 'text';
}

/** Farb-Tokens für einen Effekt */
export function effectInks(o: TextFxStyle): Record<'--ink' | '--ink-2' | '--ink-3', string> {
  if (o.colors === 'text') {
    return { '--ink': o.color, '--ink-2': o.highlightColor, '--ink-3': `color-mix(in srgb, ${o.highlightColor} 50%, #ffffff)` };
  }
  return { '--ink': o.color, '--ink-2': ORIGINAL_ACCENTS.ink2, '--ink-3': ORIGINAL_ACCENTS.ink3 };
}

export interface TitleSegment {
  text: string;
  highlight: boolean;
}

export interface BuildOptions extends TextFxStyle {
  /** Buchstaben-Animation des Alerts (bounce, wave …) oder '' */
  letterAnimation: string;
}

const TICKER_SEP = ' ✦ ';

/**
 * Baut den Inhalt des Effekt-Elements (noch ohne Effekt-Klasse). Gibt das Element zurück, das in den Titel gehört.
 * Die Effekt-Klasse setzt erst `startTextEffect`, damit Einblend-Effekte nicht schon während des Vorladens ablaufen.
 */
export function buildEffectTitle(info: TextEffectInfo, segments: TitleSegment[], o: BuildOptions): HTMLElement {
  const plain = segments.map((s) => s.text).join('');
  const fx = document.createElement('div');
  fx.className = `ffo-cfx${info.flex ? ' ffo-cfx-flex' : ''}${info.clip ? ' ffo-cfx-clip' : ''}`;
  fx.dataset.fx = info.id;
  for (const [k, v] of Object.entries(effectInks(o))) fx.style.setProperty(k, v);
  if (info.dataText) fx.dataset.text = plain;
  fx.setAttribute('role', 'img');
  fx.setAttribute('aria-label', plain);

  let letterIndex = 0;
  const letterAnim = (ch: string) => {
    if (!o.letterAnimation || o.letterAnimation === 'none') return document.createTextNode(ch);
    const l = document.createElement('span');
    l.className = `ffo-letter ffo-l-${o.letterAnimation}`;
    l.style.animationDelay = `${letterIndex * 70}ms`;
    l.textContent = ch;
    return l;
  };
  const hl = (el: HTMLElement) => {
    el.classList.add('ffo-hl');
    el.style.setProperty('--ink', o.highlightColor);
  };

  if (info.special === 'ticker') {
    // Laufband: Text fünfmal hintereinander, eine Wiederholung = 20 % der Breite (wie im Original)
    const viewport = document.createElement('div');
    viewport.className = 'ffo-cfx-viewport';
    for (let r = 0; r < 5; r++) {
      for (const seg of segments) {
        const span = document.createElement('span');
        span.textContent = seg.text.replace(/ /g, ' ');
        if (seg.highlight) hl(span);
        fx.appendChild(span);
      }
      fx.appendChild(document.createTextNode(TICKER_SEP));
    }
    viewport.appendChild(fx);
    return viewport;
  }

  if (info.perLetter || info.special === 'decoder') {
    // jeder Buchstabe als <b style="--i:n">, wortweise gebündelt (Umbruch nur zwischen Wörtern)
    const letters = segments.flatMap((seg) => segment(seg.text).map((ch) => ({ ch, highlight: seg.highlight })));
    let word: HTMLElement | null = null;
    letters.forEach((l, i) => {
      if (/^\s$/.test(l.ch) && info.special !== 'textpath') {
        word = null;
        const sp = document.createElement('span');
        sp.className = 'ffo-fx-space';
        sp.textContent = ' ';
        fx.appendChild(sp);
        return;
      }
      const b = document.createElement('b');
      b.setAttribute('aria-hidden', 'true');
      b.style.setProperty('--i', String(i));
      if (l.highlight) hl(b);
      b.appendChild(letterAnim(l.ch === ' ' ? ' ' : l.ch));
      letterIndex++;
      if (info.special === 'textpath') {
        fx.appendChild(b);
        return;
      }
      if (!word) {
        word = document.createElement('span');
        word.className = 'ffo-word';
        fx.appendChild(word);
      }
      word.appendChild(b);
    });
    return fx;
  }

  for (const seg of segments) {
    const span = document.createElement('span');
    if (seg.highlight) hl(span);
    if (o.letterAnimation && o.letterAnimation !== 'none') {
      for (const part of seg.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          span.appendChild(document.createTextNode(part));
          continue;
        }
        const w = document.createElement('span');
        w.className = 'ffo-word';
        for (const ch of segment(part)) {
          w.appendChild(letterAnim(ch));
          letterIndex++;
        }
        span.appendChild(w);
      }
    } else span.textContent = seg.text;
    fx.appendChild(span);
  }
  if (info.special === 'annotate') {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const ring = document.createElementNS(NS, 'path');
    ring.setAttribute('class', 'fx-annotate-ring');
    ring.setAttribute('pathLength', '100');
    ring.setAttribute('d', 'M 104 8 C 58 5 22 18 12 36 C 2 56 30 82 78 90 C 126 98 178 88 190 68 C 202 48 170 20 122 10 C 108 7 92 6 78 8');
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('class', 'fx-annotate-line');
    line.setAttribute('pathLength', '100');
    line.setAttribute('d', 'M 30 82 C 52 76 68 86 92 80 S 132 74 152 82 S 168 84 172 78');
    svg.append(ring, line);
    fx.appendChild(svg);
  }
  return fx;
}

export interface RunningFx {
  stop: () => void;
}

/** Zeilen des (umbrochenen) Texts im Effekt-Element, Breiten in em */
function measureLines(fx: HTMLElement, plainText: string, em: number): Array<{ text: string; width: number }> {
  const words = plainText.split(/\s+/).filter(Boolean);
  const spans = words.map((w) => {
    const s = document.createElement('span');
    s.textContent = w;
    return s;
  });
  fx.replaceChildren(...spans.flatMap((s, i) => (i ? [document.createTextNode(' '), s] : [s])));
  const lines: Array<{ top: number; words: HTMLElement[] }> = [];
  for (const s of spans) {
    const last = lines.at(-1);
    if (last && Math.abs(last.top - s.offsetTop) < 2) last.words.push(s);
    else lines.push({ top: s.offsetTop, words: [s] });
  }
  return lines.map((l) => {
    const first = l.words[0]!;
    const lastW = l.words.at(-1)!;
    return { text: l.words.map((w) => w.textContent).join(' '), width: (lastW.offsetLeft + lastW.offsetWidth - first.offsetLeft) / em };
  });
}

const SCRAMBLE = '▓▒░#%&*$€£☰01ΣΩ¥';

/** Startet den Effekt: Effekt-Klasse setzen, textabhängige Maße ausrechnen, Tempo anwenden. */
export function startTextEffect(root: HTMLElement, info: TextEffectInfo, plainText: string, speed = 1): RunningFx {
  const fx = (root.classList.contains('ffo-cfx') ? root : root.querySelector('.ffo-cfx')) as HTMLElement | null;
  if (!fx) return { stop: () => undefined };
  let timer: ReturnType<typeof setInterval> | undefined;
  let raf = 0;

  // Breite des Texts in em – im selben Koordinatensystem gemessen (funktioniert auch mit zoom im Hochformat)
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:1em;height:0;position:absolute;visibility:hidden';
  fx.appendChild(probe);
  const em = probe.offsetWidth || 1;
  const widthEm = fx.scrollWidth / em;
  probe.remove();
  const fontPx = parseFloat(getComputedStyle(fx).fontSize) || 48;
  const graphemes = segment(plainText);

  if (info.special === 'typewriter') {
    fx.style.setProperty('--fx-w', `${widthEm.toFixed(3)}em`);
    fx.style.setProperty('--fx-n', String(Math.max(1, graphemes.length)));
  }
  if (info.special === 'textpath') {
    // Buchstaben fahren auf einer Kurve: Abstände wie im echten Text (Proportionalschrift), Pfad etwas breiter als der Text
    const letters = Array.from(fx.querySelectorAll('b'));
    fx.style.whiteSpace = 'nowrap'; // zum Messen in einer Zeile
    fx.style.maxWidth = 'none';
    const left = Math.min(...letters.map((b) => b.offsetLeft));
    const centers = letters.map((b) => b.offsetLeft - left + b.offsetWidth / 2);
    const textW = Math.max(1, ...letters.map((b) => b.offsetLeft - left + b.offsetWidth));
    const w = Math.max(6 * fontPx, textW * 1.35);
    const h = Math.min(w * 0.43, 4.3 * fontPx);
    const p = { x0: w * 0.06, y0: h * 0.8, cx: w / 2, cy: h * 0.12, x1: w * 0.94, y1: h * 0.8 };
    let len = 0;
    for (let i = 1, px = p.x0, py = p.y0; i <= 40; i++) {
      const t = i / 40;
      const x = (1 - t) ** 2 * p.x0 + 2 * (1 - t) * t * p.cx + t * t * p.x1;
      const y = (1 - t) ** 2 * p.y0 + 2 * (1 - t) * t * p.cy + t * t * p.y1;
      len += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    fx.style.whiteSpace = '';
    fx.style.maxWidth = '';
    const span = Math.min(0.85, textW / len);
    letters.forEach((b, i) => b.style.setProperty('--d', `${((centers[i]! / textW) * span * 100).toFixed(2)}%`));
    fx.style.setProperty('--fx-ride', `${Math.min(40, (1 - span) * 100).toFixed(1)}%`);
    fx.style.setProperty('--fx-pw', `${w}px`);
    fx.style.setProperty('--fx-ph', `${h}px`);
    const f = (n: number) => n.toFixed(1);
    fx.style.setProperty('--fx-path', `path('M ${f(p.x0)} ${f(p.y0)} Q ${f(p.cx)} ${f(p.cy)} ${f(p.x1)} ${f(p.y1)}')`);
  }
  if (info.special === 'contour') {
    // wie im Original: Schriftgröße 40 im SVG-Koordinatensystem, Zeilenhöhe 56 – mehrzeilig wie der umbrochene Titel
    const lines = measureLines(fx, plainText, em);
    const NS = 'http://www.w3.org/2000/svg';
    const vbW = Math.max(40, Math.max(...lines.map((l) => l.width)) * 40 * 1.04 + 8);
    const lineH = 46;
    const vbH = 56 + (lines.length - 1) * lineH;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${vbW.toFixed(1)} ${vbH}`);
    svg.setAttribute('class', 'fx-contour');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', plainText);
    svg.style.width = `${(vbW / 40).toFixed(3)}em`;
    svg.style.height = `${(vbH / 40).toFixed(3)}em`;
    lines.forEach((l, i) => {
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', '50%');
      text.setAttribute('y', String(28 + i * lineH));
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '40');
      text.textContent = l.text;
      svg.appendChild(text);
    });
    fx.replaceChildren(svg);
  }
  if (info.special === 'decoder') {
    // Cipher: Zeichen werden entschlüsselt, stehen, und verschlüsseln sich wieder (Zyklus 4 s wie im Original)
    const letters = Array.from(fx.querySelectorAll('b'));
    const original = letters.map((b) => b.textContent ?? '');
    const started = performance.now();
    const tick = () => {
      const t = (((performance.now() - started) / 1000) * speed % 4) / 4;
      letters.forEach((b, i) => {
        const pos = letters.length > 1 ? i / (letters.length - 1) : 0;
        const clean = t < 0.4 ? t / 0.4 >= pos * 0.85 + 0.1 : t < 0.82 ? true : (t - 0.82) / 0.18 < pos;
        const target = b.firstChild instanceof HTMLElement ? b.firstChild : b;
        target.textContent = clean ? original[i]! : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]!;
        b.classList.toggle('ffo-scrambled', !clean);
      });
    };
    tick();
    timer = setInterval(tick, 80);
  }

  // Wireframe: die Klasse sitzt (wie im Original) am SVG, nicht am Container
  if (info.special !== 'contour') fx.classList.add(`fx-${info.id}`);
  if (speed !== 1) {
    raf = requestAnimationFrame(() => {
      for (const a of fx.getAnimations({ subtree: true })) a.updatePlaybackRate(speed);
    });
  }
  return {
    stop: () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
    },
  };
}
