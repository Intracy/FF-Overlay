import type { AlertPayload, AlertTemplate, PortraitLayout } from '../../server/src/shared/types';
import './renderer.css';
import { buildEffectTitle, startTextEffect, textEffect, type RunningFx } from './textfx';

/*
 * Rendert einen fertig aufgelösten Alert. Wird vom Overlay (Browserquelle) und von der
 * Live-Vorschau im Dashboard benutzt, damit beide exakt gleich aussehen.
 * Sicherheit: Nutzertexte werden nur über textContent gesetzt, nie als HTML.
 */

export interface PlayOptions {
  volume: number;
  muted: boolean;
  /** Hochformat (9:16): Alerts größer skalieren und in den sicheren Bereich setzen */
  portrait?: PortraitLayout;
  /** Browser hat den Ton blockiert (Autoplay-Sperre, z. B. Overlay in einem normalen Browser-Tab ohne Klick) */
  onAutoplayBlocked?: () => void;
}

export interface PlayingAlert {
  /** Erfüllt, wenn der Alert vollständig ausgeblendet ist (oder abgebrochen wurde). */
  finished: Promise<void>;
  stop: () => void;
  setAudio: (o: PlayOptions) => void;
  /** nach einer Autoplay-Sperre: Sound und Video-Ton nachträglich starten (nach einem Klick) */
  resumeSound?: () => void;
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

function buildTitle(alert: AlertPayload, animations: boolean): HTMLElement {
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

  // Animation Library: Titel als Effekt-Element (Schrift, Farben, Kontur und Schatten erbt der Effekt vom Titel)
  const effect = textEffect(t.effect);
  if (effect) {
    title.appendChild(buildEffectTitle(effect, alert.title, {
      color: t.color, highlightColor: t.highlightColor, colors: t.effectColors ?? 'effect',
      letterAnimation: animations ? t.letterAnimation : 'none',
    }));
    return title;
  }

  let index = 0;
  for (const seg of alert.title) {
    const span = document.createElement('span');
    if (seg.highlight) span.style.color = t.highlightColor;
    if (animations && t.letterAnimation && t.letterAnimation !== 'none') {
      // Buchstaben wortweise bündeln, damit Zeilen nur zwischen Wörtern umbrechen (wichtig im schmalen Hochformat)
      for (const part of seg.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          span.appendChild(document.createTextNode(part));
          index += part.length;
          continue;
        }
        const word = document.createElement('span');
        word.className = 'ffo-word';
        for (const ch of Array.from(part)) {
          const l = document.createElement('span');
          l.className = `ffo-letter ffo-l-${t.letterAnimation}`;
          l.style.animationDelay = `${index++ * 70}ms`;
          l.textContent = ch;
          word.appendChild(l);
        }
        span.appendChild(word);
      }
    } else {
      span.textContent = seg.text;
    }
    title.appendChild(span);
  }
  return title;
}

const EMOTE_URL = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`;

function buildMessage(alert: AlertPayload): HTMLElement | null {
  if (!alert.message) return null;
  const m = alert.template.message;
  const el = document.createElement('div');
  el.className = 'ffo-message';
  if (alert.messageParts?.length) {
    for (const part of alert.messageParts) {
      if ('emote' in part) {
        const img = document.createElement('img');
        img.className = 'ffo-emote';
        img.src = EMOTE_URL(part.emote);
        img.alt = part.name;
        el.appendChild(img);
      } else {
        el.appendChild(document.createTextNode(part.text));
      }
    }
  } else {
    el.textContent = alert.message;
  }
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

// ---------- Eigener Code (Sandbox-Frame) ----------

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Baut das Dokument für eigenen HTML/CSS/JS-Code. Läuft in einem iframe mit sandbox="allow-scripts"
 * (ohne allow-same-origin): kein Zugriff auf Overlay, Cookies oder Backend.
 * Platzhalter werden HTML-escaped eingesetzt; im JS stehen alle Werte als window.ALERT bereit.
 */
export function customDocument(alert: AlertPayload, frame: { w: number; h: number }): string {
  const tpl = alert.template;
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(tpl.custom.fields || '{}');
  } catch {
    /* ungültige Felder ignorieren */
  }
  const media =
    tpl.media.kind === 'none' || !tpl.media.url
      ? ''
      : tpl.media.kind === 'video'
        ? `<video src="${esc(tpl.media.url)}" autoplay loop playsinline muted></video>`
        : `<img src="${esc(tpl.media.url)}" alt="">`;
  const title = alert.title.map((s) => (s.highlight ? `<span class="hl">${esc(s.text)}</span>` : esc(s.text))).join('');
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) values[k] = esc(String(v));
  for (const [k, v] of Object.entries(alert.tokens ?? {})) values[k] = esc(v);
  values.img = media;
  values.messageTemplate = title;
  values.userMessage = esc(alert.message ?? '');
  const html = tpl.custom.html.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k: string) => (k in values ? values[k]! : m));
  const data = JSON.stringify({ ...alert.tokens, fields, title: alert.title, message: alert.message ?? '', duration: tpl.duration }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${frame.w}px;height:${frame.h}px;background:transparent;overflow:hidden}
body{display:flex;align-items:center;justify-content:center}
${tpl.custom.css.replace(/<\/style/gi, '<\\/style')}
</style></head><body>${html}<script>window.ALERT=${data};</script><script>${tpl.custom.js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

// ---------- Text-to-Speech ----------

function pickVoice(name: string, lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.find((v) => v.name === name) ?? voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}

function speak(text: string, tts: AlertTemplate['tts'], opts: PlayOptions): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth || opts.muted || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = tts.lang || 'de-DE';
    const voice = pickVoice(tts.voice, u.lang);
    if (voice) u.voice = voice;
    u.volume = Math.min(1, tts.volume * opts.volume);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
    setTimeout(resolve, 30_000); // Sicherheitsnetz: nie länger als 30 s
  });
}

// ---------- Abspielen ----------

export function playAlert(root: HTMLElement, alert: AlertPayload, opts: PlayOptions): PlayingAlert {
  const tpl: AlertTemplate = alert.template;
  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let video: HTMLVideoElement | null = null;
  let iframe: HTMLIFrameElement | null = null;
  let audioOpts = opts;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));
  // Ein-/Ausblend- und Text-Animationen nur mit Haken „Animationen verwenden“ (Animation Library läuft unabhängig davon)
  const anim = tpl.animation.enabled !== false;
  const portrait = opts.portrait;
  // Im Hochformat wird die ganze Alert-Fläche per CSS-zoom vergrößert; innen rechnet alles mit der verkleinerten Fläche,
  // dadurch bleiben Bild- und Textgrenzen (max-width/-height) im sichtbaren Bereich.
  const zoom = portrait ? Math.max(0.5, portrait.scale / 100) : 1;
  const fw = (root.clientWidth || window.innerWidth) / zoom;
  const fh = (root.clientHeight || window.innerHeight) / zoom;

  const box = document.createElement('div');
  box.className = `ffo-alert ffo-layout-${tpl.layout} ffo-mode-${tpl.positioning.mode}`;
  box.style.visibility = 'hidden';
  if (portrait) {
    box.classList.add('ffo-portrait');
    if (portrait.stackSideBySide) box.classList.add('ffo-portrait-stack');
    box.style.zoom = String(zoom);
    box.style.paddingTop = `${(portrait.safeTop / 100) * fh}px`;
    box.style.paddingBottom = `${(portrait.safeBottom / 100) * fh}px`;
    box.style.boxSizing = 'border-box';
    if (tpl.positioning.mode === 'preset') box.style.justifyContent = portrait.align === 'top' ? 'flex-start' : portrait.align === 'bottom' ? 'flex-end' : 'center';
  }
  // Größen relativ zur Bühne (Overlay = Fenster, Vorschau = skalierte 1920×1080-Fläche)
  box.style.setProperty('--ffo-fw', `${fw}px`);
  box.style.setProperty('--ffo-fh', `${fh}px`);

  let fx: RunningFx | null = null;
  let mediaEl: HTMLElement | null = null;
  let textWrap: HTMLElement | null = null;
  let title: HTMLElement | null = null;

  if (tpl.custom.enabled) {
    // Eigener Code ersetzt Bild und Text; Animationen, Sound und TTS bleiben.
    iframe = document.createElement('iframe');
    iframe.className = 'ffo-custom';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('scrolling', 'no');
    iframe.srcdoc = customDocument(alert, { w: fw, h: fh });
    box.appendChild(iframe);
  } else {
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

    textWrap = document.createElement('div');
    textWrap.className = 'ffo-text';
    title = buildTitle(alert, anim);
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
  }
  root.appendChild(box);

  if (tpl.sound.url) {
    audio = new Audio(tpl.sound.url);
    audio.preload = 'auto';
    audio.muted = opts.muted;
    audio.volume = Math.min(1, tpl.sound.volume * opts.volume);
  }

  if (!tpl.custom.enabled) {
    loadFont(tpl.text.font, tpl.text.weight);
    if (alert.message) loadFont(tpl.message.font, tpl.message.weight);
  }

  const cleanup = () => {
    fx?.stop();
    audio?.pause();
    video?.pause();
    if (alert.tts) window.speechSynthesis?.cancel();
    box.remove();
    resolveFinished();
  };

  void (async () => {
    // Erst alles vorladen, dann starten – sonst ploppt das GIF verspätet auf.
    const waits: Promise<unknown>[] = [document.fonts.ready];
    const img = box.querySelector('.ffo-media img') as HTMLImageElement | null;
    if (img) waits.push(waitForMedia(img));
    if (video) waits.push(waitForMedia(video));
    if (audio) waits.push(waitForMedia(audio));
    if (iframe) waits.push(new Promise((r) => iframe!.addEventListener('load', r, { once: true })));
    await withTimeout(Promise.all(waits), 4000);
    if (stopped) return cleanup();

    box.style.visibility = 'visible';
    if (textWrap) textWrap.style.visibility = tpl.textDelay > 0 ? 'hidden' : 'visible';
    const blocked = (err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') opts.onAutoplayBlocked?.();
    };
    // ohne Ton weiterspielen, statt das Video ganz wegzulassen
    video?.play().catch((err) => {
      blocked(err);
      if (video && !video.muted) {
        video.muted = true;
        void video.play().catch(() => undefined);
      }
    });
    audio?.play().catch(blocked);
    const speed = tpl.animation.speedMs;
    const started = Date.now();
    if (anim) void animate(box, tpl.animation.in, speed);

    if (tpl.textDelay > 0) {
      await sleep(tpl.textDelay);
      if (stopped) return cleanup();
      if (textWrap) textWrap.style.visibility = 'visible';
    }
    if (anim && title && tpl.text.intro) void animate(title, tpl.text.intro, speed);
    const effect = textEffect(tpl.text.effect);
    if (title && effect) fx = startTextEffect(title, effect, alert.title.map((x) => x.text).join(''), tpl.text.effectSpeed || 1);

    // TTS startet nach dem Alert-Sound (wie bei Streamlabs) und verlängert den Alert bei Bedarf.
    let speech: Promise<void> = Promise.resolve();
    if (alert.tts) {
      if (audio && !audio.paused) await withTimeout(new Promise((r) => audio!.addEventListener('ended', r, { once: true })), 6000);
      if (stopped) return cleanup();
      speech = speak(alert.tts, tpl.tts, audioOpts);
    }

    await sleep(Math.max(0, tpl.duration - speed - (Date.now() - started - tpl.textDelay)));
    await speech;
    if (stopped) return cleanup();
    if (anim && title && tpl.text.outro) await animate(title, tpl.text.outro, speed);
    if (anim) await animate(box, tpl.animation.out, speed);
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
      audioOpts = o;
      if (audio) {
        audio.muted = o.muted;
        audio.volume = Math.min(1, tpl.sound.volume * o.volume);
      }
      if (video) {
        video.muted = o.muted;
        video.volume = Math.min(1, tpl.media.volume * o.volume);
      }
      if (o.muted && alert.tts) window.speechSynthesis?.cancel();
    },
    resumeSound: () => {
      if (stopped || audioOpts.muted) return;
      if (audio && audio.paused && !audio.ended) void audio.play().catch(() => undefined);
      if (video) {
        video.muted = false;
        void video.play().catch(() => undefined);
      }
    },
  };
}
