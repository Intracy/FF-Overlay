import { useEffect, useState } from 'react';
import { api, type Connection, type ConnectorStatus } from '../api';
import { useLive } from '../live';
import { CopyField, Field, Modal, StatusBadge, useAction, useLoad, useRouter, useToast } from '../ui';
import { Section } from '../components/DesignFields';

interface AppsView { twitch: { clientId: string; hasSecret: boolean; fromEnv: boolean }; google: { clientId: string; hasSecret: boolean; fromEnv: boolean } }
interface ConnectionsResponse { connections: Connection[]; status: ConnectorStatus[]; apps: AppsView; twitchRedirectUri: string }
interface Flow { id: string; provider: 'twitch' | 'youtube'; userCode: string; verificationUri: string; expiresAt: number; status: 'pending' | 'done' | 'error'; error?: string; label?: string }

export function ConnectionsPage() {
  const data = useLoad(() => api.get<ConnectionsResponse>('/api/connections'));
  const { connectors } = useLive();
  const { search } = useRouter();
  const toast = useToast();
  const run = useAction();
  const [bp, setBp] = useState('');
  const [flow, setFlow] = useState<Flow | null>(null);
  const apps = data.data?.apps;

  const connect = async (provider: 'twitch' | 'youtube') => {
    const f = await run(() => api.post<Flow>(`/api/connections/${provider}/device`));
    if (f) setFlow(f);
  };

  // Status der Anmeldung abfragen, bis sie fertig ist
  useEffect(() => {
    if (!flow || flow.status !== 'pending') return;
    const t = setTimeout(() => {
      api.get<Flow>(`/api/connections/device/${flow.id}`).then((f) => {
        setFlow(f);
        if (f.status === 'done') {
          toast(`${f.label} verbunden`);
          data.reload();
        }
      }, () => undefined);
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  useEffect(() => {
    const err = search.get('error');
    if (err) toast(`Twitch: ${err}`, true);
    else if (search.get('connected')) toast('Twitch verbunden');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusOf = (id: string) => connectors.find((c) => c.id === id) ?? data.data?.status.find((c) => c.id === id);
  const conns = data.data?.connections ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Verbindungen</h1>
          <p className="lead" style={{ margin: 0 }}>Quellen für Events. Jede Quelle liefert ins selbe Event-Format; Regeln und Overlays bleiben gleich.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Twitch</h2>
          <p className="small muted" style={{ margin: 0 }}>Follows, Subs, Resubs, Gift-Subs, Bits, Power-Ups, Raids, Kanalpunkte, Charity und Stream-Status über EventSub (WebSocket).</p>
          {apps?.twitch.clientId
            ? <div><button className="primary" onClick={() => void connect('twitch')}>Mit Twitch verbinden</button></div>
            : <div className="small">Einmalig: Twitch-App anlegen und Client-ID unten unter <b>App-Zugangsdaten</b> eintragen.</div>}
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>YouTube</h2>
          <p className="small muted" style={{ margin: 0 }}>Super Chats, Super Sticker, neue Mitglieder, Mitglieds-Meilensteine, verschenkte Mitgliedschaften und neue (öffentliche) Abos während eines Livestreams.</p>
          {apps?.google.clientId && apps.google.hasSecret
            ? <div><button className="primary" onClick={() => void connect('youtube')}>Mit YouTube verbinden</button></div>
            : <div className="small">Einmalig: Google-OAuth-Client anlegen und unten unter <b>App-Zugangsdaten</b> eintragen.</div>}
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>betterplace</h2>
          <p className="small muted" style={{ margin: 0 }}>Spenden einer Spendenaktion: sofort per Spenden-Webhook (URL erscheint nach dem Hinzufügen) oder per API-Abfrage alle 20 s. Bereits vorhandene Spenden lösen keinen Alert aus. Alle Alerts dazu: Alert-Box → Spenden (betterplace).</p>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api.post('/api/connections/betterplace', { input: bp }), 'Spendenaktion verbunden').then(() => { setBp(''); data.reload(); }); }}>
            <input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="Link oder ID der Spendenaktion" style={{ flex: 1, width: 'auto' }} />
            <button className="primary" type="submit" disabled={!bp.trim()}>Hinzufügen</button>
          </form>
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>Eigener Webhook</h2>
          <p className="small muted" style={{ margin: 0 }}>Für Ko-fi, Streamer.bot, Zapier oder eigene Tools: JSON per POST an die URL senden.</p>
          <div><button onClick={() => run(() => api.post('/api/connections/webhook', { label: 'Webhook' }), 'Webhook angelegt').then(data.reload)}>+ Webhook anlegen</button></div>
          <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>{`curl -X POST <Webhook-URL> -H 'content-type: application/json' \\
  -d '{"type":"donation","user":"Max","amount":5,"message":"Danke!"}'`}</pre>
        </div>
      </div>

      {apps && <AppCredentials apps={apps} onSaved={data.reload} />}

      {flow && <DeviceDialog flow={flow} onClose={() => { if (flow.status === 'pending') void api.del(`/api/connections/device/${flow.id}`); setFlow(null); }} />}

      <h2 style={{ marginTop: 24 }}>Aktive Verbindungen</h2>
      <div className="card">
        {!conns.length && <div className="empty">Noch keine Verbindung eingerichtet.</div>}
        {!!conns.length && (
          <table>
            <thead><tr><th>Quelle</th><th>Status</th><th>Details</th><th /></tr></thead>
            <tbody>
              {conns.map((c) => {
                const st = statusOf(c.id);
                return (
                  <tr key={c.id} className={c.enabled ? '' : 'disabled'}>
                    <td><b>{c.label}</b><div className="small muted">{c.platform}</div></td>
                    <td><StatusBadge state={c.enabled ? st?.state ?? 'disconnected' : 'disconnected'} /></td>
                    <td className="small" style={{ maxWidth: 420 }}>
                      {st?.detail && <div className="muted">{st.detail}</div>}
                      {c.platform === 'webhook' && <CopyField value={c.data.url} secret />}
                      {c.platform === 'betterplace' && c.data.webhookUrl && <div className="stack" style={{ gap: 4 }}><span className="muted">Spenden-Webhook für betterplace:</span><CopyField value={c.data.webhookUrl} secret /></div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {c.platform !== 'webhook' && <button className="small" onClick={() => run(() => api.post(`/api/connections/${c.id}/restart`), 'Neu gestartet')}>Neu verbinden</button>}{' '}
                      <button className="small" onClick={() => run(() => api.patch(`/api/connections/${c.id}`, { enabled: !c.enabled })).then(data.reload)}>{c.enabled ? 'Deaktivieren' : 'Aktivieren'}</button>{' '}
                      <button className="small danger" onClick={() => confirm(`„${c.label}“ entfernen?`) && run(() => api.del(`/api/connections/${c.id}`), 'Entfernt').then(data.reload)}>Entfernen</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function DeviceDialog({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const name = flow.provider === 'twitch' ? 'Twitch' : 'YouTube';
  return (
    <Modal title={`Mit ${name} verbinden`} onClose={onClose}>
      <div className="stack" style={{ maxWidth: 460 }}>
        {flow.status === 'pending' && (
          <>
            <p style={{ margin: 0 }}>1. Öffne diese Seite – auf diesem oder einem anderen Gerät, z. B. dem Handy:</p>
            <div><a className="btn primary" href={flow.verificationUri} target="_blank" rel="noreferrer">{flow.verificationUri.replace(/^https:\/\//, '').replace(/\?.*$/, '')} öffnen</a></div>
            <p style={{ margin: 0 }}>2. Melde dich mit deinem {name}-Konto an und gib diesen Code ein:</p>
            <div className="device-code">{flow.userCode}</div>
            <p className="small muted" style={{ margin: 0 }}>3. Bestätige die Berechtigungen. Dieses Fenster merkt es automatisch. Der Code gilt bis {new Date(flow.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.</p>
            <div className="row small muted"><span className="spinner" aria-hidden /> Warte auf Bestätigung …</div>
          </>
        )}
        {flow.status === 'done' && <p style={{ margin: 0 }}>✅ <b>{flow.label}</b> ist verbunden. Alerts kommen ab jetzt automatisch.</p>}
        {flow.status === 'error' && <p style={{ margin: 0, color: 'var(--err)' }}>{flow.error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={onClose}>{flow.status === 'pending' ? 'Abbrechen' : 'Schließen'}</button></div>
      </div>
    </Modal>
  );
}

function AppCredentials({ apps, onSaved }: { apps: AppsView; onSaved: () => void }) {
  const run = useAction();
  const [tid, setTid] = useState(apps.twitch.clientId);
  const [tsecret, setTsecret] = useState('');
  const [gid, setGid] = useState(apps.google.clientId);
  const [gsecret, setGsecret] = useState('');
  const missing = !apps.twitch.clientId || !apps.google.clientId;
  const save = (body: object) => run(() => api.put('/api/apps', body), 'App-Zugangsdaten gespeichert').then(onSaved);
  return (
    <div style={{ marginTop: 16 }}>
      <Section title="App-Zugangsdaten (einmalig einrichten)" badge={missing ? 'unvollständig' : 'eingerichtet'} open={missing}>
        <p className="small muted" style={{ margin: 0 }}>
          Twitch und Google geben Zugriff nur an registrierte Apps. Weil FF-Overlay bei dir selbst läuft, registrierst du dafür einmalig eine eigene, kostenlose App.
          Danach reicht für jedes Konto ein Klick auf „Verbinden“ und ein kurzer Code – ohne Weiterleitungs-URL, auch im Heimnetz oder auf dem NAS.
        </p>
        <div className="split">
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Twitch</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li><a href="https://dev.twitch.tv/console/apps/create" target="_blank" rel="noreferrer">dev.twitch.tv/console/apps</a> öffnen (Zwei-Faktor-Anmeldung bei Twitch muss aktiv sein) → „Deine Anwendung registrieren“.</li>
              <li>Name z. B. „FF-Overlay {'<'}dein Name{'>'}“, OAuth-Redirect-URL <code>http://localhost</code>, Kategorie „Broadcaster Suite“.</li>
              <li><b>Client-Typ: Öffentlich</b> wählen, erstellen, die <b>Client-ID</b> kopieren.</li>
            </ol>
            {apps.twitch.fromEnv ? <div className="small muted">Aus der .env: <code>TWITCH_CLIENT_ID</code></div> : (
              <>
                <Field label="Twitch Client-ID"><input value={tid} onChange={(e) => setTid(e.target.value)} placeholder="z. B. abcd1234…" /></Field>
                <Field label="Client-Secret (nur bei Client-Typ „Vertraulich“)" hint={apps.twitch.hasSecret ? 'gespeichert – leer lassen, um es zu behalten' : 'bei „Öffentlich“ leer lassen'}>
                  <input type="password" value={tsecret} onChange={(e) => setTsecret(e.target.value)} autoComplete="off" />
                </Field>
                <div><button className="primary" onClick={() => save({ twitchClientId: tid, ...(tsecret ? { twitchClientSecret: tsecret } : {}) })}>Speichern</button></div>
              </>
            )}
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>YouTube (Google)</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google-Cloud-Projekt anlegen</a> und die <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">YouTube Data API v3</a> aktivieren.</li>
              <li>„Google Auth Platform“ / OAuth-Zustimmungsbildschirm: Zielgruppe <b>Extern</b>, danach <b>App veröffentlichen</b> (sonst läuft die Anmeldung nach 7 Tagen ab; die Warnung „nicht überprüft“ ist für die eigene Nutzung okay).</li>
              <li>Clients → Client erstellen → Typ <b>„Fernseher und Geräte mit begrenzter Eingabe“</b> → Client-ID und Client-Secret kopieren.</li>
            </ol>
            {apps.google.fromEnv ? <div className="small muted">Aus der .env: <code>GOOGLE_CLIENT_ID</code></div> : (
              <>
                <Field label="Google Client-ID"><input value={gid} onChange={(e) => setGid(e.target.value)} placeholder="….apps.googleusercontent.com" /></Field>
                <Field label="Client-Secret" hint={apps.google.hasSecret ? 'gespeichert – leer lassen, um es zu behalten' : 'wird verschlüsselt gespeichert'}>
                  <input type="password" value={gsecret} onChange={(e) => setGsecret(e.target.value)} autoComplete="off" />
                </Field>
                <div><button className="primary" onClick={() => save({ googleClientId: gid, ...(gsecret ? { googleClientSecret: gsecret } : {}) })}>Speichern</button></div>
              </>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
