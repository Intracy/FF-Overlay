import { useEffect, useState } from 'react';
import { api, EVENT_TYPES, type AlertTemplate, type MediaAsset, type Overlay } from '../api';
import { IN_ANIMATIONS, LETTER_ANIMATIONS, LETTER_LABEL, OUT_ANIMATIONS } from '../../../shared/animations';
import { TemplatePreview } from '../components/Preview';
import { GiphyPicker, MediaPicker } from '../components/Pickers';
import { Field, NumberInput, useAction, useLoad } from '../ui';

function AnimSelect({ value, onChange, groups, allowNone }: { value: string; onChange: (v: string) => void; groups: Record<string, string[]>; allowNone?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Keine</option>}
      {Object.entries(groups).map(([g, list]) => (
        <optgroup key={g} label={g}>{list.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>
      ))}
    </select>
  );
}

const TOKENS = ['{user}', '{amount}', '{count}', '{months}', '{streak}', '{tier}', '{product}', '{gifter}', '{message}'];

function Editor({ initial, overlays, onSaved }: { initial: AlertTemplate; overlays: Overlay[]; onSaved: (t: AlertTemplate) => void }) {
  const [t, setT] = useState(initial);
  const [picker, setPicker] = useState<'giphy' | 'visual' | 'audio' | null>(null);
  const [testType, setTestType] = useState('donation:');
  const run = useAction();
  useEffect(() => setT(initial), [initial]);
  const dirty = JSON.stringify(t) !== JSON.stringify(initial);

  const up = <K extends keyof AlertTemplate>(k: K, patch: Partial<AlertTemplate[K]>) =>
    setT((x) => ({ ...x, [k]: typeof x[k] === 'object' ? { ...(x[k] as object), ...patch } : patch }));

  const setMedia = (m: MediaAsset) => {
    up('media', { kind: m.kind === 'video' ? 'video' : 'image', url: m.url, giphyId: m.giphyId });
    if (t.layout === 'textOnly') setT((x) => ({ ...x, layout: 'above' }));
    setPicker(null);
  };

  const save = async () => {
    const saved = await run(() => api.put<AlertTemplate>(`/api/templates/${t.id}`, t), 'Design gespeichert');
    if (saved) onSaved(saved);
  };

  const testOn = async (overlayId: string) => {
    if (dirty) await save();
    const [type, subtype] = testType.split(':');
    await run(() => api.post(`/api/templates/${t.id}/test`, { overlayId, type, subtype: subtype || undefined }), 'Test an Overlay gesendet');
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} style={{ maxWidth: 320, fontWeight: 700 }} aria-label="Name des Designs" />
          <div className="row">
            <select value={testType} onChange={(e) => setTestType(e.target.value)} style={{ width: 'auto' }} aria-label="Beispiel-Event für Test">
              {EVENT_TYPES.filter((x) => x.type !== 'custom').map((x) => <option key={x.label} value={`${x.type}:${x.subtype ?? ''}`}>{x.label}</option>)}
            </select>
            {overlays.map((o) => <button key={o.id} className="small" onClick={() => testOn(o.id)}>Auf „{o.name}“ testen</button>)}
            <button className="primary" onClick={save} disabled={!dirty}>Speichern</button>
          </div>
        </div>
        <TemplatePreview template={t} />
      </div>

      <div className="grid cols-2">
        <div className="card stack">
          <h3>Text</h3>
          <Field label="Nachrichtenvorlage" hint={`Platzhalter: ${TOKENS.join(' ')}`}>
            <input value={t.text.format} onChange={(e) => up('text', { format: e.target.value })} />
          </Field>
          <div className="fields">
            <Field label="Schriftart (Google Fonts)"><input value={t.text.font} onChange={(e) => up('text', { font: e.target.value })} /></Field>
            <Field label="Größe (px)"><NumberInput value={t.text.size} min={8} max={300} onChange={(size) => up('text', { size })} /></Field>
            <Field label="Stärke">
              <select value={t.text.weight} onChange={(e) => up('text', { weight: Number(e.target.value) })}>
                {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </Field>
            <Field label="Textfarbe"><input type="color" value={t.text.color} onChange={(e) => up('text', { color: e.target.value })} /></Field>
            <Field label="Hervorhebung (Name, Betrag)"><input type="color" value={t.text.highlightColor} onChange={(e) => up('text', { highlightColor: e.target.value })} /></Field>
            <Field label="Kontur"><div className="row"><input type="color" value={t.text.strokeColor} onChange={(e) => up('text', { strokeColor: e.target.value })} /><NumberInput value={t.text.strokeWidth} min={0} max={20} onChange={(strokeWidth) => up('text', { strokeWidth })} /></div></Field>
          </div>
          <label className="check"><input type="checkbox" checked={t.text.shadow} onChange={(e) => up('text', { shadow: e.target.checked })} /> Schatten</label>
          <div className="fields">
            <Field label="Text einblenden"><AnimSelect value={t.text.intro} onChange={(intro) => up('text', { intro })} groups={IN_ANIMATIONS} allowNone /></Field>
            <Field label="Buchstaben-Animation">
              <select value={t.text.letterAnimation} onChange={(e) => up('text', { letterAnimation: e.target.value })}>
                {LETTER_ANIMATIONS.map((a) => <option key={a} value={a}>{LETTER_LABEL[a]}</option>)}
              </select>
            </Field>
            <Field label="Text ausblenden"><AnimSelect value={t.text.outro} onChange={(outro) => up('text', { outro })} groups={OUT_ANIMATIONS} allowNone /></Field>
          </div>

          <h3 style={{ marginTop: 8 }}>Zuschauer-Nachricht</h3>
          <label className="check"><input type="checkbox" checked={t.message.show} onChange={(e) => up('message', { show: e.target.checked })} /> Nachricht anzeigen</label>
          <div className="fields">
            <Field label="Schriftart"><input value={t.message.font} onChange={(e) => up('message', { font: e.target.value })} /></Field>
            <Field label="Größe (px)"><NumberInput value={t.message.size} onChange={(size) => up('message', { size })} /></Field>
            <Field label="Farbe"><input type="color" value={t.message.color} onChange={(e) => up('message', { color: e.target.value })} /></Field>
            <Field label="erst ab Betrag"><NumberInput value={t.message.minAmount} min={0} onChange={(minAmount) => up('message', { minAmount })} /></Field>
          </div>
        </div>

        <div className="card stack">
          <h3>Bild, GIF oder Video</h3>
          <div className="row">
            <button onClick={() => setPicker('giphy')}>GIPHY durchsuchen</button>
            <button onClick={() => setPicker('visual')}>Aus Mediathek</button>
            {t.media.kind !== 'none' && <button className="ghost" onClick={() => up('media', { kind: 'none', url: '', giphyId: undefined })}>Entfernen</button>}
          </div>
          {t.media.url && <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>{t.media.giphyId ? `GIPHY ${t.media.giphyId}` : t.media.url}</div>}
          <div className="fields">
            <Field label="Layout">
              <select value={t.layout} onChange={(e) => setT({ ...t, layout: e.target.value as AlertTemplate['layout'] })}>
                <option value="above">Bild über Text</option>
                <option value="below">Text über Bild</option>
                <option value="left">Bild links</option>
                <option value="textOnly">Nur Text</option>
              </select>
            </Field>
            <Field label={`Bildgröße ${t.media.size} %`}><input type="range" min={5} max={150} value={t.media.size} onChange={(e) => up('media', { size: Number(e.target.value) })} /></Field>
            {t.media.kind === 'video' && <Field label={`Video-Lautstärke ${Math.round(t.media.volume * 100)} %`}><input type="range" min={0} max={1} step={0.05} value={t.media.volume} onChange={(e) => up('media', { volume: Number(e.target.value) })} /></Field>}
          </div>

          <h3 style={{ marginTop: 8 }}>Positionierung</h3>
          <div className="row">
            <label className="check"><input type="radio" checked={t.positioning.mode === 'preset'} onChange={() => up('positioning', { mode: 'preset' })} /> Automatisch (Layout)</label>
            <label className="check"><input type="radio" checked={t.positioning.mode === 'manual'} onChange={() => up('positioning', { mode: 'manual' })} /> Manuell</label>
          </div>
          {t.positioning.mode === 'manual' && (
            <div className="fields">
              <Field label={`Bild X ${t.positioning.image.x} %`}><input type="range" min={0} max={100} value={t.positioning.image.x} onChange={(e) => up('positioning', { image: { ...t.positioning.image, x: Number(e.target.value) } })} /></Field>
              <Field label={`Bild Y ${t.positioning.image.y} %`}><input type="range" min={0} max={100} value={t.positioning.image.y} onChange={(e) => up('positioning', { image: { ...t.positioning.image, y: Number(e.target.value) } })} /></Field>
              <Field label={`Text X ${t.positioning.text.x} %`}><input type="range" min={0} max={100} value={t.positioning.text.x} onChange={(e) => up('positioning', { text: { ...t.positioning.text, x: Number(e.target.value) } })} /></Field>
              <Field label={`Text Y ${t.positioning.text.y} %`}><input type="range" min={0} max={100} value={t.positioning.text.y} onChange={(e) => up('positioning', { text: { ...t.positioning.text, y: Number(e.target.value) } })} /></Field>
            </div>
          )}

          <h3 style={{ marginTop: 8 }}>Animation & Timing</h3>
          <div className="fields">
            <Field label="Einblenden"><AnimSelect value={t.animation.in} onChange={(v) => up('animation', { in: v })} groups={IN_ANIMATIONS} /></Field>
            <Field label="Ausblenden"><AnimSelect value={t.animation.out} onChange={(v) => up('animation', { out: v })} groups={OUT_ANIMATIONS} /></Field>
            <Field label="Animationsdauer (ms)"><NumberInput value={t.animation.speedMs} min={100} max={5000} step={100} onChange={(speedMs) => up('animation', { speedMs })} /></Field>
            <Field label="Anzeigedauer (s)"><NumberInput value={t.duration / 1000} min={1} max={120} step={0.5} onChange={(s) => setT({ ...t, duration: Math.round(s * 1000) })} /></Field>
            <Field label="Textverzögerung (s)"><NumberInput value={t.textDelay / 1000} min={0} max={60} step={0.5} onChange={(s) => setT({ ...t, textDelay: Math.round(s * 1000) })} /></Field>
          </div>

          <h3 style={{ marginTop: 8 }}>Sound</h3>
          <div className="row">
            <button onClick={() => setPicker('audio')}>{t.sound.url ? 'Sound ändern' : 'Sound wählen'}</button>
            {t.sound.url && <button className="ghost" onClick={() => up('sound', { url: '' })}>Entfernen</button>}
            {t.sound.url && <button className="ghost" onClick={() => { const a = new Audio(t.sound.url); a.volume = t.sound.volume; void a.play(); }}>▶ Anhören</button>}
          </div>
          <Field label={`Lautstärke ${Math.round(t.sound.volume * 100)} %`}><input type="range" min={0} max={1} step={0.05} value={t.sound.volume} onChange={(e) => up('sound', { volume: Number(e.target.value) })} /></Field>
        </div>
      </div>

      {picker === 'giphy' && <GiphyPicker onPick={setMedia} onClose={() => setPicker(null)} />}
      {picker === 'visual' && <MediaPicker kind="visual" onPick={setMedia} onClose={() => setPicker(null)} />}
      {picker === 'audio' && <MediaPicker kind="audio" onPick={(m) => { up('sound', { url: m.url }); setPicker(null); }} onClose={() => setPicker(null)} />}
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
