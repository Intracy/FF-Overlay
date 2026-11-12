// Minimale Typen für die lokale Kopie von browsertexteffects (MIT, Don Lair)
export interface Color {
  rgbHex: string;
}
export interface EffectHandle {
  start: () => void;
  stop: () => void;
}
export function color(hex: string | number): Color;
export function createEffect(
  container: HTMLElement,
  text: string,
  effectName: string,
  config?: Record<string, unknown> & { lineHeight?: number; speed?: number; onComplete?: () => void },
): EffectHandle;
export const effectDefaults: Record<string, Record<string, unknown>>;
