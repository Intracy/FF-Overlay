import { useState } from 'react';
import { api, type MediaAsset } from '../api';
import { Field, NumberInput, useAction, useLoad } from '../ui';
import { useLive } from '../live';
import { AnimSelect, FontInput, Section } from '../components/DesignFields';
import { Color, Toggle } from '../components/WidgetFields';
import { MediaPicker, MyInstantsPicker } from '../components/Pickers';
import { IN_ANIMATIONS, OUT_ANIMATIONS } from '../../../shared/animations';
import { TEXT_EFFECT_CATEGORIES, TEXT_EFFECTS } from '../../../overlay/textfx';
import { CHAT_THEMES, DEFAULT_HIDDEN_USERS, PLATFORM_COLORS, type ChatMessage, type ChatSettings, type ChatTextStyle } from '../../../../server/src/shared/chat';
import type { Widget } from '../../../../server/src/shared/widgets';
import { WidgetEditor } from './Widgets';

/*
 * Menüpunkt „Chat“: Chat-Overlays für Twitch und YouTube (einzeln oder zusammen) gestalten,
 * live mitlesen, Nachrichten ausblenden und testen.
 */

type W = Widget & { url: string };
type Set = (p: Partial<ChatSettings>) => void;

function TextStyleFields({ t, onChange, withColor = true }: { t: ChatTextStyle; onChange: (t: ChatTextStyle) => void; withColor?: boolean }) {
  return (
    <div className="fields">
      <Field label="Schriftart"><FontInput value={t.font} onChange={(font) => onChange({ ...t, font })} /></Field>
      <Field label={`Größe ${t.size}px`}><input type="range" min={10} max={120} value={t.size} onChange={(e) => onChange({ ...t, size: Number(e.target.value) })} /></Field>
      <Field label="Stärke">
        <select value={t.weight} onChange={(e) => onChange({ ...t, weight: Number(e.target.value) })}>
          {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}{w >= 700 ? ' (fett)' : ''}</option>)}
        </select>
      </Field>
      {withColor && <Color label="Farbe" value={t.color} onChange={(color) => onChange({ ...t, color })} />}
    </div>
  );
}

function SoundField({ s, set }: { s: ChatSettings; set: Set }) {
  const [picker, setPicker] = useState<'' | 'media' | 'myinstants'>('');
  const pick = (m: MediaAsset) => {
    set({ sound: { ...s.sound, url: m.url } });
    setPicker('');
    const a = new Audio(m.url);
    a.volume = s.sound.volume;
    void a.play().catch(() => undefined);
  };
  return (
    <>
      <div className="row">
        <button onClick={() => setPicker('media')}>{s.sound.url ? 'Sound ändern' : 'Sound wählen'}</button>
        <button onClick={() => setPicker('myinstants')}>MyInstants durchsuchen</button>
        {s.sound.url && <button className="ghost" onClick={() => set({ sound: { ...s.sound, url: '' } })}>Entfernen</button>}
        {s.sound.url && <button className="ghost" onClick={() => { const a = new Audio(s.sound.url); a.volume = s.sound.volume; void a.play(); }}>▶ Anhören</button>}
      </div>
      {s.sound.url && <code className="small muted">{s.sound.url}</code>}
      <Field label={`Lautstärke ${Math.round(s.sound.volume * 100)} %`}>
        <input type="range" min={0} max={1} step={0.05} value={s.sound.volume} onChange={(e) => set({ sound: { ...s.sound, volume: Number(e.target.value) } })} />
      </Field>
      {picker === 'media' && <MediaPicker kind="audio" onPick={pick} onClose={() => setPicker('')} />}
      {picker === 'myinstants' && <MyInstantsPicker onPick={pick} onClose={() => setPicker('')} />}
    </>
  );
}

/** Einstellungen des Chat-Overlays als Abschnitte (wie die Alert-Einstellungen) */
export function chatSections(s: ChatSettings, set: Set) {
  const bg = (p: Partial<ChatSettings['background']>) => set({ background: { ...s.background, ...p } });
  const theme = CHAT_THEMES.find((t) => t.id === s.theme)?.label ?? s.theme;
  return (
    <>
      <Section title="Quellen" badge={[s.sources.twitch && 'Twitch', s.sources.youtube && 'YouTube'].filter(Boolean).join(' + ') || 'keine'}>
        <div className="row" style={{ gap: 18 }}>
          <Toggle label="Twitch-Chat" value={s.sources.twitch} onChange={(twitch) => set({ sources: { ...s.sources, twitch } })} />
          <Toggle label="YouTube-Chat" value={s.sources.youtube} onChange={(youtube) => set({ sources: { ...s.sources, youtube } })} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>Beide an: ein gemeinsamer Chat, jede Nachricht mit Plattform-Symbol. Verbindungen richtest du unter „Verbindungen“ ein.</p>
      </Section>
      <Section title="Layout" badge={theme}>
        <div className="fields">
          <Field label="Stil">
            <select value={s.theme} onChange={(e) => set({ theme: e.target.value as ChatSettings['theme'] })}>
              {CHAT_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Richtung">
            <select value={s.direction} onChange={(e) => set({ direction: e.target.value as ChatSettings['direction'] })}>
              <option value="up">Neue unten (wie im Chat)</option>
              <option value="down">Neue oben</option>
            </select>
          </Field>
          <Field label="Ausrichtung">
            <select value={s.align} onChange={(e) => set({ align: e.target.value as ChatSettings['align'] })}>
              <option value="left">Links</option>
              <option value="right">Rechts</option>
            </select>
          </Field>
          <Field label="Max. Nachrichten"><NumberInput value={s.maxMessages} min={1} max={50} onChange={(maxMessages) => set({ maxMessages })} /></Field>
          <Field label={`Ausblenden nach ${s.hideAfter ? `${s.hideAfter} s` : '– (nie)'}`}>
            <input type="range" min={0} max={300} step={5} value={s.hideAfter} onChange={(e) => set({ hideAfter: Number(e.target.value) })} />
          </Field>
          <Field label={`Verzögerung ${s.delay} s`} hint="Zeit zum Moderieren – gelöschte Nachrichten erscheinen nie">
            <input type="range" min={0} max={30} value={s.delay} onChange={(e) => set({ delay: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <Toggle label="Name und Nachricht in einer Zeile" value={s.inline} onChange={(inline) => set({ inline })} />
          <Toggle label="Plattform-Symbol" value={s.showPlatform} onChange={(showPlatform) => set({ showPlatform })} />
          <Toggle label="Abzeichen (Mod, Sub, VIP, Mitglied)" value={s.showBadges} onChange={(showBadges) => set({ showBadges })} />
          <Toggle label="Profilbild" value={s.showAvatar} onChange={(showAvatar) => set({ showAvatar })} />
        </div>
      </Section>
      <Section title="Name" badge={`${s.name.font} · ${s.name.size}px`}>
        <TextStyleFields t={s.name} onChange={(name) => set({ name })} withColor={s.nameColor === 'custom'} />
        <Field label="Farbe des Namens">
          <select value={s.nameColor} onChange={(e) => set({ nameColor: e.target.value as ChatSettings['nameColor'] })}>
            <option value="user">Farbe der Zuschauer:innen (Twitch), sonst automatisch</option>
            <option value="platform">Plattformfarbe (Twitch lila, YouTube rot)</option>
            <option value="custom">Eigene Farbe</option>
          </select>
        </Field>
      </Section>
      <Section title="Nachricht" badge={`${s.message.font} · ${s.message.size}px`}>
        <TextStyleFields t={s.message} onChange={(message) => set({ message })} />
        <div className="fields">
          <Color label="Akzentfarbe (Erwähnungen, Beträge, Neon)" value={s.highlightColor} onChange={(highlightColor) => set({ highlightColor })} />
          <Field label={`Emote-Größe ${s.emoteSize} %`}><input type="range" min={50} max={300} step={10} value={s.emoteSize} onChange={(e) => set({ emoteSize: Number(e.target.value) })} /></Field>
          <Field label={`Kontur ${s.strokeWidth}px`}><input type="range" min={0} max={8} step={0.5} value={s.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} /></Field>
          <Color label="Konturfarbe" value={s.strokeColor} onChange={(strokeColor) => set({ strokeColor })} />
        </div>
        <Toggle label="Schatten" value={s.shadow} onChange={(shadow) => set({ shadow })} />
      </Section>
      <Section title="Hintergrund" badge={`${s.background.opacity} %`}>
        <div className="fields">
          <Color label="Farbe" value={s.background.color} onChange={(color) => bg({ color })} />
          <Field label={`Deckkraft ${s.background.opacity} %`}><input type="range" min={0} max={100} value={s.background.opacity} onChange={(e) => bg({ opacity: Number(e.target.value) })} /></Field>
          <Field label={`Ecken ${s.background.radius}px`}><input type="range" min={0} max={40} value={s.background.radius} onChange={(e) => bg({ radius: Number(e.target.value) })} /></Field>
          <Field label={`Innenabstand ${s.background.padding}px`}><input type="range" min={0} max={40} value={s.background.padding} onChange={(e) => bg({ padding: Number(e.target.value) })} /></Field>
          <Field label={`Abstand zwischen Nachrichten ${s.background.gap}px`}><input type="range" min={0} max={40} value={s.background.gap} onChange={(e) => bg({ gap: Number(e.target.value) })} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Bei „Klar“ und „Minimal“ gibt es keinen Kasten – dann wirken nur Schrift, Kontur und Schatten.</p>
      </Section>
      <Section title="Animationen" badge={s.nameEffect ? 'mit Namens-Effekt' : undefined}>
        <div className="fields">
          <Field label="Einblenden"><AnimSelect value={s.animIn} onChange={(animIn) => set({ animIn })} groups={IN_ANIMATIONS} allowNone /></Field>
          <Field label="Ausblenden"><AnimSelect value={s.animOut} onChange={(animOut) => set({ animOut })} groups={OUT_ANIMATIONS} allowNone /></Field>
          <Field label={`Tempo ${s.speedMs} ms`}><input type="range" min={150} max={3000} step={50} value={s.speedMs} onChange={(e) => set({ speedMs: Number(e.target.value) })} /></Field>
        </div>
        <div className="fields">
          <Field label="Namens-Effekt (Animation Library)">
            <select value={s.nameEffect} onChange={(e) => set({ nameEffect: e.target.value })}>
              <option value="">Kein Effekt</option>
              {Object.entries(TEXT_EFFECT_CATEGORIES).map(([cat, label]) => (
                <optgroup key={cat} label={label}>
                  {TEXT_EFFECTS.filter((x) => x.category === cat).map((x) => <option key={x.id} value={x.id}>{x.index} {x.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          {s.nameEffect && (
            <>
              <Field label="Tempo des Effekts">
                <select value={s.effectSpeed} onChange={(e) => set({ effectSpeed: Number(e.target.value) })}>
                  {[0.5, 0.75, 1, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v.toLocaleString('de-DE')}×</option>)}
                </select>
              </Field>
              <Field label="Akzentfarben des Effekts">
                <select value={s.effectColors} onChange={(e) => set({ effectColors: e.target.value as ChatSettings['effectColors'] })}>
                  <option value="effect">Original (Magenta & Cyan)</option>
                  <option value="text">Meine Akzentfarbe</option>
                </select>
              </Field>
            </>
          )}
        </div>
      </Section>
      <Section title="Filter" open={false} badge={s.hideCommands ? 'ohne Befehle' : undefined}>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <Toggle label="Befehle ausblenden (!…)" value={s.hideCommands} onChange={(hideCommands) => set({ hideCommands })} />
          <Toggle label="Nachrichten mit Links ausblenden" value={s.hideLinks} onChange={(hideLinks) => set({ hideLinks })} />
          <Toggle label="Super Chats, Super Sticker und Bits zeigen (hervorgehoben)" value={s.showHighlights} onChange={(showHighlights) => set({ showHighlights })} />
        </div>
        <Field label="Ausgeblendete Nutzer:innen (z. B. Bots), eine pro Zeile">
          <textarea rows={5} value={s.hiddenUsers} onChange={(e) => set({ hiddenUsers: e.target.value })} />
        </Field>
        <div className="row">
          <button className="small ghost" onClick={() => set({ hiddenUsers: DEFAULT_HIDDEN_USERS })}>Bekannte Bots eintragen</button>
          <span className="small muted">Sperrliste und Schimpfwort-Filter aus „Alert-Box → Allgemeine Einstellungen“ gelten auch hier.</span>
        </div>
      </Section>
      <Section title="Sound bei neuer Nachricht" open={false} badge={s.sound.url ? 'an' : 'aus'}>
        <SoundField s={s} set={set} />
      </Section>
    </>
  );
}

// ---------- Live-Chat im Dashboard ----------

function LiveChat() {
  const { chat, connectors } = useLive();
  const run = useAction();
  const hide = (r: object, msg: string) => void run(() => api.post('/api/chat/remove', r), msg);
  const twitch = connectors.filter((c) => c.platform === 'twitch');
  const youtube = connectors.filter((c) => c.platform === 'youtube');
  const notes = [
    !twitch.length && 'Twitch ist nicht verbunden.',
    twitch.some((c) => /Chat fehlt/.test(c.detail ?? '')) && 'Twitch: einmal neu verbinden, damit FF-Overlay den Chat lesen darf.',
    !youtube.length && 'YouTube ist nicht verbunden.',
    youtube.length > 0 && 'YouTube-Chat kommt nur während eines Livestreams und mit einigen Sekunden Verzögerung (API-Abfrage).',
  ].filter(Boolean) as string[];
  const list = [...chat].reverse().slice(0, 60);
  return (
    <div className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Live-Chat</h3>
        <div className="row">
          <button className="small" onClick={() => void run(() => api.post('/api/chat/test', { count: 4 }), 'Testnachrichten gesendet')}>Testnachrichten</button>
          {chat.length > 0 && <button className="small ghost" onClick={() => confirm('Alle Nachrichten aus den Chat-Overlays entfernen?') && hide({ all: true }, 'Chat-Overlays geleert')}>Overlays leeren</button>}
        </div>
      </div>
      {notes.length > 0 && <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {!list.length && <p className="small muted" style={{ margin: 0 }}>Noch keine Nachrichten. Sobald im Chat geschrieben wird, erscheinen sie hier und im Overlay.</p>}
      <div className="chat-feed">
        {list.map((m) => <ChatLine key={m.id} m={m} onHide={() => hide({ ids: [m.id] }, 'Nachricht ausgeblendet')} onHideUser={() => hide({ userId: m.user.id, platform: m.platform }, `${m.user.name} ausgeblendet`)} />)}
      </div>
    </div>
  );
}

function ChatLine({ m, onHide, onHideUser }: { m: ChatMessage; onHide: () => void; onHideUser: () => void }) {
  return (
    <div className="chat-line">
      <span className="chat-dot" style={{ background: PLATFORM_COLORS[m.platform] }} title={m.platform} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <b style={{ color: m.user.color ?? 'var(--accent)' }}>{m.user.name}</b>
        {m.amount && <span className="badge" style={{ marginLeft: 6 }}>{m.amount}</span>}
        {m.isTest && <span className="badge" style={{ marginLeft: 6 }}>Test</span>}
        <div className="small">{m.parts.map((p, i) => ('emote' in p ? <img key={i} src={p.url} alt={p.name} title={p.name} style={{ height: '1.4em', verticalAlign: 'middle' }} /> : <span key={i}>{p.text}</span>))}</div>
      </div>
      <div className="chat-actions">
        <button className="small ghost" onClick={onHide} title="Nur aus dem Overlay entfernen – im Plattform-Chat bleibt sie">Ausblenden</button>
        {m.user.id && <button className="small ghost" onClick={onHideUser} title="Alle Nachrichten dieser Person aus dem Overlay entfernen">Alle von {m.user.name}</button>}
      </div>
    </div>
  );
}

// ---------- Seite ----------

export function ChatPage() {
  const list = useLoad(() => api.get<W[]>('/api/widgets'));
  const run = useAction();
  const [selected, setSelected] = useState<string | null>(null);
  const chats = (list.data ?? []).filter((w) => w.type === 'chat');
  const current = selected && chats.some((c) => c.id === selected) ? selected : chats[0]?.id ?? null;

  const create = async () => {
    const w = await run(() => api.post<W>('/api/widgets', { type: 'chat', name: chats.length ? `Chat ${chats.length + 1}` : 'Chat' }), 'Chat-Overlay angelegt');
    if (w) {
      list.reload();
      setSelected(w.id);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chat</h1>
          <p className="lead" style={{ margin: 0 }}>
            Der Chat aus Twitch, YouTube oder beiden zusammen als Overlay – gestaltet wie deine Alerts.
          </p>
        </div>
        <div className="row">
          {chats.length > 1 && (
            <select value={current ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Chat-Overlay wählen">
              {chats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button className={chats.length ? '' : 'primary'} onClick={() => void create()}>+ Chat-Overlay</button>
        </div>
      </div>
      {list.data && !chats.length && (
        <div className="split">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Noch kein Chat-Overlay</h2>
            <p className="muted" style={{ margin: 0 }}>
              Ein Chat-Overlay ist eine eigene Browserquelle (600 × 900). Du wählst Twitch, YouTube oder beide, gestaltest Namen, Nachrichten,
              Hintergrund und Animationen und siehst jede Änderung sofort in der Vorschau.
            </p>
            <div><button className="primary" onClick={() => void create()}>Chat-Overlay anlegen</button></div>
          </div>
          <LiveChat />
        </div>
      )}
      {current && <WidgetEditor key={current} id={current} onDeleted={() => { setSelected(null); list.reload(); }} onRenamed={list.reload} extra={<LiveChat />} />}
    </>
  );
}
