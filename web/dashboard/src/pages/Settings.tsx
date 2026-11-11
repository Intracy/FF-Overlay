import { useEffect, useState } from 'react';
import { api, type GlobalSettings } from '../api';
import { Field, NumberInput, useAction, useLoad } from '../ui';

interface Session { live: boolean; startedAt: string | null; largestAmount: number }

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function SettingsPage() {
  const settings = useLoad(() => api.get<GlobalSettings>('/api/settings'));
  const session = useLoad(() => api.get<Session>('/api/session'));
  const [s, setS] = useState<GlobalSettings | null>(null);
  const [blocked, setBlocked] = useState('');
  const [words, setWords] = useState('');
  const run = useAction();

  useEffect(() => {
    if (!settings.data) return;
    setS(settings.data);
    setBlocked(settings.data.blockedUsers.join('\n'));
    setWords(settings.data.badWords.join('\n'));
  }, [settings.data]);

  if (!s) return null;
  const save = () => run(() => api.put('/api/settings', { ...s, blockedUsers: lines(blocked), badWords: lines(words) }), 'Einstellungen gespeichert');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p className="lead" style={{ margin: 0 }}>Filter greifen vor den Regeln für alle Overlays.</p>
        </div>
        <button className="primary" onClick={save}>Speichern</button>
      </div>
      <div className="grid cols-2">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Filter</h2>
          <Field label="Mindestbetrag für Spenden-Alerts (€)"><NumberInput value={s.minDonationAmount} min={0} step={0.5} onChange={(minDonationAmount) => setS({ ...s, minDonationAmount })} /></Field>
          <Field label="Gesperrte Nutzer (einer pro Zeile)" hint="Events dieser Namen erscheinen nur im Log.">
            <textarea rows={5} value={blocked} onChange={(e) => setBlocked(e.target.value)} />
          </Field>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Schimpfwort-Filter</h2>
          <Field label="Wörter (eines pro Zeile)" hint="Namen mit diesen Wörtern werden zu „Anonym“.">
            <textarea rows={5} value={words} onChange={(e) => setWords(e.target.value)} />
          </Field>
          <Field label="In Nachrichten">
            <select value={s.badWordMode} onChange={(e) => setS({ ...s, badWordMode: e.target.value as GlobalSettings['badWordMode'] })}>
              <option value="censor">durch Sternchen ersetzen</option>
              <option value="hide">ganze Nachricht ausblenden</option>
            </select>
          </Field>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Stream-Session</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Für „größter Betrag dieses Streams“ und „nur wenn live“. Twitch setzt die Session beim Stream-Start automatisch zurück.
          </p>
          <div className="small">
            Status: <b>{session.data?.live ? 'live' : 'offline'}</b> · größter Betrag bisher: <b>{session.data?.largestAmount ?? 0}</b>
            {session.data?.startedAt && <> · seit {new Date(session.data.startedAt).toLocaleString('de-DE')}</>}
          </div>
          <div><button onClick={() => run(() => api.post('/api/session/reset'), 'Session zurückgesetzt').then(session.reload)}>Session zurücksetzen</button></div>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Konto</h2>
          <div><button onClick={() => api.post('/api/auth/logout').then(() => location.reload())}>Abmelden</button></div>
        </div>
      </div>
    </>
  );
}
