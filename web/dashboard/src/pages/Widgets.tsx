import { Children, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { api } from '../api';
import { CopyField, Field, NumberInput, useAction, useLoad } from '../ui';
import { AnimSelect, Section } from '../components/DesignFields';
import { Color, fromLocalInput, TextFields, toLocalInput, Toggle, TypeChecks } from '../components/WidgetFields';
import { bpSections, BP_ICON } from './BpWidgetForms';
import { TestThisButton } from '../components/TestButton';
import { widgetTest } from '../../../../server/src/shared/widgetTest';
import { IN_ANIMATIONS, OUT_ANIMATIONS } from '../../../shared/animations';
import {
  isBpType, LABEL_KINDS, LIST_STYLES, WIDGET_INFO, type BossSettings, type BpData, type BossState, type CreditsSettings, type EventListSettings,
  type GoalSettings, type LabelSettings, type TickerSettings, type TimerSettings, type TimerState, type Widget,
  type WidgetData, type WidgetSettingsMap, type WidgetType,
} from '../../../../server/src/shared/widgets';

/*
 * Widgets nach dem Vorbild von Streamlabs (Ereignisliste, Ziele, Stream-Labels, Subathon-Timer,
 * End-Credits, Stream-Boss, Spenden-Ticker). Jedes Widget ist eine eigene Browserquelle.
 */

type W = Widget & { url: string };
type Detail = W & { data: WidgetData };

const TYPES = Object.keys(WIDGET_INFO) as WidgetType[];
export const ICON: Record<WidgetType, string> = { event_list: '☰', goal: '▰', label: 'Aa', timer: '⏱', credits: '🎬', boss: '⚔', ticker: '⇆', ...BP_ICON };

type SetS<T> = (patch: Partial<T>) => void;

// ---------- Einstellungen je Typ ----------

function EventListForm({ s, set }: { s: EventListSettings; set: SetS<EventListSettings> }) {
  return (
    <>
      <Section title="Allgemein">
        <div className="fields">
          <Field label="Stil">
            <select value={s.style} onChange={(e) => set({ style: e.target.value as EventListSettings['style'] })}>
              {LIST_STYLES.map((st) => <option key={st} value={st}>{st[0]!.toUpperCase() + st.slice(1)}</option>)}
            </select>
          </Field>
          <Color label="Themenfarbe" value={s.themeColor} onChange={(themeColor) => set({ themeColor })} />
          <Field label="Max. Einträge"><NumberInput value={s.maxEvents} min={1} max={25} onChange={(maxEvents) => set({ maxEvents })} /></Field>
          <Field label="Ausblenden nach (s, 0 = nie)"><NumberInput value={s.fadeTime} min={0} onChange={(fadeTime) => set({ fadeTime })} /></Field>
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <Toggle label="Verlauf beim Laden zeigen" value={s.keepHistory} onChange={(keepHistory) => set({ keepHistory })} />
          <Toggle label="Horizontal spiegeln" value={s.flipX} onChange={(flipX) => set({ flipX })} />
          <Toggle label="Vertikal spiegeln (neueste unten)" value={s.flipY} onChange={(flipY) => set({ flipY })} />
        </div>
      </Section>
      <Section title="Ereignisse">
        <TypeChecks value={s.types} onChange={(types) => set({ types })} />
        <div className="fields">
          <Field label="Mindestanzahl Bits"><NumberInput value={s.minBits} min={0} onChange={(minBits) => set({ minBits })} /></Field>
          <Field label="Mindestanzahl Raider"><NumberInput value={s.minRaiders} min={0} onChange={(minRaiders) => set({ minRaiders })} /></Field>
        </div>
      </Section>
      <Section title="Animationen" open={false}>
        <div className="fields">
          <Field label="Einblenden"><AnimSelect value={s.animIn} onChange={(animIn) => set({ animIn })} groups={IN_ANIMATIONS} /></Field>
          <Field label="Ausblenden"><AnimSelect value={s.animOut} onChange={(animOut) => set({ animOut })} groups={OUT_ANIMATIONS} /></Field>
          <Field label={`Geschwindigkeit ${s.speedMs} ms`}><input type="range" min={200} max={3000} step={100} value={s.speedMs} onChange={(e) => set({ speedMs: Number(e.target.value) })} /></Field>
        </div>
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

function GoalForm({ s, set }: { s: GoalSettings; set: SetS<GoalSettings> }) {
  return (
    <>
      <Section title="Ziel">
        <div className="fields">
          <Field label="Art">
            <select value={s.goalType} onChange={(e) => set({ goalType: e.target.value as GoalSettings['goalType'] })}>
              <option value="donation">Spenden (Betrag)</option>
              <option value="charity">Charity-Spenden (Betrag)</option>
              <option value="cheer">Bits</option>
              <option value="follow">Follower</option>
              <option value="sub">Subs</option>
            </select>
          </Field>
          <Field label="Titel"><input value={s.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Zielwert"><NumberInput value={s.target} min={0} onChange={(target) => set({ target })} /></Field>
          <Field label="Startwert" hint="z. B. Spenden vor dem Stream"><NumberInput value={s.startValue} min={0} step={0.01} onChange={(startValue) => set({ startValue })} /></Field>
          <Field label="Zählt ab"><input type="datetime-local" value={toLocalInput(s.startedAt)} onChange={(e) => set({ startedAt: fromLocalInput(e.target.value) })} /></Field>
          <Field label="Enddatum (optional)"><input type="datetime-local" value={toLocalInput(s.endsAt)} onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })} /></Field>
        </div>
        {s.goalType === 'sub' && (
          <div className="row" style={{ gap: 16 }}>
            <Toggle label="Neue Subs" value={s.includeSubs} onChange={(includeSubs) => set({ includeSubs })} />
            <Toggle label="Resubs" value={s.includeResubs} onChange={(includeResubs) => set({ includeResubs })} />
            <Toggle label="Gift-Subs" value={s.includeGifts} onChange={(includeGifts) => set({ includeGifts })} />
          </div>
        )}
      </Section>
      <Section title="Aussehen" open={false}>
        <div className="fields">
          <Field label="Layout">
            <select value={s.layout} onChange={(e) => set({ layout: e.target.value as GoalSettings['layout'] })}>
              <option value="standard">Standard</option>
              <option value="condensed">Kompakt</option>
            </select>
          </Field>
          <Field label={`Balkenhöhe ${s.barThickness}px`}><input type="range" min={8} max={160} value={s.barThickness} onChange={(e) => set({ barThickness: Number(e.target.value) })} /></Field>
          <Color label="Balkenfarbe" value={s.barColor} onChange={(barColor) => set({ barColor })} />
          <Color label="Balkenhintergrund" value={s.barBgColor} onChange={(barBgColor) => set({ barBgColor })} />
          <Color label="Text im Balken" value={s.barTextColor} onChange={(barTextColor) => set({ barTextColor })} />
        </div>
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

function LabelForm({ s, set }: { s: LabelSettings; set: SetS<LabelSettings> }) {
  return (
    <>
      <Section title="Label">
        <div className="fields">
          <Field label="Inhalt">
            <select value={s.kind} onChange={(e) => set({ kind: e.target.value as LabelSettings['kind'] })}>
              {Object.entries(LABEL_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Zeitraum">
            <select value={s.period} onChange={(e) => set({ period: e.target.value as LabelSettings['period'] })}>
              <option value="session">Aktueller Stream (Session)</option>
              <option value="today">Heute</option>
              <option value="week">Letzte 7 Tage</option>
              <option value="month">Letzte 30 Tage</option>
            </select>
          </Field>
          <Field label="Format" hint="Platzhalter: {name} {amount} {count} {months} {message} {product}"><input value={s.format} onChange={(e) => set({ format: e.target.value })} /></Field>
          <Field label="Text ohne Wert"><input value={s.empty} onChange={(e) => set({ empty: e.target.value })} /></Field>
          <Field label="Ausrichtung">
            <select value={s.align} onChange={(e) => set({ align: e.target.value as LabelSettings['align'] })}>
              <option value="left">Links</option><option value="center">Mitte</option><option value="right">Rechts</option>
            </select>
          </Field>
        </div>
        <Toggle label="Textschatten" value={s.shadow} onChange={(shadow) => set({ shadow })} />
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

function TimerForm({ s, set }: { s: TimerSettings; set: SetS<TimerSettings> }) {
  const n = (k: keyof TimerSettings, label: string) => (
    <Field label={label}><NumberInput value={s[k] as number} min={0} onChange={(v) => set({ [k]: v } as Partial<TimerSettings>)} /></Field>
  );
  return (
    <>
      <Section title="Timer">
        <div className="fields">
          {n('startMinutes', 'Startzeit (Minuten)')}
          {n('maxMinutes', 'Höchstens (Minuten, 0 = offen)')}
          <Field label="Text bei Ablauf"><input value={s.endText} onChange={(e) => set({ endText: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Toggle label="Nur verlängern, während der Timer läuft" value={s.onlyWhileRunning} onChange={(onlyWhileRunning) => set({ onlyWhileRunning })} />
          <Toggle label="Hinzugefügte Zeit einblenden" value={s.showAdded} onChange={(showAdded) => set({ showAdded })} />
          <Toggle label="Textschatten" value={s.shadow} onChange={(shadow) => set({ shadow })} />
        </div>
      </Section>
      <Section title="Zeit pro Ereignis (Sekunden)">
        <div className="fields">
          {n('secondsPerFollow', 'Follow')}
          {n('secondsPerSub', 'Neuer Sub')}
          {n('secondsPerResub', 'Resub')}
          {n('secondsPerGiftedSub', 'Je verschenktem Sub')}
          {n('secondsPer100Bits', 'Je 100 Bits')}
          {n('secondsPerDonationUnit', 'Je 1 € Spende')}
          {n('secondsPerRaid', 'Raid')}
          {n('secondsPerRedemption', 'Kanalpunkte-Einlösung')}
        </div>
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

function CreditsForm({ s, set }: { s: CreditsSettings; set: SetS<CreditsSettings> }) {
  const keys = Object.keys(s.include) as Array<keyof CreditsSettings['include']>;
  return (
    <>
      <Section title="Allgemein">
        <div className="fields">
          <Field label="Thema">
            <select value={s.theme} onChange={(e) => set({ theme: e.target.value as CreditsSettings['theme'] })}>
              <option value="default">Klassisch (Abspann)</option>
              <option value="crawl">Weltraum-Crawl (schräg)</option>
              <option value="stars">Sternenhimmel</option>
            </select>
          </Field>
          <Field label="Titel"><input value={s.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Untertitel"><input value={s.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
          <Color label="Überschriften" value={s.headingColor} onChange={(headingColor) => set({ headingColor })} />
        </div>
      </Section>
      <Section title="Abschnitte">
        <table>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td style={{ width: 40 }}><input type="checkbox" checked={s.include[k]} onChange={(e) => set({ include: { ...s.include, [k]: e.target.checked } })} aria-label={`${k} zeigen`} /></td>
                <td><input value={s.headings[k]} onChange={(e) => set({ headings: { ...s.headings, [k]: e.target.value } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Toggle label="Beträge anzeigen" value={s.showAmounts} onChange={(showAmounts) => set({ showAmounts })} />
      </Section>
      <Section title="Abspielen">
        <div className="fields">
          <Field label="Tempo">
            <select value={s.mode} onChange={(e) => set({ mode: e.target.value as CreditsSettings['mode'] })}>
              <option value="duration">Feste Dauer</option>
              <option value="speed">Feste Geschwindigkeit</option>
            </select>
          </Field>
          {s.mode === 'duration'
            ? <Field label="Dauer (s)"><NumberInput value={s.duration} min={3} onChange={(duration) => set({ duration })} /></Field>
            : <Field label="Geschwindigkeit (px/s)"><NumberInput value={s.speed} min={5} onChange={(speed) => set({ speed })} /></Field>}
          {s.loop && <Field label="Pause vor Wiederholung (s)"><NumberInput value={s.loopDelay} min={0} onChange={(loopDelay) => set({ loopDelay })} /></Field>}
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <Toggle label="Endlosschleife" value={s.loop} onChange={(loop) => set({ loop })} />
          <Toggle label="Beim Laden abspielen" value={s.playOnLoad} onChange={(playOnLoad) => set({ playOnLoad })} />
          <Toggle label="Abspielen, wenn die Quelle in OBS sichtbar wird" value={s.playOnVisible} onChange={(playOnVisible) => set({ playOnVisible })} />
        </div>
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

function BossForm({ s, set }: { s: BossSettings; set: SetS<BossSettings> }) {
  const n = (k: keyof BossSettings, label: string, step?: number) => (
    <Field label={label}><NumberInput value={s[k] as number} min={0} step={step} onChange={(v) => set({ [k]: v } as Partial<BossSettings>)} /></Field>
  );
  return (
    <>
      <Section title="Boss">
        <div className="fields">
          <Field label="Erster Boss"><input value={s.initialName} onChange={(e) => set({ initialName: e.target.value })} /></Field>
          {n('startHp', 'Start-HP')}
          <Field label="Neuer Boss bekommt">
            <select value={s.mode} onChange={(e) => set({ mode: e.target.value as BossSettings['mode'] })}>
              <option value="fixed">Feste HP (Start-HP)</option>
              <option value="incremental">Steigende HP (+ Betrag je Sieg)</option>
              <option value="overkill">Overkill (Überschaden × Faktor)</option>
            </select>
          </Field>
          {s.mode === 'incremental' && n('incrAmount', 'HP-Zuwachs je Sieg')}
          {s.mode === 'overkill' && n('overkillMultiplier', 'Overkill-Faktor', 0.1)}
          {s.mode === 'overkill' && n('overkillMin', 'Mindest-HP')}
        </div>
        <Toggle label="Eigene Unterstützung heilt den Boss" value={s.bossHeal} onChange={(bossHeal) => set({ bossHeal })} />
      </Section>
      <Section title="Schaden pro Ereignis">
        <div className="fields">
          {n('damagePerFollow', 'Follow')}
          {n('damagePerSub', 'Sub / Resub / je Gift-Sub')}
          {n('damagePerBit', 'Je Bit', 0.1)}
          {n('damagePerDonationUnit', 'Je 1 € Spende')}
          {n('damagePerRaider', 'Je Raider', 0.1)}
        </div>
      </Section>
      <Section title="Aussehen" open={false}>
        <div className="fields">
          <Color label="HP-Balken" value={s.barColor} onChange={(barColor) => set({ barColor })} />
          <Color label="Balkenhintergrund" value={s.barBgColor} onChange={(barBgColor) => set({ barBgColor })} />
          <Color label="HP-Text" value={s.barTextColor} onChange={(barTextColor) => set({ barTextColor })} />
          <Field label="Animation bei Besiegung"><AnimSelect value={s.killAnimation} onChange={(killAnimation) => set({ killAnimation })} groups={OUT_ANIMATIONS} /></Field>
        </div>
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

function TickerForm({ s, set }: { s: TickerSettings; set: SetS<TickerSettings> }) {
  return (
    <>
      <Section title="Ticker">
        <TypeChecks value={s.types} onChange={(types) => set({ types })} />
        <div className="fields">
          <Field label="Format" hint="Platzhalter: {name} {amount} {message} {type}"><input value={s.format} onChange={(e) => set({ format: e.target.value })} /></Field>
          <Field label="Anzahl Einträge"><NumberInput value={s.maxItems} min={1} max={50} onChange={(maxItems) => set({ maxItems })} /></Field>
          <Field label="Geschwindigkeit (px/s)"><NumberInput value={s.speed} min={10} onChange={(speed) => set({ speed })} /></Field>
          <Field label="Trenner"><input value={s.separator} onChange={(e) => set({ separator: e.target.value })} /></Field>
          <Color label="Betragsfarbe" value={s.amountColor} onChange={(amountColor) => set({ amountColor })} />
        </div>
      </Section>
      <TextFields t={s.text} onChange={(text) => set({ text })} />
    </>
  );
}

/** Liefert die Einstellungs-Abschnitte eines Widgets als Liste, damit sie auf zwei Spalten verteilt werden können.
 *  Die Formulare nutzen keine Hooks und dürfen deshalb direkt aufgerufen werden. */
function settingsSections(type: WidgetType, s: WidgetSettingsMap[WidgetType], set: (p: object) => void): ReactNode[] {
  const form = (): ReactElement<{ children?: ReactNode }> => {
    switch (type) {
      case 'event_list': return EventListForm({ s: s as EventListSettings, set });
      case 'goal': return GoalForm({ s: s as GoalSettings, set });
      case 'label': return LabelForm({ s: s as LabelSettings, set });
      case 'timer': return TimerForm({ s: s as TimerSettings, set });
      case 'credits': return CreditsForm({ s: s as CreditsSettings, set });
      case 'boss': return BossForm({ s: s as BossSettings, set });
      case 'ticker': return TickerForm({ s: s as TickerSettings, set });
      default: return bpSections(type, s, set);
    }
  };
  return Children.toArray(form().props.children);
}

// ---------- Vorschau & Steuerung ----------

function WidgetPreview({ w, background, sample }: { w: W; background: string; sample?: boolean }) {
  const info = WIDGET_INFO[w.type];
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / info.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [info.width]);
  return (
    <div ref={wrap} className="widget-preview" style={{ height: info.height * scale, background }}>
      <iframe
        title="Widget-Vorschau"
        src={`${w.url.replace(/^https?:\/\/[^/]+/, '')}${w.type === 'credits' ? '&play=1' : ''}${sample ? '&preview=1' : ''}`}
        style={{ width: info.width, height: info.height, transform: `scale(${scale})`, colorScheme: 'light' }}
      />
    </div>
  );
}

function Controls({ w, data, onChange }: { w: W; data: WidgetData; onChange: () => void }) {
  const run = useAction();
  const [add, setAdd] = useState(5);
  const post = (path: string, body?: unknown, msg?: string) => run(() => api.post(`/api/widgets/${w.id}/${path}`, body), msg).then(onChange);
  if (w.type === 'timer') {
    const st = (data as { state: TimerState }).state;
    return (
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {st.running
          ? <button onClick={() => post('timer', { action: 'pause' })}>⏸ Pause</button>
          : <button className="primary" onClick={() => post('timer', { action: 'start' })}>▶ Start</button>}
        <button onClick={() => confirm('Timer auf die Startzeit zurücksetzen?') && post('timer', { action: 'reset' }, 'Zurückgesetzt')}>↺ Zurücksetzen</button>
        <span className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <span style={{ width: 80 }}><NumberInput value={add} onChange={setAdd} /></span> Min
          <button onClick={() => post('timer', { action: 'add', seconds: add * 60 })}>+ hinzufügen</button>
          <button onClick={() => post('timer', { action: 'add', seconds: -add * 60 })}>− abziehen</button>
        </span>
      </div>
    );
  }
  if (w.type === 'boss') {
    const st = (data as { state: BossState }).state;
    return (
      <div className="row">
        <span className="muted">Aktueller Boss: <b>{st.name}</b> · {st.hp}/{st.maxHp} HP</span>
        <button onClick={() => confirm('Boss zurücksetzen?') && post('boss/reset', undefined, 'Boss zurückgesetzt')}>↺ Boss zurücksetzen</button>
      </div>
    );
  }
  if (w.type === 'goal') {
    const g = data as Extract<WidgetData, { type: 'goal' }>;
    return (
      <div className="row">
        <span className="muted">Stand: <b>{g.current.toLocaleString('de-DE')}</b> / {g.target.toLocaleString('de-DE')} ({g.percent.toLocaleString('de-DE')} %)</span>
        <button onClick={() => confirm('Ziel neu starten? Es zählt dann ab jetzt.') && post('goal/reset', undefined, 'Ziel neu gestartet')}>↺ Neu starten</button>
      </div>
    );
  }
  if (w.type === 'credits') {
    return (
      <div className="row">
        <button className="primary" onClick={() => run(() => api.post<{ sources: number }>(`/api/widgets/${w.id}/credits/roll`)).then((r) => r && onChange())}>▶ Credits abspielen</button>
        <span className="small muted">Spielt in allen verbundenen Quellen ab. Inhalt: Ereignisse der aktuellen Session.</span>
      </div>
    );
  }
  if (w.type === 'label') return <div className="muted">Aktuell: <b>{(data as { text: string }).text}</b></div>;
  if (isBpType(w.type)) {
    const bp = (data as { bp: BpData }).bp;
    const money = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    return (
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="muted">
          {bp.preview ? 'Test-Modus aktiv (Beispieldaten) · ' : ''}Spendenstand <b>{money(bp.total)}</b> · {bp.count} Spenden{bp.target ? ` · Ziel ${money(bp.target)}` : ''}
        </span>
        {w.type === 'bp_poll' && <button className="primary" onClick={() => post('poll/winner', undefined, 'Gewinnanimation ausgelöst')}>🎉 Gewinnanimation auslösen</button>}
        {w.type === 'bp_milestones' && (
          <button onClick={() => confirm('Alle Milestones wieder scharf schalten? Bereits erreichte lösen dann bei der nächsten Spende erneut einen Alert aus.') && post('milestones/reset', undefined, 'Milestones zurückgesetzt')}>↺ Milestones zurücksetzen</button>
        )}
      </div>
    );
  }
  return null;
}

function TestButtons({ betterplace }: { betterplace?: boolean }) {
  const run = useAction();
  const fire = (body: object, label: string) => void run(() => api.post('/api/events/test', body), `Test: ${label}`);
  if (betterplace) {
    return (
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="small muted">Testspende:</span>
        <button className="small" onClick={() => fire({ type: 'donation', amount: 5, user: 'Maxi H.', message: 'Weiter so!' }, '5 €')}>5 €</button>
        <button className="small" onClick={() => fire({ type: 'donation', amount: 25, user: 'rubber duck', message: '#1 für die erste Option' }, '25 € für #1')}>25 € für #1</button>
        <button className="small" onClick={() => fire({ type: 'donation', amount: 50, user: 'Unicorn<3', message: '#2' }, '50 € für #2')}>50 € für #2</button>
        <button className="small" onClick={() => fire({ type: 'donation', amount: 250, user: 'Maxi M.' }, '250 €')}>250 € ohne Kommentar</button>
        <button className="small ghost" onClick={() => confirm('Alle Test-Events aus Log und Widgets entfernen?') && void run(() => api.del('/api/events/test'), 'Testdaten entfernt')}>Testdaten entfernen</button>
      </div>
    );
  }
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      <span className="small muted">Test:</span>
      <button className="small" onClick={() => fire({ type: 'follow' }, 'Follow')}>Follow</button>
      <button className="small" onClick={() => fire({ type: 'subscription', subtype: 'sub' }, 'Sub')}>Sub</button>
      <button className="small" onClick={() => fire({ type: 'subscription', subtype: 'gift', count: 5 }, 'Gift-Subs')}>5 Gift-Subs</button>
      <button className="small" onClick={() => fire({ type: 'cheer', count: 500 }, 'Bits')}>500 Bits</button>
      <button className="small" onClick={() => fire({ type: 'donation', amount: 10 }, 'Spende')}>10 € Spende</button>
      <button className="small" onClick={() => fire({ type: 'raid', count: 42 }, 'Raid')}>Raid</button>
      <button className="small ghost" onClick={() => confirm('Alle Test-Events aus Log und Widgets entfernen?') && void run(() => api.del('/api/events/test'), 'Testdaten entfernt')}>Testdaten entfernen</button>
    </div>
  );
}

export function WidgetEditor({ id, onDeleted, onRenamed }: { id: string; onDeleted: () => void; onRenamed: () => void }) {
  const detail = useLoad(() => api.get<Detail>(`/api/widgets/${id}`), [id]);
  const run = useAction();
  const [draft, setDraft] = useState<object | null>(null);
  const [name, setName] = useState('');
  const [bg, setBg] = useState('');
  const [live, setLive] = useState<WidgetData | null>(null);
  const [sample, setSample] = useState(false);
  const [frameRun, setFrameRun] = useState(0);
  const w = detail.data;

  // Entwurf nur nach (Neu-)Laden übernehmen, nicht bei jeder Live-Aktualisierung
  useEffect(() => {
    if (w) {
      setDraft(w.settings);
      setName(w.name);
      setBg(w.previewBackground);
      setLive(w.data);
    }
  }, [w]);

  // Steuerdaten (Timer, Boss, Ziel) regelmäßig auffrischen
  const refresh = () => api.get<Detail>(`/api/widgets/${id}`).then((d) => setLive(d.data), () => undefined);
  useEffect(() => {
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!w || !draft) return <div className="card muted">Lade …</div>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(w.settings) || name !== w.name || bg !== w.previewBackground;
  const set = (p: object) => setDraft((d) => ({ ...d, ...p }));
  const save = () =>
    run(() => api.patch<W>(`/api/widgets/${id}`, { name, previewBackground: bg, settings: draft }), 'Gespeichert').then((r) => {
      if (r) {
        detail.reload();
        onRenamed();
      }
    });
  const info = WIDGET_INFO[w.type];

  // „Dieses Widget testen“: ungespeicherte Änderungen zuerst speichern (die Browserquelle zeigt den gespeicherten Stand),
  // dann ein passendes Test-Event schicken
  const test = async () => {
    if (dirty) {
      const r = await run(() => api.patch<W>(`/api/widgets/${id}`, { name, previewBackground: bg, settings: draft }));
      if (!r) return;
      detail.reload();
      onRenamed();
    }
    const plan = widgetTest(w.type, draft);
    if (plan.kind === 'credits') await run(() => api.post(`/api/widgets/${w.id}/credits/roll`), 'Credits laufen');
    else if (plan.kind === 'reload') {
      setFrameRun((n) => n + 1);
      await run(() => api.post(`/api/widgets/${w.id}/refresh`), 'Widget neu geladen');
    } else await run(() => api.post('/api/events/test', plan.event), `Test: ${plan.label}`);
    setTimeout(refresh, 400);
  };

  const sections = settingsSections(w.type, draft as WidgetSettingsMap[WidgetType], set);
  const half = Math.ceil(sections.length / 2);

  return (
    <div className="stack">
      <div className="split-head">
        <h2 style={{ margin: 0 }}>{ICON[w.type]} {w.name} <span className="badge">{info.label}</span></h2>
        <div className="row">
          <button className="primary" disabled={!dirty} onClick={save}>Speichern</button>
          <button disabled={!dirty} onClick={() => { setDraft(w.settings); setName(w.name); setBg(w.previewBackground); }}>Verwerfen</button>
        </div>
      </div>
      <div className="split">
        <div className="col">
          <div className="card stack">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Widget-URL (wie ein Passwort behandeln – nicht im Stream zeigen)"><CopyField value={w.url} secret /></Field>
            <p className="small muted" style={{ margin: 0 }}>In OBS: Quelle → Browser → URL einfügen, Breite {info.width}, Höhe {info.height}. Mit <code>&amp;debug=1</code> zeigt die Quelle ihren Verbindungsstatus.</p>
          </div>
          {sections.slice(0, half)}
          <div className="row">
            <button className="primary" disabled={!dirty} onClick={save}>Speichern</button>
            <button onClick={() => confirm('Neuen Key erzeugen? Die alte URL funktioniert danach nicht mehr.') && run(() => api.post(`/api/widgets/${id}/rotate-key`), 'Neuer Key erzeugt').then(detail.reload)}>Key erneuern</button>
            <button className="danger" onClick={() => confirm(`Widget „${w.name}“ löschen?`) && run(() => api.del(`/api/widgets/${id}`), 'Gelöscht').then(onDeleted)}>Löschen</button>
          </div>
        </div>
        <div className="col aside">
          <div className="card stack preview-card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Vorschau</h3>
              <label className="row small" style={{ gap: 6 }}>Hintergrund <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ width: 40, padding: 2 }} /></label>
            </div>
            <WidgetPreview key={`${w.url}:${sample}:${frameRun}`} w={w} background={bg} sample={sample} />
            <TestThisButton block onTest={test} label={dirty ? 'Speichern & dieses Widget testen' : 'Dieses Widget testen'}
              title="Schickt ein passendes Test-Event – das Widget reagiert in der Vorschau und in OBS" />
            <Controls w={w} data={live ?? w.data} onChange={refresh} />
            {isBpType(w.type) && <Toggle label="Beispieldaten in der Vorschau (wie &preview=true bei betterplace)" value={sample} onChange={setSample} />}
            <TestButtons betterplace={isBpType(w.type)} />
          </div>
          {sections.slice(half)}
        </div>
      </div>
    </div>
  );
}

export function WidgetsPage() {
  const list = useLoad(() => api.get<W[]>('/api/widgets'));
  const run = useAction();
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? list.data?.[0]?.id ?? null;

  const create = async (type: WidgetType) => {
    const w = await run(() => api.post<W>('/api/widgets', { type }), `${WIDGET_INFO[type].label} angelegt`);
    if (w) {
      list.reload();
      setSelected(w.id);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Widgets</h1>
          <p className="lead" style={{ margin: 0 }}>
            Weitere Browserquellen, die auf dieselben Events reagieren wie die Alert-Box – wie die Widgets bei Streamlabs.
          </p>
        </div>
      </div>
      <div className="widgets-layout">
        <div className="stack">
          <div className="card stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0 }}>Deine Widgets</h3>
            {list.data?.length === 0 && <p className="small muted" style={{ margin: 0 }}>Noch keine – lege unten eins an.</p>}
            <div className="ab-nav" style={{ position: 'static' }}>
              {list.data?.map((w) => (
                <button key={w.id} className={`item ${current === w.id ? 'active' : ''}`} onClick={() => setSelected(w.id)}>
                  {ICON[w.type]} {w.name}
                </button>
              ))}
            </div>
          </div>
          <div className="card stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0 }}>Neues Widget</h3>
            {TYPES.filter((t) => !isBpType(t)).map((t) => (
              <button key={t} className="widget-type" onClick={() => void create(t)}>
                <b>{ICON[t]} {WIDGET_INFO[t].label}</b>
                <span className="small muted">{WIDGET_INFO[t].description}</span>
              </button>
            ))}
          </div>
          <div className="card stack" style={{ gap: 6 }}>
            <h3 style={{ margin: 0 }}>betterplace</h3>
            <p className="small muted" style={{ margin: 0 }}>Wie die Livestream-Alerts von betterplace – auch unter Alert-Box → Spenden (betterplace).</p>
            {TYPES.filter(isBpType).map((t) => (
              <button key={t} className="widget-type" onClick={() => void create(t)}>
                <b>{ICON[t]} {WIDGET_INFO[t].label}</b>
                <span className="small muted">{WIDGET_INFO[t].description}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          {current
            ? <WidgetEditor key={current} id={current} onDeleted={() => { setSelected(null); list.reload(); }} onRenamed={list.reload} />
            : <Hint>Lege links ein Widget an, z. B. ein Spendenziel oder einen Subathon-Timer.</Hint>}
        </div>
      </div>
    </>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="card muted">{children}</div>;
}
