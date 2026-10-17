import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { choosePortalUsage, usePortalUsage } from '../analytics/portalAnalytics';
import { InfoIcon } from './Icons';

/**
 * The one-time question about anonymous usage (MUT-155, README "Opt-in
 * experience"). An inline notice at the top of the page, never a dialog (B1),
 * with two buttons of the same weight so neither answer is nudged (B2). It
 * shows only while the signed-in person hasn't answered on this browser.
 */
export function UsagePrompt() {
  const t = useT();
  const titleId = useId();
  const choice = usePortalUsage((state) => state.choice);
  const owner = usePortalUsage((state) => state.owner);
  if (choice !== null || owner === null) return null;

  return (
    <section className="hp-banner hp-banner-info hp-usage-prompt" aria-labelledby={titleId}>
      <InfoIcon />
      <div className="hp-usage-prompt-body">
        <h2 id={titleId} className="hp-usage-prompt-title">
          {t('hosted.usage.title')}
        </h2>
        <p>{t('hosted.usage.body')}</p>
        <div className="hp-usage-prompt-actions">
          <Button type="button" variant="secondary" onClick={() => void choosePortalUsage('on', 'first_run')}>
            {t('hosted.usage.turnOn')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void choosePortalUsage('off', 'first_run')}>
            {t('hosted.usage.decline')}
          </Button>
        </div>
      </div>
    </section>
  );
}
