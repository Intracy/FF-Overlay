import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
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

const NAV = [
  { to: '/', label: 'Alert Feed' },
  { to: '/alertbox', label: 'Alert-Box' },
  { to: '/widgets', label: 'Widgets' },
  { to: '/chat', label: 'Chat' },
  { to: '/rules', label: 'Regeln (erweitert)' },
  { to: '/templates', label: 'Alle Designs' },
  { to: '/overlays', label: 'Overlays' },
  { to: '/connections', label: 'Verbindungen' },
  { to: '/media', label: 'Mediathek' },
  { to: '/settings', label: 'Einstellungen' },
];

function Shell() {
  const { path, search } = useRouter();
  const { connected, connectors } = useLive();
  const popout = search.get('popout') === '1';
  const problems = connectors.filter((c) => c.state === 'error').length;

  const page = (() => {
    switch (path) {
      case '/alertbox': return <AlertBoxPage />;
      case '/widgets': return <WidgetsPage />;
      case '/chat': return <ChatPage />;
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
        <div className="brand"><span className="logo">F</span>FF-Overlay</div>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={path === n.to ? 'active' : ''}>
            {n.label}
            {n.to === '/connections' && problems > 0 && <span className="badge err">{problems}</span>}
          </Link>
        ))}
        <div className="spacer" />
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
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => {
    api.get<{ authenticated: boolean }>('/api/auth/me').then((r) => setAuth(r.authenticated), () => setAuth(false));
    const on = () => setAuth(false);
    window.addEventListener('ffo:unauthorized', on);
    return () => window.removeEventListener('ffo:unauthorized', on);
  }, []);
  if (auth === null) return null;
  if (!auth) return <LoginPage onLogin={() => setAuth(true)} />;
  return (
    <LiveProvider>
      <Shell />
    </LiveProvider>
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
