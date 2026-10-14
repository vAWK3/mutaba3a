import { useLayoutEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { useMalafatMomentStore } from '../../lib/malafatMomentStore';
import './MalafatSuggestionCard.css';

interface MalafatSuggestionCardProps {
  /** The group's accessible name. */
  label: string;
  text: string;
  /** A `malafatUrl(...)` for this moment. */
  href: string;
  ctaLabel: string;
  dismissLabel: string;
  /** Retire the moment for good: called on dismiss and on a click on the link (seen and acted on). */
  onRetire: () => void;
  /** The card has hidden itself: move focus somewhere sensible before it is gone. */
  onGone: () => void;
  /** `note` sits inside a settings row; `card` stands on a page. */
  variant?: 'card' | 'note';
}

/**
 * One inline Malafat suggestion (MUT-190, epic MUT-189): a line, one link out
 * to malafat.app in a new tab, and a permanent dismiss. Never a modal or a
 * toast. While it is on screen it holds the one upsell slot, so the Go hosted
 * card steps aside (ADR-078). It hides itself at once on dismiss or click,
 * without waiting for the settings write.
 */
export function MalafatSuggestionCard({
  label,
  text,
  href,
  ctaLabel,
  dismissLabel,
  onRetire,
  onGone,
  variant = 'card',
}: MalafatSuggestionCardProps) {
  const t = useT();
  const claimSlot = useMalafatMomentStore((s) => s.claimSlot);
  const [gone, setGone] = useState(false);

  // A layout effect, so the Go hosted card never paints a frame beside a Malafat suggestion
  useLayoutEffect(() => (gone ? undefined : claimSlot()), [gone, claimSlot]);

  if (gone) return null;

  const retire = () => {
    setGone(true);
    onRetire();
    onGone();
  };

  // A click on the link counts as seen, but the anchor must outlive the click so the browser follows it
  const followLink = () => {
    onRetire();
    setTimeout(() => {
      setGone(true);
      onGone();
    });
  };

  return (
    <div role="group" aria-label={label} className={cn('malafat-suggestion', `malafat-suggestion--${variant}`)}>
      <p className="malafat-suggestion-text">{text}</p>
      <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary" onClick={followLink}>
        {ctaLabel}{' '}
        <span className="sr-only">{t('common.opensInNewTab')}</span>
      </a>
      <button type="button" className="malafat-suggestion-dismiss" onClick={retire} aria-label={dismissLabel} title={dismissLabel}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
