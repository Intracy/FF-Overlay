import { useEffect, useMemo, useState } from 'react';
import { api, EVENT_TYPES, typeIcon, typeLabel, type EventLogEntry, type Overlay, type QueueState } from '../api';
import { useLive } from '../live';
import { StatusBadge, timeAgo, useAction, useLoad } from '../ui';

const FILTERS = [
  { key: 'all', label: 'Alle' },
  { key: 'follow', label: 'Follows' },
  { key: 'subscription', label: 'Subs' },
  { key: 'cheer', label: 'Bits' },
  { key: 'raid', label: 'Raids' },
  { key: 'redemption', label: 'Kanalpunkte' },
  { key: 'power_up', label: 'Power-Ups' },
  { key: 'charity', label: 'Charity' },
  { key: 'donation', label: 'Spenden' },
];

function EventTitle({ e }: { e: EventLogEntry['event'] }) {
  const amount = e.amount ? (e.amount.currency === 'BITS' ? `${e.amount.value} Bits` : new Intl.NumberFormat('de-DE', { style: 'currency', currency: e.amount.currency }).format(e.amount.value)) : '';
  const name = <b>{e.user.name}</b>;
  switch (e.type) {
    case 'follow': return <>{name} folgt jetzt</>;
    case 'subscription':
      if (e.subtype === 'gift') return <>{name} verschenkt {e.count} Sub{e.count === 1 ? '' : 's'}</>;
      if (e.subtype === 'gift_recipient') return <>{name} hat einen Sub geschenkt bekommen</>;
      if (e.subtype === 'resub') return <>{name} ist seit {e.months} Monaten dabei</>;
      return <>{name} hat abonniert</>;
    case 'cheer': return <>{name} cheert {amount}</>;
    case 'raid': return <>{name} raidet mit {e.count} Leuten</>;
    case 'redemption': return <>{name} löst „{e.product}“ ein</>;
    case 'power_up': return <>{name} löst Power-Up „{e.product}“ aus ({e.count} Bits)</>;
    case 'charity': return <>{name} spendet {amount} für {e.product ?? 'den guten Zweck'}</>;
    case 'donation': return <>{name} spendet {amount || '(Betrag verborgen)'}</>;
    case 'stream_status': return <>Stream {e.subtype === 'online' ? 'gestartet' : 'beendet'}</>;
    default: return <>{name} · {typeLabel(e.type, e.subtype)} {amount}</>;
  }
}

function QueueCard({ overlay, state }: { overlay: Overlay; state?: QueueState }) {
  const run = useAction();
  const act = (a: string, msg?: string) => run(() => api.post(`/api/overlays/${overlay.id}/queue/${a}`), msg);
  const setAudio = (patch: { muted?: boolean; volume?: number }) => run(() => api.patch(`/api/overlays/${overlay.id}`, patch));
  const s = state;
  // Countdown der Moderation sekündlich aktualisieren
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s?.held.some((h) => h.releaseAt)) return;
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [s?.held]);
  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{overlay.name}</h2>
        <span className={`badge ${s?.connections ? 'ok' : 'warn'}`} title="Verbundene Browserquellen">
          <span className="dot" />{s?.connections ?? 0} Quelle{s?.connections === 1 ? '' : 'n'}
        </span>
      </div>
      {!!s?.held.length && (
        <div className="stack">
          <div className="small" style={{ color: 'var(--warn)', fontWeight: 700 }}>Wartet auf Moderation ({s.held.length})</div>
          {s.held.map((h) => (
            <div key={h.itemId} className="held">
              <div style={{ fontWeight: 650 }}>{h.title}</div>
              {h.message && <div className="small muted">„{h.message}“</div>}
              <div className="row between" style={{ marginTop: 6 }}>
                <span className="small muted">{h.releaseAt ? `automatisch in ${Math.max(0, Math.round((h.releaseAt - Date.now()) / 1000))} s` : 'wartet auf Freigabe'}</span>
                <span className="row">
                  <button className="small" onClick={() => run(() => api.post(`/api/overlays/${overlay.id}/moderation/${h.itemId}/approve`))}>✓ Freigeben</button>
                  <button className="small danger" onClick={() => run(() => api.post(`/api/overlays/${overlay.id}/moderation/${h.itemId}/reject`))}>✕ Ablehnen</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="queue-now">
        <div className="small muted">Läuft gerade</div>
        <div style={{ fontWeight: 650 }}>{s?.playing?.title ?? (s?.paused ? 'Pausiert' : '–')}</div>
        {!!s?.pending.length && (
          <ol className="queue-list small">{s.pending.slice(0, 5).map((p) => <li key={p.itemId}>{p.title}</li>)}</ol>
        )}
        {(s?.pending.length ?? 0) > 5 && <div className="small muted">… und {s!.pending.length - 5} weitere</div>}
        {!s?.connections && !!s?.pending.length && <div className="small" style={{ color: 'var(--warn)' }}>Wartet, bis eine Browserquelle verbunden ist.</div>}
      </div>
      <div className="row">
        {s?.paused
          ? <button className="on" onClick={() => act('resume')}>▶ Fortsetzen</button>
          : <button onClick={() => act('pause')}>❚❚ Pausieren</button>}
        <button onClick={() => act('skip')} disabled={!s?.playing}>⏭ Skip Alert</button>
        <button className={s?.muted ? 'on' : ''} onClick={() => setAudio({ muted: !s?.muted })}>{s?.muted ? '🔇 Stumm' : '🔊 Ton an'}</button>
      </div>
      <label className="field">
        Master-Lautstärke {Math.round((s?.volume ?? overlay.volume) * 100)} %
        <input type="range" min={0} max={1} step={0.05} defaultValue={overlay.volume} onChange={(e) => setAudio({ volume: Number(e.target.value) })} />
      </label>
      <div className="row">
        <button className="small" onClick={() => act('clear', 'Warteschlange geleert')} disabled={!s?.pending.length}>Queue leeren</button>
        <button className="small" onClick={() => act('reload', 'Browserquellen neu geladen')}>Quellen neu laden</button>
      </div>
    </div>
  );
}

function TestPanel() {
  const run = useAction();
  const [user, setUser] = useState('TestViewer');
  const [amount, setAmount] = useState(10);
  const test = (type: string, subtype?: string, extra: Record<string, unknown> = {}) =>
    run(() => api.post('/api/events/test', { type, subtype, user, ...extra }));
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Test-Alerts</h2>
      <div className="fields">
        <label className="field">Name<input value={user} onChange={(e) => setUser(e.target.value)} /></label>
        <label className="field">Betrag / Anzahl<input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
      </div>
      <div className="chips">
        {EVENT_TYPES.filter((t) => t.type !== 'custom').map((t) => (
          <button key={t.label} className="small" onClick={() => test(t.type, t.subtype, t.type === 'donation' ? { amount } : t.type === 'cheer' ? { amount, count: amount } : ['raid', 'subscription'].includes(t.type) ? { count: amount } : {})}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Test-Events laufen durch dieselben Filter und Regeln wie echte Events.</p>
    </div>
  );
}

export function LivePage({ popout }: { popout: boolean }) {
  const { events, queues, setEvents } = useLive();
  const overlays = useLoad(() => api.get<Overlay[]>('/api/overlays'));
  const [filter, setFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const run = useAction();

  const shown = useMemo(
    () => events.filter((e) => e.event.type !== 'stream_status' || filter === 'all')
      .filter((e) => filter === 'all' || e.event.type === filter)
      .filter((e) => !unreadOnly || !e.read),
    [events, filter, unreadOnly],
  );

  const markRead = (ids: string[] | 'all') => {
    setEvents((list) => list.map((e) => (ids === 'all' || ids.includes(e.id) ? { ...e, read: true } : e)));
    void run(() => api.post('/api/events/read', { ids }));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alert Feed</h1>
          {!popout && <p className="lead" style={{ margin: 0 }}>Ereignisse, Warteschlange und Steuerung während des Streams.</p>}
        </div>
        {!popout && <button onClick={() => window.open('/?popout=1', 'ffo-live', 'width=720,height=900')}>↗ Als Popout öffnen</button>}
      </div>
      <div className={`grid ${popout ? '' : 'live-grid'}`}>
        <section className="card">
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="chips" role="toolbar" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
              ))}
              <button className={`chip ${unreadOnly ? 'active' : ''}`} onClick={() => setUnreadOnly((u) => !u)}>Nur ungelesen</button>
            </div>
            <button className="small ghost" onClick={() => markRead('all')}>Alle gelesen ✓</button>
          </div>
          <div className="feed">
            {!shown.length && <div className="empty">Noch keine Ereignisse. Starte einen Test-Alert oder verbinde eine Plattform.</div>}
            {shown.map((entry) => (
              <div key={entry.id} className={`feed-row ${entry.read ? '' : 'unread'}`}>
                <div className="icon" title={entry.event.platform}>{typeIcon(entry.event.type)}</div>
                <div>
                  <div className="title"><EventTitle e={entry.event} /></div>
                  {entry.event.message && <div className="msg">„{entry.event.message}“</div>}
                  <div className="why">
                    <StatusBadge state={entry.status} /> · {entry.event.platform}{entry.event.isTest ? ' (Test)' : ''} · {timeAgo(entry.createdAt)}
                    {entry.reason && <> · {entry.reason}</>}
                  </div>
                </div>
                <div className="actions">
                  <button className="small ghost" title="Erneut abspielen" onClick={() => run(() => api.post(`/api/events/${entry.id}/replay`), 'Erneut eingereiht')}>↻</button>
                  {!entry.read && <button className="small ghost" title="Als gelesen markieren" onClick={() => markRead([entry.id])}>✓</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside className="stack">
          {overlays.data?.map((o) => <QueueCard key={o.id} overlay={o} state={queues[o.id]} />)}
          <TestPanel />
        </aside>
      </div>
    </>
  );
}
