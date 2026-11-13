import { useEffect, useState, type ReactNode } from 'react';
import type { AlertTemplate, MediaAsset } from '../api';
import { IN_ANIMATIONS, LETTER_ANIMATIONS, LETTER_LABEL, OUT_ANIMATIONS } from '../../../shared/animations';
import { GiphyPicker, MediaPicker, MyInstantsPicker } from './Pickers';
import { AnimationLibraryField } from './AnimationLibrary';
import { Field, NumberInput } from '../ui';
import { DEFAULT_CUSTOM_CSS, DEFAULT_CUSTOM_HTML } from '../../../../server/src/templates/defaults';

/* Alle Einstellungen eines Alert-Designs, gegliedert wie die Streamlabs-Alert-Box. */

const FONTS = [
  'Poppins', 'Inter', 'Open Sans', 'Roboto', 'Montserrat', 'Lato', 'Oswald', 'Raleway', 'Nunito', 'Rubik', 'Work Sans',
  'Archivo Black', 'Anton', 'Bebas Neue', 'Bangers', 'Bungee', 'Luckiest Guy', 'Lilita One', 'Fredoka', 'Baloo 2',
  'Press Start 2P', 'VT323', 'Silkscreen', 'Orbitron', 'Russo One', 'Teko', 'Rajdhani', 'Exo 2', 'Audiowide', 'Black Ops One',
  'Permanent Marker', 'Pacifico', 'Lobster', 'Caveat', 'Shadows Into Light', 'Indie Flower', 'Amatic SC', 'Kalam',
  'Playfair Display', 'Merriweather', 'Abril Fatface', 'Alfa Slab One', 'Righteous', 'Comfortaa', 'Quicksand', 'Barlow',
  'Barlow Condensed', 'Titillium Web', 'Source Sans 3', 'PT Sans', 'Ubuntu', 'Josefin Sans', 'Kanit', 'Prompt', 'Saira',
];

export const TOKENS = ['{user}', '{amount}', '{count}', '{months}', '{streak}', '{tier}', '{product}', '{gifter}', '{message}'];

export function AnimSelect({ value, onChange, groups, allowNone }: { value: string; onChange: (v: string) => void; groups: Record<string, string[]>; allowNone?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Keine</option>}
      {Object.entries(groups).map(([g, list]) => (
        <optgroup key={g} label={g}>{list.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>
      ))}
    </select>
  );
}

export function FontInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input list="ffo-fonts" value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id="ffo-fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  );
}

/** Aufklappbarer Abschnitt wie die Akkordeons in Streamlabs */
export function Section({ title, badge, open: initial = true, children }: { title: string; badge?: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="section">
      <button type="button" className="section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <span className="row">{badge && <span className="badge">{badge}</span>}<span className="muted">{open ? '▾' : '▸'}</span></span>
      </button>
      {open && <div className="section-body stack">{children}</div>}
    </div>
  );
}

function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

/** part: 'left' = Allgemein, Medien, Sound, Animationen; 'right' = Schrift, Nachricht, TTS, eigener Code (für das zweispaltige Layout). */
export function DesignFields({ t, setT, part = 'all' }: { t: AlertTemplate; setT: (fn: (t: AlertTemplate) => AlertTemplate) => void; part?: 'all' | 'left' | 'right' }) {
  const show = (p: 'left' | 'right') => part === 'all' || part === p;
  const [picker, setPicker] = useState<'giphy' | 'visual' | 'audio' | 'myinstants' | null>(null);
  const [codeTab, setCodeTab] = useState<'html' | 'css' | 'js' | 'fields'>('html');
  const voices = useVoices();

  const up = <K extends keyof AlertTemplate>(k: K, patch: Partial<AlertTemplate[K]>) =>
    setT((x) => ({ ...x, [k]: typeof x[k] === 'object' ? { ...(x[k] as object), ...patch } : patch }));
  const set = (patch: Partial<AlertTemplate>) => setT((x) => ({ ...x, ...patch }));

  const setMedia = (m: MediaAsset) => {
    setT((x) => ({ ...x, layout: x.layout === 'textOnly' ? 'above' : x.layout, media: { ...x.media, kind: m.kind === 'video' ? 'video' : 'image', url: m.url, giphyId: m.giphyId } }));
    setPicker(null);
  };

  const fieldsValid = (() => { try { const v = JSON.parse(t.custom.fields || '{}'); return v && typeof v === 'object' && !Array.isArray(v); } catch { return false; } })();

  return (
    <div className="stack">
      {show('left') && (
      <Section title="Allgemein">
        <Field label="Nachrichtenvorlage" hint={`Platzhalter: ${TOKENS.join(' ')}`}>
          <input value={t.text.format} onChange={(e) => up('text', { format: e.target.value })} />
        </Field>
        <div className="fields">
          <Field label="Positionierung">
            <select value={t.positioning.mode} onChange={(e) => up('positioning', { mode: e.target.value as 'preset' | 'manual' })}>
              <option value="preset">Voreinstellung (Layout)</option>
              <option value="manual">Manuell</option>
            </select>
          </Field>
          <Field label="Layout">
            <select value={t.layout} onChange={(e) => set({ layout: e.target.value as AlertTemplate['layout'] })}>
              <option value="above">Bild über Text</option>
              <option value="below">Text über Bild</option>
              <option value="left">Bild links</option>
              <option value="textOnly">Nur Text</option>
            </select>
          </Field>
          <Field label={`Anzeigedauer ${t.duration / 1000} s`}><input type="range" min={2} max={300} step={1} value={t.duration / 1000} onChange={(e) => set({ duration: Number(e.target.value) * 1000 })} /></Field>
          <Field label={`Textverzögerung ${t.textDelay / 1000} s`}><input type="range" min={0} max={60} step={0.5} value={t.textDelay / 1000} onChange={(e) => set({ textDelay: Math.round(Number(e.target.value) * 1000) })} /></Field>
        </div>
        {t.positioning.mode === 'manual' && (
          <div className="fields">
            <Field label={`Bild X ${t.positioning.image.x} %`}><input type="range" min={0} max={100} value={t.positioning.image.x} onChange={(e) => up('positioning', { image: { ...t.positioning.image, x: Number(e.target.value) } })} /></Field>
            <Field label={`Bild Y ${t.positioning.image.y} %`}><input type="range" min={0} max={100} value={t.positioning.image.y} onChange={(e) => up('positioning', { image: { ...t.positioning.image, y: Number(e.target.value) } })} /></Field>
            <Field label={`Text X ${t.positioning.text.x} %`}><input type="range" min={0} max={100} value={t.positioning.text.x} onChange={(e) => up('positioning', { text: { ...t.positioning.text, x: Number(e.target.value) } })} /></Field>
            <Field label={`Text Y ${t.positioning.text.y} %`}><input type="range" min={0} max={100} value={t.positioning.text.y} onChange={(e) => up('positioning', { text: { ...t.positioning.text, y: Number(e.target.value) } })} /></Field>
          </div>
        )}
      </Section>
      )}

      {show('left') && (
      <Section title="Bild, GIF oder Video" badge={t.media.kind === 'none' ? 'keins' : t.media.giphyId ? 'GIPHY' : t.media.kind === 'video' ? 'Video' : 'Bild'}>
        <div className="row">
          <button onClick={() => setPicker('giphy')}>GIPHY durchsuchen</button>
          <button onClick={() => setPicker('visual')}>Aus Mediathek / Upload</button>
          {t.media.kind !== 'none' && <button className="ghost" onClick={() => up('media', { kind: 'none', url: '', giphyId: undefined })}>Entfernen</button>}
        </div>
        {t.media.url && <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>{t.media.giphyId ? `GIPHY ${t.media.giphyId}` : t.media.url}</div>}
        <div className="fields">
          <Field label={`Bildgröße ${t.media.size} %`}><input type="range" min={1} max={100} value={t.media.size} onChange={(e) => up('media', { size: Number(e.target.value) })} /></Field>
          {t.media.kind === 'video' && <Field label={`Video-Lautstärke ${Math.round(t.media.volume * 100)} %`}><input type="range" min={0} max={1} step={0.05} value={t.media.volume} onChange={(e) => up('media', { volume: Number(e.target.value) })} /></Field>}
        </div>
      </Section>
      )}

      {show('left') && (
      <Section title="Sound" badge={t.sound.url ? `${Math.round(t.sound.volume * 100)} %` : 'keiner'}>
        <div className="row">
          <button onClick={() => setPicker('audio')}>{t.sound.url ? 'Sound ändern' : 'Sound wählen'}</button>
          <button onClick={() => setPicker('myinstants')}>MyInstants durchsuchen</button>
          {t.sound.url && <button className="ghost" onClick={() => up('sound', { url: '' })}>Entfernen</button>}
          {t.sound.url && <button className="ghost" onClick={() => { const a = new Audio(t.sound.url); a.volume = t.sound.volume; void a.play(); }}>▶ Anhören</button>}
        </div>
        <Field label={`Lautstärke ${Math.round(t.sound.volume * 100)} %`}><input type="range" min={0} max={1} step={0.01} value={t.sound.volume} onChange={(e) => up('sound', { volume: Number(e.target.value) })} /></Field>
      </Section>
      )}

      {show('left') && (
      <Section title="Animationen" badge={[t.animation.enabled ? 'Animationen an' : '', t.text.effect ? 'Library' : ''].filter(Boolean).join(' + ') || 'aus'}>
        <label className="check">
          <input type="checkbox" checked={t.animation.enabled} onChange={(e) => up('animation', { enabled: e.target.checked })} />
          Ein-/Ausblend- und Text-Animationen verwenden
        </label>
        {!t.animation.enabled && <p className="small muted" style={{ margin: 0 }}>Aus: Der Alert erscheint und verschwindet ohne Animation. Ein Effekt aus der Animation Library läuft unabhängig davon.</p>}
        {t.animation.enabled && (
        <div className="fields">
          <Field label="Alert einblenden"><AnimSelect value={t.animation.in} onChange={(v) => up('animation', { in: v })} groups={IN_ANIMATIONS} /></Field>
          <Field label="Alert ausblenden"><AnimSelect value={t.animation.out} onChange={(v) => up('animation', { out: v })} groups={OUT_ANIMATIONS} /></Field>
          <Field label="Text-Intro"><AnimSelect value={t.text.intro} onChange={(intro) => up('text', { intro })} groups={IN_ANIMATIONS} allowNone /></Field>
          <Field label="Text-Animation (pro Buchstabe)">
            <select value={t.text.letterAnimation} onChange={(e) => up('text', { letterAnimation: e.target.value })}>
              {LETTER_ANIMATIONS.map((a) => <option key={a} value={a}>{LETTER_LABEL[a]}</option>)}
            </select>
          </Field>
          <Field label="Text-Outro"><AnimSelect value={t.text.outro} onChange={(outro) => up('text', { outro })} groups={OUT_ANIMATIONS} allowNone /></Field>
          <Field label="Animationsdauer (ms)"><NumberInput value={t.animation.speedMs} min={100} max={5000} step={100} onChange={(speedMs) => up('animation', { speedMs })} /></Field>
        </div>
        )}
        <AnimationLibraryField t={t} setText={(p) => up('text', p)} />
      </Section>
      )}

      {show('right') && (
      <Section title="Schriftart-Einstellungen" open={false}>
        <div className="fields">
          <Field label="Schriftart (Google Fonts)"><FontInput value={t.text.font} onChange={(font) => up('text', { font })} /></Field>
          <Field label={`Schriftgröße ${t.text.size} px`}><input type="range" min={12} max={200} value={t.text.size} onChange={(e) => up('text', { size: Number(e.target.value) })} /></Field>
          <Field label="Schriftstärke">
            <select value={t.text.weight} onChange={(e) => up('text', { weight: Number(e.target.value) })}>
              {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
          <Field label="Textfarbe"><input type="color" value={t.text.color} onChange={(e) => up('text', { color: e.target.value })} /></Field>
          <Field label="Text-Highlight-Farbe"><input type="color" value={t.text.highlightColor} onChange={(e) => up('text', { highlightColor: e.target.value })} /></Field>
          <Field label="Kontur"><div className="row"><input type="color" value={t.text.strokeColor} onChange={(e) => up('text', { strokeColor: e.target.value })} /><NumberInput value={t.text.strokeWidth} min={0} max={20} onChange={(strokeWidth) => up('text', { strokeWidth })} /></div></Field>
        </div>
        <label className="check"><input type="checkbox" checked={t.text.shadow} onChange={(e) => up('text', { shadow: e.target.checked })} /> Schatten</label>
      </Section>
      )}

      {show('right') && (
      <Section title="Einstellungen für Nachrichten" badge={t.message.show ? 'Aktiviert' : 'Deaktiviert'} open={false}>
        <div className="row">
          <label className="check"><input type="checkbox" checked={t.message.show} onChange={(e) => up('message', { show: e.target.checked })} /> Zuschauer-Nachricht anzeigen</label>
          <label className="check"><input type="checkbox" checked={t.message.allowEmotes} onChange={(e) => up('message', { allowEmotes: e.target.checked })} /> Twitch-Emotes anzeigen</label>
        </div>
        <div className="fields">
          <Field label="Schriftart"><FontInput value={t.message.font} onChange={(font) => up('message', { font })} /></Field>
          <Field label={`Schriftgröße ${t.message.size} px`}><input type="range" min={12} max={120} value={t.message.size} onChange={(e) => up('message', { size: Number(e.target.value) })} /></Field>
          <Field label="Schriftstärke">
            <select value={t.message.weight} onChange={(e) => up('message', { weight: Number(e.target.value) })}>
              {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
          <Field label="Textfarbe"><input type="color" value={t.message.color} onChange={(e) => up('message', { color: e.target.value })} /></Field>
          <Field label="Nachricht erst ab Betrag"><NumberInput value={t.message.minAmount} min={0} onChange={(minAmount) => up('message', { minAmount })} /></Field>
        </div>
      </Section>
      )}

      {show('right') && (
      <Section title="Einstellungen Text-in-Sprache" badge={t.tts.enabled ? 'Aktiviert' : 'Deaktiviert'} open={false}>
        <label className="check"><input type="checkbox" checked={t.tts.enabled} onChange={(e) => up('tts', { enabled: e.target.checked })} /> Nachrichten vorlesen</label>
        <div className="fields">
          <Field label="Mindestbetrag zum Vorlesen"><NumberInput value={t.tts.minAmount} min={0} onChange={(minAmount) => up('tts', { minAmount })} /></Field>
          <Field label="Sprache">
            <select value={t.tts.lang} onChange={(e) => up('tts', { lang: e.target.value, voice: '' })}>
              {['de-DE', 'de-AT', 'de-CH', 'en-US', 'en-GB', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pl-PL', 'tr-TR'].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Stimme" hint="Stimmen kommen vom Rechner, auf dem die Browserquelle läuft.">
            <select value={t.tts.voice} onChange={(e) => up('tts', { voice: e.target.value })}>
              <option value="">Standard für die Sprache</option>
              {voices.filter((v) => v.lang.startsWith(t.tts.lang.slice(0, 2))).map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </Field>
          <Field label={`Spam-Sicherheit: ${['Aus', 'Niedrig', 'Mittel', 'Hoch'][t.tts.security]}`}><input type="range" min={0} max={3} step={1} value={t.tts.security} onChange={(e) => up('tts', { security: Number(e.target.value) })} /></Field>
          <Field label={`Spam-Wiederholungssperre ${t.tts.repetitionBlock || 'aus'}`} hint="Gleiches Wort höchstens so oft"><input type="range" min={0} max={100} value={t.tts.repetitionBlock} onChange={(e) => up('tts', { repetitionBlock: Number(e.target.value) })} /></Field>
          <Field label={`Lautstärke ${Math.round(t.tts.volume * 100)} %`}><input type="range" min={0} max={1} step={0.05} value={t.tts.volume} onChange={(e) => up('tts', { volume: Number(e.target.value) })} /></Field>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={t.tts.includeTemplate} onChange={(e) => up('tts', { includeTemplate: e.target.checked })} /> Nachrichtenvorlage in TTS einbinden</label>
          <button className="small" onClick={() => {
            const u = new SpeechSynthesisUtterance('Danke für die Unterstützung! Das ist ein Test.');
            u.lang = t.tts.lang;
            const v = voices.find((x) => x.name === t.tts.voice);
            if (v) u.voice = v;
            u.volume = t.tts.volume;
            window.speechSynthesis.speak(u);
          }}>▶ Stimme testen</button>
        </div>
      </Section>
      )}

      {show('right') && (
      <Section title="Benutzerdefiniertes HTML/CSS" badge={t.custom.enabled ? 'Aktiviert' : 'Deaktiviert'} open={false}>
        <label className="check"><input type="checkbox" checked={t.custom.enabled} onChange={(e) => up('custom', { enabled: e.target.checked })} /> Eigenen Code statt Bild/Text verwenden</label>
        <div className="chips">
          {(['html', 'css', 'js', 'fields'] as const).map((k) => (
            <button key={k} className={`chip ${codeTab === k ? 'active' : ''}`} onClick={() => setCodeTab(k)}>{k === 'fields' ? 'Eigene Felder' : k.toUpperCase()}</button>
          ))}
        </div>
        <textarea className="code" rows={12} spellCheck={false} value={t.custom[codeTab]} onChange={(e) => up('custom', { [codeTab]: e.target.value })} />
        {codeTab === 'fields' && !fieldsValid && <div className="small" style={{ color: 'var(--err)' }}>Eigene Felder müssen ein JSON-Objekt sein, z. B. {'{"farbe": "#ff0000"}'}</div>}
        <p className="small muted" style={{ margin: 0 }}>
          Platzhalter: <code>{'{img} {messageTemplate} {userMessage} {name} {amount}'}</code> und alle aus der Vorlage, plus eigene Felder als <code>{'{feldname}'}</code>.
          Im JavaScript stehen alle Werte unter <code>window.ALERT</code>. Der Code läuft abgeschottet in einem Sandbox-Frame ohne Zugriff aufs Dashboard – trotzdem nur Code verwenden, dem du vertraust.
        </p>
        <div><button className="small" onClick={() => up('custom', { html: DEFAULT_CUSTOM_HTML, css: DEFAULT_CUSTOM_CSS, js: '', fields: '{}' })}>Code zurücksetzen</button></div>
      </Section>
      )}

      {picker === 'giphy' && <GiphyPicker onPick={setMedia} onClose={() => setPicker(null)} />}
      {picker === 'visual' && <MediaPicker kind="visual" onPick={setMedia} onClose={() => setPicker(null)} />}
      {picker === 'audio' && <MediaPicker kind="audio" onPick={(m) => { up('sound', { url: m.url }); setPicker(null); }} onClose={() => setPicker(null)} />}
      {picker === 'myinstants' && <MyInstantsPicker onPick={(m) => { up('sound', { url: m.url }); setPicker(null); }} onClose={() => setPicker(null)} />}
    </div>
  );
}
