import { useState } from 'react';
import { api, type AlertTemplate, type Rule } from '../api';
import { useAction } from '../ui';

/*
 * Lila „Testen“-Knopf für alle Alert- und Widget-Baukästen.
 * Alerts: spielt genau den gerade bearbeiteten Entwurf (auch ungespeichert) im Overlay ab.
 */

export function TestThisButton({ onTest, label = 'Diesen Alert testen', title, block }: {
  onTest: () => Promise<unknown> | unknown; label?: string; title?: string; block?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      await onTest();
    } finally {
      setTimeout(() => setBusy(false), 700);
    }
  };
  return (
    <button className={`btn-test${block ? ' block' : ''}`} onClick={click} disabled={busy} title={title ?? 'Spielt genau diesen Alert im Overlay ab – auch ungespeicherte Änderungen'}>
      <span aria-hidden>▶</span> {busy ? 'Wird gesendet …' : label}
    </button>
  );
}

/** Entwurf eines Alerts an ein Overlay schicken. Bedingungen einer Variante werden im Beispiel-Event erfüllt. */
export function useTestDraft() {
  const run = useAction();
  return (overlayId: string, template: AlertTemplate, trigger: { type: string; subtype?: string }, conditions?: Rule['conditions'], label?: string) =>
    run(
      () => api.post(`/api/overlays/${overlayId}/test-draft`, { template, type: trigger.type, subtype: trigger.subtype, conditions }),
      `Test gesendet${label ? `: ${label}` : ''} – läuft im Overlay`,
    );
}
