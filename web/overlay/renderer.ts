import type { AlertPayload, AlertTemplate } from '../../server/src/shared/types';
import './renderer.css';

/*
 * Rendert einen fertig aufgelösten Alert. Wird vom Overlay (Browserquelle) und von der
 * Live-Vorschau im Dashboard benutzt, damit beide exakt gleich aussehen.
 * Sicherheit: Nutzertexte werden nur über textContent gesetzt, nie als HTML.
 */

export interface PlayOptions {
  volume: number;
  muted: boolean;
}

export interface PlayingAlert {
  /** Erfüllt, wenn der Alert vollständig ausgeblendet ist (oder abgebrochen wurde). */
  finished: Promise<void>;
  stop: () => void;
  setAudio: (o: PlayOptions) => void;
}

const loadedFonts = new Set<string>();

function loadFont(family: string, weight: number) {
  const fam = family.trim();
  if (!fam || /^(sans-serif|serif|monospace|system-ui)$/i.test(fam)) return;
  const id = `${fam}:${weight}`;
  if (loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@${weight}&display=block`;
  document.head.appendChild(link);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, sleep(ms)]);

function waitForMedia(el: HTMLImageElement | HTMLVideoElement | HTMLAudioElement): Promise<void> {
  if (el instanceof HTMLImageElement) return el.decode().catch(() => undefined);
  return new Promise((resolve) => {
    if (el.readyState >= 3) return resolve();
    el.addEventListener('canplaythrough', () => resolve(), { once: true });
    el.addEventListener('error', () => resolve(), { once: true });
  });
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
    setTimeout(done, ms + 200); // Sicherheitsnetz, falls animationend nicht feuert
  });
}

function buildTitle(alert: AlertPayload): HTMLElement {
  const t = alert.template.text;
  const title = document.createElement('div');
  title.className = 'ffo-title';
  Object.assign(title.style, {
    fontFamily: `'${t.font}', sans-serif`,
    fontSize: `${t.size}px`,
    fontWeight: String(t.weight),
    color: t.color,
    textShadow: t.shadow ? '0 2px 8px rgba(0,0,0,.65), 0 0 2px rgba(0,0,0,.8)' : 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  if (t.strokeWidth > 0) {
    title.style.setProperty('-webkit-text-stroke', `${t.strokeWidth}px ${t.strokeColor}`);
    title.style.setProperty('paint-order', 'stroke fill');
  }

  let index = 0;
  for (const seg of alert.title) {
    const span = document.createElement('span');
    if (seg.highlight) span.style.color = t.highlightColor;
    if (t.letterAnimation && t.letterAnimation !== 'none') {
      for (const ch of Array.from(seg.text)) {
        const l = document.createElement('span');
        l.className = `ffo-letter ffo-l-${t.letterAnimation}`;
        l.style.animationDelay = `${index++ * 70}ms`;
        l.textContent = ch === ' ' ? ' ' : ch;
        span.appendChild(l);
      }
    } else {
      span.textContent = seg.text;
    }
    title.appendChild(span);
  }
  return title;
}

function buildMessage(alert: AlertPayload): HTMLElement | null {
  if (!alert.message) return null;
  const m = alert.template.message;
  const el = document.createElement('div');
  el.className = 'ffo-message';
  el.textContent = alert.message;
  Object.assign(el.style, {
    fontFamily: `'${m.font}', sans-serif`,
    fontSize: `${m.size}px`,
    fontWeight: String(m.weight),
    color: m.color,
  });
  return el;
}

function place(el: HTMLElement, pos: { x: number; y: number }) {
  Object.assign(el.style, { position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' });
}

export function playAlert(root: HTMLElement, alert: AlertPayload, opts: PlayOptions): PlayingAlert {
  const tpl: AlertTemplate = alert.template;
  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let video: HTMLVideoElement | null = null;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));

  const box = document.createElement('div');
  box.className = `ffo-alert ffo-layout-${tpl.layout} ffo-mode-${tpl.positioning.mode}`;
  box.style.visibility = 'hidden';
  // Größen relativ zur Bühne (Overlay = Fenster, Vorschau = skalierte 1920×1080-Fläche)
  box.style.setProperty('--ffo-fw', `${root.clientWidth || window.innerWidth}px`);
  box.style.setProperty('--ffo-fh', `${root.clientHeight || window.innerHeight}px`);

  // Medium
  let mediaEl: HTMLElement | null = null;
  if (tpl.layout !== 'textOnly' && tpl.media.kind !== 'none' && tpl.media.url) {
    const wrap = document.createElement('div');
    wrap.className = 'ffo-media';
    if (tpl.media.kind === 'video') {
      video = document.createElement('video');
      video.src = tpl.media.url;
      video.playsInline = true;
      video.loop = true;
      video.preload = 'auto';
      video.muted = opts.muted;
      video.volume = Math.min(1, tpl.media.volume * opts.volume);
      wrap.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = tpl.media.url;
      img.alt = '';
      wrap.appendChild(img);
    }
    wrap.style.setProperty('--ffo-media-size', String(tpl.media.size / 100));
    mediaEl = wrap;
  }

  const textWrap = document.createElement('div');
  textWrap.className = 'ffo-text';
  const title = buildTitle(alert);
  textWrap.appendChild(title);
  const message = buildMessage(alert);
  if (message) textWrap.appendChild(message);

  if (tpl.positioning.mode === 'manual') {
    if (mediaEl) place(mediaEl, tpl.positioning.image);
    place(textWrap, tpl.positioning.text);
  }
  if (tpl.layout === 'below') {
    box.append(textWrap);
    if (mediaEl) box.append(mediaEl);
  } else {
    if (mediaEl) box.append(mediaEl);
    box.append(textWrap);
  }
  root.appendChild(box);

  if (tpl.sound.url) {
    audio = new Audio(tpl.sound.url);
    audio.preload = 'auto';
    audio.muted = opts.muted;
    audio.volume = Math.min(1, tpl.sound.volume * opts.volume);
  }

  loadFont(tpl.text.font, tpl.text.weight);
  if (alert.message) loadFont(tpl.message.font, tpl.message.weight);

  const cleanup = () => {
    audio?.pause();
    video?.pause();
    box.remove();
    resolveFinished();
  };

  void (async () => {
    // Erst alles vorladen, dann starten – sonst ploppt das GIF verspätet auf.
    const waits: Promise<unknown>[] = [document.fonts.ready];
    const img = box.querySelector('img');
    if (img) waits.push(waitForMedia(img));
    if (video) waits.push(waitForMedia(video));
    if (audio) waits.push(waitForMedia(audio));
    await withTimeout(Promise.all(waits), 4000);
    if (stopped) return cleanup();

    box.style.visibility = 'visible';
    textWrap.style.visibility = tpl.textDelay > 0 ? 'hidden' : 'visible';
    video?.play().catch(() => undefined);
    audio?.play().catch(() => undefined);
    const speed = tpl.animation.speedMs;
    void animate(box, tpl.animation.in, speed);

    if (tpl.textDelay > 0) {
      await sleep(tpl.textDelay);
      if (stopped) return cleanup();
      textWrap.style.visibility = 'visible';
    }
    if (tpl.text.intro) void animate(title, tpl.text.intro, speed);

    await sleep(Math.max(0, tpl.duration - speed));
    if (stopped) return cleanup();
    if (tpl.text.outro) await animate(title, tpl.text.outro, speed);
    await animate(box, tpl.animation.out, speed);
    cleanup();
  })();

  return {
    finished,
    stop: () => {
      if (stopped) return;
      stopped = true;
      cleanup();
    },
    setAudio: (o) => {
      if (audio) {
        audio.muted = o.muted;
        audio.volume = Math.min(1, tpl.sound.volume * o.volume);
      }
      if (video) {
        video.muted = o.muted;
        video.volume = Math.min(1, tpl.media.volume * o.volume);
      }
    },
  };
}
