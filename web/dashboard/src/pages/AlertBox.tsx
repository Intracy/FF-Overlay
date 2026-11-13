import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AlertTemplate, type GlobalSettings, type Overlay, type Rule } from '../api';
import type { Profile } from '../../../../server/src/shared/types';
import { CATALOG, detectPreset, FREQUENCIES, TIERS, type CatalogEntry, type VariationPreset } from '../../../../server/src/shared/catalog';
import { DesignFields, Section } from '../components/DesignFields';
import { FormatToggle, SoundToggle, TemplatePreview, usePreviewFormat, usePreviewSound } from '../components/Preview';
import { TestThisButton, useTestDraft } from '../components/TestButton';
import type { PortraitLayout } from '../../../../server/src/shared/types';
import { CopyField, Field, Link, Modal, NumberInput, useAction, useLoad, useToast } from '../ui';
import { BP_TYPES, WIDGET_INFO, type BpWidgetType } from '../../../../server/src/shared/widgets';
import { BetterplaceSetup, BpWidgetPanel } from './BetterplacePanel';
import { BP_ICON } from './BpWidgetForms';

/*
 * Alert-Box im Aufbau der Streamlabs-Alert-Box:
 * Allgemeine Einstellungen · Globale Bearbeitung · Plattform → Event-Typ → Varianten,
 * oben Thema (Profil), Widget-URL, Ereignisfilter und Test.
 */

interface Item { rule: Rule; template: AlertTemplate | null }
interface View {
  overlay: Overlay;
  profiles: Profile[];
  entries: Array<{ key: string; default: Item | null; variations: Item[] }>;
}
type Selection =
  | { kind: 'general' }
  | { kind: 'global' }
  | { kind: 'entry'; key: string; ruleId?: string }
  | { kind: 'bpsetup' }
  | { kind: 'bpwidget'; type: BpWidgetType };

const GROUPS: Array<CatalogEntry['group']> = ['Twitch', 'YouTube', 'Spenden', 'Sonstiges'];
/** Reihenfolge wie auf der betterplace-Seite „Alerts für deinen Charity Stream“ (bp_… = Widget, sonst Alert) */
const BP_ORDER = ['bp_all', 'bp_poll', 'bp_total', 'donation', 'bp_last', 'bp_top', 'bp_leaderboard', 'bp_progress', 'bp_comment', 'bp_logos', 'bp_milestones', 'milestone', 'bp_feed'];

const GROUP_LABELS: Record<CatalogEntry['group'], string> = { Twitch: 'Twitch', YouTube: 'YouTube', Spenden: 'Spenden (betterplace)', Sonstiges: 'Sonstiges' };

// ---------- Kopfzeile: Thema, Widget-URL, Ereignisfilter, Test ----------

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [onOutside]);
  return ref;
}

function Dropdown({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div className="dropdown" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label} ▾</button>
      {open && <div className="dropdown-menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function TopBar({ view, overlayUrl, reload }: { view: View; overlayUrl: string; reload: () => void }) {
  const run = useAction();
  const o = view.overlay;
  const active = view.profiles.find((p) => p.id === o.activeProfileId);

  const addProfile = async () => {
    const name = prompt('Name des neuen Themas', `Thema ${view.profiles.length + 1}`);
    if (!name) return;
    const copy = confirm('Aktuelle Einstellungen übernehmen?\nOK = Kopie des aktuellen Themas, Abbrechen = leeres Thema mit Standard-Alerts');
    const p = await run(() => api.post<Profile>(`/api/overlays/${o.id}/profiles`, { name, copy }), 'Thema angelegt');
    if (p && !copy) for (const key of ['follow', 'sub', 'resub', 'gift', 'cheer', 'raid', 'redemption', 'donation', 'milestone']) await api.post(`/api/overlays/${o.id}/alertbox/${key}/enable`);
    reload();
  };

  const toggleType = (key: string) => {
    const disabled = o.disabledTypes.includes(key) ? o.disabledTypes.filter((k) => k !== key) : [...o.disabledTypes, key];
    void run(() => api.patch(`/api/overlays/${o.id}`, { disabledTypes: disabled })).then(reload);
  };

  return (
    <div className="split">
      <div className="card stack">
      <div className="ab-top">
        <Field label="Thema (Profil)">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select value={o.activeProfileId} onChange={(e) => run(() => api.patch(`/api/overlays/${o.id}`, { activeProfileId: e.target.value }), 'Thema gewechselt').then(reload)}>
              {view.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Dropdown label="⋯">
              {(close) => (
                <>
                  <button onClick={() => { close(); void addProfile(); }}>Thema hinzufügen</button>
                  <button onClick={() => { close(); const n = prompt('Neuer Name', active?.name); if (n && active) void run(() => api.patch(`/api/profiles/${active.id}`, { name: n })).then(reload); }}>Umbenennen</button>
                  <button disabled={view.profiles.length < 2} onClick={() => { close(); if (active && confirm(`Thema „${active.name}“ mit allen Alerts löschen?`)) void run(() => api.del(`/api/profiles/${active.id}`), 'Gelöscht').then(reload); }}>Löschen</button>
                </>
              )}
            </Dropdown>
          </div>
        </Field>
        <Dropdown label={`Ereignisse filtern${o.disabledTypes.length ? ` (${o.disabledTypes.length} aus)` : ''}`}>
          {() => GROUPS.map((g) => (
            <div key={g}>
              <div className="grp">{GROUP_LABELS[g]}</div>
              {CATALOG.filter((c) => c.group === g).map((c) => (
                <label key={c.key}><input type="checkbox" checked={!o.disabledTypes.includes(c.key)} onChange={() => toggleType(c.key)} /> {c.label}</label>
              ))}
            </div>
          ))}
        </Dropdown>
        <Dropdown label="Test">
          {(close) => GROUPS.map((g) => (
            <div key={g}>
              <div className="grp">{GROUP_LABELS[g]}</div>
              {CATALOG.filter((c) => c.group === g).map((c) => (
                <button key={c.key} onClick={() => { close(); void run(() => api.post('/api/events/test', { type: c.trigger.type, subtype: c.trigger.subtype }), `Test: ${c.label}`); }}>{c.label}</button>
              ))}
            </div>
          ))}
        </Dropdown>
      </div>
      </div>
      <div className="card stack">
        <Field label="Querformat 16:9 · Browserquelle 1920 × 1080 (nicht im Stream zeigen)"><CopyField value={overlayUrl} secret /></Field>
        <Field label="Hochformat 9:16 · Browserquelle 1080 × 1920 (läuft parallel)"><CopyField value={`${overlayUrl}&format=9x16`} secret /></Field>
      </div>
    </div>
  );
}

// ---------- Allgemeine Einstellungen ----------

function GeneralSettings({ overlay, sample, sampleKey, reload }: { overlay: Overlay; sample?: AlertTemplate; sampleKey?: string; reload: () => void }) {
  const [o, setO] = useState(overlay);
  const settings = useLoad(() => api.get<GlobalSettings>('/api/settings'));
  const [s, setS] = useState<GlobalSettings | null>(null);
  const [words, setWords] = useState('');
  const [blocked, setBlocked] = useState('');
  const run = useAction();
  useEffect(() => setO(overlay), [overlay]);
  useEffect(() => {
    if (!settings.data) return;
    setS(settings.data);
    setWords(settings.data.badWords.join('\n'));
    setBlocked(settings.data.blockedUsers.join('\n'));
  }, [settings.data]);
  const lines = (x: string) => x.split('\n').map((w) => w.trim()).filter(Boolean);

  const save = async () => {
    await run(() => api.patch(`/api/overlays/${o.id}`, {
      alertDelay: o.alertDelay, moderationDelay: o.moderationDelay, interruptMode: o.interruptMode, interruptDelay: o.interruptDelay, previewBackground: o.previewBackground,
      portrait: o.portrait,
    }));
    if (s) await run(() => api.put('/api/settings', { ...s, badWords: lines(words), blockedUsers: lines(blocked) }), 'Einstellungen gespeichert');
    reload();
  };
  const unlimited = o.moderationDelay === -1;

  return (
    <div className="stack">
      <div className="split-head"><h2 style={{ margin: 0 }}>Allgemeine Einstellungen</h2><button className="primary" onClick={save}>Einstellungen speichern</button></div>
      <div className="split">
      <div className="col">
      <Section title="Ablauf">
        <div className="fields">
          <Field label={`Alert-Verzögerung ${o.alertDelay / 1000} s`} hint="Pause zwischen zwei Alerts"><input type="range" min={0} max={30} step={0.5} value={o.alertDelay / 1000} onChange={(e) => setO({ ...o, alertDelay: Math.round(Number(e.target.value) * 1000) })} /></Field>
          <Field label={`Alert-Moderationsverzögerung ${unlimited ? 'unbegrenzt' : `${o.moderationDelay / 1000} s`}`} hint="Zeit, in der du Alerts im Alert Feed ablehnen kannst">
            <input type="range" min={0} max={60} step={1} disabled={unlimited} value={unlimited ? 60 : o.moderationDelay / 1000} onChange={(e) => setO({ ...o, moderationDelay: Number(e.target.value) * 1000 })} />
          </Field>
          <Field label={`Alert-Parry-Verzögerung ${o.interruptDelay} ms`} hint="Neuer Alert unterbricht den laufenden nach dieser Zeit"><input type="range" min={0} max={5000} step={100} disabled={!o.interruptMode} value={o.interruptDelay} onChange={(e) => setO({ ...o, interruptDelay: Number(e.target.value) })} /></Field>
          <Field label="Hintergrund der Vorschau"><input type="color" value={o.previewBackground} onChange={(e) => setO({ ...o, previewBackground: e.target.value })} /></Field>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={unlimited} onChange={(e) => setO({ ...o, moderationDelay: e.target.checked ? -1 : 0 })} /> Unbegrenzte Moderationsverzögerung (jeder Alert braucht eine Freigabe)</label>
          <label className="check"><input type="checkbox" checked={o.interruptMode} onChange={(e) => setO({ ...o, interruptMode: e.target.checked })} /> Alert-Parry</label>
          {s && <label className="check"><input type="checkbox" checked={s.autoResetSession} onChange={(e) => setS({ ...s, autoResetSession: e.target.checked })} /> Stream-Session bei Stream-Start automatisch zurücksetzen</label>}
        </div>
      </Section>
      <Section title="Hochformat 9:16 (Handy)" badge={`${o.portrait.scale} %`}>
        <p className="small muted" style={{ margin: 0 }}>
          Dieselben Alerts laufen parallel in einer Hochkant-Browserquelle (1080 × 1920) – größer skaliert und außerhalb der Bedienelemente von TikTok, Shorts und Reels.
          Die Vorschau rechts auf „9:16“ stellen.
        </p>
        <div className="fields">
          <Field label={`Skalierung ${o.portrait.scale} %`} hint="100 % = wie im Querformat">
            <input type="range" min={80} max={300} step={5} value={o.portrait.scale} onChange={(e) => setO({ ...o, portrait: { ...o.portrait, scale: Number(e.target.value) } })} />
          </Field>
          <Field label="Position">
            <select value={o.portrait.align} onChange={(e) => setO({ ...o, portrait: { ...o.portrait, align: e.target.value as PortraitLayout['align'] } })}>
              <option value="top">Oben</option>
              <option value="center">Mitte</option>
              <option value="bottom">Unten</option>
            </select>
          </Field>
          <Field label={`Abstand oben ${o.portrait.safeTop} %`}>
            <input type="range" min={0} max={45} value={o.portrait.safeTop} onChange={(e) => setO({ ...o, portrait: { ...o.portrait, safeTop: Number(e.target.value) } })} />
          </Field>
          <Field label={`Abstand unten ${o.portrait.safeBottom} %`}>
            <input type="range" min={0} max={45} value={o.portrait.safeBottom} onChange={(e) => setO({ ...o, portrait: { ...o.portrait, safeBottom: Number(e.target.value) } })} />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={o.portrait.stackSideBySide} onChange={(e) => setO({ ...o, portrait: { ...o.portrait, stackSideBySide: e.target.checked } })} /> Layout „Bild links“ im Hochformat untereinander anordnen</label>
      </Section>
      </div>
      <div className="col aside">
      {sample && (
        <PreviewCard template={sample} background={o.previewBackground} portrait={o.portrait} testLabel="Test-Alert senden"
          onTest={() => { const c = CATALOG.find((x) => x.key === sampleKey) ?? CATALOG.find((x) => x.key === 'donation')!; return run(() => api.post('/api/events/test', { type: c.trigger.type, subtype: c.trigger.subtype }), `Test: ${c.label} (mit gespeicherten Einstellungen)`); }} />
      )}
      {s && (
        <Section title="Schimpfwort-Filter" badge="gilt für alle Overlays">
          <div className="row">
            <label className="check"><input type="checkbox" checked={s.badWordMode === 'censor'} onChange={(e) => setS({ ...s, badWordMode: e.target.checked ? 'censor' : 'hide' })} /> Inakzeptable Wörter durch Sternchen (*) ersetzen</label>
            <label className="check"><input type="checkbox" checked={s.useDefaultBadWords} onChange={(e) => setS({ ...s, useDefaultBadWords: e.target.checked })} /> Standardliste mit „schlimmen Wörtern“ aktivieren</label>
            <label className="check"><input type="checkbox" checked={s.anonymizeNames} onChange={(e) => setS({ ...s, anonymizeNames: e.target.checked })} /> Namen mit inakzeptablen Wörtern anonymisieren</label>
            <label className="check"><input type="checkbox" checked={s.censorEventLog} onChange={(e) => setS({ ...s, censorEventLog: e.target.checked })} /> Filter auf letzte Ereignisse anwenden</label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Ohne Sternchen wird die ganze Nachricht ausgeblendet.</p>
          <div className="fields">
            <Field label="Eigene inakzeptable Wörter (eines pro Zeile)"><textarea rows={5} value={words} onChange={(e) => setWords(e.target.value)} /></Field>
            <Field label="Blacklist (Nutzernamen, einer pro Zeile)"><textarea rows={5} value={blocked} onChange={(e) => setBlocked(e.target.value)} /></Field>
            <Field label="Mindestbetrag für Spenden-Alerts (€)"><NumberInput value={s.minDonationAmount} min={0} step={0.5} onChange={(minDonationAmount) => setS({ ...s, minDonationAmount })} /></Field>
          </div>
        </Section>
      )}
      </div>
      </div>
    </div>
  );
}

function PreviewCard({ template, background, portrait, onTest, testLabel }: {
  template: AlertTemplate; background: string; portrait: PortraitLayout; onTest?: () => unknown; testLabel?: string;
}) {
  const [format, setFormat] = usePreviewFormat();
  const [sound, setSound] = usePreviewSound();
  const [blocked, setBlocked] = useState(false);
  return (
    <div className="card preview-card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Vorschau {format === 'portrait' ? '9:16' : '16:9'}</h3>
        <div className="preview-tools">
          <SoundToggle value={sound} onChange={(v) => { setSound(v); setBlocked(false); }} />
          <FormatToggle value={format} onChange={setFormat} />
        </div>
      </div>
      <TemplatePreview template={template} background={background} portrait={format === 'portrait' ? portrait : undefined} sound={sound} onSoundBlocked={() => setBlocked(true)} />
      {blocked && sound && <p className="sound-blocked-hint">Der Browser hat den Ton blockiert – einmal irgendwo auf die Seite klicken, dann klingt die nächste Vorschau.</p>}
      {onTest && <div style={{ marginTop: 10 }}><TestThisButton block onTest={onTest} label={testLabel} /></div>}
    </div>
  );
}

// ---------- Globale Bearbeitung ----------

const GLOBAL_GROUPS: Array<{ id: string; label: string }> = [
  { id: 'general', label: 'Allgemein (Layout, Dauer, Textverzögerung)' },
  { id: 'animations', label: 'Animationen' },
  { id: 'image', label: 'Bild' },
  { id: 'videoVolume', label: 'Video-Lautstärke' },
  { id: 'positioning', label: 'Positionierung' },
  { id: 'sound', label: 'Sound' },
  { id: 'font', label: 'Schriftart-Einstellungen' },
  { id: 'messageFont', label: 'Einstellungen für Nachrichtenschrift' },
  { id: 'tts', label: 'Text-in-Sprache' },
];

function GlobalEdit({ view, reload }: { view: View; reload: () => void }) {
  const first = view.entries.find((e) => e.default?.template)?.default?.template;
  const [t, setT] = useState<AlertTemplate | null>(first ?? null);
  const [testKey, setTestKey] = useState(view.entries.find((e) => e.default?.template)?.key ?? 'donation');
  const run = useAction();
  const testDraft = useTestDraft();
  if (!t) return <div className="empty">Noch keine Alerts in diesem Thema.</div>;
  const apply = (group: string, label: string) =>
    confirm(`„${label}“ auf alle Alerts und Varianten dieses Themas anwenden?`) &&
    run(() => api.post<{ updated: number }>(`/api/overlays/${view.overlay.id}/global-edit`, { group, values: t }), `${label}: auf alle Alerts angewendet`).then(reload);
  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0 }}>Globale Bearbeitung</h2>
        <p className="small muted">Einstellungen einmal setzen und mit einem Klick auf alle Alerts und Varianten des aktuellen Themas übertragen. Einzelne Alerts lassen sich danach weiter anpassen.</p>
      </div>
      <div className="split">
        <div className="col">
          <div className="card">
            <h3>Auf alle Alerts anwenden</h3>
            <div className="chips">{GLOBAL_GROUPS.map((g) => <button key={g.id} className="small" onClick={() => apply(g.id, g.label)}>{g.label}</button>)}</div>
          </div>
          <DesignFields part="left" t={t} setT={(fn) => setT((x) => (x ? fn(x) : x))} />
        </div>
        <div className="col aside">
          <PreviewCard template={t} background={view.overlay.previewBackground} portrait={view.overlay.portrait}
            onTest={() => { const c = CATALOG.find((x) => x.key === testKey) ?? CATALOG[0]!; return testDraft(view.overlay.id, t, c.trigger, [], c.label); }}
            testLabel="Diese Einstellungen testen" />
          <div className="card row" style={{ gap: 8 }}>
            <span className="small muted">Test als</span>
            <select value={testKey} onChange={(e) => setTestKey(e.target.value)} style={{ width: 'auto', flex: 1 }} aria-label="Event für den Test">
              {CATALOG.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <DesignFields part="right" t={t} setT={(fn) => setT((x) => (x ? fn(x) : x))} />
        </div>
      </div>
    </div>
  );
}

// ---------- Einzelner Alert oder Variante ----------

function ConditionEditor({ entry, rule, onChange }: { entry: CatalogEntry; rule: Rule; onChange: (r: Rule) => void }) {
  const detected = detectPreset(entry, rule.conditions);
  const [presetId, setPresetId] = useState(detected?.preset.id ?? (rule.conditions.length ? 'custom' : entry.presets[0]!.id));
  const [value, setValue] = useState<string | number>(detected?.value ?? 50);
  const preset: VariationPreset | undefined = entry.presets.find((p) => p.id === presetId);

  const update = (p: VariationPreset | undefined, v: string | number) => {
    if (p) onChange({ ...rule, conditions: p.build(v) });
  };

  return (
    <div className="fields">
      <Field label="Bedingung">
        <select value={presetId} onChange={(e) => {
          const p = entry.presets.find((x) => x.id === e.target.value);
          const v = p?.value === 'frequency' ? 50 : p?.value === 'tier' ? '1000' : p?.value === 'number' ? 10 : '';
          setPresetId(e.target.value);
          setValue(v);
          update(p, v);
        }}>
          {entry.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {presetId === 'custom' && <option value="custom">Eigene Bedingungen (siehe Regeln)</option>}
        </select>
      </Field>
      {preset?.value === 'frequency' && (
        <Field label="Häufigkeit">
          <select value={value} onChange={(e) => { setValue(Number(e.target.value)); update(preset, Number(e.target.value)); }}>
            {FREQUENCIES.map((f) => <option key={f.percent} value={f.percent}>{f.label} ({f.percent} %)</option>)}
          </select>
        </Field>
      )}
      {preset?.value === 'tier' && (
        <Field label="Abo-Stufe">
          <select value={value} onChange={(e) => { setValue(e.target.value); update(preset, e.target.value); }}>
            {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      )}
      {preset?.value === 'number' && <Field label="Wert"><NumberInput value={Number(value)} min={0} onChange={(v) => { setValue(v); update(preset, v); }} /></Field>}
      {preset?.value === 'text' && <Field label="Wert"><input value={String(value)} onChange={(e) => { setValue(e.target.value); update(preset, e.target.value); }} /></Field>}
      {presetId === 'custom' && <div className="small muted">Diese Variante nutzt mehrere oder eigene Bedingungen – bearbeiten unter <Link to="/rules">Regeln</Link>.</div>}
    </div>
  );
}

function EntryEditor({ entry, item, isVariation, overlayId, background, portrait, onSaved, onDeleted }: {
  entry: CatalogEntry; item: Item; isVariation: boolean; overlayId: string; background: string; portrait: PortraitLayout; onSaved: () => void; onDeleted: () => void;
}) {
  const [rule, setRule] = useState(item.rule);
  const [t, setT] = useState(item.template!);
  const run = useAction();
  const testDraft = useTestDraft();
  const testLabel = isVariation ? 'Diese Variante testen' : 'Diesen Alert testen';
  const test = () => testDraft(overlayId, t, entry.trigger, isVariation ? rule.conditions : [], isVariation ? `${entry.label} › ${rule.name}` : entry.label);
  useEffect(() => { setRule(item.rule); setT(item.template!); }, [item]);
  const dirty = JSON.stringify(rule) !== JSON.stringify(item.rule) || JSON.stringify(t) !== JSON.stringify(item.template);

  const save = async () => {
    const ok = await run(async () => {
      await api.put(`/api/templates/${t.id}`, t);
      await api.put(`/api/rules/${rule.id}`, rule);
      return true;
    }, 'Einstellungen gespeichert');
    if (ok) onSaved();
  };

  return (
    <div className="stack">
      <div className="split-head">
        <div>
          <h2 style={{ margin: 0 }}>{entry.label}{isVariation ? ` › ${rule.name}` : ''}</h2>
          <span className="small muted">{isVariation ? 'Variante – ersetzt den Standard-Alert, wenn die Bedingung zutrifft' : 'Standard-Alert'}</span>
        </div>
        <div className="row">
          {isVariation && <button className="danger" onClick={() => confirm(`Variante „${rule.name}“ löschen?`) && run(() => api.del(`/api/alertbox/rules/${rule.id}`), 'Variante gelöscht').then(onDeleted)}>Löschen</button>}
          <button className="primary" disabled={!dirty} onClick={save}>Einstellungen speichern</button>
        </div>
      </div>
      <div className="split">
      <div className="col">
      <div className="card stack">
        <div className="row">
          <label className="check"><input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: e.target.checked })} /> Aktiviert</label>
          <label className="check"><input type="checkbox" checked={rule.onlyWhenLive} onChange={(e) => setRule({ ...rule, onlyWhenLive: e.target.checked })} /> Nur wenn live</label>
        </div>
        {isVariation && (
          <>
            <Field label="Name der Variante"><input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></Field>
            <ConditionEditor key={rule.id} entry={entry} rule={rule} onChange={setRule} />
          </>
        )}
      </div>
      <DesignFields part="left" t={t} setT={(fn) => setT((x) => fn(x))} />
      </div>
      <div className="col aside">
        <PreviewCard template={t} background={background} portrait={portrait} onTest={test} testLabel={testLabel} />
        <DesignFields part="right" t={t} setT={(fn) => setT((x) => fn(x))} />
      </div>
      </div>
    </div>
  );
}

function AddVariationDialog({ entry, overlayId, onClose, onAdded }: { entry: CatalogEntry; overlayId: string; onClose: () => void; onAdded: (r: Rule) => void }) {
  const [name, setName] = useState('');
  const [copyCurrent, setCopyCurrent] = useState(false);
  const run = useAction();
  const add = async () => {
    const r = await run(() => api.post<Rule>(`/api/overlays/${overlayId}/alertbox/${entry.key}/variations`, { name: name.trim(), copyCurrent }), 'Variante hinzugefügt');
    if (r) onAdded(r);
  };
  return (
    <Modal title="Variation hinzufügen" onClose={onClose}>
      <div className="stack" style={{ maxWidth: 460 }}>
        <Field label="Gib einen Namen für deine Variante ein."><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Variation" /></Field>
        <label className="check"><input type="radio" checked={!copyCurrent} onChange={() => setCopyCurrent(false)} /> Eine Variation mit Standardeinstellungen hinzufügen</label>
        <label className="check"><input type="radio" checked={copyCurrent} onChange={() => setCopyCurrent(true)} /> Eine Variation mit aktuellen Einstellungen hinzufügen</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!name.trim()} onClick={add}>Hinzufügen</button>
        </div>
      </div>
    </Modal>
  );
}

function ManageVariationsDialog({ entry, items, onClose, onChanged }: { entry: CatalogEntry; items: Item[]; onClose: () => void; onChanged: () => void }) {
  const run = useAction();
  const move = async (i: number, dir: -1 | 1) => {
    const a = items[i]!.rule;
    const b = items[i + dir]?.rule;
    if (!b) return;
    await run(async () => {
      await api.put(`/api/rules/${a.id}`, { ...a, priority: b.priority });
      await api.put(`/api/rules/${b.id}`, { ...b, priority: a.priority === b.priority ? a.priority - dir : a.priority });
    });
    onChanged();
  };
  return (
    <Modal title={`Variationen verwalten: ${entry.label}`} onClose={onClose}>
      <p className="small muted">Bei mehreren passenden Varianten gewinnt die obere.</p>
      <table>
        <thead><tr><th>Variante</th><th>Bedingung</th><th>Status</th><th /></tr></thead>
        <tbody>
          {items.map((it, i) => {
            const d = detectPreset(entry, it.rule.conditions);
            return (
              <tr key={it.rule.id}>
                <td><b>{it.rule.name}</b></td>
                <td className="small">{d ? d.preset.label.replace('<x>', String(d.preset.value === 'frequency' ? FREQUENCIES.find((f) => f.percent === d.value)?.label ?? d.value : d.value)) : 'eigene Bedingungen'}</td>
                <td><span className={`badge ${it.rule.enabled ? 'ok' : ''}`}>{it.rule.enabled ? 'aktiv' : 'pausiert'}</span></td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="small ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="nach oben">↑</button>
                  <button className="small ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="nach unten">↓</button>{' '}
                  <button className="small" onClick={() => run(() => api.put(`/api/rules/${it.rule.id}`, { ...it.rule, enabled: !it.rule.enabled })).then(onChanged)}>{it.rule.enabled ? 'Pausieren' : 'Aktivieren'}</button>{' '}
                  <button className="small danger" onClick={() => confirm(`„${it.rule.name}“ löschen?`) && run(() => api.del(`/api/alertbox/rules/${it.rule.id}`), 'Gelöscht').then(onChanged)}>Löschen</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------- Seite ----------

export function AlertBoxPage() {
  const overlays = useLoad(() => api.get<Overlay[]>('/api/overlays'));
  const [overlayId, setOverlayId] = useState('');
  useEffect(() => { if (!overlayId && overlays.data?.[0]) setOverlayId(overlays.data[0].id); }, [overlays.data, overlayId]);
  const view = useLoad(() => (overlayId ? api.get<View>(`/api/overlays/${overlayId}/alertbox`) : Promise.resolve(undefined)), [overlayId]);
  const [sel, setSel] = useState<Selection>({ kind: 'entry', key: 'follow' });
  const [dialog, setDialog] = useState<{ kind: 'add' | 'manage'; key: string } | null>(null);
  const run = useAction();
  const toast = useToast();

  const overlay = overlays.data?.find((o) => o.id === overlayId);
  const entries = useMemo(() => new Map((view.data?.entries ?? []).map((e) => [e.key, e])), [view.data]);
  const reload = () => { view.reload(); overlays.reload(); };

  const selectedEntry = sel.kind === 'entry' ? CATALOG.find((c) => c.key === sel.key) : undefined;
  const data = sel.kind === 'entry' ? entries.get(sel.key) : undefined;
  const item = sel.kind === 'entry' ? (sel.ruleId ? data?.variations.find((v) => v.rule.id === sel.ruleId) : data?.default ?? undefined) : undefined;

  if (!view.data || !overlay) return <div className="empty">Lade Alert-Box …</div>;
  const v = view.data;

  const entryItem = (c: CatalogEntry) => {
    const e = entries.get(c.key);
    const off = !e?.default || !e.default.rule.enabled || v.overlay.disabledTypes.includes(c.key);
    const activeEntry = sel.kind === 'entry' && sel.key === c.key;
    return (
      <div key={c.key}>
        <button className={`item ${activeEntry && !sel.ruleId ? 'active' : ''} ${off ? 'off' : ''}`} onClick={() => setSel({ kind: 'entry', key: c.key })} title={off ? 'deaktiviert oder herausgefiltert' : ''}>
          {c.label}
        </button>
        {activeEntry && (
          <>
            {e?.variations.map((x) => (
  <button key={x.rule.id} className={`item sub ${sel.ruleId === x.rule.id ? 'active' : ''} ${x.rule.enabled ? '' : 'off'}`} onClick={() => setSel({ kind: 'entry', key: c.key, ruleId: x.rule.id })}>{x.rule.name}</button>
            ))}
            {e?.default && <button className="add" onClick={() => setDialog({ kind: 'add', key: c.key })}>+ Variation hinzufügen</button>}
            {!!e?.variations.length && <button className="add" onClick={() => setDialog({ kind: 'manage', key: c.key })}>⚙ Variationen verwalten</button>}
          </>
        )}
      </div>
    );
  };


  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alert-Box</h1>
          <p className="lead" style={{ margin: 0 }}>Individuelle Alerts, um deinen Viewern zu danken, wenn sie folgen, abonnieren, cheeren oder spenden.</p>
        </div>
        {(overlays.data?.length ?? 0) > 1 && (
          <select value={overlayId} onChange={(e) => setOverlayId(e.target.value)} style={{ width: 'auto' }} aria-label="Overlay">
            {overlays.data!.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      <div className="ab-grid">
        <nav className="ab-nav card" aria-label="Alert-Box-Navigation">
          <button className={`item ${sel.kind === 'general' ? 'active' : ''}`} onClick={() => setSel({ kind: 'general' })}>⚙ Allgemeine Einstellungen</button>
          <button className={`item ${sel.kind === 'global' ? 'active' : ''}`} onClick={() => setSel({ kind: 'global' })}>▦ Globale Bearbeitung</button>
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="grp">{GROUP_LABELS[g]}</div>
              {g === 'Spenden' ? (
                <>
                  <button className={`item ${sel.kind === 'bpsetup' ? 'active' : ''}`} onClick={() => setSel({ kind: 'bpsetup' })}>⚙ Verbindung & Webhook</button>
                  {BP_ORDER.map((k) => {
                    if (k.startsWith('bp_')) {
                      const t = k as BpWidgetType;
                      return <button key={t} className={`item ${sel.kind === 'bpwidget' && sel.type === t ? 'active' : ''}`} onClick={() => setSel({ kind: 'bpwidget', type: t })}>{BP_ICON[t]} {WIDGET_INFO[t].label}</button>;
                    }
                    const c = CATALOG.find((x) => x.key === k);
                    return c ? entryItem(c) : null;
                  })}
                  {CATALOG.filter((c) => c.group === g && !BP_ORDER.includes(c.key)).map(entryItem)}
                </>
              ) : CATALOG.filter((c) => c.group === g).map(entryItem)}
            </div>
          ))}
        </nav>

        <div className="stack" style={{ minWidth: 0 }}>
          <TopBar view={v} overlayUrl={overlay.url} reload={reload} />
          {sel.kind === 'bpsetup' && <BetterplaceSetup />}
          {sel.kind === 'bpwidget' && <BpWidgetPanel key={sel.type} type={sel.type} />}
          {sel.kind === 'general' && <GeneralSettings overlay={v.overlay} sample={v.entries.find((e) => e.default?.template)?.default?.template ?? undefined} sampleKey={v.entries.find((e) => e.default?.template)?.key} reload={reload} />}
          {sel.kind === 'global' && <GlobalEdit view={v} reload={view.reload} />}
          {sel.kind === 'entry' && selectedEntry && !data?.default && (
            <div className="card stack" style={{ maxWidth: 'calc(50% - 8px)' }}>
              <h2 style={{ margin: 0 }}>{selectedEntry.label}</h2>
              <p className="muted" style={{ margin: 0 }}>Für diesen Event-Typ gibt es in diesem Thema noch keinen Alert.</p>
              <div><button className="primary" onClick={() => run(() => api.post(`/api/overlays/${overlayId}/alertbox/${selectedEntry.key}/enable`), 'Alert angelegt').then(view.reload)}>Alert für „{selectedEntry.label}“ anlegen</button></div>
            </div>
          )}
          {sel.kind === 'entry' && selectedEntry && item?.template && (
            <EntryEditor key={item.rule.id} entry={selectedEntry} item={item} isVariation={!!sel.ruleId} overlayId={v.overlay.id} background={v.overlay.previewBackground} portrait={v.overlay.portrait}
              onSaved={view.reload} onDeleted={() => { setSel({ kind: 'entry', key: selectedEntry.key }); view.reload(); }} />
          )}
          {sel.kind === 'entry' && item && !item.template && <div className="empty">Das Design dieses Alerts fehlt. <button className="small" onClick={() => toast('Bitte unter „Regeln“ ein Design zuweisen.')}>Hilfe</button></div>}
        </div>
      </div>

      {dialog?.kind === 'add' && (
        <AddVariationDialog entry={CATALOG.find((c) => c.key === dialog.key)!} overlayId={overlayId} onClose={() => setDialog(null)}
          onAdded={(r) => { setDialog(null); view.reload(); setSel({ kind: 'entry', key: dialog.key, ruleId: r.id }); }} />
      )}
      {dialog?.kind === 'manage' && (
        <ManageVariationsDialog entry={CATALOG.find((c) => c.key === dialog.key)!} items={entries.get(dialog.key)?.variations ?? []}
          onClose={() => setDialog(null)} onChanged={view.reload} />
      )}
    </>
  );
}
