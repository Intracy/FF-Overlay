import { useEffect, useState } from 'react';
import { api, type Connection, type ConnectorStatus } from '../api';
import { useLive } from '../live';
import { CopyField, StatusBadge, useAction, useLoad, useRouter, useToast } from '../ui';

interface ConnectionsResponse { connections: Connection[]; status: ConnectorStatus[]; twitchConfigured: boolean; twitchRedirectUri: string }

export function ConnectionsPage() {
  const data = useLoad(() => api.get<ConnectionsResponse>('/api/connections'));
  const { connectors } = useLive();
  const { search } = useRouter();
  const toast = useToast();
  const run = useAction();
  const [bp, setBp] = useState('');

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
          <p className="small muted" style={{ margin: 0 }}>Follows, Subs, Resubs, Gift-Subs, Bits, Raids, Kanalpunkte und Stream-Status über EventSub (WebSocket).</p>
          {data.data?.twitchConfigured ? (
            <div><a className="btn" href="/auth/twitch/start">Mit Twitch verbinden</a></div>
          ) : (
            <div className="small">
              <b>Noch nicht eingerichtet.</b> Lege unter <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">dev.twitch.tv/console/apps</a> eine App an,
              trage als OAuth-Redirect-URL ein:
              <div style={{ margin: '6px 0' }}><CopyField value={data.data?.twitchRedirectUri ?? ''} /></div>
              und setze <code>TWITCH_CLIENT_ID</code> und <code>TWITCH_CLIENT_SECRET</code> in der <code>.env</code>.
            </div>
          )}
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
