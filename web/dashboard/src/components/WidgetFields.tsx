import { Field } from '../ui';
import { FontInput, Section } from './DesignFields';
import { CATALOG } from '../../../../server/src/shared/catalog';
import type { TextStyle } from '../../../../server/src/shared/widgets';

// Kleine Feld-Bausteine für die Widget-Editoren

export function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 44, padding: 2 }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="row" style={{ gap: 8, alignItems: 'center' }} title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

export function TextFields({ t, onChange, title = 'Schrift' }: { t: TextStyle; onChange: (t: TextStyle) => void; title?: string }) {
  return (
    <Section title={title} open={false} badge={`${t.font} · ${t.size}px`}>
      <div className="fields">
        <Field label="Schriftart"><FontInput value={t.font} onChange={(font) => onChange({ ...t, font })} /></Field>
        <Field label={`Größe ${t.size}px`}><input type="range" min={10} max={200} value={t.size} onChange={(e) => onChange({ ...t, size: Number(e.target.value) })} /></Field>
        <Field label="Stärke">
          <select value={t.weight} onChange={(e) => onChange({ ...t, weight: Number(e.target.value) })}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        <Color label="Farbe" value={t.color} onChange={(color) => onChange({ ...t, color })} />
      </div>
    </Section>
  );
}

export function TypeChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
      {CATALOG.map((c) => (
        <Toggle key={c.key} label={c.label} value={value.includes(c.key)} onChange={(on) => onChange(on ? [...value, c.key] : value.filter((k) => k !== c.key))} />
      ))}
    </div>
  );
}

export const toLocalInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');

