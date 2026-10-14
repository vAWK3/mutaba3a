import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { isGoHostedCardDue, readDismissedAt, writeDismissedAt } from '../../lib/goHosted';
import { HOSTED_OFFER_URL } from '../../content/download-config';
import { useSampleSessionStore } from '../../demo/sampleSessionStore';
import { useMalafatMomentStore } from '../../lib/malafatMomentStore';
import './GoHostedCard.css';

/** How long the card fades before it unmounts; the CSS transition matches it (none under reduced motion). */
export const GO_HOSTED_EXIT_MS = 160;

type Phase = 'shown' | 'leaving' | 'gone';

/** Whether the card is due (read once, on mount) and the dismissal that hides it for 30 days. */
function useGoHostedCard() {
  const [phase, setPhase] = useState<Phase>(() =>
    isGoHostedCardDue(readDismissedAt(), Date.now()) ? 'shown' : 'gone',
  );

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('gone'), GO_HOSTED_EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const dismiss = useCallback(() => {
    writeDismissedAt(Date.now());
    setPhase('leaving');
  }, []);

  return { phase, dismiss };
}

interface GoHostedCardProps {
  /** Called on dismiss, so the sidebar can move focus before the card unmounts. */
  onDismissed?: () => void;
}

/**
 * The free web app's "Go hosted" card (MUT-187): one line of value and a link
 * to /hosted in a new tab, dismissible for 30 days. It makes no network call
 * (ADR-024) and stays out of the way while a visitor sample is open (ADR-042).
 * The sidebar decides where it may appear (web build, expanded).
 */
export function GoHostedCard({ onDismissed }: GoHostedCardProps) {
  const t = useT();
  const sampleStatus = useSampleSessionStore((s) => s.status);
  const { phase, dismiss } = useGoHostedCard();
  // One upsell on screen at a time: a Malafat suggestion takes the turn (MUT-190, ADR-078)
  const malafatShown = useMalafatMomentStore((s) => s.suggestionsShown > 0);

  if (phase === 'gone' || sampleStatus !== 'none' || malafatShown) return null;

  const handleDismiss = () => {
    dismiss();
    onDismissed?.();
  };

  return (
    <div
      role="group"
      aria-label={t('nav.goHosted.label')}
      className={cn('go-hosted-card', phase === 'leaving' && 'is-leaving')}
    >
      <p className="go-hosted-card-text">{t('nav.goHosted.text')}</p>
      {/* A plain anchor: the router's /app basepath would turn /hosted into /app/hosted */}
      <a href={HOSTED_OFFER_URL} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary">
        {t('nav.goHosted.cta')}{' '}
        <span className="sr-only">{t('common.opensInNewTab')}</span>
      </a>
      <button
        type="button"
        className="go-hosted-card-dismiss"
        onClick={handleDismiss}
        aria-label={t('nav.goHosted.dismiss')}
        title={t('nav.goHosted.dismiss')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
