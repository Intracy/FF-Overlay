import type {
  Align, BpAllSettings, BpCommentSettings, BpData, BpDonation, BpFeedSettings, BpLastSettings, BpLeaderboardSettings, BpLogosSettings,
  BpMilestonesSettings, BpPollSettings, BpProgressSettings, BpTopSettings, BpTotalSettings, BpWidgetType, TextStyle,
} from '../../server/src/shared/widgets';
import { animate, font, h, money, type PubWidget, type Renderer } from './util';

/*
 * Renderer für die betterplace-Widgets (nach dem Vorbild der betterplace-Livestream-Alerts).
 * Alle Texte aus Spenden werden als Text gesetzt (kein HTML aus Nutzerdaten).
 */

type Data = BpData;
const dataOf = (d: unknown): BpData => (d as { bp: BpData }).bp;
const amountText = (d: BpDonation) => (d.amount != null ? money(d.amount) : '');

function base(root: HTMLElement, cls: string) {
  const box = h('div', `bp ${cls}`);
  root.replaceChildren(box);
  return box;
}

function alignBox(el: HTMLElement, align: Align) {
  el.style.textAlign = align;
  el.style.alignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
}

function headline(text: string, t: TextStyle) {
  return text ? font(h('div', 'bp-headline', text), t) : null;
}

/** Wechselt Inhalte nacheinander (Top-Spenden, Kommentare, Logos) */
function rotator() {
  let timer = 0;
  let index = 0;
  let sig = '';
  return {
    run(key: string, count: number, seconds: number, show: (i: number, first: boolean) => void) {
      if (key === sig) return;
      sig = key;
      clearInterval(timer);
      index = 0;
      if (!count) return show(-1, true);
      show(0, true);
      if (count > 1) timer = window.setInterval(() => show((index = (index + 1) % count), false), Math.max(1, seconds) * 1000);
    },
    dispose() {
      clearInterval(timer);
    },
  };
}

// ---------- All-Inclusive ----------

const THEME_FONTS: Record<BpAllSettings['theme'], { head: TextStyle; data: TextStyle }> = {
  standard: { head: { font: 'Fira Sans', size: 16, weight: 700, color: '#ffffff' }, data: { font: 'Fira Sans', size: 16, weight: 700, color: '#ffffff' } },
  pixel: { head: { font: 'Press Start 2P', size: 11, weight: 400, color: '#ffffff' }, data: { font: 'Press Start 2P', size: 13, weight: 400, color: '#ffe066' } },
  sakura: { head: { font: 'Quicksand', size: 16, weight: 700, color: '#7a2848' }, data: { font: 'Quicksand', size: 18, weight: 700, color: '#4a1029' } },
  pride: { head: { font: 'Fira Sans', size: 16, weight: 700, color: '#ffffff' }, data: { font: 'Fira Sans', size: 18, weight: 800, color: '#ffffff' } },
};

function bpAll(root: HTMLElement): Renderer {
  const box = base(root, 'bp-all');
  return {
    update(w: PubWidget, d) {
      const s = w.settings as BpAllSettings;
      const b = dataOf(d);
      const f = s.designMode === 'default' ? THEME_FONTS[s.theme] : { head: s.headline, data: s.data };
      box.className = `bp bp-all theme-${s.theme}`;
      const cell = (label: string, lines: string[]) => {
        const c = h('div', 'bp-all-cell');
        c.append(font(h('div', 'bp-all-label', label), f.head));
        for (const l of lines) c.append(font(h('div', 'bp-all-value', l || '–'), f.data));
        return c;
      };
      const last = b.last;
      const top = b.top[0];
      box.replaceChildren(
        cell(s.labels.total, [money(b.total)]),
        cell(s.labels.last, last ? [last.name, amountText(last)] : ['–']),
        cell(s.labels.top, top ? [top.name, amountText(top)] : ['–']),
      );
    },
    dispose() {},
  };
}

// ---------- Spendenstand ----------

function bpTotal(root: HTMLElement): Renderer {
  const box = base(root, 'bp-stack');
  let prev = '';
  return {
    update(w, d) {
      const s = w.settings as BpTotalSettings;
      const b = dataOf(d);
      alignBox(box, s.align);
      const value = font(h('span', 'bp-value', money(b.total)), s.data);
      if (s.lines === 'single') {
        const line = h('div', 'bp-line');
        if (s.headlineText) line.append(font(h('span', '', `${s.headlineText}: `), s.headline));
        line.append(value);
        box.replaceChildren(line);
      } else box.replaceChildren(...[headline(s.headlineText, s.headline), value].filter((x): x is HTMLElement => !!x));
      if (prev && prev !== value.textContent) void animate(value, 'heartBeat', 900);
      prev = value.textContent ?? '';
    },
    dispose() {},
  };
}

// ---------- Letzte Spende ----------

function donationBlock(x: BpDonation, s: { name: TextStyle; amount: TextStyle; comment: TextStyle }, opts: { single: boolean; comment: boolean }) {
  const wrap = h('div', opts.single ? 'bp-line' : 'bp-donation');
  wrap.append(font(h('span', 'bp-name', x.name), s.name));
  const amt = amountText(x);
  if (amt) wrap.append(font(h('span', 'bp-amount', opts.single ? ` ${amt}` : amt), s.amount));
  if (opts.comment && x.comment) wrap.append(font(h(opts.single ? 'span' : 'div', 'bp-comment', opts.single ? ` – ${x.comment}` : x.comment), s.comment));
  return wrap;
}

function bpLast(root: HTMLElement): Renderer {
  const box = base(root, 'bp-stack');
  let lastId = '';
  return {
    update(w, d) {
      const s = w.settings as BpLastSettings;
      const b = dataOf(d);
      alignBox(box, s.align);
      const content = b.last
        ? donationBlock(b.last, s, { single: s.lines === 'single', comment: s.showComment })
        : font(h('div', 'bp-empty', 'Noch keine Spende'), s.name);
      box.replaceChildren(...[headline(s.headlineText, s.headline), content].filter((x): x is HTMLElement => !!x));
      if (lastId && b.last && b.last.id !== lastId) void animate(content, 'bounceIn', 900);
      lastId = b.last?.id ?? '';
    },
    dispose() {},
  };
}

// ---------- Top-Spende & Leaderboard ----------

function listOrLoop(root: HTMLElement, kind: 'top' | 'leaders'): Renderer {
  const box = base(root, 'bp-stack');
  const rot = rotator();
  return {
    update(w, d) {
      const s = w.settings as BpTopSettings & BpLeaderboardSettings;
      const b = dataOf(d);
      alignBox(box, s.align);
      const items: HTMLElement[] =
        kind === 'top'
          ? b.top.slice(0, s.count).map((x, i) => {
              const row = donationBlock(x, s, { single: s.display === 'list', comment: s.showComment });
              if (s.display === 'list') row.prepend(font(h('span', 'bp-rank', `${i + 1}.`), s.name));
              return row;
            })
          : b.leaders.slice(0, s.count).map((x, i) => {
              const row = h('div', s.display === 'list' ? 'bp-line' : 'bp-donation');
              if (s.display === 'list' && s.count > 1) row.append(font(h('span', 'bp-rank', `${i + 1}.`), s.name));
              row.append(font(h('span', 'bp-name', x.name), s.name), font(h('span', 'bp-amount', money(x.amount)), s.amount));
              return row;
            });
      const head = headline(s.headlineText, s.headline);
      if (!items.length) {
        rot.run('empty', 0, 1, () => undefined);
        box.replaceChildren(...[head, font(h('div', 'bp-empty', 'Noch keine Spenden'), s.name)].filter((x): x is HTMLElement => !!x));
        return;
      }
      if (s.display === 'list') {
        rot.run('list', 0, 1, () => undefined);
        const list = h('div', 'bp-list');
        list.append(...items);
        box.replaceChildren(...[head, list].filter((x): x is HTMLElement => !!x));
        return;
      }
      const slot = h('div', 'bp-slot');
      box.replaceChildren(...[head, slot].filter((x): x is HTMLElement => !!x));
      rot.run(JSON.stringify([s, items.map((i) => i.textContent)]), items.length, s.rotateSeconds, (i) => {
        const el = items[i]!.cloneNode(true) as HTMLElement;
        slot.replaceChildren(el);
        void animate(el, 'fadeIn', 600);
      });
    },
    dispose() {
      rot.dispose();
    },
  };
}

// ---------- Fortschrittsbalken ----------

function hexAlpha(hex: string, transparency: number) {
  const m = hex.match(/^#([0-9a-f]{6})/i);
  if (!m) return hex;
  const a = Math.round((1 - Math.min(100, Math.max(0, transparency)) / 100) * 255).toString(16).padStart(2, '0');
  return `#${m[1]}${a}`;
}

function bar(percent: number, height: number, color: string, baseColor: string) {
  const b = h('div', 'bp-bar');
  b.style.height = `${height}px`;
  b.style.background = baseColor;
  const fill = h('div', 'bp-bar-fill');
  fill.style.background = color;
  b.append(fill);
  requestAnimationFrame(() => (fill.style.width = `${Math.max(0, Math.min(100, percent))}%`));
  return b;
}

function bpProgress(root: HTMLElement): Renderer {
  const box = base(root, 'bp-stack bp-progress');
  return {
    update(w, d) {
      const s = w.settings as BpProgressSettings;
      const b = dataOf(d);
      alignBox(box, s.align);
      const target = s.target > 0 ? s.target : b.target;
      const percent = target ? (b.total / target) * 100 : 0;
      const parts: HTMLElement[] = [];
      const head = headline(s.headlineText, s.headline);
      if (head) parts.push(head);
      if (s.display !== 'text') {
        const br = bar(percent, s.barHeight, s.progressColor, hexAlpha(s.baseColor, s.baseOpacity));
        br.style.width = '100%';
        parts.push(br);
      }
      if (s.display !== 'bar') {
        parts.push(font(h('div', 'bp-value', target ? `${money(b.total)} / ${money(target)}` : `${money(b.total)} · kein Zielbetrag`), s.data));
      }
      box.replaceChildren(...parts);
    },
    dispose() {},
  };
}

// ---------- Letzter Kommentar ----------

function bpComment(root: HTMLElement): Renderer {
  const box = base(root, 'bp-stack');
  const rot = rotator();
  return {
    update(w, d) {
      const s = w.settings as BpCommentSettings;
      const b = dataOf(d);
      alignBox(box, s.align);
      const head = headline(s.headlineText, s.headline);
      const slot = h('div', 'bp-slot');
      box.replaceChildren(...[head, slot].filter((x): x is HTMLElement => !!x));
      const list = b.comments.slice(0, s.count);
      rot.run(JSON.stringify([s, list.map((x) => x.id)]), list.length, s.rotateSeconds, (i) => {
        if (i < 0) return slot.replaceChildren();
        const x = list[i]!;
        const el = h('div', 'bp-donation');
        el.append(font(h('div', 'bp-name', x.name), s.name));
        if (x.amount != null) el.append(font(h('div', 'bp-amount', money(x.amount)), s.amount));
        el.append(font(h('div', 'bp-comment', x.comment), s.comment));
        slot.replaceChildren(el);
        void animate(el, 'fadeIn', 600);
      });
    },
    dispose() {
      rot.dispose();
    },
  };
}

// ---------- Logos ----------

function bpLogos(root: HTMLElement): Renderer {
  const box = base(root, 'bp-stack bp-logos');
  const rot = rotator();
  return {
    update(w, d) {
      const s = w.settings as BpLogosSettings;
      const b = dataOf(d);
      alignBox(box, s.align);
      const extra = s.extraLogos.split('\n').map((l) => l.trim()).filter((l) => /^(https:\/\/|\/media\/)/.test(l)).map((url) => ({ name: '', url }));
      const logos = [...b.logos, ...extra];
      rot.run(JSON.stringify([s, logos]), logos.length, s.duration, (i) => {
        if (i < 0) return box.replaceChildren(font(h('div', 'bp-empty', b.preview ? 'Logos der Organisationen' : ''), s.name));
        const l = logos[i]!;
        const fig = h('div', 'bp-logo');
        const img = document.createElement('img');
        img.src = l.url;
        img.alt = l.name;
        img.style.height = `${s.logoHeight}px`;
        fig.append(img);
        if (s.showNames && l.name) fig.append(font(h('div', 'bp-name', l.name), s.name));
        box.replaceChildren(fig);
        void animate(fig, 'fadeIn', 800);
      });
    },
    dispose() {
      rot.dispose();
    },
  };
}

// ---------- Milestones ----------

function bpMilestones(root: HTMLElement): Renderer {
  const box = base(root, 'bp-stack');
  return {
    update(w, d) {
      const s = w.settings as BpMilestonesSettings;
      const b = dataOf(d);
      const m = b.milestones;
      if (s.mode === 'alert_only' || !m) return box.replaceChildren();
      alignBox(box, 'center');
      const head = headline(s.headlineText, s.text);
      if (!m.next) {
        box.replaceChildren(...[head, font(h('div', 'bp-value', m.list.length ? 'Alle Milestones erreicht! 🎉' : 'Keine Milestones'), s.amount)].filter((x): x is HTMLElement => !!x));
        return;
      }
      const span = m.next.amount - m.previous;
      const percent = span > 0 ? ((b.total - m.previous) / span) * 100 : 0;
      const row = h('div', 'bp-line');
      row.append(font(h('span', 'bp-amount', money(m.next.amount)), s.amount), font(h('span', 'bp-comment', ` – ${m.next.text}`), s.text));
      const br = bar(percent, 14, s.progressColor, s.baseColor);
      br.style.width = '100%';
      box.replaceChildren(...[head, row, br, font(h('div', 'bp-small', `${money(b.total)} von ${money(m.next.amount)}`), { ...s.text, size: Math.max(10, s.text.size - 3) })].filter((x): x is HTMLElement => !!x));
    },
    dispose() {},
  };
}

// ---------- Abstimmung ----------

function bpPoll(root: HTMLElement): Renderer {
  const box = base(root, 'bp-poll');
  let shownWinner = 0;
  let last: { s: BpPollSettings; p: NonNullable<Data['poll']> } | null = null;
  const celebrate = () => {
    if (!last || last.p.leader == null) return;
    const row = box.querySelectorAll<HTMLElement>('.bp-poll-option')[last.p.leader];
    if (!row) return;
    row.classList.add('winner');
    void animate(row, 'tada', 1500);
    for (let i = 0; i < 24; i++) {
      const c = h('i', 'bp-confetti');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = [last.s.progressColor, '#ffd166', '#06d6a0', '#ef476f', '#ffffff'][i % 5]!;
      c.style.animationDelay = `${Math.random() * 0.6}s`;
      box.append(c);
      setTimeout(() => c.remove(), 3000);
    }
  };
  return {
    update(w, d) {
      const s = w.settings as BpPollSettings;
      const p = dataOf(d).poll;
      if (!p) return;
      last = { s, p };
      const head = font(h('div', 'bp-headline', p.title), s.headline);
      const rows = p.options.map((o, i) => {
        const row = h('div', `bp-poll-option${p.leader === i && p.total > 0 ? ' leading' : ''}`);
        const top = h('div', 'bp-poll-top');
        top.append(font(h('span', '', `#${i + 1} ${o.text}`), s.option), font(h('span', '', `${s.countBy === 'amount' ? money(o.value) : `${o.value} Stimmen`} · ${o.percent.toLocaleString('de-DE')} %`), s.data));
        row.append(top, bar(o.percent, 12, s.progressColor, hexAlpha(s.baseColor, s.baseOpacity)));
        return row;
      });
      const hint = font(h('div', 'bp-small', p.active ? 'Stimme ab: Schreib #1, #2 … in deinen Spendenkommentar' : p.started ? 'Abstimmung beendet' : 'Abstimmung startet gleich'), { ...s.data, size: Math.max(10, s.data.size - 3) });
      box.replaceChildren(head, ...rows, hint);
      if (p.winnerAt && shownWinner && p.winnerAt !== shownWinner) celebrate();
      shownWinner = p.winnerAt || -1;
    },
    message(m) {
      if (m.t === 'poll.winner') setTimeout(celebrate, 200);
    },
    dispose() {},
  };
}

// ---------- Live Spenden-Feed ----------

function bpFeed(root: HTMLElement): Renderer {
  const box = base(root, 'bp-feed');
  return {
    update(w, d) {
      const s = w.settings as BpFeedSettings;
      const b = dataOf(d);
      const head = h('div', 'bp-feed-head');
      head.append(font(h('div', '', `Spendenstand: ${money(b.total)}`), s.name), font(h('div', '', `Anzahl der Spenden: ${b.count}`), { ...s.comment }));
      let list = b.feed.filter((x) => !s.onlyWithAmount || x.amount != null);
      if (s.sort === 'highest') list = [...list].sort((a, c) => (c.amount ?? -1) - (a.amount ?? -1));
      const rows = list.slice(0, s.max).map((x) => {
        const row = h('div', 'bp-feed-row');
        const top = h('div', 'bp-poll-top');
        top.append(font(h('span', '', x.name), s.name), font(h('span', '', amountText(x) || '—'), s.amount));
        row.append(top);
        if (s.showComments && x.comment) row.append(font(h('div', 'bp-comment', x.comment), s.comment));
        row.append(font(h('div', 'bp-small', new Date(x.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })), { ...s.comment, size: 11 }));
        return row;
      });
      box.replaceChildren(head, ...(rows.length ? rows : [font(h('div', 'bp-empty', 'Noch keine Spenden'), s.comment)]));
    },
    dispose() {},
  };
}

export const BP_RENDERERS = (root: HTMLElement): Record<BpWidgetType, () => Renderer> => ({
  bp_all: () => bpAll(root),
  bp_poll: () => bpPoll(root),
  bp_total: () => bpTotal(root),
  bp_last: () => bpLast(root),
  bp_top: () => listOrLoop(root, 'top'),
  bp_leaderboard: () => listOrLoop(root, 'leaders'),
  bp_progress: () => bpProgress(root),
  bp_comment: () => bpComment(root),
  bp_logos: () => bpLogos(root),
  bp_milestones: () => bpMilestones(root),
  bp_feed: () => bpFeed(root),
});
