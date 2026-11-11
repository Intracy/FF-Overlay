import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ServerToDashboard } from '../../../server/src/shared/types';
import { api, type ConnectorStatus, type EventLogEntry, type QueueState } from './api';

interface LiveState {
  connected: boolean;
  events: EventLogEntry[];
  queues: Record<string, QueueState>;
  connectors: ConnectorStatus[];
  setEvents: (fn: (e: EventLogEntry[]) => EventLogEntry[]) => void;
}

const LiveCtx = createContext<LiveState>({ connected: false, events: [], queues: {}, connectors: [], setEvents: () => {} });

/** Eine WebSocket-Verbindung fürs ganze Dashboard: Event-Feed, Queue- und Connector-Status. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [queues, setQueues] = useState<Record<string, QueueState>>({});
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const retry = useRef(0);

  useEffect(() => {
    api.get<EventLogEntry[]>('/api/events?limit=150').then(setEvents).catch(() => undefined);
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: number | undefined;

    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/dashboard`);
      ws.onopen = () => { retry.current = 0; setConnected(true); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data) as ServerToDashboard;
        if (msg.t === 'event') setEvents((e) => [msg.entry, ...e.filter((x) => x.id !== msg.entry.id)].slice(0, 300));
        else if (msg.t === 'event.update') setEvents((e) => e.map((x) => (x.id === msg.id ? { ...x, status: msg.status, reason: msg.reason } : x)));
        else if (msg.t === 'queue') setQueues((q) => ({ ...q, [msg.state.overlayId]: msg.state }));
        else if (msg.t === 'connectors') setConnectors(msg.status);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retry.current++));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, []);

  return <LiveCtx.Provider value={{ connected, events, queues, connectors, setEvents }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);
