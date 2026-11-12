import type { OverlayInfo, ServerToOverlay } from '../../server/src/shared/types';
import { playAlert, type PlayingAlert } from './renderer';

/*
 * Overlay-Browserquelle für OBS & Co.
 * URL: /overlay/?id=<overlayId>&key=<geheimerKey>   (Zusatz &debug=1 zeigt den Verbindungsstatus)
 * Hochkant-Variante: &format=9x16 (Browserquelle 1080 × 1920) – dieselben Alerts, größer skaliert fürs Handy.
 * Ohne format-Angabe entscheidet das Seitenverhältnis der Browserquelle.
 * Spielt nur ab, was das Backend schickt; Warteschlange und Logik liegen im Backend.
 */

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? '';
const key = params.get('key') ?? '';
const stage = document.getElementById('stage')!;
const statusEl = document.getElementById('status')!;
if (params.get('debug') === '1') document.body.classList.add('debug');

const formatParam = (params.get('format') ?? '').toLowerCase();
const isPortrait = () =>
  /^(9x16|9:16|portrait|hochkant|vertical)$/.test(formatParam) ||
  (!/^(16x9|16:9|landscape|quer)$/.test(formatParam) && window.innerHeight > window.innerWidth);
let overlayInfo: OverlayInfo | null = null;
/** &mute=1: diese Quelle spielt keinen Ton (z. B. wenn Quer- und Hochformat in derselben Szene liegen) */
const forceMute = params.get('mute') === '1';
document.body.classList.toggle('portrait', isPortrait());

let audio = { volume: 1, muted: params.get('mute') === '1' };
let current: { itemId: string; playing: PlayingAlert } | null = null;
let retry = 0;
let ws: WebSocket | null = null;
let pingTimer: number | undefined;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function send(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  if (!id || !key) {
    setStatus('Fehler: id und key fehlen in der URL');
    document.body.classList.add('debug');
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/overlay/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`);
  setStatus('verbinde …');

  ws.onopen = () => {
    retry = 0;
    setStatus('verbunden');
    clearInterval(pingTimer);
    pingTimer = window.setInterval(() => send({ t: 'ping' }), 20_000);
  };

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerToOverlay | { t: 'pong' };
    switch (msg.t) {
      case 'hello':
        overlayInfo = msg.overlay;
        setStatus(`verbunden: ${msg.overlay.name}${isPortrait() ? ' · Hochformat 9:16' : ' · Querformat 16:9'}`);
        break;
      case 'state':
        audio = { volume: msg.volume, muted: msg.muted || forceMute };
        current?.playing.setAudio(audio);
        break;
      case 'alert.show': {
        current?.playing.stop();
        const itemId = msg.alert.itemId;
        const playing = playAlert(stage, msg.alert, { ...audio, portrait: isPortrait() ? overlayInfo?.portrait : undefined });
        current = { itemId, playing };
        send({ t: 'alert.started', itemId });
        void playing.finished.then(() => {
          if (current?.itemId === itemId) current = null;
          send({ t: 'alert.done', itemId });
        });
        break;
      }
      case 'alert.skip':
        if (current?.itemId === msg.itemId) current.playing.stop();
        break;
      case 'reload':
        location.reload();
        break;
    }
  };

  ws.onclose = (ev) => {
    clearInterval(pingTimer);
    if (ev.code === 4001) {
      // Falscher oder erneuerter Key: nicht endlos neu versuchen, aber nach 30 s erneut prüfen.
      setStatus(`abgewiesen: ${ev.reason || 'ungültiger Key'}`);
      document.body.classList.add('debug');
      setTimeout(connect, 30_000);
      return;
    }
    const delay = Math.min(15_000, 500 * 2 ** retry++);
    setStatus(`getrennt – neuer Versuch in ${Math.round(delay / 1000)} s`);
    setTimeout(connect, delay);
  };
}

connect();
