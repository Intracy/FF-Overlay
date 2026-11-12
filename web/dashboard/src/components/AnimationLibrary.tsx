import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlertTemplate } from '../api';
import { Field, Modal } from '../ui';
import { TemplatePreview } from './Preview';
import { TEXT_EFFECTS } from '../../../overlay/textfx';

/*
 * Animation Library: alle Text-Effekte aus browsertexteffects als Beispiele mit dem eigenen Text –
 * gleiche Schrift, Stärke, Farben, Kontur, Schatten, Akzentfarben und Emojis wie im Alert.
 * Ein Klick übernimmt den Effekt ins Design.
 */

const SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3];

/** Vorschau-Variante des Designs: nur der Titel, groß genug für eine Kachel */
function previewTemplate(t: AlertTemplate, effect: string): AlertTemplate {
  return {
    ...t,
    layout: 'textOnly',
    positioning: { ...t.positioning, mode: 'preset' },
    media: { ...t.media, kind: 'none' },
    sound: { ...t.sound, url: '' },
    custom: { ...t.custom, enabled: false },
    tts: { ...t.tts, enabled: false },
    message: { ...t.message, show: false },
    animation: { ...t.animation, in: 'fadeIn', out: 'fadeOut', speedMs: 300 },
    duration: 2500,
    textDelay: 0,
    text: { ...t.text, size: Math.max(150, t.text.size), intro: '', outro: '', effect },
  };
}

/** Kachel spielt nur, solange sie sichtbar ist */
function LazyPreview({ template }: { template: AlertTemplate }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className="fx-thumb">{visible ? <TemplatePreview template={template} background="#14161a" /> : <div className="preview-frame" />}</div>;
}

function LibraryDialog({ t, onPick, onClose }: { t: AlertTemplate; onPick: (effect: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const list = useMemo(
    () => TEXT_EFFECTS.filter((e) => !filter || `${e.label} ${e.description}`.toLowerCase().includes(filter.toLowerCase())),
    [filter],
  );
  // Vorlage nur einmal pro Effekt bauen, sonst starten die Vorschauen bei jedem Render neu
  const templates = useMemo(() => new Map(TEXT_EFFECTS.map((e) => [e.id, previewTemplate(t, e.id)])), [t]);
  return (
    <Modal title="Animation Library" onClose={onClose} wide>
      <div className="stack">
        <div className="row between">
          <p className="small muted" style={{ margin: 0 }}>
            {TEXT_EFFECTS.length} Text-Effekte mit deinem Text, deiner Schrift und deinen Farben. Klick auf einen Effekt übernimmt ihn ins Design.
          </p>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Suchen …" style={{ width: 200 }} aria-label="Effekte durchsuchen" />
        </div>
        <div className="fx-grid">
          <button className={`fx-card ${!t.text.effect ? 'active' : ''}`} onClick={() => onPick('')}>
            <div className="fx-thumb fx-none">Kein Effekt</div>
            <b>Keiner</b>
            <span className="small muted">Text erscheint mit Text-Intro und Buchstaben-Animation</span>
          </button>
          {list.map((e) => (
            <button key={e.id} className={`fx-card ${t.text.effect === e.id ? 'active' : ''}`} onClick={() => onPick(e.id)}>
              <LazyPreview template={templates.get(e.id)!} />
              <b>{e.label}</b>
              <span className="small muted">{e.description} · ca. {e.seconds.toLocaleString('de-DE')} s</span>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Effekte: <a href="https://donlair.github.io/browsertexteffects/" target="_blank" rel="noreferrer">BrowserTextEffects</a> von Don Lair (MIT-Lizenz), Port von TerminalTextEffects.
        </p>
      </div>
    </Modal>
  );
}

export function AnimationLibraryField({ t, setText }: { t: AlertTemplate; setText: (patch: Partial<AlertTemplate['text']>) => void }) {
  const [open, setOpen] = useState(false);
  const current = TEXT_EFFECTS.find((e) => e.id === t.text.effect);
  const seconds = current ? current.seconds / (t.text.effectSpeed || 1) : 0;
  return (
    <div className="fx-field stack">
      <div className="row between">
        <div>
          <b>Animation Library</b>
          <div className="small muted">{current ? `${current.label} – ${current.description}` : 'Kein Text-Effekt gewählt'}</div>
        </div>
        <div className="row">
          {current && <button className="small ghost" onClick={() => setText({ effect: '' })}>Entfernen</button>}
          <button className="primary" onClick={() => setOpen(true)}>Animation Library öffnen</button>
        </div>
      </div>
      {current && (
        <div className="fields">
          <Field label="Tempo">
            <select value={t.text.effectSpeed} onChange={(e) => setText({ effectSpeed: Number(e.target.value) })}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s.toLocaleString('de-DE')}×</option>)}
            </select>
          </Field>
          <Field label="Farben während des Effekts">
            <select value={t.text.effectColors} onChange={(e) => setText({ effectColors: e.target.value as AlertTemplate['text']['effectColors'] })}>
              <option value="effect">Originalfarben des Effekts</option>
              <option value="text">Meine Text- und Akzentfarbe</option>
            </select>
          </Field>
        </div>
      )}
      {current && seconds * 1000 > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Dauer ca. {seconds.toLocaleString('de-DE', { maximumFractionDigits: 1 })} s. Ist der Effekt länger als die Anzeigedauer, bleibt der Alert stehen, bis er fertig ist (höchstens 20 s länger).
          Am Ende wird zum fertig formatierten Text übergeblendet – mit Akzentfarben, Emojis und Buchstaben-Animation.
        </p>
      )}
      {open && <LibraryDialog t={t} onClose={() => setOpen(false)} onPick={(effect) => { setText({ effect, effectSpeed: t.text.effectSpeed || 1 }); setOpen(false); }} />}
    </div>
  );
}
