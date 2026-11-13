import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectInks, segment, TEXT_EFFECT_CATEGORIES, TEXT_EFFECTS } from '../../web/overlay/textfx.js';
import { templateSchema } from '../src/schemas.js';
import { defaultTemplate } from '../src/templates/defaults.js';

const css = readFileSync(new URL('../../web/vendor/colorion-text-effects/effects.css', import.meta.url), 'utf8');

describe('Animation Library (text-effects.colorion.co)', () => {
  it('enthält alle 123 Effekte mit eindeutigen IDs und gültigen Kategorien', () => {
    expect(TEXT_EFFECTS).toHaveLength(123);
    expect(new Set(TEXT_EFFECTS.map((e) => e.id)).size).toBe(123);
    expect(TEXT_EFFECTS.map((e) => Number(e.index))).toEqual(Array.from({ length: 123 }, (_, i) => i + 1));
    for (const e of TEXT_EFFECTS) expect(Object.keys(TEXT_EFFECT_CATEGORIES)).toContain(e.category);
  });

  it('hat für jeden Effekt CSS und erlaubt die ID im Design', () => {
    for (const e of TEXT_EFFECTS) {
      expect(css, e.id).toContain(`.fx-${e.id}`);
      expect(templateSchema.shape.text.shape.effect.safeParse(e.id).success, e.id).toBe(true);
    }
    const t = defaultTemplate('t', 'x', '{user}');
    expect(templateSchema.safeParse({ ...t, id: 't', name: 'x', text: { ...t.text, effect: 'neon' } }).success).toBe(true);
  });

  it('übernimmt Schrift und Größe aus dem Alert (keine feste Schrift, keine px-Werte, keine Reduced-Motion-Sperre)', () => {
    expect(css).not.toMatch(/font:\s*\d{3}/);
    expect(css.replace(/url\([^)]*\)/g, '')).not.toMatch(/\d+px\b(?!')/);
    expect(css).not.toMatch(/@media\s*\(prefers-reduced-motion/);
    expect(css).not.toContain('content: "BOLD"');
    expect(css).toContain('steps(var(--fx-n, 10))');
  });

  it('setzt Textfarbe und Akzente als Farb-Tokens', () => {
    expect(effectInks({ color: '#ffffff', highlightColor: '#9373c5', colors: 'effect' })).toEqual({ '--ink': '#ffffff', '--ink-2': '#FF4FD8', '--ink-3': '#4FF8FF' });
    const own = effectInks({ color: '#111111', highlightColor: '#9373c5', colors: 'text' });
    expect(own['--ink']).toBe('#111111');
    expect(own['--ink-2']).toBe('#9373c5');
  });

  it('zerlegt Emojis nicht in Einzelteile', () => {
    expect(segment('Hi 👋🏽!')).toEqual(['H', 'i', ' ', '👋🏽', '!']);
  });
});
