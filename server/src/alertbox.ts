import { nanoid } from 'nanoid';
import type { DB } from './db.js';
import * as store from './db.js';
import type { AlertTemplate, NormalizedEvent, OverlayInfo, Rule } from './shared/types.js';
import { CATALOG, type CatalogEntry } from './shared/catalog.js';
import { defaultTemplate } from './templates/defaults.js';

/*
 * Alert-Box nach Streamlabs-Vorbild: pro Event-Typ ein Standard-Alert plus beliebig viele Varianten.
 * Technisch ist jeder Eintrag eine Regel mit eigenem Design (Template).
 *   Standard-Alert = Regel ohne Bedingungen, Priorität 10
 *   Variante       = Regel mit Bedingungen, Priorität 100+ (gewinnt, wenn ihre Bedingungen zutreffen)
 */

export const entryByKey = (key: string) => CATALOG.find((c) => c.key === key);

const matchesEntry = (r: Rule, e: CatalogEntry) =>
  r.trigger.type === e.trigger.type && (r.trigger.subtype ?? '') === (e.trigger.subtype ?? '') && !r.trigger.platform;

export const isVariation = (r: Rule) => (r.kind ? r.kind === 'variation' : r.conditions.length > 0);

/** Komplette Alert-Box-Ansicht eines Overlays (aktives Profil). */
export function alertboxView(db: DB, overlay: OverlayInfo) {
  const rules = store.rules.active(db, overlay);
  const tpl = (id: string) => store.templates.get(db, id) ?? null;
  return {
    overlay,
    profiles: store.profiles.list(db, overlay.id),
    entries: CATALOG.map((e) => {
      const own = rules.filter((r) => matchesEntry(r, e));
      const def = own.find((r) => !isVariation(r));
      return {
        key: e.key,
        default: def ? { rule: def, template: tpl(def.templateId) } : null,
        variations: own.filter(isVariation).sort((a, b) => b.priority - a.priority).map((r) => ({ rule: r, template: tpl(r.templateId) })),
      };
    }),
  };
}

function newTemplate(db: DB, name: string, entry: CatalogEntry, base?: AlertTemplate | null): AlertTemplate {
  const t = base ? { ...structuredClone(base), id: nanoid(10), name } : defaultTemplate(nanoid(10), name, entry.defaultFormat);
  return store.templates.save(db, t);
}

/** Standard-Alert für einen Event-Typ anlegen (falls noch keiner existiert). */
export function ensureDefault(db: DB, overlay: OverlayInfo, key: string): Rule {
  const entry = entryByKey(key);
  if (!entry) throw Object.assign(new Error('Unbekannter Alert-Typ'), { statusCode: 404 });
  const existing = store.rules.active(db, overlay).find((r) => matchesEntry(r, entry) && !isVariation(r));
  if (existing) return existing;
  const t = newTemplate(db, entry.label, entry);
  return store.rules.save(db, {
    id: nanoid(10), overlayId: overlay.id, profileId: overlay.activeProfileId, kind: 'default', name: entry.label,
    trigger: { ...entry.trigger }, conditions: [], priority: 10, weight: 1, templateId: t.id, enabled: true, onlyWhenLive: false,
  });
}

/** „Variation hinzufügen“: mit Standardeinstellungen oder als Kopie der aktuellen Einstellungen. */
export function addVariation(db: DB, overlay: OverlayInfo, key: string, opts: { name: string; copyCurrent: boolean; presetId?: string; value?: string | number }): Rule {
  const entry = entryByKey(key);
  if (!entry) throw Object.assign(new Error('Unbekannter Alert-Typ'), { statusCode: 404 });
  const def = ensureDefault(db, overlay, key);
  const base = opts.copyCurrent ? store.templates.get(db, def.templateId) : null;
  const t = newTemplate(db, `${entry.label}: ${opts.name}`, entry, base);
  const preset = entry.presets.find((p) => p.id === opts.presetId) ?? entry.presets[0]!;
  const others = store.rules.active(db, overlay).filter((r) => matchesEntry(r, entry) && isVariation(r));
  return store.rules.save(db, {
    id: nanoid(10), overlayId: overlay.id, profileId: overlay.activeProfileId, kind: 'variation', name: opts.name,
    trigger: { ...entry.trigger }, conditions: preset.build(opts.value ?? (preset.value === 'frequency' ? 50 : 0)),
    priority: 100 + others.length, weight: 1, templateId: t.id, enabled: true, onlyWhenLive: false,
  });
}

/** Regel löschen und ihr Design entfernen, wenn es sonst niemand benutzt. */
export function removeRule(db: DB, ruleId: string) {
  const r = store.rules.get(db, ruleId);
  if (!r) return false;
  store.rules.remove(db, ruleId);
  if (!store.rules.usesTemplate(db, r.templateId)) store.templates.remove(db, r.templateId);
  return true;
}

/** „Thema hinzufügen“: neues Profil, leer oder als Kopie des aktiven (mit eigenen Design-Kopien). */
export function createProfile(db: DB, overlay: OverlayInfo, name: string, copy: boolean) {
  const profile = store.profiles.create(db, overlay.id, name);
  if (copy) {
    for (const r of store.rules.active(db, overlay)) {
      const src = store.templates.get(db, r.templateId);
      const t = src ? store.templates.save(db, { ...structuredClone(src), id: nanoid(10) }) : null;
      store.rules.save(db, { ...r, id: nanoid(10), profileId: profile.id, templateId: t?.id ?? r.templateId });
    }
  }
  return profile;
}

/** Gruppen der „Globalen Bearbeitung“ – jeweils „Auf alle Alerts anwenden“. */
export const GLOBAL_EDIT_GROUPS = {
  general: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, layout: v.layout, duration: v.duration, textDelay: v.textDelay }),
  animations: (t: AlertTemplate, v: AlertTemplate) => ({
    ...t, animation: { ...v.animation }, text: { ...t.text, intro: v.text.intro, letterAnimation: v.text.letterAnimation, outro: v.text.outro, effect: v.text.effect, effectSpeed: v.text.effectSpeed, effectColors: v.text.effectColors },
  }),
  image: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, media: { ...t.media, kind: v.media.kind, url: v.media.url, giphyId: v.media.giphyId, size: v.media.size } }),
  videoVolume: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, media: { ...t.media, volume: v.media.volume } }),
  positioning: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, positioning: structuredClone(v.positioning) }),
  sound: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, sound: { ...v.sound } }),
  font: (t: AlertTemplate, v: AlertTemplate) => ({
    ...t, text: { ...t.text, font: v.text.font, size: v.text.size, weight: v.text.weight, color: v.text.color, highlightColor: v.text.highlightColor, strokeColor: v.text.strokeColor, strokeWidth: v.text.strokeWidth, shadow: v.text.shadow },
  }),
  messageFont: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, message: { ...t.message, font: v.message.font, size: v.message.size, weight: v.message.weight, color: v.message.color } }),
  tts: (t: AlertTemplate, v: AlertTemplate) => ({ ...t, tts: { ...v.tts } }),
} as const;

export type GlobalEditGroup = keyof typeof GLOBAL_EDIT_GROUPS;

export function applyGlobalEdit(db: DB, overlay: OverlayInfo, group: GlobalEditGroup, values: AlertTemplate): number {
  const ids = new Set(store.rules.active(db, overlay).map((r) => r.templateId));
  let n = 0;
  for (const id of ids) {
    const t = store.templates.get(db, id);
    if (!t) continue;
    store.templates.save(db, GLOBAL_EDIT_GROUPS[group](t, values) as AlertTemplate);
    n++;
  }
  return n;
}

/** Beispiel-Events für Test-Buttons (Werte aus dem Katalog). */
export function sampleEvent(type: NormalizedEvent['type'], subtype?: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const entry = CATALOG.find((c) => c.trigger.type === type && (c.trigger.subtype ?? '') === (subtype ?? '')) ?? CATALOG.find((c) => c.trigger.type === type);
  return {
    id: `test_${nanoid(12)}`, platform: 'test', type, subtype, isTest: true,
    user: { name: 'TestViewer' }, receivedAt: new Date().toISOString(),
    ...(entry?.sample ?? {}),
    ...(type === 'subscription' && subtype === 'resub' ? { emotes: [{ id: '25', begin: 19, end: 23 }] } : {}),
    ...overrides,
  };
}
