import { useState } from 'react';
import { api, type Overlay } from '../api';
import { useLive } from '../live';
import { CopyField, Field, NumberInput, useAction, useLoad } from '../ui';

function OverlayCard({ o, onChange }: { o: Overlay; onChange: () => void }) {
  const [draft, setDraft] = useState(o);
  const run = useAction();
  const { queues } = useLive();
  const conns = queues[o.id]?.connections ?? 0;
  const dirty = draft.name !== o.name || draft.width !== o.width || draft.height !== o.height || draft.alertDelay !== o.alertDelay;

  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{o.name}</h2>
        <span className={`badge ${conns ? 'ok' : ''}`}><span className="dot" />{conns} Browserquelle{conns === 1 ? '' : 'n'} verbunden</span>
      </div>
      <Field label="Browserquellen-URL (wie ein Passwort behandeln – nicht im Stream zeigen)">
        <CopyField value={o.url} secret />
      </Field>
      <p className="small muted" style={{ margin: 0 }}>
        In OBS: Quelle hinzufügen → Browser → URL einfügen, Breite {o.width}, Höhe {o.height}, „Audio über OBS steuern“ aktivieren.
        Mit <code>&amp;debug=1</code> am Ende zeigt die Quelle ihren Verbindungsstatus.
      </p>
      <div className="fields">
        <Field label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Breite"><NumberInput value={draft.width} onChange={(width) => setDraft({ ...draft, width })} /></Field>
        <Field label="Höhe"><NumberInput value={draft.height} onChange={(height) => setDraft({ ...draft, height })} /></Field>
        <Field label="Pause zwischen Alerts (s)"><NumberInput value={draft.alertDelay / 1000} step={0.5} min={0} onChange={(s) => setDraft({ ...draft, alertDelay: Math.round(s * 1000) })} /></Field>
      </div>
      <div className="row">
        <button className="primary" disabled={!dirty} onClick={() => run(() => api.patch(`/api/overlays/${o.id}`, { name: draft.name, width: draft.width, height: draft.height, alertDelay: draft.alertDelay }), 'Gespeichert').then(onChange)}>Speichern</button>
        <button onClick={() => confirm('Neuen Key erzeugen? Alle verbundenen Browserquellen müssen danach die neue URL bekommen.') && run(() => api.post(`/api/overlays/${o.id}/rotate-key`), 'Neuer Key erzeugt').then(onChange)}>Key erneuern</button>
        <button className="danger" onClick={() => confirm(`Overlay „${o.name}“ samt Regeln löschen?`) && run(() => api.del(`/api/overlays/${o.id}`), 'Gelöscht').then(onChange)}>Löschen</button>
      </div>
    </div>
  );
}

export function OverlaysPage() {
  const overlays = useLoad(() => api.get<Overlay[]>('/api/overlays'));
  const run = useAction();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overlays</h1>
          <p className="lead" style={{ margin: 0 }}>Jedes Overlay hat eine eigene URL, Warteschlange und eigene Regeln – z. B. Spenden getrennt von Follows oder eines pro Szene.</p>
        </div>
        <button className="primary" onClick={() => run(() => api.post('/api/overlays', { name: 'Neues Overlay' }), 'Overlay angelegt').then(overlays.reload)}>+ Overlay</button>
      </div>
      <div className="grid cols-2">
        {overlays.data?.map((o) => <OverlayCard key={`${o.id}:${o.key}:${o.name}`} o={o} onChange={overlays.reload} />)}
      </div>
    </>
  );
}
