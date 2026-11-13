import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlertPayload, AlertTemplate, PortraitLayout, TextSegment } from '../../../../server/src/shared/types';
import { playAlert, type PlayingAlert } from '../../../overlay/renderer';

const SAMPLE = { user: 'TestViewer', amount: '25,00 €', months: '14', count: '5', tier: 'Tier 1', product: 'Hydrate!', gifter: 'TestViewer', streak: '6', reward: 'Hydrate!', name: 'TestViewer', platform: 'twitch', message: 'Grüße in den Chat!' };
const HL = new Set(['user', 'name', 'amount', 'count', 'months', 'streak', 'tier', 'product', 'reward', 'gifter']);

/** Vorschau-Variante des serverseitigen Renderers (gleiche Platzhalter, Beispielwerte). */
function sampleSegments(format: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  const re = /\{([a-zA-Z_]+)\}/g;
  for (let m = re.exec(format); m; m = re.exec(format)) {
    if (m.index > last) out.push({ text: format.slice(last, m.index), highlight: false });
    const v = SAMPLE[m[1] as keyof typeof SAMPLE];
    out.push({ text: v ?? m[0], highlight: !!v && HL.has(m[1]!) });
    last = m.index + m[0].length;
  }
  if (last < format.length) out.push({ text: format.slice(last), highlight: false });
  return out;
}

/**
 * Zeigt ein Template auf einer skalierten 1920×1080-Bühne (bzw. 1080×1920 im Hochformat),
 * mit derselben Render-Logik wie das Overlay.
 */
export function TemplatePreview({ template, muted = true, background, portrait }: { template: AlertTemplate; muted?: boolean; background?: string; portrait?: PortraitLayout }) {
  const stageW = portrait ? 1080 : 1920;
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [run, setRun] = useState(0);
  // Nur echte Änderungen am Design starten die Vorschau neu – nicht jedes neue Objekt beim Neuzeichnen
  const key = useMemo(() => JSON.stringify(template), [template]);
  const portraitKey = portrait ? JSON.stringify(portrait) : '';
  const latest = useRef({ template, portrait });
  latest.current = { template, portrait };

  useEffect(() => {
    if (!frame.current) return;
    // auf ganze Pixel runden: verhindert ein Hin- und Herspringen (z. B. wenn eine Scrollleiste auftaucht)
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e!.contentRect.width);
      setScale((s) => (Math.abs(s * stageW - w) < 2 ? s : w / stageW));
    });
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [stageW]);

  useEffect(() => {
    if (!stage.current) return;
    const { template, portrait } = latest.current;
    const alert: AlertPayload = {
      itemId: `preview-${run}`, eventId: 'preview', template,
      title: sampleSegments(template.text.format),
      message: template.message.show ? SAMPLE.message : undefined,
      messageParts: template.message.show && template.message.allowEmotes ? [{ text: 'Grüße in den Chat! ' }, { emote: '25', name: 'Kappa' }] : undefined,
      tokens: { ...SAMPLE, messageTemplate: sampleSegments(template.text.format).map((x) => x.text).join(''), userMessage: template.message.show ? SAMPLE.message : '' },
      tts: template.tts.enabled ? SAMPLE.message : undefined,
    };
    let playing: PlayingAlert | null = null;
    let cancelled = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    // Entprellung, damit Tippen und Schieberegler nicht bei jeder Änderung neu starten
    const t = setTimeout(() => {
      playing = playAlert(stage.current!, alert, { volume: 1, muted, portrait });
      // nur ein regulär beendeter Durchlauf startet die Wiederholung (ein abgebrochener nicht)
      void playing.finished.then(() => {
        if (!cancelled) again = setTimeout(() => !cancelled && setRun((r) => r + 1), 900);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearTimeout(again);
      playing?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run, muted, portraitKey]);

  return (
    <div className={`preview-frame${portrait ? ' portrait' : ''}`} ref={frame} style={background ? { background } : undefined}>
      <div className="preview-stage" ref={stage} style={{ transform: `scale(${scale})`, width: stageW, height: portrait ? 1920 : 1080 }} />
    </div>
  );
}

export type PreviewFormat = 'landscape' | 'portrait';

/** Gemerktes Vorschauformat (pro Browser) */
export function usePreviewFormat(): [PreviewFormat, (f: PreviewFormat) => void] {
  const [f, setF] = useState<PreviewFormat>(() => {
    try {
      return localStorage.getItem('ffo-preview-format') === 'portrait' ? 'portrait' : 'landscape';
    } catch {
      return 'landscape';
    }
  });
  const set = (v: PreviewFormat) => {
    setF(v);
    try {
      localStorage.setItem('ffo-preview-format', v);
    } catch {
      /* egal */
    }
  };
  return [f, set];
}

export function FormatToggle({ value, onChange }: { value: PreviewFormat; onChange: (f: PreviewFormat) => void }) {
  return (
    <div className="seg" role="group" aria-label="Vorschauformat">
      <button className={value === 'landscape' ? 'on' : ''} onClick={() => onChange('landscape')} title="Querformat 1920 × 1080">16:9</button>
      <button className={value === 'portrait' ? 'on' : ''} onClick={() => onChange('portrait')} title="Hochformat 1080 × 1920">9:16</button>
    </div>
  );
}
