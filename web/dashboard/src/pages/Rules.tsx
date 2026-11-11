import { useEffect, useState } from 'react';
import { api, EVENT_TYPES, typeLabel, type AlertTemplate, type Overlay, type Rule } from '../api';
import type { Condition, ConditionOp } from '../../../../server/src/shared/types';
import { Field, Modal, NumberInput, useAction, useLoad } from '../ui';

const FIELDS: Array<{ value: string; label: string }> = [
  { value: 'amount.value', label: 'Betrag (€ oder Bits)' },
  { value: 'count', label: 'Anzahl (Gift-Subs, Raider, Bits)' },
  { value: 'months', label: 'Monate abonniert' },
  { value: 'streakMonths', label: 'Monate in Folge (Streak)' },
  { value: 'tier', label: 'Sub-Tier (1000/2000/3000)' },
  { value: 'message', label: 'Nachricht' },
  { value: 'user.name', label: 'Name' },
  { value: 'product', label: 'Belohnung / Produkt' },
  { value: 'platform', label: 'Plattform' },
  { value: 'isAnonymous', label: 'Anonym (true/false)' },
];

const OPS: Array<{ value: ConditionOp; label: string; needsField: boolean; values: 0 | 1 | 2 }> = [
  { value: 'gte', label: 'mindestens', needsField: true, values: 1 },
  { value: 'lte', label: 'höchstens', needsField: true, values: 1 },
  { value: 'eq', label: 'genau', needsField: true, values: 1 },
  { value: 'neq', label: 'nicht', needsField: true, values: 1 },
  { value: 'between', label: 'zwischen', needsField: true, values: 2 },
  { value: 'contains', label: 'enthält', needsField: true, values: 1 },
  { value: 'regex', label: 'passt zu Regex', needsField: true, values: 1 },
  { value: 'empty', label: 'ist leer', needsField: true, values: 0 },
  { value: 'notEmpty', label: 'ist nicht leer', needsField: true, values: 0 },
  { value: 'largestOfStream', label: 'größter Betrag dieses Streams', needsField: false, values: 0 },
  { value: 'firstFromUser', label: 'erstes Event dieses Users', needsField: false, values: 0 },
  { value: 'random', label: 'Zufall (Prozent)', needsField: false, values: 1 },
];

const triggerKey = (r: Pick<Rule, 'trigger'>) => `${r.trigger.type}:${r.trigger.subtype ?? ''}`;

function describe(c: Condition) {
  const op = OPS.find((o) => o.value === c.op);
  const field = FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
  if (!op?.needsField) return c.op === 'random' ? `Zufall ${c.value ?? 50} %` : op?.label;
  if (op.values === 0) return `${field} ${op.label}`;
  if (op.values === 2) return `${field} zwischen ${c.value} und ${c.value2}`;
  return `${field} ${op.label} ${c.value}`;
}

function RuleEditor({ rule, templates, onClose, onSaved }: { rule: Rule; templates: AlertTemplate[]; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<Rule>(rule);
  const run = useAction();
  const set = (patch: Partial<Rule>) => setR((x) => ({ ...x, ...patch }));
  const setCond = (i: number, patch: Partial<Condition>) => set({ conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const isNew = !rule.id;

  const save = async () => {
    const body = { ...r, conditions: r.conditions.map((c) => ({ ...c, value: num(c.value), value2: num(c.value2) })) };
    const ok = await run(() => (isNew ? api.post('/api/rules', body) : api.put(`/api/rules/${r.id}`, body)), 'Regel gespeichert');
    if (ok) onSaved();
  };

  return (
    <Modal title={isNew ? 'Neue Regel' : `Regel bearbeiten: ${rule.name}`} onClose={onClose}>
      <div className="stack">
        <div className="fields">
          <Field label="Name"><input value={r.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Auslöser">
            <select value={triggerKey(r)} onChange={(e) => { const [type, subtype] = e.target.value.split(':'); set({ trigger: { ...r.trigger, type: type as Rule['trigger']['type'], subtype: subtype || undefined } }); }}>
              {EVENT_TYPES.map((t) => <option key={t.label} value={`${t.type}:${t.subtype ?? ''}`}>{t.label}</option>)}
              <option value="subscription:">Alle Subs (Sub, Resub, Gift)</option>
            </select>
          </Field>
          <Field label="Plattform">
            <select value={r.trigger.platform ?? ''} onChange={(e) => set({ trigger: { ...r.trigger, platform: (e.target.value || undefined) as Rule['trigger']['platform'] } })}>
              <option value="">alle</option>
              <option value="twitch">Twitch</option>
              <option value="betterplace">betterplace</option>
              <option value="webhook">Webhook</option>
            </select>
          </Field>
          <Field label="Alert-Design">
            <select value={r.templateId} onChange={(e) => set({ templateId: e.target.value })}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Priorität" hint="Höhere gewinnt bei mehreren Treffern"><NumberInput value={r.priority} min={0} onChange={(priority) => set({ priority })} /></Field>
          <Field label="Gewicht" hint="Zufall unter gleicher Priorität"><NumberInput value={r.weight} min={0} onChange={(weight) => set({ weight })} /></Field>
        </div>

        <div>
          <h3>Bedingungen (alle müssen zutreffen)</h3>
          <div className="stack">
            {r.conditions.map((c, i) => {
              const op = OPS.find((o) => o.value === c.op)!;
              return (
                <div className="cond" key={i}>
                  <select value={c.field} disabled={!op.needsField} onChange={(e) => setCond(i, { field: e.target.value })}>
                    {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as ConditionOp })}>
                    {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {op.values >= 1 ? <input value={c.value ?? ''} placeholder="Wert" onChange={(e) => setCond(i, { value: e.target.value })} /> : <span />}
                  {op.values === 2 ? <input value={c.value2 ?? ''} placeholder="bis" onChange={(e) => setCond(i, { value2: e.target.value })} /> : <span />}
                  <button className="ghost" aria-label="Bedingung entfernen" onClick={() => set({ conditions: r.conditions.filter((_, j) => j !== i) })}>✕</button>
                </div>
              );
            })}
            {!r.conditions.length && <div className="small muted">Ohne Bedingungen greift die Regel für jedes Event des Auslösers (Standard-Alert).</div>}
            <div><button className="small" onClick={() => set({ conditions: [...r.conditions, { field: 'amount.value', op: 'gte', value: 10 }] })}>+ Bedingung</button></div>
          </div>
        </div>

        <div className="row">
          <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Aktiv</label>
          <label className="check"><input type="checkbox" checked={r.onlyWhenLive} onChange={(e) => set({ onlyWhenLive: e.target.checked })} /> Nur wenn live</label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={save}>Speichern</button>
        </div>
      </div>
    </Modal>
  );
}

const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v === '' ? undefined : (v as string | number | undefined));

function Explain() {
  const [type, setType] = useState('donation:');
  const [amount, setAmount] = useState(25);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Array<{ overlay: string; rule: string | null; reason: string }>>([]);
  const run = useAction();
  const go = async () => {
    const [t, subtype] = type.split(':');
    const r = await run(() => api.post<typeof result>('/api/rules/explain', { type: t, subtype: subtype || undefined, amount, count: amount, months: amount, message: message || undefined }));
    if (r) setResult(r);
  };
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Welche Regel greift?</h2>
      <div className="fields">
        <Field label="Event">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {EVENT_TYPES.map((t) => <option key={t.label} value={`${t.type}:${t.subtype ?? ''}`}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Betrag / Anzahl / Monate"><NumberInput value={amount} onChange={setAmount} /></Field>
        <Field label="Nachricht"><input value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
      <div><button onClick={go}>Prüfen</button></div>
      {result.map((r) => (
        <div key={r.overlay} className="small"><b>{r.overlay}:</b> {r.rule ? r.reason : <span className="muted">{r.reason}</span>}</div>
      ))}
    </div>
  );
}

export function RulesPage() {
  const overlays = useLoad(() => api.get<Overlay[]>('/api/overlays'));
  const templates = useLoad(() => api.get<AlertTemplate[]>('/api/templates'));
  const [overlayId, setOverlayId] = useState('');
  useEffect(() => { if (!overlayId && overlays.data?.[0]) setOverlayId(overlays.data[0].id); }, [overlays.data, overlayId]);
  const rules = useLoad(() => (overlayId ? api.get<Rule[]>(`/api/rules?overlayId=${overlayId}`) : Promise.resolve([])), [overlayId]);
  const [editing, setEditing] = useState<Rule | null>(null);
  const run = useAction();
  const tplName = (id: string) => templates.data?.find((t) => t.id === id)?.name ?? '⚠ fehlt';

  const newRule = (): Rule => ({
    id: '', overlayId, name: 'Neue Regel', trigger: { type: 'donation' }, conditions: [], priority: 50, weight: 1,
    templateId: templates.data?.[0]?.id ?? '', enabled: true, onlyWhenLive: false,
  });

  const groups = new Map<string, Rule[]>();
  for (const r of rules.data ?? []) groups.set(triggerKey(r), [...(groups.get(triggerKey(r)) ?? []), r]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Regeln</h1>
          <p className="lead" style={{ margin: 0 }}>Welches Event welchen Alert auslöst. Mehrere Bedingungen pro Regel werden UND-verknüpft; die höchste Priorität gewinnt.</p>
        </div>
        <div className="row">
          <select value={overlayId} onChange={(e) => setOverlayId(e.target.value)} style={{ width: 'auto' }}>
            {overlays.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="primary" onClick={() => setEditing(newRule())} disabled={!overlayId || !templates.data?.length}>+ Regel</button>
        </div>
      </div>
      <div className="grid live-grid">
        <div className="card">
          {!rules.data?.length && <div className="empty">Noch keine Regeln für dieses Overlay.</div>}
          {[...groups.entries()].map(([key, list]) => (
            <div key={key} style={{ marginBottom: 18 }}>
              <h3>{typeLabel(list[0]!.trigger.type, list[0]!.trigger.subtype) + (list[0]!.trigger.type === 'subscription' && !list[0]!.trigger.subtype ? ' (alle)' : '')}</h3>
              <table>
                <thead><tr><th>Regel</th><th>Bedingungen</th><th>Design</th><th>Prio</th><th /></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className={r.enabled ? '' : 'disabled'}>
                      <td><b>{r.name}</b>{r.trigger.platform && <div className="small muted">nur {r.trigger.platform}</div>}{r.onlyWhenLive && <div className="small muted">nur live</div>}</td>
                      <td className="small">{r.conditions.length ? r.conditions.map(describe).join(' und ') : <span className="muted">Standard</span>}</td>
                      <td className="small">{tplName(r.templateId)}</td>
                      <td>{r.priority}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className="small" onClick={() => setEditing(r)}>Bearbeiten</button>{' '}
                        <button className="small" onClick={() => run(() => api.put(`/api/rules/${r.id}`, { ...r, enabled: !r.enabled })).then(rules.reload)}>{r.enabled ? 'Aus' : 'An'}</button>{' '}
                        <button className="small danger" onClick={() => confirm(`Regel „${r.name}“ löschen?`) && run(() => api.del(`/api/rules/${r.id}`)).then(rules.reload)}>Löschen</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <Explain />
      </div>
      {editing && templates.data && (
        <RuleEditor rule={editing} templates={templates.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); rules.reload(); }} />
      )}
    </>
  );
}
