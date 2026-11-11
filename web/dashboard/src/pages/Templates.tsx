import { useEffect, useState } from 'react';
import { api, type AlertTemplate, type Overlay } from '../api';
import { CATALOG } from '../../../../server/src/shared/catalog';
import { TemplatePreview } from '../components/Preview';
import { DesignFields } from '../components/DesignFields';
import { useAction, useLoad } from '../ui';

function Editor({ initial, overlays, onSaved }: { initial: AlertTemplate; overlays: Overlay[]; onSaved: (t: AlertTemplate) => void }) {
  const [t, setT] = useState(initial);
  const [testType, setTestType] = useState('donation');
  const run = useAction();
  useEffect(() => setT(initial), [initial]);
  const dirty = JSON.stringify(t) !== JSON.stringify(initial);

  const save = async () => {
    const saved = await run(() => api.put<AlertTemplate>(`/api/templates/${t.id}`, t), 'Design gespeichert');
    if (saved) onSaved(saved);
  };

  const testOn = async (overlayId: string) => {
    if (dirty) await save();
    const entry = CATALOG.find((c) => c.key === testType)!;
    await run(() => api.post(`/api/templates/${t.id}/test`, { overlayId, type: entry.trigger.type, subtype: entry.trigger.subtype }), 'Test an Overlay gesendet');
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ maxWidth: 320, fontWeight: 700 }} aria-label="Name des Designs" />
          <div className="row">
            <select value={testType} onChange={(e) => setTestType(e.target.value)} style={{ width: 'auto' }} aria-label="Beispiel-Event für Test">
              {CATALOG.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            {overlays.map((o) => <button key={o.id} className="small" onClick={() => testOn(o.id)}>Auf „{o.name}“ testen</button>)}
            <button className="primary" onClick={save} disabled={!dirty}>Speichern</button>
          </div>
        </div>
        <TemplatePreview template={t} />
      </div>
      <DesignFields t={t} setT={setT} />
    </div>
  );
}

export function TemplatesPage() {
  const templates = useLoad(() => api.get<AlertTemplate[]>('/api/templates'));
  const overlays = useLoad(() => api.get<Overlay[]>('/api/overlays'));
  const [selected, setSelected] = useState('');
  const run = useAction();
  useEffect(() => { if (!selected && templates.data?.[0]) setSelected(templates.data[0].id); }, [templates.data, selected]);
  const current = templates.data?.find((t) => t.id === selected);

  const create = async (copyFrom?: string) => {
    const t = await run(() => api.post<AlertTemplate>('/api/templates', { copyFrom }));
    if (t) { templates.setData([...(templates.data ?? []), t]); setSelected(t.id); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alert-Designs</h1>
          <p className="lead" style={{ margin: 0 }}>Aussehen der Alerts. Regeln entscheiden, welches Design bei welchem Event läuft.</p>
        </div>
        <div className="row">
          {current && <button onClick={() => create(current.id)}>Duplizieren</button>}
          {current && <button className="danger" onClick={() => confirm(`Design „${current.name}“ löschen?`) && run(() => api.del(`/api/templates/${current.id}`), 'Gelöscht').then((r) => { if (r) { setSelected(''); templates.reload(); } })}>Löschen</button>}
          <button className="primary" onClick={() => create()}>+ Neues Design</button>
        </div>
      </div>
      <div className="grid editor-grid">
        <div className="card" style={{ alignSelf: 'start' }}>
          {templates.data?.map((t) => (
            <button key={t.id} className={`list-item ${t.id === selected ? 'active' : ''}`} onClick={() => setSelected(t.id)}>{t.name}</button>
          ))}
        </div>
        {current && overlays.data && (
          <Editor initial={current} overlays={overlays.data} onSaved={(s) => templates.setData(templates.data!.map((t) => (t.id === s.id ? s : t)))} />
        )}
      </div>
    </>
  );
}
