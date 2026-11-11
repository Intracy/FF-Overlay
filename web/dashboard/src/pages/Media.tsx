import { useState } from 'react';
import { api, type MediaAsset } from '../api';
import { GiphyPicker, MediaThumb, UploadButton } from '../components/Pickers';
import { useAction, useLoad } from '../ui';

export function MediaPage() {
  const media = useLoad(() => api.get<MediaAsset[]>('/api/media'));
  const [giphy, setGiphy] = useState(false);
  const run = useAction();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mediathek</h1>
          <p className="lead" style={{ margin: 0 }}>Bilder, GIFs, Videos (WebM mit Transparenz) und Sounds für deine Alerts. Max. 50 MB pro Datei.</p>
        </div>
        <div className="row">
          <button onClick={() => setGiphy(true)}>GIPHY durchsuchen</button>
          <UploadButton onUploaded={media.reload} />
        </div>
      </div>
      <div className="media-grid">
        {!media.data?.length && <div className="empty">Noch keine Medien.</div>}
        {media.data?.map((m) => (
          <div key={m.id} className="media-tile">
            <MediaThumb m={m} />
            <div className="meta">
              <span title={m.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <button className="small ghost danger" aria-label={`${m.name} löschen`} onClick={() => confirm(`„${m.name}“ löschen?`) && run(() => api.del(`/api/media/${m.id}`)).then(media.reload)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {giphy && <GiphyPicker onPick={() => { setGiphy(false); media.reload(); }} onClose={() => setGiphy(false)} />}
    </>
  );
}
