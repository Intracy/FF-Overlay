import { useEffect, useState } from 'react';
import { api, type AlertTemplate, type Overlay } from '../api';
import { CATALOG } from '../../../../server/src/shared/catalog';
import { FormatToggle, SoundToggle, TemplatePreview, usePreviewFormat, usePreviewSound } from '../components/Preview';
import { TestThisButton, useTestDraft } from '../components/TestButton';
import { DesignFields } from '../components/DesignFields';
import { Field, useAction, useLoad } from '../ui';

function Editor({ initial, overlays, onSaved }: { initial: AlertTemplate; overlays: Overlay[]; onSaved: (t: AlertTemplate) => void }) {
  const [t, setT] = useState(initial);
  const [testType, setTestType] = useState('donation');
  const [format, setFormat] = usePreviewFormat();
  const [sound, setSound] = usePreviewSound();
  const [testOverlay, setTestOverlay] = useState('');
  const run = useAction();
  const testDraft = useTestDraft();
  useEffect(() => setT(initial), [initial]);
  const dirty = JSON.stringify(t) !== JSON.stringify(initial);

  const save = async () => {
    const saved = await run(() => api.put<AlertTemplate>(`/api/templates/${t.id}`, t), 'Design gespeichert');
    if (saved) onSaved(saved);
  };

  // genau den bearbeiteten Entwurf testen – ohne vorher speichern zu müssen
  const test = () => {
    const overlay = overlays.find((o) => o.id === testOverlay) ?? overlays[0];
    if (!overlay) return run(async () => { throw new Error('Kein Overlay vorhanden'); });
    const entry = CATALOG.find((c) => c.key === testType) ?? CATALOG[0]!;
    return testDraft(overlay.id, t, entry.trigger, [], `${t.name} als ${entry.label}`);
  };

  return (
    <div className="stack">
      <div className="split-head">
        <h2 style={{ margin: 0 }}>{t.name || 'Design'}</h2>
        <div className="row">
          <button disabled={!dirty} onClick={() => setT(initial)}>Verwerfen</button>
          <button className="primary" onClick={save} disabled={!dirty}>Speichern</button>
        </div>
      </div>
      <div className="split">
        <div className="col">
          <div className="card stack">
            <Field label="Name des Designs"><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
          </div>
          <DesignFields part="left" t={t} setT={setT} />
        </div>
        <div className="col aside">
          <div className="card stack preview-card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Vorschau {format === 'portrait' ? '9:16' : '16:9'}</h3>
              <div className="preview-tools">
                <SoundToggle value={sound} onChange={setSound} />
                <FormatToggle value={format} onChange={setFormat} />
              </div>
            </div>
            <TemplatePreview template={t} portrait={format === 'portrait' ? overlays[0]?.portrait : undefined} sound={sound} />
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="small muted">Test als</span>
              <select value={testType} onChange={(e) => setTestType(e.target.value)} style={{ width: 'auto', flex: 1 }} aria-label="Beispiel-Event für Test">
                {CATALOG.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              {overlays.length > 1 && (
                <select value={testOverlay || overlays[0]!.id} onChange={(e) => setTestOverlay(e.target.value)} style={{ width: 'auto' }} aria-label="Overlay für Test">
                  {overlays.map((o) => <option key={o.id} value={o.id}>auf „{o.name}“</option>)}
                </select>
              )}
            </div>
            <TestThisButton block onTest={test} />
          </div>
          <DesignFields part="right" t={t} setT={setT} />
        </div>
      </div>
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
