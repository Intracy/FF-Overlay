import './widget.css';
import type {
  BossSettings, CreditsSettings, EventListSettings, GoalSettings, LabelSettings, ListEntry, ServerToWidget, TextStyle, TickerSettings,
  TimerSettings, Widget, WidgetData,
} from '../../server/src/shared/widgets';

/*
 * Widget-Browserquelle für OBS & Co.
 * URL: /widget/?id=<widgetId>&key=<geheimerKey>   (&debug=1 zeigt den Verbindungsstatus)
 * Das Backend schickt bei jeder Änderung einen vollständigen Snapshot; diese Seite zeichnet nur.
 */

type PubWidget = Omit<Widget, 'key' | 'state'>;
type Snap<T extends WidgetData['type']> = Extract<WidgetData, { type: T }>;

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const key = params.get('key') ?? '';
const root = document.getElementById('root')!;
const statusEl = document.getElementById('status')!;
if (params.get('debug') === '1') document.body.classList.add('debug');

// ---------- Hilfen ----------

const loadedFonts = new Set<string>();
function loadFont(family: string, weight: number) {
  const fam = family.trim();
  if (!fam || /^(sans-serif|serif|monospace|system-ui)$/i.test(fam) || loadedFonts.has(`${fam}:${weight}`)) return;
  loadedFonts.add(`${fam}:${weight}`);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@${weight}&display=block`;
  document.head.appendChild(link);
}

function applyText(el: HTMLElement, t: TextStyle) {
  loadFont(t.font, t.weight);
  el.classList.add('w-text');
  el.style.setProperty('--font', `'${t.font.replace(/'/g, '')}'`);
  el.style.setProperty('--size', `${t.size}px`);
  el.style.setProperty('--weight', String(t.weight));
  el.style.setProperty('--color', t.color);
}

function h(tag: string, cls = '', text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function animate(el: HTMLElement, name: string, ms: number): Promise<void> {
  if (!name) return Promise.resolve();
  return new Promise((resolve) => {
    el.style.setProperty('--animate-duration', `${ms}ms`);
    el.classList.add('animate__animated', `animate__${name}`);
    const done = () => {
      el.classList.remove(`animate__${name}`);
      resolve();
    };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, ms + 200);
  });
}

const fmtNumber = (v: number, currency = '') =>
  currency ? new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(v) : new Intl.NumberFormat('de-DE').format(v);

// ---------- Renderer je Typ ----------

interface Renderer {
  update(w: PubWidget, d: WidgetData): void;
  message?(m: ServerToWidget): void;
  dispose(): void;
}

const ICONS: Record<string, string> = {
  follow: '♥', sub: '★', resub: '★', gift: '🎁', cheer: '◆', power_up: '⚡', raid: '⚑', redemption: '●', charity: '✚', donation: '€', custom: '✦',
};

function eventList(): Renderer {
  const box = h('div', 'el');
  root.replaceChildren(box);
  const shown = new Map<string, HTMLElement>();
  const timers = new Map<string, number>();
  /** Einträge, die nicht (mehr) gezeigt werden: alte Events ohne Verlauf und ausgeblendete */
  const ignored = new Set<string>();
  let first = true;

  const remove = async (eid: string, s: EventListSettings, faded = false) => {
    if (faded) ignored.add(eid);
    const el = shown.get(eid);
    if (!el) return;
    shown.delete(eid);
    clearTimeout(timers.get(eid));
    await animate(el, s.animOut, s.speedMs);
    el.remove();
  };

  return {
    update(w, d) {
      const s = w.settings as EventListSettings;
      const { entries } = d as Snap<'event_list'>;
      box.className = `el st-${s.style}${s.flipX ? ' flip-x' : ''}${s.flipY ? ' flip-y' : ''}`;
      box.style.setProperty('--theme', s.themeColor);
      applyText(box, s.text);
      if (first && !s.keepHistory) for (const e of entries) ignored.add(e.id);
      const visible = entries.filter((e) => !ignored.has(e.id)).slice(0, s.maxEvents);
      const ids = new Set(visible.map((e) => e.id));
      for (const eid of [...shown.keys()]) if (!ids.has(eid)) void remove(eid, s);
      // älteste zuerst einfügen, damit die neueste oben landet
      for (const e of [...visible].reverse()) {
        if (shown.has(e.id)) continue;
        const item = makeItem(e);
        box.prepend(item);
        shown.set(e.id, item);
        if (!first) void animate(item, s.animIn, s.speedMs);
        if (s.fadeTime > 0) timers.set(e.id, window.setTimeout(() => void remove(e.id, s, true), s.fadeTime * 1000));
      }
      // Reihenfolge an Server-Reihenfolge angleichen
      for (const e of [...visible].reverse()) {
        const el = shown.get(e.id);
        if (el) box.prepend(el);
      }
      first = false;
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
    },
  };

  function makeItem(e: ListEntry) {
    const item = h('div', 'el-item');
    item.append(h('span', 'el-icon', ICONS[e.key] ?? '•'), h('span', 'el-name', e.name), h('span', 'el-detail', e.detail));
    return item;
  }
}

function goal(): Renderer {
  const box = h('div', 'goal');
  const title = h('div', 'goal-title');
  const amount = h('div', 'goal-amount');
  const head = h('div', 'goal-head');
  head.append(title, amount);
  const bar = h('div', 'goal-bar');
  const fill = h('div', 'goal-fill');
  const barText = h('div', 'goal-bar-text');
  bar.append(fill, barText);
  const foot = h('div', 'goal-foot');
  const left = h('span');
  const right = h('span');
  foot.append(left, right);
  box.append(head, bar, foot);
  root.replaceChildren(box);
  let endTimer = 0;
  return {
    update(w, d) {
      const s = w.settings as GoalSettings;
      const g = d as Snap<'goal'>;
      box.className = `goal w-shadow ${s.layout}`;
      applyText(box, s.text);
      box.style.setProperty('--bar', s.barColor);
      box.style.setProperty('--bg', s.barBgColor);
      box.style.setProperty('--thick', `${s.barThickness}px`);
      box.style.setProperty('--bartext', s.barTextColor);
      title.textContent = s.title;
      const cur = fmtNumber(g.current, g.currency);
      const tgt = fmtNumber(g.target, g.currency);
      amount.textContent = `${cur} / ${tgt}`;
      if (s.layout === 'condensed') barText.replaceChildren(h('span', '', s.title), h('span', '', `${cur} / ${tgt}`));
      else barText.textContent = `${g.percent.toLocaleString('de-DE')} %`;
      requestAnimationFrame(() => (fill.style.width = `${g.percent}%`));
      left.textContent = g.percent >= 100 ? 'Ziel erreicht! 🎉' : '';
      const tick = () => {
        if (!g.endsAt) return (right.textContent = '');
        const ms = new Date(g.endsAt).getTime() - Date.now();
        if (ms <= 0) return (right.textContent = 'Beendet');
        const days = Math.floor(ms / 864e5);
        const hrs = Math.floor((ms % 864e5) / 36e5);
        const min = Math.floor((ms % 36e5) / 6e4);
        right.textContent = days > 0 ? `noch ${days} T ${hrs} Std` : `noch ${hrs} Std ${min} Min`;
      };
      tick();
      clearInterval(endTimer);
      endTimer = window.setInterval(tick, 30_000);
    },
    dispose() {
      clearInterval(endTimer);
    },
  };
}

function label(): Renderer {
  const box = h('div', 'label');
  const span = h('span');
  box.append(span);
  root.replaceChildren(box);
  return {
    update(w, d) {
      const s = w.settings as LabelSettings;
      box.className = `label al-${s.align}${s.shadow ? ' w-shadow' : ''}`;
      applyText(box, s.text);
      const text = (d as Snap<'label'>).text;
      if (span.textContent !== text) {
        span.textContent = text;
        void animate(span, 'fadeIn', 500);
      }
    },
    dispose() {},
  };
}

function timer(): Renderer {
  const box = h('div', 'timer');
  const value = h('div', 'timer-value');
  const added = h('div', 'timer-added');
  box.append(value, added);
  root.replaceChildren(box);
  let snap: Snap<'timer'> | null = null;
  let settings: TimerSettings | null = null;
  let offset = 0; // Serveruhr - lokale Uhr
  let lastAddedAt = 0;
  const fmt = (ms: number) => {
    const t = Math.ceil(ms / 1000);
    const hh = Math.floor(t / 3600);
    const mm = Math.floor((t % 3600) / 60);
    const ss = t % 60;
    const p = (n: number) => String(n).padStart(2, '0');
    return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
  };
  const render = () => {
    if (!snap || !settings) return;
    const st = snap.state;
    const remaining = st.running ? Math.max(0, st.endsAt - (Date.now() + offset)) : st.remaining;
    value.textContent = st.running && remaining <= 0 ? settings.endText : fmt(remaining);
    box.classList.toggle('paused', !st.running);
  };
  const iv = window.setInterval(render, 200);
  return {
    update(w, d) {
      settings = w.settings as TimerSettings;
      snap = d as Snap<'timer'>;
      offset = snap.serverNow - Date.now();
      box.className = `timer${settings.shadow ? ' w-shadow' : ''}`;
      applyText(box, settings.text);
      const la = snap.lastAdded;
      if (settings.showAdded && la && la.at !== lastAddedAt && lastAddedAt !== 0) {
        added.textContent = `${la.seconds >= 0 ? '+' : '−'}${fmt(Math.abs(la.seconds) * 1000)} · ${la.reason}`;
        added.classList.remove('show');
        void added.offsetWidth;
        added.classList.add('show');
      }
      lastAddedAt = la?.at ?? -1;
      render();
    },
    dispose() {
      clearInterval(iv);
    },
  };
}

function boss(): Renderer {
  const box = h('div', 'boss w-shadow');
  const head = h('div', 'boss-head');
  const name = h('div', 'boss-name');
  const tag = h('div', '', 'Stream-Boss');
  head.append(name, tag);
  const bar = h('div', 'boss-bar');
  const fill = h('div', 'boss-fill');
  const hp = h('div', 'boss-hp');
  bar.append(fill, hp);
  box.append(head, bar);
  root.replaceChildren(box);
  let prevName = '';
  let prevAt = 0;
  return {
    update(w, d) {
      const s = w.settings as BossSettings;
      const { state } = d as Snap<'boss'>;
      applyText(box, s.text);
      box.style.setProperty('--bar', s.barColor);
      box.style.setProperty('--bg', s.barBgColor);
      box.style.setProperty('--bartext', s.barTextColor);
      const pct = state.maxHp > 0 ? Math.max(0, Math.min(100, (state.hp / state.maxHp) * 100)) : 0;
      const apply = () => {
        name.textContent = state.name;
        fill.style.width = `${pct}%`;
        hp.textContent = `${state.hp.toLocaleString('de-DE')} / ${state.maxHp.toLocaleString('de-DE')} HP`;
      };
      const newBoss = prevName && prevName !== state.name;
      if (newBoss) {
        void animate(name, s.killAnimation, 1200).then(() => {
          apply();
          void animate(name, 'bounceIn', 800);
        });
      } else apply();
      const ld = state.lastDamage;
      if (ld && prevAt && ld.at !== prevAt) {
        const dmg = h('div', `boss-dmg${ld.amount < 0 ? ' heal' : ''}`, `${ld.amount < 0 ? '+' : '−'}${Math.abs(ld.amount)} · ${ld.by}`);
        bar.append(dmg);
        setTimeout(() => dmg.remove(), 1700);
      }
      prevName = state.name;
      prevAt = ld?.at ?? -1;
    },
    dispose() {},
  };
}

function credits(): Renderer {
  const box = h('div', 'credits');
  const stage = h('div', 'credits-stage');
  box.append(stage);
  root.replaceChildren(box);
  let settings: CreditsSettings | null = null;
  let data: Snap<'credits'> | null = null;
  let anim: Animation | null = null;
  let loopTimer = 0;
  let started = false;

  const roll = () => {
    if (!settings || !data) return;
    const s = settings;
    clearTimeout(loopTimer);
    anim?.cancel();
    const r = h('div', 'credits-roll w-shadow');
    r.append(h('h1', '', s.title));
    if (s.subtitle) r.append(h('div', 'sub', s.subtitle));
    for (const sec of data.sections) {
      r.append(h('h2', '', sec.heading));
      for (const line of sec.lines) r.append(h('p', '', line));
    }
    if (!data.sections.length) r.append(h('p', 'sub', 'Danke an alle, die heute dabei waren!'));
    stage.replaceChildren(r);
    const H = window.innerHeight;
    const rh = r.offsetHeight;
    const distance = H + rh;
    const ms = s.mode === 'speed' ? (distance / s.speed) * 1000 : s.duration * 1000;
    const tilt = s.theme === 'crawl' ? ' rotateX(25deg)' : '';
    anim = r.animate([{ transform: `translate(-50%, ${H}px)${tilt}` }, { transform: `translate(-50%, ${-rh}px)${tilt}` }], { duration: ms, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => {
      if (s.loop) loopTimer = window.setTimeout(roll, s.loopDelay * 1000);
    };
  };

  // OBS meldet, wenn die Quelle sichtbar wird (Szenenwechsel)
  const onVisible = (ev: Event) => {
    const visible = (ev as CustomEvent<{ visible: boolean }>).detail?.visible;
    if (visible && settings?.playOnVisible) roll();
  };
  window.addEventListener('obsSourceVisibleChanged', onVisible);

  return {
    update(w, d) {
      settings = w.settings as CreditsSettings;
      data = d as Snap<'credits'>;
      box.className = `credits ${settings.theme}`;
      applyText(box, settings.text);
      box.style.setProperty('--heading', settings.headingColor);
      if (!started) {
        started = true;
        if (settings.playOnLoad || params.get('play') === '1') roll();
      }
    },
    message(m) {
      if (m.t === 'credits.roll') roll();
    },
    dispose() {
      clearTimeout(loopTimer);
      anim?.cancel();
      window.removeEventListener('obsSourceVisibleChanged', onVisible);
    },
  };
}

function ticker(): Renderer {
  const box = h('div', 'ticker w-shadow');
  root.replaceChildren(box);
  let sig = '';
  return {
    update(w, d) {
      const s = w.settings as TickerSettings;
      const { items } = d as Snap<'ticker'>;
      applyText(box, s.text);
      box.style.setProperty('--amount', s.amountColor);
      const nextSig = JSON.stringify([s, items]);
      if (nextSig === sig) return;
      sig = nextSig;
      const track = h('div', 'ticker-track');
      const build = () => {
        const frag = document.createDocumentFragment();
        const list = items.length ? items : [{ id: '-', name: '', amount: '', message: 'Noch keine Unterstützer – sei die/der Erste!', type: '' }];
        for (const it of list) {
          const span = h('span', 'ticker-item');
          // Format in Text- und Betragsteile zerlegen (kein HTML aus Nutzerdaten)
          const fmt = it.id === '-' ? '{message}' : s.format;
          for (const part of fmt.split(/(\{[a-z]+\})/g)) {
            const k = part.match(/^\{([a-z]+)\}$/)?.[1];
            if (!k) span.append(document.createTextNode(part));
            else if (k === 'amount') span.append(h('span', 'ticker-amount', it.amount));
            else span.append(document.createTextNode((it as Record<string, string>)[k] ?? part));
          }
          frag.append(span, h('span', 'ticker-sep', s.separator));
        }
        return frag;
      };
      // zweimal hintereinander für nahtloses Laufband
      track.append(build(), build());
      box.replaceChildren(track);
      requestAnimationFrame(() => {
        const half = track.scrollWidth / 2;
        track.style.setProperty('--dur', `${Math.max(5, half / s.speed)}s`);
      });
    },
    dispose() {},
  };
}

const FACTORIES: Record<WidgetData['type'], () => Renderer> = {
  event_list: eventList, goal, label, timer, boss, credits, ticker,
};

// ---------- Verbindung ----------

let renderer: Renderer | null = null;
let rendererType = '';
let retry = 0;
let ws: WebSocket | null = null;
let pingTimer: number | undefined;

function connect() {
  if (!id || !key) {
    statusEl.textContent = 'Fehler: id und key fehlen in der URL';
    document.body.classList.add('debug');
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/widget/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`);
  statusEl.textContent = 'verbinde …';
  ws.onopen = () => {
    retry = 0;
    clearInterval(pingTimer);
    pingTimer = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 20_000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerToWidget | { t: 'pong' };
    if (msg.t === 'snapshot') {
      statusEl.textContent = `verbunden: ${msg.widget.name}`;
      if (rendererType !== msg.data.type) {
        renderer?.dispose();
        renderer = FACTORIES[msg.data.type]();
        rendererType = msg.data.type;
      }
      renderer!.update(msg.widget, msg.data);
    } else if (msg.t === 'reload') location.reload();
    else if (msg.t !== 'pong') renderer?.message?.(msg);
  };
  ws.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ev.code === 4001) {
      statusEl.textContent = `Abgewiesen: ${ev.reason}`;
      document.body.classList.add('debug');
      return;
    }
    statusEl.textContent = 'getrennt – neuer Versuch …';
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    setTimeout(connect, delay);
  };
}

connect();
