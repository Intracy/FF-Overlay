import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './theme.css';
import { api } from './api';
import { Link, Router, ToastProvider, useRouter } from './ui';
import { LiveProvider, useLive } from './live';
import { LoginPage } from './pages/Login';
import { LivePage } from './pages/Live';
import { RulesPage } from './pages/Rules';
import { AlertBoxPage } from './pages/AlertBox';
import { TemplatesPage } from './pages/Templates';
import { OverlaysPage } from './pages/Overlays';
import { ConnectionsPage } from './pages/Connections';
import { MediaPage } from './pages/Media';
import { SettingsPage } from './pages/Settings';
import { WidgetsPage } from './pages/Widgets';
import { ChatPage } from './pages/Chat';
import { ProjectSwitcher, ProjectsPage } from './pages/Projects';
import { atLeast, Brand, SessionContext, useRole, useSession, type Me, type Role } from './session';

// min = Mindestrolle aus dem Portal (operator < editor < admin), siehe server/src/lib/permissions.ts
const NAV: { to: string; label: string; min: Role }[] = [
  { to: '/projects', label: 'Projekte', min: 'admin' },
  { to: '/', label: 'Alert Feed', min: 'operator' },
  { to: '/alertbox', label: 'Alert-Box', min: 'editor' },
  { to: '/widgets', label: 'Widgets', min: 'operator' },
  { to: '/chat', label: 'Chat', min: 'operator' },
  { to: '/rules', label: 'Regeln (erweitert)', min: 'editor' },
  { to: '/templates', label: 'Alle Designs', min: 'editor' },
  { to: '/overlays', label: 'Overlays', min: 'editor' },
  { to: '/connections', label: 'Verbindungen', min: 'admin' },
  { to: '/media', label: 'Mediathek', min: 'editor' },
  { to: '/settings', label: 'Einstellungen', min: 'admin' },
];

function UserBox() {
  const me = useSession();
  if (!me?.user || me.user.via === 'open') return null;
  const u = me.user;
  const initials = (u.name || u.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const logout = async () => {
    const r = await api.post<{ portalUrl: string | null }>('/api/auth/logout', {}).catch(() => ({ portalUrl: null }));
    location.href = r.portalUrl ? r.portalUrl + '/' : '/';
  };
  return (
    <div className="userbox">
      <div className="userbox-who">
        <span className="avatar">{initials}</span>
        <span className="userbox-txt"><b>{u.name || u.email}</b><span>{u.roleLabel}</span></span>
      </div>
      <div className="userbox-actions">
        {me.portalUrl && <a className="btn small" href={me.portalUrl + '/'}>Zum Portal</a>}
        <button className="small ghost" onClick={logout}>Abmelden</button>
      </div>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2>Kein Zugriff</h2>
      <p className="muted">Für diesen Bereich reicht deine Rolle nicht aus. Rollen vergibt ein Admin im Portal unter Benutzer.</p>
    </div>
  );
}

function Shell() {
  const { path, search } = useRouter();
  const { connected, connectors } = useLive();
  const popout = search.get('popout') === '1';
  const problems = connectors.filter((c) => c.state === 'error').length;
  const role = useRole();
  const nav = NAV.filter((n) => atLeast(role, n.min));
  const allowed = atLeast(role, NAV.find((n) => n.to === path)?.min ?? 'operator');

  const page = (() => {
    if (!allowed) return <NoAccess />;
    switch (path) {
      case '/alertbox': return <AlertBoxPage />;
      case '/widgets': return <WidgetsPage />;
      case '/chat': return <ChatPage />;
      case '/projects': return <ProjectsPage />;
      case '/rules': return <RulesPage />;
      case '/templates': return <TemplatesPage />;
      case '/overlays': return <OverlaysPage />;
      case '/connections': return <ConnectionsPage />;
      case '/media': return <MediaPage />;
      case '/settings': return <SettingsPage />;
      default: return <LivePage popout={popout} />;
    }
  })();

  return (
    <div className={`app ${popout ? 'popout' : ''}`}>
      <nav className="side" aria-label="Hauptnavigation">
        <Brand />
        <ProjectSwitcher />
        {nav.map((n) => (
          <Link key={n.to} to={n.to} className={`${path === n.to ? 'active' : ''}${n.to === '/projects' ? ' nav-projects' : ''}`}>
            {n.label}
            {n.to === '/connections' && problems > 0 && <span className="badge err">{problems}</span>}
          </Link>
        ))}
        <div className="spacer" />
        <UserBox />
        <span className="badge" title="Verbindung Dashboard ↔ Backend">
          <span className="dot" style={{ color: connected ? 'var(--ok)' : 'var(--err)' }} />
          {connected ? 'Backend verbunden' : 'Backend getrennt'}
        </span>
      </nav>
      <main>{page}</main>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = () =>
    api.get<Me>('/api/auth/me').then(
      (r) => { setMe(r); setLoaded(true); },
      () => { setMe(null); setLoaded(true); },
    );
  useEffect(() => {
    load();
    const on = () => setMe((m) => (m ? { ...m, authenticated: false, user: null } : m));
    window.addEventListener('ffo:unauthorized', on);
    return () => window.removeEventListener('ffo:unauthorized', on);
  }, []);
  if (!loaded) return null;
  if (!me?.authenticated) return <LoginPage me={me} onLogin={load} />;
  return (
    <SessionContext.Provider value={me}>
      <LiveProvider>
        <Shell />
      </LiveProvider>
    </SessionContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <ToastProvider>
        <App />
      </ToastProvider>
    </Router>
  </StrictMode>,
);
