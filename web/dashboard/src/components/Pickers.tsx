import { useEffect, useState } from 'react';
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
  return (
    <Modal title={kind === 'audio' ? 'Sound auswählen' : 'Bild oder Video auswählen'} onClose={onClose} wide>
      <UploadButton onUploaded={(m) => { media.reload(); onPick(m); }} accept={kind === 'audio' ? 'audio/*' : 'image/*,video/mp4,video/webm'} />
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
      {m.kind === 'audio' && <span style={{ fontSize: 34 }}>♪</span>}
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
