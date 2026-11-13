#!/usr/bin/env node
/*
 * Übernimmt die 123 CSS-Text-Effekte von https://text-effects.colorion.co (github.com/ckissi/colorion-text-effects, MIT)
 * in die Animation Library und passt sie an Alerts an:
 *  - Schrift, Größe und Stärke kommen aus dem Alert (die feste Schrift der Effekte wird entfernt)
 *  - alle px-Werte werden in em umgerechnet, damit der Effekt mit der Schriftgröße mitwächst
 *  - beliebiger Text statt des Beispielworts (Schreibmaschine, Rotator, Path-Ride, Wireframe, Cipher)
 *  - mehrzeiliger Text bricht zwischen Wörtern um
 *  - prefers-reduced-motion wird nicht ausgewertet (OBS/Overlay soll immer animieren)
 *
 * Aufruf: node scripts/vendor-text-effects.mjs <Pfad zum geklonten Repo>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
  console.error('Pfad zum Repo colorion-text-effects fehlt');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'web/vendor/colorion-text-effects');
mkdirSync(outDir, { recursive: true });

const css = readFileSync(join(src, 'src/styles/global.css'), 'utf8');
const effectsTs = readFileSync(join(src, 'src/data/effects.ts'), 'utf8');
const seoTs = readFileSync(join(src, 'src/data/seo.ts'), 'utf8');
let commit = '';
try {
  commit = execSync('git rev-parse HEAD', { cwd: src }).toString().trim();
} catch {
  /* egal */
}

// ---------- Katalog ----------
const effects = [...effectsTs.matchAll(/\{\s*index: '(\d+)',\s*name: '([^']+)',\s*type: '([a-z0-9]+)',\s*text: '([^']*)',?\s*\}/g)].map((m) => ({
  index: m[1], name: m[2], type: m[3], word: m[4],
}));
const setFrom = (name) => {
  const m = effectsTs.match(new RegExp(`export const ${name} = new Set<EffectType>\\(\\[([\\s\\S]*?)\\]\\)`));
  return new Set([...(m?.[1] ?? '').matchAll(/'([a-z0-9]+)'/g)].map((x) => x[1]));
};
const perLetter = setFrom('perLetter');
const dataText = setFrom('usesDataText');
const seo = Object.fromEntries([...seoTs.matchAll(/^\s+([a-z0-9]+): \{ slug: '[^']*', keyword: '([^']*)', category: '([a-z]+)' \}/gm)].map((m) => [m[1], { keyword: m[2], category: m[3] }]));
const labelsBlock = seoTs.match(/export const categoryLabels[^{]*\{([\s\S]*?)\};/)?.[1] ?? '';
const categoryLabels = Object.fromEntries([...labelsBlock.matchAll(/([a-z]+): '([^']+)'/g)].map((m) => [m[1], m[2]]));

// ---------- CSS zerlegen ----------
const start = css.search(/\/\*\s*01\s/);
const end = css.indexOf('/* ---------- Lazy loading');
const section = css.slice(start, end);
const markers = [...section.matchAll(/\/\*\s*(\d{2,})\s+((?:[^*]|\*(?!\/))*)\*\//g)];
const blocks = new Map();
markers.forEach((m, i) => {
  const s = m.index;
  const e = i + 1 < markers.length ? markers[i + 1].index : section.length;
  const blurb = m[2].replace(/\s+/g, ' ').split(/\s+—\s+/).slice(1).join(' — ').trim();
  blocks.set(m[1], { css: section.slice(s, e).trim(), blurb });
});

/** entfernt @media (prefers-reduced-motion …) { … } samt Inhalt */
function stripReducedMotion(s) {
  let out = '';
  let i = 0;
  const re = /@media\s*\(prefers-reduced-motion[^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    out += s.slice(i, m.index);
    let j = m.index + m[0].length;
    let depth = 1;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    i = j;
    re.lastIndex = j;
  }
  return out + s.slice(i);
}

/** px → em (bezogen auf die Schriftgröße des Effekts); data:-URLs bleiben unangetastet */
function pxToEm(s, base) {
  const urls = [];
  s = s.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, (u) => `__URL${urls.push(u) - 1}__`);
  s = s.replace(/(-?\d*\.?\d+)px\b/g, (_, v) => {
    const n = Number(v) / base;
    return `${Number(n.toFixed(4))}em`;
  });
  return s.replace(/__URL(\d+)__/g, (_, i) => urls[Number(i)]);
}

/** Deklarationen der Hauptregel `.fx-x { … }` bearbeiten */
function editMainRule(s, type, fn) {
  const re = new RegExp(`(^|\\n)(\\.fx-${type})\\s*\\{([^}]*)\\}`);
  return s.replace(re, (all, pre, sel, body) => `${pre}${sel} {${fn(body)}}`);
}

const catalog = [];
const cssOut = [];
for (const fx of effects) {
  const b = blocks.get(fx.index);
  if (!b) throw new Error(`Kein CSS für ${fx.index} ${fx.name}`);
  let s = stripReducedMotion(b.css);
  const fontM = s.match(/font:\s*\d{3}\s+(\d+(?:\.\d+)?)px(?:\/([\d.]+))?/);
  const base = fontM ? Number(fontM[1]) : 30;
  // feste Schrift raus – Schrift, Größe und Stärke kommen aus dem Alert; Zeilenhöhe des Effekts bleibt
  s = s.replace(/font:\s*\d{3}\s+\d+(?:\.\d+)?px(?:\/([\d.]+))?\s+[^;]+;/g, (_, lh) => (lh ? `line-height: ${lh};` : ''));

  let main = '';
  s.replace(new RegExp(`(?:^|\\n)\\.fx-${fx.type}\\s*\\{([^}]*)\\}`), (_, body) => (main = body));
  const clip = /color:\s*transparent/.test(main) && /background-clip:\s*text/.test(main);
  const flex = /display:\s*(inline-)?flex/.test(main);
  let special;

  // ---- Sonderfälle: beliebiger Text statt Beispielwort ----
  if (fx.type === 'typewriter') {
    s = s.replace(/width: 10ch;/g, 'width: var(--fx-w, 10ch);').replace(/steps\(10\)/, 'steps(var(--fx-n, 10))');
    special = 'typewriter';
  }
  if (fx.type === 'decoder') {
    // die festen Zeichenketten ersetzt ein kleines Skript im Renderer
    s = s.replace(/\.fx-decoder::after\s*\{[^}]*\}\s*/, '').replace(/@keyframes fx-decoder\s*\{[\s\S]*?\n\}\s*/, '');
    special = 'decoder';
  }
  if (fx.type === 'rotator') {
    s = s.replace(/content: "BOLD";/, 'content: attr(data-text);').replace(/content: "[A-Z]+"; /g, '');
    dataText.add('rotator');
  }
  if (fx.type === 'contour') special = 'contour';
  if (fx.type === 'ticker') special = 'ticker';
  if (fx.type === 'annotate') {
    s = editMainRule(s, 'annotate', (body) => body.replace(/white-space: pre;/, 'white-space: pre-wrap;'));
    special = 'annotate';
  }
  if (fx.type === 'textpath') {
    s = s.replace(/width: 300px;/, 'width: var(--fx-pw, 300px);').replace(/height: 130px;/, 'height: var(--fx-ph, 130px);')
      .replace(/offset-path: (path\('[^']+'\));/, 'offset-path: var(--fx-path, $1);')
      .replace(/to \{ --ride: 40%; \}/, 'to { --ride: var(--fx-ride, 40%); }');
    special = 'textpath';
  }

  s = pxToEm(s, base);

  // lange Alert-Texte dürfen umbrechen (außer Schreibmaschine und Laufband, die eine Zeile brauchen)
  if (fx.type !== 'typewriter' && fx.type !== 'ticker') {
    s = s.replace(/white-space:\s*pre;/g, 'white-space: pre-wrap;').replace(/white-space:\s*nowrap;/g, 'white-space: normal;');
  }

  // ---- Alert-Tauglichkeit ----
  s = editMainRule(s, fx.type, (body) => {
    let add = '';
    // Verlaufs-Effekte: Schatten/Kontur des Alerts würden durch den transparenten Text scheinen
    if (clip && !/text-shadow/.test(body)) add += '\n  text-shadow: none;';
    if (clip && !/-webkit-text-stroke/.test(body)) add += '\n  -webkit-text-stroke-width: 0;';
    // lange Alert-Texte umbrechen (zwischen Wörtern, siehe .ffo-word)
    if (flex) add += '\n  flex-wrap: wrap;\n  justify-content: var(--ffo-justify, center);';
    return body.replace(/\s*$/, '') + add + '\n';
  });

  cssOut.push(s.trim());
  catalog.push({
    id: fx.type, index: fx.index, name: fx.name, word: fx.word, keyword: seo[fx.type]?.keyword ?? fx.name,
    category: seo[fx.type]?.category ?? 'motion', description: b.blurb,
    perLetter: perLetter.has(fx.type) || fx.type === 'textpath', dataText: dataText.has(fx.type), clip, flex,
    ...(special ? { special } : {}),
  });
}

const header = `/*
 * CSS Text Effects – https://text-effects.colorion.co
 * Quelle: https://github.com/ckissi/colorion-text-effects${commit ? ` (Commit ${commit})` : ''}
 * Lizenz: MIT (laut Projekt). Für FF-Overlay automatisch angepasst mit scripts/vendor-text-effects.mjs:
 * Schrift aus dem Alert, px → em, beliebiger Text, Umbruch zwischen Wörtern, ohne prefers-reduced-motion.
 * Farben: --ink (Text), --ink-2 und --ink-3 (Akzente). NICHT VON HAND BEARBEITEN – Skript erneut ausführen.
 */
`;
writeFileSync(join(outDir, 'effects.css'), `${header}\n${cssOut.join('\n\n')}\n`);

const ts = `// Automatisch erzeugt von scripts/vendor-text-effects.mjs – nicht von Hand bearbeiten.
// Quelle: https://text-effects.colorion.co (github.com/ckissi/colorion-text-effects, MIT)${commit ? `, Commit ${commit}` : ''}

export type TextEffectCategory = ${Object.keys(categoryLabels).map((k) => `'${k}'`).join(' | ')};

export interface TextEffectInfo {
  id: string;
  /** Nummer auf text-effects.colorion.co */
  index: string;
  name: string;
  /** Beispielwort der Originalseite */
  word: string;
  keyword: string;
  category: TextEffectCategory;
  description: string;
  /** jeder Buchstabe als <b style="--i:n"> */
  perLetter: boolean;
  /** Text zusätzlich in data-text (für ::before/::after) */
  dataText: boolean;
  /** Verlauf im Text (background-clip: text) */
  clip: boolean;
  /** Hauptelement ist ein Flex-Container */
  flex: boolean;
  special?: 'typewriter' | 'decoder' | 'contour' | 'annotate' | 'textpath' | 'ticker';
}

export const TEXT_EFFECT_CATEGORIES: Record<TextEffectCategory, string> = ${JSON.stringify(categoryLabels, null, 2)};

export const TEXT_EFFECTS: TextEffectInfo[] = ${JSON.stringify(catalog, null, 2)};
`;
writeFileSync(join(outDir, 'catalog.ts'), ts);
writeFileSync(join(outDir, 'LICENSE'), `MIT License

CSS Text Effects (https://text-effects.colorion.co, https://github.com/ckissi/colorion-text-effects)
Copyright (c) Colorion / ckissi

Laut Projektseite und README steht die Bibliothek unter der MIT-Lizenz:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`);
console.log(`${catalog.length} Effekte übernommen → web/vendor/colorion-text-effects/`);
