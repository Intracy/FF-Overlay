import '../overlay/renderer.css';
import { CHAT_SAMPLES, chatVisible, PLATFORM_COLORS, sampleChatMessage, type ChatMessage, type ChatRemoval, type ChatRole, type ChatSettings } from '../../server/src/shared/chat';
import type { WidgetData } from '../../server/src/shared/widgets';
import { buildEffectTitle, startTextEffect, textEffect, type RunningFx } from '../overlay/textfx';
import { animate, h, loadFont, type Renderer, type ServerToWidget } from './util';

/*
 * Chat-Overlay: Nachrichten aus Twitch und YouTube (einzeln oder zusammen) als Browserquelle.
 * Gestaltung wie bei den Alerts: Schriften, Farben, Kontur, Schatten, Hintergründe, Ein-/Ausblend-Animationen
 * und optional ein Text-Effekt aus der Animation Library für den Namen.
 */

const PALETTE = ['#ff7ad9', '#4ff8ff', '#ffb703', '#7cfc00', '#ff6b6b', '#9373c5', '#5ab0ff', '#ffd166', '#06d6a0', '#f78c6b'];
const ROLE_ICON: Record<ChatRole, { glyph: string; color: string }> = {
  broadcaster: { glyph: '▶', color: '#e91916' },
  moderator: { glyph: '⚔', color: '#00ad03' },
  vip: { glyph: '♦', color: '#e005b9' },
  subscriber: { glyph: '★', color: '#9373c5' },
  member: { glyph: '★', color: '#2ba640' },
  verified: { glyph: '✓', color: '#7c7c8a' },
};

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function rgba(hex: string, opacity: number) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
}

function platformIcon(p: ChatMessage['platform']): HTMLElement {
  const el = h('span', `chat-plat chat-plat-${p}`);
  el.title = p === 'twitch' ? 'Twitch' : p === 'youtube' ? 'YouTube' : 'Test';
  // schlichte Symbole: Sprechblase (Twitch), Play-Dreieck (YouTube)
  el.innerHTML = p === 'youtube'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="5" fill="#ff0033"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>'
    : p === 'twitch'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#9146ff"/><path d="M7 6h11v7l-3 3h-3l-2 2v-2H7z" fill="#fff"/><path d="M11 9v3M14.5 9v3" stroke="#9146ff" stroke-width="1.6" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#9373c5"/><path d="M8 12h8M12 8v8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
  return el;
}

export function nameColor(s: ChatSettings, m: ChatMessage): string {
  if (s.nameColor === 'custom') return s.name.color;
  if (s.nameColor === 'platform') return PLATFORM_COLORS[m.platform];
  return m.user.color || PALETTE[hash(m.user.name) % PALETTE.length]!;
}

function textWithMentions(text: string): Node[] {
  return text.split(/(@[\p{L}\p{N}_]+)/u).filter(Boolean).map((t) => (t.startsWith('@') ? h('span', 'chat-mention', t) : document.createTextNode(t)));
}

interface Shown {
  msg: ChatMessage;
  el: HTMLElement;
  fx: RunningFx | null;
  timer?: number;
}

export function chatRenderer(root: HTMLElement): Renderer {
  const box = h('div', 'chat');
  root.replaceChildren(box);
  let settings: ChatSettings | null = null;
  /** gezeigte Nachrichten in Reihenfolge (älteste zuerst) */
  let shown: Shown[] = [];
  const pending = new Map<string, number>();
  let first = true;
  let demo: number | undefined;
  let lastSound = 0;
  let draft = false;

  const applyBox = (s: ChatSettings) => {
    loadFont(s.name.font, s.name.weight);
    loadFont(s.message.font, s.message.weight);
    box.className = `chat th-${s.theme} dir-${s.direction} al-${s.align}${s.inline ? ' inline' : ''}${s.shadow ? ' shadow' : ''}`;
    const st = box.style;
    st.setProperty('--name-font', `'${s.name.font.replace(/'/g, '')}', sans-serif`);
    st.setProperty('--name-size', `${s.name.size}px`);
    st.setProperty('--name-weight', String(s.name.weight));
    st.setProperty('--msg-font', `'${s.message.font.replace(/'/g, '')}', sans-serif`);
    st.setProperty('--msg-size', `${s.message.size}px`);
    st.setProperty('--msg-weight', String(s.message.weight));
    st.setProperty('--msg-color', s.message.color);
    st.setProperty('--hl', s.highlightColor);
    st.setProperty('--bg', rgba(s.background.color, s.background.opacity));
    st.setProperty('--bg-solid', s.background.color);
    st.setProperty('--radius', `${s.background.radius}px`);
    st.setProperty('--pad', `${s.background.padding}px`);
    st.setProperty('--gap', `${s.background.gap}px`);
    st.setProperty('--emote', `${s.emoteSize / 100}em`);
    st.setProperty('--stroke', s.strokeWidth > 0 ? `${s.strokeWidth}px ${s.strokeColor}` : '0 transparent');
  };

  const build = (s: ChatSettings, m: ChatMessage): { el: HTMLElement; fx: RunningFx | null; start: () => RunningFx | null } => {
    const color = nameColor(s, m);
    const el = h('div', `chat-msg chat-${m.platform}${m.amount ? ' chat-hl' : ''}${m.action ? ' chat-action' : ''}`);
    el.dataset.id = m.id;
    el.style.setProperty('--name', color);
    el.style.setProperty('--plat', PLATFORM_COLORS[m.platform]);
    if (s.showAvatar) {
      const av = h('span', 'chat-avatar');
      if (m.user.avatar && /^https:\/\//.test(m.user.avatar)) {
        const img = document.createElement('img');
        img.src = m.user.avatar;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        av.appendChild(img);
      } else av.textContent = (m.user.name[0] ?? '?').toUpperCase();
      el.appendChild(av);
    }
    const body = h('div', 'chat-body');
    const head = h('div', 'chat-head');
    if (s.showPlatform) head.appendChild(platformIcon(m.platform));
    if (s.showBadges) {
      for (const b of m.badges) {
        if (b.url && /^https:\/\//.test(b.url)) {
          const img = document.createElement('img');
          img.className = 'chat-badge';
          img.src = b.url;
          img.alt = b.title;
          img.title = b.title;
          img.onerror = () => img.remove();
          head.appendChild(img);
        } else {
          const role = (b.id.split('/')[0] ?? '') as ChatRole;
          const icon = ROLE_ICON[role];
          if (!icon) continue;
          const chip = h('span', 'chat-role', icon.glyph);
          chip.title = b.title;
          chip.style.background = icon.color;
          head.appendChild(chip);
        }
      }
    }
    const name = h('span', 'chat-name');
    const effect = textEffect(s.nameEffect);
    if (effect) {
      name.appendChild(buildEffectTitle(effect, [{ text: m.user.name, highlight: false }], { color, highlightColor: s.highlightColor, colors: s.effectColors, letterAnimation: 'none' }));
    } else name.textContent = m.user.name;
    head.appendChild(name);
    if (s.inline) head.appendChild(h('span', 'chat-sep', m.action ? ' ' : ':'));
    body.appendChild(head);

    const text = h('div', 'chat-text');
    for (const p of m.parts) {
      if ('emote' in p) {
        const img = document.createElement('img');
        img.className = 'chat-emote';
        img.src = p.url;
        img.alt = p.name;
        img.title = p.name;
        // Emote nicht ladbar: Namen als Text zeigen
        img.onerror = () => img.replaceWith(document.createTextNode(p.name));
        text.appendChild(img);
      } else text.append(...textWithMentions(p.text));
    }
    if (m.amount) {
      const amount = h('span', 'chat-amount', m.amount);
      if (s.inline) text.prepend(amount, document.createTextNode(' '));
      else body.appendChild(amount);
    }
    body.appendChild(text);
    el.appendChild(body);
    return { el, fx: null, start: () => (effect ? startTextEffect(name, effect, m.user.name, s.effectSpeed) : null) };
  };

  const drop = async (item: Shown, animated: boolean) => {
    shown = shown.filter((x) => x !== item);
    clearTimeout(item.timer);
    if (animated && settings) await animate(item.el, settings.animOut, settings.speedMs);
    item.fx?.stop();
    item.el.remove();
  };

  const place = (el: HTMLElement) => {
    // „up“: neue Nachrichten unten (DOM-Reihenfolge = zeitlich), „down“: neue oben
    if (settings?.direction === 'down') box.prepend(el);
    else box.append(el);
  };

  const show = (m: ChatMessage, animated: boolean) => {
    const s = settings;
    if (!s || shown.some((x) => x.msg.id === m.id)) return;
    const { el, start } = build(s, m);
    place(el);
    const item: Shown = { msg: m, el, fx: null };
    shown.push(item);
    item.fx = start();
    if (animated) void animate(el, s.animIn, s.speedMs);
    if (s.hideAfter > 0) item.timer = window.setTimeout(() => void drop(item, true), s.hideAfter * 1000);
    while (shown.length > s.maxMessages) void drop(shown[0]!, false);
    if (animated && s.sound.url && Date.now() - lastSound > 400) {
      lastSound = Date.now();
      const a = new Audio(s.sound.url);
      a.volume = s.sound.volume;
      void a.play().catch(() => undefined);
    }
  };

  const receive = (m: ChatMessage) => {
    const s = settings;
    if (!s || !chatVisible(s, m)) return;
    if (s.delay > 0) {
      pending.set(m.id, window.setTimeout(() => {
        pending.delete(m.id);
        show(m, true);
      }, s.delay * 1000));
    } else show(m, true);
  };

  /** Alles neu zeichnen (neue Einstellungen), ohne Animation */
  const rerender = () => {
    const s = settings;
    if (!s) return;
    const msgs = shown.map((x) => x.msg).filter((m) => chatVisible(s, m));
    for (const x of shown) {
      clearTimeout(x.timer);
      x.fx?.stop();
    }
    shown = [];
    box.replaceChildren();
    applyBox(s);
    for (const m of msgs.slice(-s.maxMessages)) show(m, false);
  };

  const remove = (r: ChatRemoval) => {
    const hit = (m: ChatMessage) => (r.all ? !r.platform || m.platform === r.platform : !!r.ids?.includes(m.id) || (!!r.userId && m.user.id === r.userId && (!r.platform || m.platform === r.platform)));
    for (const item of [...shown]) if (hit(item.msg)) void drop(item, true);
    for (const [id, t] of pending) if (r.all || r.ids?.includes(id)) {
      clearTimeout(t);
      pending.delete(id);
    }
  };

  // Vorschau im Dashboard: Entwurf der Einstellungen live übernehmen (ohne Speichern)
  const onDraft = (ev: MessageEvent) => {
    if (ev.origin !== location.origin || ev.data?.t !== 'ffo-chat-draft') return;
    draft = true;
    settings = ev.data.settings as ChatSettings;
    rerender();
  };
  window.addEventListener('message', onDraft);

  return {
    update(w, d) {
      const data = d as Extract<WidgetData, { type: 'chat' }>;
      if (!draft) settings = w.settings as ChatSettings;
      if (first) {
        applyBox(settings!);
        for (const m of data.messages) if (chatVisible(settings!, m)) show(m, false);
        first = false;
        // Beispieldaten (&preview=1): laufend neue Nachrichten, damit Animationen sichtbar sind
        if (data.preview && !demo) {
          let i = data.messages.length;
          demo = window.setInterval(() => receive(sampleChatMessage(i++ % CHAT_SAMPLES.length)), 2600);
        }
      } else rerender();
    },
    message(msg: ServerToWidget) {
      if (msg.t === 'chat.message') receive(msg.message);
      else if (msg.t === 'chat.remove') remove(msg.removal);
    },
    dispose() {
      clearInterval(demo);
      window.removeEventListener('message', onDraft);
      for (const t of pending.values()) clearTimeout(t);
      for (const x of shown) {
        clearTimeout(x.timer);
        x.fx?.stop();
      }
    },
  };
}
