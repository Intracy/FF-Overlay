import { useState } from 'react';
import { api, type GlobalSettings } from '../api';
import { CopyField, Field, StatusBadge, useAction, useLoad } from '../ui';
import { Toggle } from '../components/WidgetFields';
import { WIDGET_INFO, type BpWidgetType, type Widget } from '../../../../server/src/shared/widgets';
import { WidgetEditor } from './Widgets';

/*
 * Alert-Box → „Spenden (betterplace)“: Verbindung & Webhook sowie alle Alerts,
 * die betterplace unter „Alerts für deinen Charity Stream“ anbietet, als Widgets.
 */

interface BpConnection {
  id: string;
  platform: string;
  label: string;
  enabled: boolean;
  data: {
    fundraisingEventId: string;
    webhookUrl: string;
    webhookSeenAt: string | null;
    stats: { title: string; total: number; count: number; target: number | null; closed: boolean; fetchedAt: string; logos: unknown[] } | null;
  };
}
interface ConnectionsResponse {
  connections: BpConnection[];
  status: Array<{ id: string; state: 'connected' | 'connecting' | 'error' | 'disconnected'; detail?: string }>;
}

const money = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const EXAMPLE = `{
  "event_name": "donation_announced",
  "event_version": "0.2",
  "donation": {
    "sequence_number": 1,
    "amount_in_cents": 2000,
    "receiver": "f111",
    "comment": "have fun",
    "donor_display_name": "Donald Duck",
    "streaming_shareable_media": { "video_link": "https://youtu.be/…", "video_start_time": 3 }
  }
}`;

export function BetterplaceSetup() {
  const data = useLoad(() => api.get<ConnectionsResponse>('/api/connections'));
  const settings = useLoad(() => api.get<GlobalSettings>('/api/settings'));
  const run = useAction();
  const [input, setInput] = useState('');
  const conns = (data.data?.connections ?? []).filter((c) => c.platform === 'betterplace');
  const local = (url: string) => /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(url);

  return (
    <div className="stack">
      <div className="split-head"><h2 style={{ margin: 0 }}>betterplace: Verbindung & Webhook</h2></div>
      <div className="split">
        <div className="col">
          {conns.map((c) => {
            const st = data.data?.status.find((x) => x.id === c.id);
            const s = c.data.stats;
            return (
              <div key={c.id} className="card stack">
                <div className="row between">
                  <h3 style={{ margin: 0 }}>{s?.title || c.label}</h3>
                  <StatusBadge state={c.enabled ? st?.state ?? 'disconnected' : 'disconnected'} />
                </div>
                {s && (
                  <div className="small">
                    Spendenstand <b>{money(s.total)}</b> · {s.count} Spenden{s.target ? ` · Ziel ${money(s.target)}` : ''}
                    {s.closed && <span style={{ color: 'var(--warn)' }}> · Spendenaktion geschlossen – es kommen keine echten Spenden mehr</span>}
                  </div>
                )}
                <Field label="Webhook-URL für betterplace (wie ein Passwort behandeln)">
                  {c.data.webhookUrl
                    ? <CopyField value={c.data.webhookUrl} secret />
                    : <button onClick={() => run(() => api.post(`/api/connections/${c.id}/betterplace`, { action: 'rotate' }), 'Webhook-URL erzeugt').then(data.reload)}>Webhook-URL erzeugen</button>}
                </Field>
                {c.data.webhookUrl && local(c.data.webhookUrl) && (
                  <div className="small" style={{ color: 'var(--warn)' }}>
                    Diese Adresse ist nur in deinem Netz erreichbar. betterplace ruft den Webhook aus dem Internet auf – setze <code>PUBLIC_URL</code> auf eine öffentliche Adresse
                    (z. B. Cloudflare-Tunnel oder Reverse-Proxy auf dem NAS). Bis dahin holt FF-Overlay die Spenden alle 20 s über die API.
                  </div>
                )}
                <div className="small muted">
                  {c.data.webhookSeenAt
                    ? <>Spenden kommen per Webhook (zuletzt {new Date(c.data.webhookSeenAt).toLocaleString('de-DE')}). Die API liefert nur noch Spendenstand, Ziel und Logos.</>
                    : <>Spenden kommen per API-Abfrage (alle 20 s). Sobald der erste Webhook ankommt, wird automatisch umgestellt – ohne doppelte Alerts.</>}
                </div>
                <div className="row">
                  {c.data.webhookSeenAt && <button className="small" onClick={() => run(() => api.post(`/api/connections/${c.id}/betterplace`, { action: 'poll' }), 'Zurück auf API-Abfrage').then(data.reload)}>Zurück auf API-Abfrage</button>}
                  {c.data.webhookUrl && <button className="small" onClick={() => confirm('Neue Webhook-URL erzeugen? Die alte funktioniert danach nicht mehr – bei betterplace neu eintragen.') && run(() => api.post(`/api/connections/${c.id}/betterplace`, { action: 'rotate' }), 'Neue Webhook-URL').then(data.reload)}>URL erneuern</button>}
                  <button className="small" onClick={() => run(() => api.post(`/api/connections/${c.id}/restart`), 'Neu abgefragt').then(() => setTimeout(data.reload, 1500))}>Jetzt abfragen</button>
                </div>
              </div>
            );
          })}
          {!conns.length && (
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Spendenaktion verbinden</h3>
              <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api.post('/api/connections/betterplace', { input }), 'Spendenaktion verbunden').then(() => { setInput(''); data.reload(); }); }}>
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Link oder ID der Spendenaktion" style={{ flex: 1, width: 'auto' }} />
                <button className="primary" type="submit" disabled={!input.trim()}>Verbinden</button>
              </form>
            </div>
          )}
          {settings.data && (
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Test-Modus</h3>
              <Toggle
                label="Alle betterplace-Widgets zeigen Beispieldaten"
                value={settings.data.betterplaceTestMode}
                onChange={(on) => run(() => api.put('/api/settings', { betterplaceTestMode: on }), on ? 'Test-Modus an' : 'Test-Modus aus').then(settings.reload)}
              />
              <p className="small muted" style={{ margin: 0 }}>Wie der Test-Modus bei betterplace: Vorschau mit Testdaten in OBS, auch ohne Spenden. Einzelne Quelle: <code>&amp;preview=true</code> an die URL hängen.</p>
            </div>
          )}
        </div>
        <div className="col aside">
          <div className="card stack">
            <h3 style={{ margin: 0 }}>So richtest du den Webhook ein</h3>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>betterplace → deine Spendenaktion → <b>Alerts für deinen Charity Stream</b> → <b>Spenden-Webhook</b> → „Webhook einrichten“.</li>
              <li>Die Webhook-URL von links bei „Gib deine URL an“ einfügen, <b>Übernehmen</b>, Webhook auf <b>an</b>.</li>
              <li>„Testspende senden“ – sie erscheint im Alert Feed und spielt den Spendenalert.</li>
            </ol>
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Was der Webhook liefert</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li><b>Anzeigename</b> → {'{user}'} (leer = „Anonym“)</li>
              <li><b>Betrag in Cent</b> → {'{amount}'} (kann auf Wunsch verborgen sein)</li>
              <li><b>Kommentar</b> → {'{message}'}, auch für Abstimmungen (#1, #2 …)</li>
              <li><b>Laufende Nummer</b> → keine doppelten Alerts</li>
              <li><b>Video-Link</b> (nur moderierte Aktionen) → wird im Event gespeichert</li>
            </ul>
            <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>{EXAMPLE}</pre>
            <p className="small muted" style={{ margin: 0 }}>Spendenstand, Zielbetrag, Spendenanzahl und Logos der Organisationen kommen zusätzlich über die öffentliche API.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ein betterplace-Alert in der Alert-Box: vorhandenes Widget bearbeiten oder anlegen */
export function BpWidgetPanel({ type }: { type: BpWidgetType }) {
  const list = useLoad(() => api.get<Array<Widget & { url: string }>>('/api/widgets'));
  const run = useAction();
  const info = WIDGET_INFO[type];
  if (!list.data) return <div className="empty">Lade …</div>;
  const existing = list.data.filter((w) => w.type === type);
  if (!existing.length) {
    return (
      <div className="split">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{info.label}</h2>
          <p className="muted" style={{ margin: 0 }}>{info.description}.</p>
          <p className="small muted" style={{ margin: 0 }}>Wird als eigene Browserquelle angelegt ({info.width} × {info.height}). Danach kannst du Farben, Schriften und Anzeige einstellen.</p>
          <div><button className="primary" onClick={() => run(() => api.post('/api/widgets', { type }), `${info.label} angelegt`).then(list.reload)}>„{info.label}“ anlegen</button></div>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      {existing.length > 1 && <p className="small muted" style={{ margin: 0 }}>Es gibt {existing.length} Widgets dieser Art – hier wird das erste bearbeitet, alle findest du unter „Widgets“.</p>}
      <WidgetEditor key={existing[0]!.id} id={existing[0]!.id} onDeleted={list.reload} onRenamed={list.reload} />
    </div>
  );
}
