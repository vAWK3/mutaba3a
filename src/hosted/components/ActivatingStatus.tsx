import { useT } from '../../lib/i18n/core';
import type { ActivatingPhase } from '../data/activatingPoll';
import { ActivatingMotion } from './ActivatingMotion';

/**
 * MUT-770 (design DR-5, DR-11): the desk's card-activation status for one customer after Stripe: the `activating`
 * motion and one line, Activating… → Active, or Check back shortly after 2 minutes (the loop then rests on the active
 * pose, as the spec ends). Each change is said once in a polite live region.
 */
export function ActivatingStatus({ name, phase, onClose }: { name: string; phase: ActivatingPhase; onClose?: () => void }) {
  const t = useT();
  const line = t(`hosted.accountantChannel.activating.${phase}`);
  return (
    <section className="hp-activating-status" data-phase={phase} aria-label={name}>
      <ActivatingMotion done={phase !== 'activating'} size={96} />
      <div className="hp-activating-status-text">
        <bdi dir="auto" className="hp-activating-status-name">
          {name}
        </bdi>
        <span>{line}</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {t('hosted.accountantChannel.activating.announce', { name, state: line })}
      </p>
      {onClose && phase !== 'activating' && (
        <button type="button" className="hp-link-button press" onClick={onClose}>
          {t('hosted.accountantChannel.activating.close')}
        </button>
      )}
    </section>
  );
}
