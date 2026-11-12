import { describe, expect, it } from 'vitest';
import { effectColors, segment, TEXT_EFFECTS, wrapForGrid } from '../../web/overlay/textfx.js';
import { templateSchema } from '../src/schemas.js';
import { defaultTemplate } from '../src/templates/defaults.js';

describe('Animation Library', () => {
  it('kennt alle 37 Effekte von browsertexteffects', () => {
    expect(TEXT_EFFECTS).toHaveLength(37);
    expect(new Set(TEXT_EFFECTS.map((e) => e.id)).size).toBe(37);
  });

  it('bricht zwischen Wörtern um, zentriert und lässt Emojis ganz', () => {
    expect(segment('🎄👍🏽 a')).toEqual(['🎄', '👍🏽', ' ', 'a']);
    const t = wrapForGrid('🎄 Maxi H. spendet 25,00 €!', 12);
    const lines = t.split('\n');
    expect(lines.every((l) => segment(l).length <= 12)).toBe(true);
    expect(lines.map((l) => l.trim())).toEqual(['🎄 Maxi H.', 'spendet', '25,00 €!']);
    expect(lines[1]!.startsWith(' ')).toBe(true); // zentriert
    expect(wrapForGrid('abc', 12, false)).toBe('abc');
  });

  it('Endfarbe ist immer die Textfarbe, eigene Farben optional', () => {
    const orig = effectColors('beams', { colors: 'effect', color: '#ffffff', highlightColor: '#9373c5' });
    expect(orig.finalGradientStops).toEqual([{ rgbHex: 'ffffff' }, { rgbHex: 'ffffff' }]);
    expect(orig.beamGradientStops).toBeUndefined();
    const mine = effectColors('beams', { colors: 'text', color: '#ffffff', highlightColor: '#9373c5' });
    expect(mine.beamGradientStops).toEqual([{ rgbHex: '9373c5' }, { rgbHex: 'ffffff' }]);
  });

  it('Design speichert Effekt, Tempo und Farbmodus', () => {
    const t = { ...defaultTemplate('x', 'Test', '{user}'), text: { ...defaultTemplate('x', 'Test', '{user}').text, effect: 'matrix', effectSpeed: 2, effectColors: 'text' as const } };
    expect(templateSchema.parse(t).text).toMatchObject({ effect: 'matrix', effectSpeed: 2, effectColors: 'text' });
    expect(() => templateSchema.parse({ ...t, text: { ...t.text, effect: '<script>' } })).toThrow();
  });
});
