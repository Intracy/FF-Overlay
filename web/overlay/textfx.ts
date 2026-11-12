import { color, createEffect, effectDefaults, type Color, type EffectHandle } from '../vendor/browsertexteffects/index.js';

/*
 * „Animation Library“: 37 Text-Effekte aus browsertexteffects (MIT, Don Lair; Port von TerminalTextEffects).
 * Der Effekt läuft über dem eigentlichen Titel – mit dessen Schrift, Größe, Stärke, Farbe, Kontur und Schatten.
 * Danach wird nahtlos zum echten Titel übergeblendet, damit Akzentfarben, Emojis und Buchstaben-Animationen erhalten bleiben.
 */

export interface TextEffectInfo {
  id: string;
  label: string;
  description: string;
  /** ungefähre Dauer bei Tempo 1× mit einem kurzen Alert-Text (gemessen) */
  seconds: number;
}

export const TEXT_EFFECTS: TextEffectInfo[] = [
  { id: 'beams', label: 'Beams', description: 'Lichtstrahlen fegen über den Text', seconds: 3 },
  { id: 'binarypath', label: 'Binary Path', description: 'Binärziffern wandern auf Pfaden zum Text', seconds: 10 },
  { id: 'blackhole', label: 'Black Hole', description: 'Buchstaben kreisen in ein schwarzes Loch', seconds: 10 },
  { id: 'bouncyballs', label: 'Bouncy Balls', description: 'Buchstaben hüpfen an ihren Platz', seconds: 2 },
  { id: 'bubbles', label: 'Bubbles', description: 'Text steigt wie Blasen auf', seconds: 3 },
  { id: 'burn', label: 'Burn', description: 'Text brennt sich ein', seconds: 5.5 },
  { id: 'colorshift', label: 'Color Shift', description: 'Farben laufen durch den Text', seconds: 9 },
  { id: 'crumble', label: 'Crumble', description: 'Text zerbröselt und setzt sich zusammen', seconds: 4 },
  { id: 'decrypt', label: 'Decrypt', description: 'Text wird Zeichen für Zeichen entschlüsselt', seconds: 10 },
  { id: 'errorcorrect', label: 'Error Correct', description: 'Fehlerkorrektur bringt Zeichen an ihren Platz', seconds: 3 },
  { id: 'expand', label: 'Expand', description: 'Text dehnt sich aus der Mitte aus', seconds: 1 },
  { id: 'fireworks', label: 'Fireworks', description: 'Buchstaben explodieren wie ein Feuerwerk', seconds: 21 },
  { id: 'highlight', label: 'Highlight', description: 'Ein Lichtschein streicht über den Text', seconds: 2.5 },
  { id: 'laseretch', label: 'Laser Etch', description: 'Ein Laser graviert den Text', seconds: 4 },
  { id: 'matrix', label: 'Matrix', description: 'Zeichenregen wie in Matrix', seconds: 16 },
  { id: 'middleout', label: 'Middle Out', description: 'Text erscheint von der Mitte nach außen', seconds: 1.5 },
  { id: 'orbittingvolley', label: 'Orbiting Volley', description: 'Buchstaben umkreisen den Text und landen', seconds: 3 },
  { id: 'overflow', label: 'Overflow', description: 'Text läuft über und rastet ein', seconds: 0.5 },
  { id: 'pour', label: 'Pour', description: 'Buchstaben werden von oben eingegossen', seconds: 2 },
  { id: 'print', label: 'Print', description: 'Schreibmaschine', seconds: 1 },
  { id: 'rain', label: 'Rain', description: 'Buchstaben regnen herunter', seconds: 1 },
  { id: 'randomsequence', label: 'Random Sequence', description: 'Buchstaben erscheinen in zufälliger Reihenfolge', seconds: 1.5 },
  { id: 'rings', label: 'Rings', description: 'Ringe drehen sich und geben den Text frei', seconds: 23 },
  { id: 'scattered', label: 'Scattered', description: 'Verstreute Buchstaben finden zusammen', seconds: 2 },
  { id: 'slice', label: 'Slice', description: 'Text schneidet sich ins Bild', seconds: 0.5 },
  { id: 'slide', label: 'Slide', description: 'Text gleitet herein', seconds: 2 },
  { id: 'smoke', label: 'Smoke', description: 'Text erscheint aus Rauch', seconds: 2.5 },
  { id: 'spotlights', label: 'Spotlights', description: 'Scheinwerfer beleuchten den Text', seconds: 12 },
  { id: 'spray', label: 'Spray', description: 'Buchstaben werden aufgesprüht', seconds: 1 },
  { id: 'swarm', label: 'Swarm', description: 'Ein Schwarm formt den Text', seconds: 25 },
  { id: 'sweep', label: 'Sweep', description: 'Ein Wisch deckt den Text auf', seconds: 3.5 },
  { id: 'synthgrid', label: 'Synth Grid', description: 'Synthwave-Gitter', seconds: 5.5 },
  { id: 'thunderstorm', label: 'Thunderstorm', description: 'Blitze lassen den Text aufleuchten', seconds: 9.5 },
  { id: 'unstable', label: 'Unstable', description: 'Text zittert und stabilisiert sich', seconds: 4.5 },
  { id: 'vhstape', label: 'VHS Tape', description: 'VHS-Bandstörung', seconds: 11.5 },
  { id: 'waves', label: 'Waves', description: 'Wellen laufen durch den Text', seconds: 8.5 },
  { id: 'wipe', label: 'Wipe', description: 'Text wird von einer Seite aufgewischt', seconds: 2.5 },
];

export const TEXT_EFFECT_IDS = new Set(TEXT_EFFECTS.map((e) => e.id));

export interface TextFxOptions {
  effect: string;
  speed: number;
  /** 'effect' = Originalfarben des Effekts, 'text' = eigene Text- und Akzentfarbe */
  colors: 'effect' | 'text';
  color: string;
  highlightColor: string;
  /** CSS-zoom der Alert-Fläche (Hochformat), damit Messungen stimmen */
  zoom?: number;
}

export interface RunningFx {
  /** erfüllt, sobald der Effekt fertig ist und der echte Titel sichtbar ist */
  done: Promise<void>;
  /** sofort zum echten Titel wechseln */
  finish: () => void;
  stop: () => void;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const segment = (s: string) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

const isColor = (v: unknown): v is Color => !!v && typeof v === 'object' && typeof (v as Color).rgbHex === 'string';
const hex = (c: string) => c.replace('#', '').slice(0, 6);

/** Farb-Einstellungen für den Effekt: Endfarbe immer = Textfarbe; optional alle Effektfarben in den eigenen Farben */
export function effectColors(effect: string, o: Pick<TextFxOptions, 'colors' | 'color' | 'highlightColor'>): Record<string, unknown> {
  const defaults = effectDefaults[effect] ?? {};
  const text = color(hex(o.color));
  const accent = color(hex(o.highlightColor));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(defaults)) {
    const isFinal = /final/i.test(k);
    if (Array.isArray(v) && v.length && v.every(isColor)) {
      if (isFinal) out[k] = [text, text];
      else if (o.colors === 'text') out[k] = v.length === 1 ? [accent] : [accent, text];
    } else if (isColor(v)) {
      if (isFinal) out[k] = text;
      else if (o.colors === 'text') out[k] = accent;
    }
  }
  return out;
}

/** Bricht Text in Zeilen mit höchstens `cols` Zeichen um und zentriert sie (Raster wie im Terminal). */
export function wrapForGrid(text: string, cols: number, center = true): string {
  const max = Math.max(4, cols);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (segment(w).length > max) {
      if (line) {
        lines.push(line);
        line = '';
      }
      const chars = segment(w);
      lines.push(chars.slice(0, max).join(''));
      w = chars.slice(max).join('');
    }
    const candidate = line ? `${line} ${w}` : w;
    if (segment(candidate).length > max) {
      lines.push(line);
      line = w;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const width = Math.max(...lines.map((l) => segment(l).length));
  return lines.map((l) => (center ? ' '.repeat(Math.floor((width - segment(l).length) / 2)) : '') + l).join('\n');
}

/**
 * Spielt den Effekt über `title` ab. Der Titel selbst ist währenddessen unsichtbar (behält aber seinen Platz)
 * und wird am Ende eingeblendet.
 */
export function runTextEffect(title: HTMLElement, plainText: string, o: TextFxOptions): RunningFx {
  const zoom = o.zoom ?? 1;
  const cs = getComputedStyle(title);
  const fontSize = parseFloat(cs.fontSize) || 48;
  const content = Array.from(title.childNodes) as HTMLElement[];
  title.style.position = 'relative';
  title.style.visibility = 'hidden';

  const leftAligned = /^(left|start)$/.test(cs.textAlign);
  // Hülle liegt über dem Titel; die Bibliothek setzt am inneren Container selbst position/size
  const wrap = document.createElement('div');
  wrap.className = `ffo-fx-wrap${leftAligned ? ' left' : ''}`;
  // eigenes Koordinatensystem ohne zoom, damit die Messungen der Bibliothek stimmen
  if (zoom !== 1) {
    wrap.style.zoom = String(1 / zoom);
    wrap.style.fontSize = `${fontSize * zoom}px`;
  }
  const fx = document.createElement('div');
  fx.className = 'ffo-fx';
  wrap.appendChild(fx);
  title.appendChild(wrap);

  // Zellbreite = mittlere Zeichenbreite des Texts in der echten Schrift (sichtbare Pixel)
  const graphemes = segment(plainText);
  const ctx = document.createElement('canvas').getContext('2d');
  let cell = fontSize * 0.6 * zoom;
  if (ctx) {
    ctx.font = `${cs.fontWeight} ${fontSize * zoom}px ${cs.fontFamily}`;
    const w = ctx.measureText(plainText).width;
    if (w > 0 && graphemes.length) cell = w / graphemes.length;
  }
  fx.dataset.cellWidth = String(cell);
  // verfügbare Breite: maximale Textbreite der Alert-Fläche (nicht die aktuelle, schmalere Titelbreite)
  const parent = title.parentElement;
  const maxW = parent ? parseFloat(getComputedStyle(parent).maxWidth) : NaN;
  const available = (Number.isFinite(maxW) ? maxW : Math.max(parent?.clientWidth ?? 0, title.clientWidth)) * zoom;
  const text = wrapForGrid(plainText, Math.floor(available / cell), !leftAligned);

  let handle: EffectHandle | null = null;
  let finished = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const reveal = () => {
    if (finished) return;
    finished = true;
    handle?.stop();
    for (const n of content) if (n instanceof HTMLElement) n.style.opacity = '0';
    wrap.style.pointerEvents = 'none';
    title.style.visibility = 'visible';
    wrap.style.transition = 'opacity 450ms ease';
    requestAnimationFrame(() => {
      wrap.style.opacity = '0';
      for (const n of content) {
        if (!(n instanceof HTMLElement)) continue;
        n.style.transition = 'opacity 450ms ease';
        n.style.opacity = '1';
      }
    });
    setTimeout(() => {
      wrap.remove();
      resolveDone();
    }, 480);
  };

  try {
    handle = createEffect(fx, text, o.effect, {
      ...effectColors(o.effect, o),
      lineHeight: 1.15,
      speed: o.speed,
      onComplete: reveal,
    });
    handle.start();
  } catch {
    reveal();
  }

  return {
    done,
    finish: reveal,
    stop: () => {
      finished = true;
      handle?.stop();
      wrap.remove();
      resolveDone();
    },
  };
}
