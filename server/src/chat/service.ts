import type { DB } from '../db.js';
import * as store from '../db.js';
import type { Hub } from '../ws/hub.js';
import { DEFAULT_BAD_WORDS } from '../lib/badwords.js';
import type { GlobalSettings } from '../shared/types.js';
import type { ChatMessage, ChatRemoval } from '../shared/chat.js';

const KEEP = 200;

/**
 * Chat-Nachrichten aus Twitch und YouTube: kurzer Verlauf im Speicher (nicht in der Datenbank),
 * globale Filter (Sperrliste, Schimpfwörter) und Verteilung an alle Chat-Overlays und das Dashboard.
 */
export class ChatService {
  private messages: ChatMessage[] = [];

  constructor(private db: DB, private hub: Hub) {}

  recent(limit = 50): ChatMessage[] {
    return this.messages.slice(-limit);
  }

  ingest(raw: ChatMessage) {
    if (this.messages.some((m) => m.id === raw.id)) return;
    const message = filterChat(raw, store.settings.global(this.db));
    if (!message) return;
    this.messages.push(message);
    if (this.messages.length > KEEP) this.messages = this.messages.slice(-KEEP);
    this.send({ t: 'chat.message', message });
    this.hub.broadcastDashboard({ t: 'chat', message });
  }

  remove(removal: ChatRemoval) {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => !matches(m, removal));
    this.send({ t: 'chat.remove', removal });
    this.hub.broadcastDashboard({ t: 'chat.remove', removal });
    return before - this.messages.length;
  }

  private send(msg: { t: 'chat.message'; message: ChatMessage } | { t: 'chat.remove'; removal: ChatRemoval }) {
    for (const w of store.widgets.list(this.db)) {
      if (w.type !== 'chat') continue;
      this.hub.sendWidget(w.id, msg);
      this.hub.sendWidget(`${w.id}:preview`, msg);
    }
  }
}

export function matches(m: ChatMessage, r: ChatRemoval): boolean {
  if (r.all) return !r.platform || m.platform === r.platform;
  if (r.ids?.includes(m.id)) return true;
  if (r.userId && m.user.id === r.userId && (!r.platform || m.platform === r.platform)) return true;
  return false;
}

/** Sperrliste und Schimpfwort-Filter wie bei den Alerts. null = Nachricht nicht zeigen. */
export function filterChat(m: ChatMessage, s: GlobalSettings): ChatMessage | null {
  const name = m.user.name.toLowerCase();
  if (s.blockedUsers.some((u) => u.trim().toLowerCase() === name)) return null;
  const words = [...s.badWords, ...(s.useDefaultBadWords ? DEFAULT_BAD_WORDS : [])].map((w) => w.trim()).filter(Boolean);
  if (!words.length) return m;
  const alt = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = () => new RegExp(`(?<!\\p{L})(?:${alt})(?!\\p{L})`, 'giu');
  const hit = re().test(m.text);
  const next: ChatMessage = { ...m, user: { ...m.user } };
  if (s.anonymizeNames && re().test(next.user.name)) next.user.name = 'Anonym';
  if (!hit) return next;
  if (s.badWordMode === 'hide') return null;
  next.parts = m.parts.map((p) => ('text' in p ? { text: p.text.replace(re(), (x) => '*'.repeat(x.length)) } : p));
  next.text = m.text.replace(re(), (x) => '*'.repeat(x.length));
  return next;
}
