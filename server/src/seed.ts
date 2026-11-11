import type { DB } from './db.js';
import * as store from './db.js';
import { addVariation, ensureDefault } from './alertbox.js';

/** Legt beim ersten Start ein Overlay mit Standard-Alerts für die wichtigsten Event-Typen an. */
export function seedIfEmpty(db: DB) {
  if (store.overlays.list(db).length) return;
  const overlay = store.overlays.create(db, 'Haupt-Overlay');

  for (const key of ['follow', 'sub', 'resub', 'gift', 'cheer', 'raid', 'redemption', 'donation']) ensureDefault(db, overlay, key);

  // Ein paar Akzente wie bei den Streamlabs-Vorlagen
  const tweak = (key: string, patch: (t: NonNullable<ReturnType<typeof store.templates.get>>) => void) => {
    const rule = ensureDefault(db, overlay, key);
    const t = store.templates.get(db, rule.templateId)!;
    patch(t);
    store.templates.save(db, t);
  };
  tweak('follow', (t) => (t.animation.in = 'bounceIn'));
  tweak('gift', (t) => (t.animation.in = 'zoomIn'));
  tweak('raid', (t) => (t.animation.in = 'slideInDown'));
  tweak('redemption', (t) => (t.text.letterAnimation = 'none'));

  // Beispiel-Variante: große Spenden
  const big = addVariation(db, overlay, 'donation', { name: 'Große Spende ab 50 €', copyCurrent: true, presetId: 'min_amount', value: 50 });
  const t = store.templates.get(db, big.templateId)!;
  t.animation.in = 'tada';
  t.text.size = 72;
  t.text.letterAnimation = 'rubberBand';
  t.duration = 12000;
  store.templates.save(db, t);
}
