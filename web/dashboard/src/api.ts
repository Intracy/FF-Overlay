import type {
  AlertTemplate, ConnectorStatus, EventLogEntry, EventType, GlobalSettings, OverlayInfo, QueueState, Rule,
} from '../../../server/src/shared/types';

export type { AlertTemplate, ConnectorStatus, EventLogEntry, EventType, GlobalSettings, OverlayInfo, QueueState, Rule };
export type Overlay = OverlayInfo & { url: string };
export interface MediaAsset { id: string; name: string; kind: 'image' | 'video' | 'audio'; url: string; source: 'upload' | 'giphy'; giphyId?: string; createdAt: string }
export interface Connection { id: string; platform: string; label: string; enabled: boolean; data: Record<string, any> }
export interface GiphyItem { id: string; title: string; preview: string; url: string; width: number; height: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  if (res.status === 401 && !url.startsWith('/api/auth')) {
    window.dispatchEvent(new Event('ffo:unauthorized'));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const issues = data?.issues?.map((i: { path: unknown[]; message: string }) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ApiError(res.status, [data?.error ?? res.statusText, issues].filter(Boolean).join(' – '));
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const EVENT_TYPES: Array<{ type: EventType; subtype?: string; label: string; icon: string }> = [
  { type: 'follow', label: 'Follow', icon: '❤' },
  { type: 'subscription', subtype: 'sub', label: 'Sub', icon: '★' },
  { type: 'subscription', subtype: 'resub', label: 'Resub', icon: '★' },
  { type: 'subscription', subtype: 'gift', label: 'Gift-Subs', icon: '🎁' },
  { type: 'cheer', label: 'Cheer / Bits', icon: '◆' },
  { type: 'raid', label: 'Raid', icon: '⚑' },
  { type: 'redemption', label: 'Kanalpunkte', icon: '●' },
  { type: 'power_up', label: 'Power-Up', icon: '⚡' },
  { type: 'charity', label: 'Charity-Spende', icon: '♥' },
  { type: 'donation', label: 'Spende', icon: '€' },
  { type: 'custom', label: 'Eigenes Event', icon: '✱' },
];

export function typeLabel(type: string, subtype?: string): string {
  return EVENT_TYPES.find((t) => t.type === type && (!t.subtype || t.subtype === subtype))?.label ?? (subtype ? `${type} · ${subtype}` : type);
}

export function typeIcon(type: string): string {
  return EVENT_TYPES.find((t) => t.type === type)?.icon ?? '•';
}
