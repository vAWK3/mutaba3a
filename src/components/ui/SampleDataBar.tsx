import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import { useSampleSessionStore } from '../../demo/sampleSessionStore';
import { countSessionAdditions } from '../../demo/visitorSample';
import { useLeaveSample } from '../../demo/useVisitorSample';
import './SampleDataBar.css';

/**
 * One quiet line while a visitor looks at the sample (MUT-78): it says so,
 * and "Start with your own" clears it. That asks first only when the visitor
 * added things of their own while looking around — the one case where
 * leaving loses something. In the content flow, so it can never cover a
 * drawer.
 */
export function SampleDataBar() {
  const t = useT();
  const tp = useTp();
  const status = useSampleSessionStore((s) => s.status);
  const leave = useLeaveSample();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (status !== 'active') return null;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const startOwn = () =>
    run(async () => {
      const added = await countSessionAdditions();
      if (added > 0) setPendingCount(added);
      else await leave();
    });

  return (
    <div className="sample-bar" role="region" aria-label={t('sample.bar.label')}>
      {pendingCount === null ? (
        <>
          <span className="sample-bar-text">{t('sample.bar.message')}</span>
          <button type="button" className="sample-bar-action" onClick={startOwn} disabled={busy}>
            {t('sample.bar.start')}
          </button>
        </>
      ) : (
        <>
          <span className="sample-bar-text" role="alert">
            {tp('sample.bar.confirm', pendingCount)}
          </span>
          <button type="button" className="sample-bar-action" onClick={() => run(leave)} disabled={busy}>
            {t('sample.bar.confirmYes')}
          </button>
          <button
            type="button"
            className="sample-bar-secondary"
            onClick={() => setPendingCount(null)}
            disabled={busy}
          >
            {t('sample.bar.keep')}
          </button>
        </>
      )}
    </div>
  );
}
