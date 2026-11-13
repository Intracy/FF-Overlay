import { useEffect, useRef, useState } from 'react';
import { api, type GiphyItem, type MediaAsset } from '../api';
import { Modal, useAction, useLoad } from '../ui';

/** GIPHY-Suche über den Backend-Proxy. „Powered By GIPHY“ ist laut GIPHY-Bedingungen Pflicht. */
export function GiphyPicker({ onPick, onClose }: { onPick: (m: MediaAsset) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'gifs' | 'stickers'>('stickers');
  const [items, setItems] = useState<GiphyItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const run = useAction();

  const search = async (o = 0) => {
    setError('');
    try {
      const r = await api.get<{ items: GiphyItem[] }>(`/api/giphy/search?kind=${kind}&q=${encodeURIComponent(q)}&offset=${o}`);
      setItems((prev) => (o ? [...prev, ...r.items] : r.items));
      setOffset(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void search(0); }, [kind]);

  const pick = async (g: GiphyItem) => {
    const m = await run(() => api.post<MediaAsset>('/api/media/giphy', { id: g.id, title: g.title, url: g.url }));
    if (m) onPick(m);
  };

  return (
    <Modal title="GIF bei GIPHY suchen" onClose={onClose} wide>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void search(0); }} style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="z. B. party, hype, danke" style={{ flex: 1, width: 'auto' }} autoFocus />
        <select value={kind} onChange={(e) => setKind(e.target.value as 'gifs' | 'stickers')} style={{ width: 'auto' }}>
          <option value="stickers">Sticker (transparent)</option>
          <option value="gifs">GIFs</option>
        </select>
        <button className="primary" type="submit">Suchen</button>
      </form>
      {error && !/GIPHY-Key/.test(error) && <div className="empty">{error}</div>}
      {/GIPHY-Key/.test(error) && (
        <form className="card stack" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); void run(() => api.put('/api/apps', { giphyApiKey: key }), 'GIPHY-Key gespeichert').then(() => { setKey(''); void search(0); }); }}>
          <b>GIPHY-Key fehlt</b>
          <span className="small muted">Key von <a href="https://developers.giphy.com/dashboard/" target="_blank" rel="noreferrer">developers.giphy.com</a> einfügen (API- oder SDK-Key). Er wird verschlüsselt auf deinem Server gespeichert und nie an den Browser zurückgegeben.</span>
          <div className="row"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="GIPHY-Key" autoComplete="off" style={{ flex: 1, width: 'auto' }} /><button className="primary" type="submit" disabled={!key.trim()}>Speichern & suchen</button></div>
        </form>
      )}
      <div className="giphy-grid">
        {items.map((g) => (
          <button key={g.id} title={g.title} onClick={() => pick(g)}><img src={g.preview} alt={g.title} loading="lazy" /></button>
        ))}
      </div>
      <div className="row between" style={{ marginTop: 12 }}>
        <span className="small muted">Powered By GIPHY</span>
        {!!items.length && <button className="small" onClick={() => search(offset + 24)}>Mehr laden</button>}
      </div>
    </Modal>
  );
}

export function MediaPicker({ kind, onPick, onClose }: { kind: 'visual' | 'audio'; onPick: (m: MediaAsset) => void; onClose: () => void }) {
  const media = useLoad(() => api.get<MediaAsset[]>('/api/media'));
  const list = (media.data ?? []).filter((m) => (kind === 'audio' ? m.kind === 'audio' : m.kind !== 'audio'));
  const [instants, setInstants] = useState(false);
  return (
    <Modal title={kind === 'audio' ? 'Sound auswählen' : 'Bild oder Video auswählen'} onClose={onClose} wide>
      <div className="row">
        <UploadButton onUploaded={(m) => { media.reload(); onPick(m); }} accept={kind === 'audio' ? 'audio/*' : 'image/*,video/mp4,video/webm'} />
        {kind === 'audio' && <button onClick={() => setInstants(true)}>MyInstants durchsuchen</button>}
      </div>
      {instants && <MyInstantsPicker onPick={(m) => { setInstants(false); media.reload(); onPick(m); }} onClose={() => setInstants(false)} />}
      <div className="media-grid" style={{ marginTop: 12 }}>
        {!list.length && <div className="empty">Noch nichts in der Mediathek.</div>}
        {list.map((m) => (
          <div key={m.id} className="media-tile selectable" onClick={() => onPick(m)} role="button" tabIndex={0}>
            <MediaThumb m={m} />
            <div className="meta"><span>{m.name}</span></div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function MediaThumb({ m }: { m: MediaAsset }) {
  return (
    <div className="thumb">
      {m.kind === 'image' && <img src={m.url} alt="" loading="lazy" />}
      {m.kind === 'video' && <video src={m.url} muted loop autoPlay playsInline />}
      {m.kind === 'audio' && <button className="ghost" style={{ fontSize: 30 }} onClick={(e) => { e.stopPropagation(); void new Audio(m.url).play(); }} aria-label={`${m.name} anhören`} title="Anhören">♪</button>}
    </div>
  );
}

export function UploadButton({ onUploaded, accept }: { onUploaded: (m: MediaAsset) => void; accept?: string }) {
  const run = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <label className="btn" style={{ cursor: 'pointer' }}>
      {busy ? 'Lade hoch …' : '⤒ Datei hochladen'}
      <input type="file" hidden accept={accept ?? 'image/*,video/mp4,video/webm,audio/*'} onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        const fd = new FormData();
        fd.append('file', f);
        const m = await run(() => api.post<MediaAsset>('/api/media/upload', fd), 'Hochgeladen');
        setBusy(false);
        e.target.value = '';
        if (m) onUploaded(m);
      }} />
    </label>
  );
}

interface Instant { slug: string; name: string; sound: string; color: string; description: string; tags: string }

/**
 * Sound-Buttons von MyInstants durchsuchen, probehören und in die Mediathek übernehmen.
 * Der Sound wird auf den eigenen Server kopiert – im Stream hängt nichts an myinstants.com.
 */
export function MyInstantsPicker({ onPick, onClose }: { onPick: (m: MediaAsset) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Instant[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState('');
  const [busy, setBusy] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const run = useAction();

  const search = async (p = 1) => {
    setError('');
    setLoading(true);
    try {
      const r = await api.get<{ items: Instant[]; count: number; hasMore: boolean }>(`/api/myinstants/search?q=${encodeURIComponent(q)}&page=${p}`);
      setItems((prev) => (p > 1 ? [...prev, ...r.items] : r.items));
      setPage(p);
      setHasMore(r.hasMore);
      setCount(r.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void search(1); return () => audio.current?.pause(); }, []);

  const toggle = (i: Instant) => {
    audio.current?.pause();
    if (playing === i.slug) return setPlaying('');
    const a = new Audio(i.sound);
    a.volume = 0.6;
    a.onended = () => setPlaying('');
    audio.current = a;
    setPlaying(i.slug);
    void a.play().catch(() => setPlaying(''));
  };

  const pick = async (i: Instant) => {
    setBusy(i.slug);
    const m = await run(() => api.post<MediaAsset>('/api/media/myinstants', { slug: i.slug, name: i.name, sound: i.sound }), `„${i.name}“ in die Mediathek übernommen`);
    setBusy('');
    if (m) {
      audio.current?.pause();
      onPick(m);
    }
  };

  return (
    <Modal title="Sound bei MyInstants suchen" onClose={onClose} wide>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void search(1); }} style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="z. B. airhorn, applaus, bruh, wow" style={{ flex: 1, width: 'auto' }} autoFocus />
        <button className="primary" type="submit">Suchen</button>
      </form>
      {error && <div className="empty">{error}</div>}
      {!error && !loading && !items.length && <div className="empty">Keine Sounds gefunden.</div>}
      <div className="instants-grid">
        {items.map((i) => (
          <div key={i.slug} className="instant">
            <button className={`instant-btn${playing === i.slug ? ' playing' : ''}`} style={{ '--c': i.color } as React.CSSProperties} onClick={() => toggle(i)} aria-label={`${i.name} anhören`} title="Anhören">
              {playing === i.slug ? '■' : '▶'}
            </button>
            <div className="instant-name" title={i.description || i.name}>{i.name}</div>
            <button className="small primary" disabled={!!busy} onClick={() => void pick(i)}>{busy === i.slug ? 'Lade …' : 'Übernehmen'}</button>
          </div>
        ))}
      </div>
      <div className="row between" style={{ marginTop: 12 }}>
        <span className="small muted">
          Sounds von <a href="https://www.myinstants.com" target="_blank" rel="noreferrer">myinstants.com</a>{count ? ` · ${count.toLocaleString('de-DE')} Treffer` : ''} · Rechte am Sound prüfen, bevor du ihn im Stream nutzt.
        </span>
        {hasMore && <button className="small" disabled={loading} onClick={() => void search(page + 1)}>{loading ? 'Lade …' : 'Mehr laden'}</button>}
      </div>
    </Modal>
  );
}
