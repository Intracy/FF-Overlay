import { nanoid } from 'nanoid';
import type { DeviceStart, DevicePoll } from './twitch/auth.js';

/*
 * Laufende Gerätecode-Anmeldungen (Twitch, YouTube). Das Backend fragt im Hintergrund nach,
 * das Dashboard zeigt Code + Link und fragt den Status ab. Nichts davon wird gespeichert.
 */

export type FlowStatus = 'pending' | 'done' | 'error';

export interface DeviceFlow {
  id: string;
  provider: 'twitch' | 'youtube';
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  status: FlowStatus;
  error?: string;
  label?: string;
}

interface Running<T> {
  flow: DeviceFlow;
  deviceCode: string;
  interval: number;
  timer: NodeJS.Timeout | null;
  poll: (deviceCode: string) => Promise<DevicePoll<T>>;
  finish: (tokens: T) => Promise<string>;
}

const flows = new Map<string, Running<unknown>>();

export function startFlow<T>(
  provider: DeviceFlow['provider'],
  start: DeviceStart,
  poll: (deviceCode: string) => Promise<DevicePoll<T>>,
  /** speichert die Verbindung und gibt deren Bezeichnung zurück */
  finish: (tokens: T) => Promise<string>,
): DeviceFlow {
  // alte Abläufe aufräumen
  for (const [id, r] of flows) if (r.flow.expiresAt < Date.now() - 10 * 60_000) cancelFlow(id);
  const flow: DeviceFlow = {
    id: nanoid(12), provider, userCode: start.userCode, verificationUri: start.verificationUri,
    expiresAt: Date.now() + start.expiresIn * 1000, status: 'pending',
  };
  const run: Running<T> = { flow, deviceCode: start.deviceCode, interval: Math.max(2, start.interval), timer: null, poll, finish };
  flows.set(flow.id, run as Running<unknown>);
  schedule(run);
  return flow;
}

function schedule<T>(run: Running<T>) {
  run.timer = setTimeout(() => void step(run), run.interval * 1000);
}

async function step<T>(run: Running<T>) {
  const f = run.flow;
  if (f.status !== 'pending') return;
  if (Date.now() > f.expiresAt) {
    f.status = 'error';
    f.error = 'Code abgelaufen – bitte neu starten';
    return;
  }
  try {
    const r = await run.poll(run.deviceCode);
    if (r.status === 'pending') return schedule(run);
    if (r.status === 'slow_down') {
      run.interval += 5;
      return schedule(run);
    }
    if (r.status === 'error') {
      f.status = 'error';
      f.error = r.error;
      return;
    }
    f.label = await run.finish(r.tokens);
    f.status = 'done';
  } catch (err) {
    f.status = 'error';
    f.error = err instanceof Error ? err.message : String(err);
  }
}

export const getFlow = (id: string) => flows.get(id)?.flow;

export function cancelFlow(id: string) {
  const r = flows.get(id);
  if (r?.timer) clearTimeout(r.timer);
  flows.delete(id);
}
