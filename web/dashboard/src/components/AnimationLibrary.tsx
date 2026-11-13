import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlertTemplate } from '../api';
import { Field, Modal } from '../ui';
import { TemplatePreview } from './Preview';
import { TEXT_EFFECT_CATEGORIES, TEXT_EFFECTS, type TextEffectInfo } from '../../../overlay/textfx';

/*
 * Animation Library: alle 123 CSS-Text-Effekte von text-effects.colorion.co als Beispiele mit dem eigenen Text –
 * gleiche Schrift, Größe, Stärke, Farben, Kontur, Schatten, Akzentfarben und Emojis wie im Alert.
 * Ein Klick übernimmt den Effekt ins Design.
 */

type Cat = TextEffectInfo['category'];

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
    duration: 6000,
    textDelay: 0,
    text: { ...t.text, size: Math.max(140, t.text.size), intro: '', outro: '', effect },
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
  const [cat, setCat] = useState<Cat | ''>('');
  const list = useMemo(
    () => TEXT_EFFECTS.filter((e) => (!cat || e.category === cat) && (!filter || `${e.name} ${e.keyword} ${e.word} ${e.description}`.toLowerCase().includes(filter.toLowerCase()))),
    [filter, cat],
  );
  // Vorlage nur einmal pro Effekt bauen, sonst starten die Vorschauen bei jedem Render neu
  const templates = useMemo(() => new Map(TEXT_EFFECTS.map((e) => [e.id, previewTemplate(t, e.id)])), [t]);
  const count = (c: Cat) => TEXT_EFFECTS.filter((e) => e.category === c).length;
  return (
    <Modal title="Animation Library" onClose={onClose} wide>
      <div className="stack">
        <div className="row between">
          <p className="small muted" style={{ margin: 0 }}>
            {TEXT_EFFECTS.length} Text-Effekte mit deinem Text, deiner Schrift und deinen Farben. Klick auf einen Effekt übernimmt ihn ins Design.
          </p>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Suchen …" style={{ width: 200 }} aria-label="Effekte durchsuchen" />
        </div>
        <div className="chips">
          <button className={`chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>Alle {TEXT_EFFECTS.length}</button>
          {(Object.keys(TEXT_EFFECT_CATEGORIES) as Cat[]).map((c) => (
            <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{CATEGORY_DE[c] ?? TEXT_EFFECT_CATEGORIES[c]} {count(c)}</button>
          ))}
        </div>
        <div className="fx-grid">
          {!cat && !filter && (
            <button className={`fx-card ${!t.text.effect ? 'active' : ''}`} onClick={() => onPick('')}>
              <div className="fx-thumb fx-none">Kein Effekt</div>
              <b>Keiner</b>
              <span className="small muted">Text erscheint mit Text-Intro und Buchstaben-Animation</span>
            </button>
          )}
          {list.map((e) => (
            <button key={e.id} className={`fx-card ${t.text.effect === e.id ? 'active' : ''}`} onClick={() => onPick(e.id)} title={e.description}>
              <LazyPreview template={templates.get(e.id)!} />
              <b><span className="muted small">{e.index}</span> {e.name}</b>
              <span className="small muted">{e.keyword}</span>
            </button>
          ))}
          {!list.length && <p className="muted">Kein Effekt gefunden.</p>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Effekte: <a href="https://text-effects.colorion.co/" target="_blank" rel="noreferrer">CSS Text Effects</a> von Colorion (MIT-Lizenz), angepasst für Alerts.
        </p>
      </div>
    </Modal>
  );
}

const CATEGORY_DE: Record<Cat, string> = {
  gradient: 'Verlauf & Farbe', glitch: 'Glitch & Verzerrung', glow: 'Neon & Leuchten', reveal: 'Aufdecken & Tippen',
  depth: '3D & Tiefe', retro: 'Retro-Anzeigen', motion: 'Buchstaben-Bewegung', texture: 'Material & Textur',
};

export function AnimationLibraryField({ t, setText }: { t: AlertTemplate; setText: (patch: Partial<AlertTemplate['text']>) => void }) {
  const [open, setOpen] = useState(false);
  const current = TEXT_EFFECTS.find((e) => e.id === t.text.effect);
  return (
    <div className="fx-field stack">
      <div className="row between">
        <div>
          <b>Animation Library</b>
          <div className="small muted">{current ? `${current.index} ${current.name} – ${current.keyword}` : 'Kein Text-Effekt gewählt'}</div>
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
          <Field label="Akzentfarben des Effekts">
            <select value={t.text.effectColors} onChange={(e) => setText({ effectColors: e.target.value as AlertTemplate['text']['effectColors'] })}>
              <option value="effect">Original (Magenta & Cyan)</option>
              <option value="text">Meine Akzentfarbe</option>
            </select>
          </Field>
        </div>
      )}
      {current && (
        <p className="small muted" style={{ margin: 0 }}>
          {current.description ? `${current.description}. ` : ''}Der Effekt läuft, solange der Alert zu sehen ist. Schrift, Größe, Stärke, Text- und Akzentfarbe, Kontur, Schatten,
          Emojis und Buchstaben-Animation kommen aus deinen Einstellungen.
        </p>
      )}
      {open && <LibraryDialog t={t} onClose={() => setOpen(false)} onPick={(effect) => { setText({ effect, effectSpeed: t.text.effectSpeed || 1 }); setOpen(false); }} />}
    </div>
  );
}
