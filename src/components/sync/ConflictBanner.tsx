/**
 * Conflict Banner
 *
 * A global banner that appears when there are unresolved sync conflicts.
 */

import { useConflictBanner } from '../../sync/stores/syncStore';
import { useNavigate } from '@tanstack/react-router';
import './ConflictBanner.css';

export function ConflictBanner() {
  const { count, isDismissed, dismiss } = useConflictBanner();
  const navigate = useNavigate();

  if (count === 0 || isDismissed) {
    return null;
  }

  const handleReview = () => {
    navigate({ to: '/settings', search: { section: 'sync' } });
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismiss();
  };

  return (
    <div className="conflict-banner" role="alert">
      <div className="conflict-banner__content">
        <span className="conflict-banner__icon">⚠</span>
        <span className="conflict-banner__text">
          <strong>{count} {count === 1 ? 'edit' : 'edits'}</strong> detected on multiple devices
        </span>
      </div>
      <div className="conflict-banner__actions">
        <button className="conflict-banner__btn conflict-banner__btn--review" onClick={handleReview}>
          Review
        </button>
        <button
          className="conflict-banner__btn conflict-banner__btn--dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
