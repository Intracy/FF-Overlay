import type { ReactElement, ReactNode } from 'react';
import { Field, NumberInput } from '../ui';
import { Section } from '../components/DesignFields';
import { Color, TextFields, Toggle } from '../components/WidgetFields';
import type {
  Align, BpAllSettings, BpCommentSettings, BpFeedSettings, BpLastSettings, BpLeaderboardSettings, BpLogosSettings, BpMilestonesSettings,
  BpPollSettings, BpProgressSettings, BpTopSettings, BpTotalSettings, BpWidgetType, TextStyle, WidgetSettingsMap, WidgetType,
} from '../../../../server/src/shared/widgets';

/*
 * Einstellungen der betterplace-Widgets – Optionen wie in den betterplace-Livestream-Alerts.
 * Die Formulare benutzen keine Hooks und werden direkt aufgerufen (Abschnitte werden auf zwei Spalten verteilt).
 */

export const BP_ICON: Record<BpWidgetType, string> = {
  bp_all: '▤', bp_poll: '☑', bp_total: '€', bp_last: '♥', bp_top: '🏆', bp_leaderboard: '🥇', bp_progress: '▰',
  bp_comment: '💬', bp_logos: '◎', bp_milestones: '⚑', bp_feed: '☰',
};

type Set<T> = (patch: Partial<T>) => void;

function AlignSelect({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  return (
    <Field label="Textausrichtung">
      <select value={value} onChange={(e) => onChange(e.target.value as Align)}>
        <option value="left">Links</option>
        <option value="center">Mitte</option>
        <option value="right">Rechts</option>
      </select>
    </Field>
  );
}

function LinesSelect({ value, onChange }: { value: 'single' | 'multi'; onChange: (v: 'single' | 'multi') => void }) {
  return (
    <Field label="Zeilen">
      <select value={value} onChange={(e) => onChange(e.target.value as 'single' | 'multi')}>
        <option value="multi">Mehrzeilig</option>
        <option value="single">Einzeilig</option>
      </select>
    </Field>
  );
}

function Headline<T extends { headlineText: string; headline: TextStyle }>({ s, set, children }: { s: T; set: Set<T>; children?: ReactNode }) {
  return (
    <Section title="Layout">
      <div className="fields">
        <Field label="Überschrift"><input value={s.headlineText} onChange={(e) => set({ headlineText: e.target.value } as Partial<T>)} placeholder="leer = keine Überschrift" /></Field>
        {children}
      </div>
    </Section>
  );
}

const fonts = (entries: Array<[string, TextStyle, (t: TextStyle) => void]>) =>
  entries.map(([title, t, on]) => <TextFields key={title} title={`Schrift: ${title}`} t={t} onChange={on} />);

function All({ s, set }: { s: BpAllSettings; set: Set<BpAllSettings> }) {
  return (
    <>
      <Section title="Gestaltung">
        <div className="fields">
          <Field label="Gestaltungsmodus">
            <select value={s.designMode} onChange={(e) => set({ designMode: e.target.value as BpAllSettings['designMode'] })}>
              <option value="default">Default-Design (Theme)</option>
              <option value="custom">Selbst gestalten</option>
            </select>
          </Field>
          <Field label="Theme">
            <select value={s.theme} onChange={(e) => set({ theme: e.target.value as BpAllSettings['theme'] })}>
              <option value="standard">Standard</option>
              <option value="pixel">Pixel</option>
              <option value="sakura">Sakura</option>
              <option value="pride">Pride</option>
            </select>
          </Field>
        </div>
      </Section>
      <Section title="Beschriftungen">
        <div className="fields">
          <Field label="Spendenstand"><input value={s.labels.total} onChange={(e) => set({ labels: { ...s.labels, total: e.target.value } })} /></Field>
          <Field label="Letzte Spende"><input value={s.labels.last} onChange={(e) => set({ labels: { ...s.labels, last: e.target.value } })} /></Field>
          <Field label="Top-Spende"><input value={s.labels.top} onChange={(e) => set({ labels: { ...s.labels, top: e.target.value } })} /></Field>
        </div>
      </Section>
      {s.designMode === 'custom' && fonts([['Überschrift', s.headline, (headline) => set({ headline })], ['Daten', s.data, (data) => set({ data })]])}
    </>
  );
}

function Poll({ s, set }: { s: BpPollSettings; set: Set<BpPollSettings> }) {
  const opt = (i: number, patch: Partial<BpPollSettings['options'][number]>) => set({ options: s.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <>
      <Section title="Abstimmung">
        <Field label="Titel oder Frage"><input value={s.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <table>
          <thead><tr><th>#</th><th>Antwort</th><th>Weitere Stichwörter (Komma)</th><th /></tr></thead>
          <tbody>
            {s.options.map((o, i) => (
              <tr key={i}>
                <td>#{i + 1}</td>
                <td><input value={o.text} onChange={(e) => opt(i, { text: e.target.value })} aria-label={`Antwort ${i + 1}`} /></td>
                <td><input value={o.keywords} onChange={(e) => opt(i, { keywords: e.target.value })} aria-label={`Stichwörter ${i + 1}`} placeholder="optional" /></td>
                <td><button className="small ghost" disabled={s.options.length <= 2} onClick={() => set({ options: s.options.filter((_, j) => j !== i) })}>Löschen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><button className="small" disabled={s.options.length >= 10} onClick={() => set({ options: [...s.options, { text: `Option ${String.fromCharCode(65 + s.options.length)}`, keywords: '' }] })}>+ Antwort hinzufügen</button></div>
        <div className="fields">
          <Field label="Zählen nach">
            <select value={s.countBy} onChange={(e) => set({ countBy: e.target.value as BpPollSettings['countBy'] })}>
              <option value="amount">Spendenbetrag (1 € = 1 Stimme)</option>
              <option value="count">Anzahl der Spenden</option>
            </select>
          </Field>
        </div>
        <Toggle label="Abstimmung aktiv (zählt Spenden ab dem Speichern)" value={s.active} onChange={(active) => set({ active })} />
        <p className="small muted" style={{ margin: 0 }}>
          Zuschauer*innen stimmen ab, indem sie <b>#1</b>, <b>#2</b> … oder den Antworttext in ihren Spendenkommentar schreiben.
          Die Auswahl im betterplace-Spendenformular selbst wird über den Webhook nicht übertragen.
        </p>
      </Section>
      <Section title="Fortschrittsbalken" open={false}>
        <div className="fields">
          <Color label="Fortschrittsfarbe" value={s.progressColor} onChange={(progressColor) => set({ progressColor })} />
          <Color label="Basisfarbe" value={s.baseColor} onChange={(baseColor) => set({ baseColor })} />
          <Field label={`Transparenz (Basisfarbe) ${s.baseOpacity} %`}><input type="range" min={0} max={100} value={s.baseOpacity} onChange={(e) => set({ baseOpacity: Number(e.target.value) })} /></Field>
        </div>
      </Section>
      {fonts([['Titel', s.headline, (headline) => set({ headline })], ['Antworten', s.option, (option) => set({ option })], ['Werte', s.data, (data) => set({ data })]])}
    </>
  );
}

function Total({ s, set }: { s: BpTotalSettings; set: Set<BpTotalSettings> }) {
  return (
    <>
      <Headline s={s} set={set}>
        <AlignSelect value={s.align} onChange={(align) => set({ align })} />
        <LinesSelect value={s.lines} onChange={(lines) => set({ lines })} />
      </Headline>
      {fonts([['Überschrift', s.headline, (headline) => set({ headline })], ['Spendenstand', s.data, (data) => set({ data })]])}
    </>
  );
}

function Last({ s, set }: { s: BpLastSettings; set: Set<BpLastSettings> }) {
  return (
    <>
      <Headline s={s} set={set}>
        <AlignSelect value={s.align} onChange={(align) => set({ align })} />
        <LinesSelect value={s.lines} onChange={(lines) => set({ lines })} />
      </Headline>
      <Section title="Kommentare"><Toggle label="Kommentar anzeigen" value={s.showComment} onChange={(showComment) => set({ showComment })} /></Section>
      {fonts([
        ['Überschrift', s.headline, (headline) => set({ headline })], ['Name der Spender*in', s.name, (name) => set({ name })],
        ['Betrag', s.amount, (amount) => set({ amount })], ['Kommentar', s.comment, (comment) => set({ comment })],
      ])}
    </>
  );
}

function DisplayFields<T extends { count: number; display: 'list' | 'loop'; rotateSeconds: number }>({ s, set, countLabel }: { s: T; set: Set<T>; countLabel: string }) {
  return (
    <>
      <Field label={countLabel}><NumberInput value={s.count} min={1} max={25} onChange={(count) => set({ count } as Partial<T>)} /></Field>
      <Field label="Darstellung">
        <select value={s.display} onChange={(e) => set({ display: e.target.value } as Partial<T>)}>
          <option value="list">Als Liste anzeigen</option>
          <option value="loop">Nacheinander rotieren</option>
        </select>
      </Field>
      {s.display === 'loop' && <Field label="Sekunden pro Eintrag"><NumberInput value={s.rotateSeconds} min={1} max={120} onChange={(rotateSeconds) => set({ rotateSeconds } as Partial<T>)} /></Field>}
    </>
  );
}

function Top({ s, set }: { s: BpTopSettings; set: Set<BpTopSettings> }) {
  return (
    <>
      <Headline s={s} set={set}>
        <AlignSelect value={s.align} onChange={(align) => set({ align })} />
        <DisplayFields s={s} set={set} countLabel="Anzahl der Spenden" />
      </Headline>
      <Section title="Kommentare"><Toggle label="Kommentar anzeigen" value={s.showComment} onChange={(showComment) => set({ showComment })} /></Section>
      {fonts([
        ['Überschrift', s.headline, (headline) => set({ headline })], ['Betrag', s.amount, (amount) => set({ amount })],
        ['Name der Spender*in', s.name, (name) => set({ name })], ['Kommentar', s.comment, (comment) => set({ comment })],
      ])}
    </>
  );
}

function Leaderboard({ s, set }: { s: BpLeaderboardSettings; set: Set<BpLeaderboardSettings> }) {
  return (
    <>
      <Headline s={s} set={set}>
        <AlignSelect value={s.align} onChange={(align) => set({ align })} />
        <DisplayFields s={s} set={set} countLabel="Wie viele Spender*innen?" />
      </Headline>
      {fonts([['Überschrift', s.headline, (headline) => set({ headline })], ['Name der Spender*in', s.name, (name) => set({ name })], ['Betrag', s.amount, (amount) => set({ amount })]])}
    </>
  );
}

function Progress({ s, set }: { s: BpProgressSettings; set: Set<BpProgressSettings> }) {
  return (
    <>
      <Headline s={s} set={set}>
        <AlignSelect value={s.align} onChange={(align) => set({ align })} />
        <Field label="Darstellung">
          <select value={s.display} onChange={(e) => set({ display: e.target.value as BpProgressSettings['display'] })}>
            <option value="both">Balken und Anzeige</option>
            <option value="bar">Nur Balken</option>
            <option value="text">Nur Anzeige</option>
          </select>
        </Field>
        <Field label="Zielbetrag (€)" hint="0 = Zielbetrag der Spendenaktion (betterplace → Allgemeine Einstellungen → Beschreibung)">
          <NumberInput value={s.target} min={0} onChange={(target) => set({ target })} />
        </Field>
      </Headline>
      <Section title="Fortschrittsbalken">
        <div className="fields">
          <Color label="Fortschrittsfarbe" value={s.progressColor} onChange={(progressColor) => set({ progressColor })} />
          <Color label="Basisfarbe" value={s.baseColor} onChange={(baseColor) => set({ baseColor })} />
          <Field label={`Transparenz (Basisfarbe) ${s.baseOpacity} %`}><input type="range" min={0} max={100} value={s.baseOpacity} onChange={(e) => set({ baseOpacity: Number(e.target.value) })} /></Field>
          <Field label={`Balkenhöhe ${s.barHeight}px`}><input type="range" min={6} max={120} value={s.barHeight} onChange={(e) => set({ barHeight: Number(e.target.value) })} /></Field>
        </div>
      </Section>
      {fonts([['Überschrift', s.headline, (headline) => set({ headline })], ['Anzeige', s.data, (data) => set({ data })]])}
    </>
  );
}

function Comment({ s, set }: { s: BpCommentSettings; set: Set<BpCommentSettings> }) {
  return (
    <>
      <Headline s={s} set={set}>
        <AlignSelect value={s.align} onChange={(align) => set({ align })} />
        <Field label="Letzte Kommentare im Wechsel"><NumberInput value={s.count} min={1} max={25} onChange={(count) => set({ count })} /></Field>
        <Field label="Sekunden pro Kommentar"><NumberInput value={s.rotateSeconds} min={1} max={120} onChange={(rotateSeconds) => set({ rotateSeconds })} /></Field>
      </Headline>
      {fonts([
        ['Überschrift', s.headline, (headline) => set({ headline })], ['Name der Spender*in', s.name, (name) => set({ name })],
        ['Betrag', s.amount, (amount) => set({ amount })], ['Kommentar', s.comment, (comment) => set({ comment })],
      ])}
    </>
  );
}

function Logos({ s, set }: { s: BpLogosSettings; set: Set<BpLogosSettings> }) {
  return (
    <>
      <Section title="Logos">
        <div className="fields">
          <Field label="Dauer pro Logo (s)"><NumberInput value={s.duration} min={1} max={120} onChange={(duration) => set({ duration })} /></Field>
          <AlignSelect value={s.align} onChange={(align) => set({ align })} />
          <Field label={`Logohöhe ${s.logoHeight}px`}><input type="range" min={30} max={600} value={s.logoHeight} onChange={(e) => set({ logoHeight: Number(e.target.value) })} /></Field>
        </div>
        <Toggle label="Namen der Organisationen anzeigen" value={s.showNames} onChange={(showNames) => set({ showNames })} />
        <Field label="Weitere Logos (eine Bild-URL pro Zeile)" hint="Die Logos der Organisationen kommen automatisch von betterplace.">
          <textarea rows={3} value={s.extraLogos} onChange={(e) => set({ extraLogos: e.target.value })} placeholder="https://…/logo.png" />
        </Field>
      </Section>
      {fonts([['Name', s.name, (name) => set({ name })]])}
    </>
  );
}

function Milestones({ s, set }: { s: BpMilestonesSettings; set: Set<BpMilestonesSettings> }) {
  const sorted = s.milestones;
  const edit = (i: number, patch: Partial<BpMilestonesSettings['milestones'][number]>) => set({ milestones: sorted.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  return (
    <>
      <Section title="Milestones">
        <table>
          <thead><tr><th>Betrag (€)</th><th>Text</th><th /></tr></thead>
          <tbody>
            {sorted.map((m, i) => (
              <tr key={i}>
                <td style={{ width: 120 }}><NumberInput value={m.amount} min={0} onChange={(amount) => edit(i, { amount })} /></td>
                <td><input value={m.text} onChange={(e) => edit(i, { text: e.target.value })} aria-label={`Text Milestone ${i + 1}`} /></td>
                <td><button className="small ghost" onClick={() => set({ milestones: sorted.filter((_, j) => j !== i) })}>Löschen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div><button className="small" onClick={() => set({ milestones: [...sorted, { amount: (sorted.at(-1)?.amount ?? 0) + 100, text: 'Neuer Milestone' }] })}>+ Neuer Milestone</button></div>
        <Field label="Was ist im Stream zu sehen?">
          <select value={s.mode} onChange={(e) => set({ mode: e.target.value as BpMilestonesSettings['mode'] })}>
            <option value="display_and_alert">„Nächster Milestone“-Anzeige + Alert</option>
            <option value="alert_only">Nur Alert wird abgespielt</option>
          </select>
        </Field>
        <p className="small muted" style={{ margin: 0 }}>Der Alert läuft über die Alert-Box („Milestone erreicht“) – mit GIF, Sound und Text wie jeder andere Alert. Bereits erreichte Beträge lösen beim Speichern keinen Alert aus.</p>
      </Section>
      <Section title="Anzeige" open={false}>
        <div className="fields">
          <Field label="Überschrift"><input value={s.headlineText} onChange={(e) => set({ headlineText: e.target.value })} /></Field>
          <Color label="Fortschrittsfarbe" value={s.progressColor} onChange={(progressColor) => set({ progressColor })} />
          <Color label="Basisfarbe" value={s.baseColor} onChange={(baseColor) => set({ baseColor })} />
        </div>
      </Section>
      {fonts([['Text', s.text, (text) => set({ text })], ['Milestone-Betrag', s.amount, (amount) => set({ amount })]])}
    </>
  );
}

function Feed({ s, set }: { s: BpFeedSettings; set: Set<BpFeedSettings> }) {
  return (
    <>
      <Section title="Spenden-Feed">
        <div className="fields">
          <Field label="Sortiere nach">
            <select value={s.sort} onChange={(e) => set({ sort: e.target.value as BpFeedSettings['sort'] })}>
              <option value="newest">Neuste zuerst</option>
              <option value="highest">Höchste zuerst</option>
            </select>
          </Field>
          <Field label="Max. Einträge"><NumberInput value={s.max} min={5} max={200} onChange={(max) => set({ max })} /></Field>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <Toggle label="Kommentare anzeigen" value={s.showComments} onChange={(showComments) => set({ showComments })} />
          <Toggle label="Nur Spenden mit Betrag anzeigen" value={s.onlyWithAmount} onChange={(onlyWithAmount) => set({ onlyWithAmount })} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>Tipp: In OBS unter Docks → Benutzerdefinierte Browser-Docks als eigenes Fenster einbinden.</p>
      </Section>
      {fonts([['Name', s.name, (name) => set({ name })], ['Betrag', s.amount, (amount) => set({ amount })], ['Kommentar', s.comment, (comment) => set({ comment })]])}
    </>
  );
}

/** Formular-Abschnitte für ein betterplace-Widget */
export function bpSections(type: WidgetType, s: WidgetSettingsMap[WidgetType], set: (p: object) => void): ReactElement<{ children?: ReactNode }> {
  switch (type) {
    case 'bp_all': return All({ s: s as BpAllSettings, set });
    case 'bp_poll': return Poll({ s: s as BpPollSettings, set });
    case 'bp_total': return Total({ s: s as BpTotalSettings, set });
    case 'bp_last': return Last({ s: s as BpLastSettings, set });
    case 'bp_top': return Top({ s: s as BpTopSettings, set });
    case 'bp_leaderboard': return Leaderboard({ s: s as BpLeaderboardSettings, set });
    case 'bp_progress': return Progress({ s: s as BpProgressSettings, set });
    case 'bp_comment': return Comment({ s: s as BpCommentSettings, set });
    case 'bp_logos': return Logos({ s: s as BpLogosSettings, set });
    case 'bp_milestones': return Milestones({ s: s as BpMilestonesSettings, set });
    case 'bp_feed': return Feed({ s: s as BpFeedSettings, set });
    default: return <></>;
  }
}
