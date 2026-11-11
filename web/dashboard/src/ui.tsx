import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ---------- Mini-Router (History API) ----------

const RouterCtx = createContext<{ path: string; search: URLSearchParams; navigate: (to: string) => void }>({
  path: '/', search: new URLSearchParams(), navigate: () => {},
});

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to: string) => {
    history.pushState(null, '', to);
    const u = new URL(to, location.origin);
    setLoc({ path: u.pathname, search: u.search });
  }, []);
  return <RouterCtx.Provider value={{ path: loc.path, search: new URLSearchParams(loc.search), navigate }}>{children}</RouterCtx.Provider>;
}

export const useRouter = () => useContext(RouterCtx);

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { navigate } = useRouter();
  return (
    <a href={to} className={className} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(to); } }}>
      {children}
    </a>
  );
}

// ---------- Toasts ----------

const ToastCtx = createContext<(msg: string, isError?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((msg: string, err = false) => setToast({ msg, err }), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} role="status">{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Führt eine Aktion aus und zeigt Fehler als Toast. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), true);
        return undefined;
      }
    },
    [toast],
  );
}

// ---------- Daten laden ----------

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string>('');
  const reload = useCallback(() => {
    fn().then(setData, (e) => setError(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, setData, error, reload };
}

// ---------- Kleine Bausteine ----------

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={wide ? { width: 'min(1100px, 100%)' } : undefined}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="small" style={{ fontWeight: 400 }}>{hint}</span>}
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  return <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
}

export function CopyField({ value, secret }: { value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const toast = useToast();
  return (
    <div className="url-box">
      <input readOnly value={shown ? value : '•'.repeat(Math.min(48, value.length))} onFocus={(e) => shown && e.target.select()} />
      {secret && <button className="small" onClick={() => setShown((s) => !s)}>{shown ? 'Verbergen' : 'Anzeigen'}</button>}
      <button className="small" onClick={() => navigator.clipboard.writeText(value).then(() => toast('Kopiert'))}>Kopieren</button>
    </div>
  );
}

export function StatusBadge({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    connected: ['ok', 'verbunden'], connecting: ['warn', 'verbindet'], disconnected: ['', 'getrennt'],
    error: ['err', 'Fehler'], not_configured: ['warn', 'nicht eingerichtet'],
    played: ['ok', 'gespielt'], queued: ['warn', 'in Queue'], filtered: ['err', 'gefiltert'], suppressed: ['', 'gebündelt'],
    no_rule: ['', 'keine Regel'], skipped: ['', 'übersprungen'], held: ['warn', 'Moderation'], rejected: ['err', 'abgelehnt'],
  };
  const [cls, label] = map[state] ?? ['', state];
  return <span className={`badge ${cls}`}><span className="dot" />{label}</span>;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('de-DE');
}
