import type { Ref } from 'react';
import { useT } from '../../../lib/i18n/core';
import { SUPPORT_EMAIL } from '../../terms';
import type { TurnstileStatus } from './useTurnstile';

/**
 * Where the Turnstile widget mounts (MUT-368). The box keeps the widget's height reserved, so the form doesn't jump
 * when it appears. A check that can't run (a blocker, an outage) says so, offers Try again, and names the support
 * address (D15): the form never sends without a token.
 */
export function TurnstileWidget({ containerRef, status, onRetry, id }: { containerRef: Ref<HTMLDivElement>; status: TurnstileStatus; onRetry: () => void; id: string }) {
  const t = useT();
  return (
    <div className="hp-field">
      <div ref={containerRef} className="hp-turnstile" />
      {status === 'failed' && (
        <p className="hp-field-error" id={id} role="alert">
          {t('hosted.selfService.check.failed')}{' '}
          <button type="button" className="hp-link-button press" onClick={onRetry}>
            {t('hosted.selfService.check.retry')}
          </button>{' '}
          {t('hosted.selfService.check.help')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>
            <bdi>{SUPPORT_EMAIL}</bdi>
          </a>
        </p>
      )}
    </div>
  );
}
