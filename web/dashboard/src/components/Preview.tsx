import { useEffect, useRef, useState } from 'react';
import type { AlertPayload, AlertTemplate, TextSegment } from '../../../../server/src/shared/types';
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

/** Zeigt ein Template auf einer skalierten 1920×1080-Bühne, mit derselben Render-Logik wie das Overlay. */
export function TemplatePreview({ template, muted = true }: { template: AlertTemplate; muted?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!frame.current) return;
    const ro = new ResizeObserver(([e]) => setScale(e!.contentRect.width / 1920));
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!stage.current) return;
    const alert: AlertPayload = {
      itemId: `preview-${run}`, eventId: 'preview', template,
      title: sampleSegments(template.text.format),
      message: template.message.show ? SAMPLE.message : undefined,
    };
    let playing: PlayingAlert | null = null;
    // kurze Entprellung, damit Tippen nicht bei jedem Zeichen neu startet
    const t = setTimeout(() => {
      playing = playAlert(stage.current!, alert, { volume: 1, muted });
      void playing.finished.then(() => setTimeout(() => setRun((r) => r + 1), 900));
    }, 250);
    return () => { clearTimeout(t); playing?.stop(); };
  }, [template, run, muted]);

  return (
    <div className="preview-frame" ref={frame}>
      <div className="preview-stage" ref={stage} style={{ transform: `scale(${scale})` }} />
    </div>
  );
}
