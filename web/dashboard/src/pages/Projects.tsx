import { useEffect, useRef, useState } from 'react';
import { api, currentProject, switchProject, type ProjectSummary } from '../api';
import { Field, Modal, useAction, useLoad, useRouter } from '../ui';

/*
 * Projekte (Overlay-Profile) – oberste Ebene: getrennte Alert-Systeme für verschiedene Streams,
 * jedes mit eigenen Konten, Overlays, Alert-Box, Widgets, Chat, Regeln, Mediathek und Einstellungen.
 */

interface ProjectList { current: string; projects: ProjectSummary[] }

const COLORS = ['#9373c5', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#64748b'];
const PLATFORM: Record<string, string> = { twitch: 'Twitch', youtube: 'YouTube', betterplace: 'betterplace', webhook: 'Webhook' };
const STATE_CLASS: Record<string, string> = { connected: 'ok', connecting: 'warn', error: 'err', not_configured: 'warn', disconnected: '' };

export const useProjects = () => useLoad(() => api.get<ProjectList>('/api/projects'));

function ProjectDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none', boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` }} />;
}

// ---------- Auswahl in der Seitenleiste ----------

export function ProjectSwitcher() {
  const list = useProjects();
  const { navigate, path } = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  // gespeichertes Projekt gibt es nicht mehr → Server hat das Haupt-Projekt genommen
  useEffect(() => {
    if (list.data && list.data.current !== currentProject()) {
      try {
        localStorage.setItem('ffo-project', list.data.current);
      } catch {
        /* egal */
      }
    }
  }, [list.data]);
  // erster Aufruf mit mehreren Projekten: zuerst die Projektauswahl zeigen
  useEffect(() => {
    let chosen = true;
    try {
      chosen = !!localStorage.getItem('ffo-project');
    } catch {
      /* egal */
    }
    if (list.data && !chosen && list.data.projects.length > 1 && path === '/') navigate('/projects');
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = list.data?.projects.find((p) => p.id === list.data?.current);
  return (
    <div className="project-switch" ref={ref}>
      <button className="project-switch-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Projekt wechseln">
        <ProjectDot color={current?.color ?? '#9373c5'} />
        <span className="project-switch-txt">
          <small>Projekt</small>
          <b>{current?.name ?? '…'}</b>
        </span>
        <span className="muted">▾</span>
      </button>
      {open && list.data && (
        <div className="dropdown-menu project-menu">
          <div className="grp">Projekt wechseln</div>
          {list.data.projects.map((p) => (
            <button key={p.id} onClick={() => (p.id === list.data!.current ? setOpen(false) : switchProject(p.id))} className={p.id === list.data!.current ? 'active' : ''}>
              <ProjectDot color={p.color} />
              <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
              {p.live && <span className="badge live">live</span>}
              {p.id === list.data!.current && <span className="muted">✓</span>}
            </button>
          ))}
          <div className="grp" />
          <button onClick={() => { setOpen(false); navigate('/projects'); }}>⚙ Projekte verwalten</button>
        </div>
      )}
    </div>
  );
}

// ---------- Dialog: neues Projekt / bearbeiten ----------

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {COLORS.map((c) => (
        <button key={c} type="button" className={`color-swatch ${value === c ? 'active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={`Farbe ${c}`} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 40, padding: 2 }} aria-label="Eigene Farbe" />
    </div>
  );
}

function ProjectDialog({ projects, edit, onClose, onDone }: { projects: ProjectSummary[]; edit?: ProjectSummary; onClose: () => void; onDone: (p: ProjectSummary, isNew: boolean) => void }) {
  const [name, setName] = useState(edit?.name ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [color, setColor] = useState(edit?.color ?? COLORS[(projects.length + 1) % COLORS.length]!);
  const [copyFrom, setCopyFrom] = useState('');
  const run = useAction();
  const save = async () => {
    const p = edit
      ? await run(() => api.patch<ProjectSummary>(`/api/projects/${edit.id}`, { name, description, color }), 'Projekt gespeichert')
      : await run(() => api.post<ProjectSummary>('/api/projects', { name, description, color, copyFrom: copyFrom || undefined }), 'Projekt angelegt');
    if (p) onDone(p, !edit);
  };
  return (
    <Modal title={edit ? 'Projekt bearbeiten' : 'Neues Projekt'} onClose={onClose}>
      <div className="stack">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Charity-Stream, FrankenFinals, Zweitkanal" autoFocus /></Field>
        <Field label="Beschreibung (optional)"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Wofür ist dieses Projekt?" /></Field>
        <Field label="Farbe"><ColorPick value={color} onChange={setColor} /></Field>
        {!edit && (
          <Field label="Start">
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Neu – mit Standard-Designs und -Regeln</option>
              {projects.map((p) => <option key={p.id} value={p.id}>Kopie von „{p.name}“ (Designs, Regeln, Overlays, Widgets, Mediathek)</option>)}
            </select>
          </Field>
        )}
        {!edit && (
          <p className="small muted" style={{ margin: 0 }}>
            Jedes Projekt ist ein eigenes Alert-System mit eigenen Konten (Twitch, YouTube, betterplace, Webhooks), eigenen Overlay-URLs und eigenem Event-Log.
            Bei einer Kopie werden keine Verbindungen übernommen, und alle Overlay- und Widget-URLs bekommen neue Keys.
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!name.trim()} onClick={save}>{edit ? 'Speichern' : 'Projekt anlegen'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Seite ----------

export function ProjectsPage() {
  const list = useProjects();
  const run = useAction();
  const [dialog, setDialog] = useState<null | { edit?: ProjectSummary }>(null);
  const projects = list.data?.projects ?? [];
  const current = list.data?.current;

  const remove = (p: ProjectSummary) => {
    if (!confirm(`Projekt „${p.name}“ löschen?\n\nVerbindungen werden getrennt und die Overlay-URLs funktionieren nicht mehr. Die Datenbank bleibt als Sicherung im Ordner data/projects erhalten.`)) return;
    void run(() => api.del(`/api/projects/${p.id}`), 'Projekt gelöscht').then(() => (p.id === current ? switchProject('default', '/projects') : list.reload()));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projekte</h1>
          <p className="lead" style={{ margin: 0 }}>
            Eigene Alert-Systeme für verschiedene Streams – jedes mit eigenen Konten, Overlays, Alerts, Widgets, Chat und Einstellungen.
          </p>
        </div>
        <button className="primary" onClick={() => setDialog({})}>+ Neues Projekt</button>
      </div>
      <div className="project-grid">
        {projects.map((p) => (
          <div key={p.id} className={`card project-card ${p.id === current ? 'current' : ''}`} style={{ ['--pc' as string]: p.color }}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
                <ProjectDot color={p.color} size={14} />
                <h2 style={{ margin: 0, overflowWrap: 'anywhere' }}>{p.name}</h2>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {p.live && <span className="badge live">live</span>}
                {p.id === current && <span className="badge ok">geöffnet</span>}
                {p.isDefault && <span className="badge">Standard</span>}
              </div>
            </div>
            {p.description && <p className="small muted" style={{ margin: 0 }}>{p.description}</p>}
            <div className="chips">
              {p.connections.length
                ? p.connections.map((c, i) => <span key={i} className={`badge ${STATE_CLASS[c.state] ?? ''}`} title={c.state}>{PLATFORM[c.platform] ?? c.platform}: {c.label.replace(/^(Twitch|YouTube|betterplace)\s*/i, '') || c.label}</span>)
                : <span className="small muted">Noch keine Konten verbunden</span>}
            </div>
            <div className="small muted">{p.overlays} Overlay{p.overlays === 1 ? '' : 's'} · {p.widgets} Widget{p.widgets === 1 ? '' : 's'} / Chat-Overlays</div>
            <div className="row" style={{ marginTop: 'auto' }}>
              {p.id === current
                ? <button className="primary" onClick={() => switchProject(p.id, '/')}>Zum Alert Feed</button>
                : <button className="primary" onClick={() => switchProject(p.id, '/')}>Öffnen</button>}
              <button onClick={() => setDialog({ edit: p })}>Bearbeiten</button>
              {!p.isDefault && <button className="danger ghost" onClick={() => remove(p)}>Löschen</button>}
            </div>
          </div>
        ))}
        <button className="card project-card project-new" onClick={() => setDialog({})}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>+</span>
          <b>Neues Projekt</b>
          <span className="small muted">Für einen weiteren Kanal, ein Event oder einen Charity-Stream</span>
        </button>
      </div>
      {dialog && (
        <ProjectDialog projects={projects} edit={dialog.edit} onClose={() => setDialog(null)}
          onDone={(p, isNew) => {
            setDialog(null);
            if (isNew && confirm(`„${p.name}“ jetzt öffnen?`)) switchProject(p.id, '/connections');
            else list.reload();
          }} />
      )}
    </>
  );
}
