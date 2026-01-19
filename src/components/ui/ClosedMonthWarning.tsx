import { useIsMonthClosed, useReopenMonth } from '../../hooks/useExpenseQueries';
import { formatMonthKey } from '../../lib/monthDetection';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import './ClosedMonthWarning.css';

export interface ClosedMonthWarningProps {
  profileId: string;
  monthKey: string;
  onReopen?: () => void;
}

export function ClosedMonthWarning({
  profileId,
  monthKey,
  onReopen,
}: ClosedMonthWarningProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const { data: isClosed } = useIsMonthClosed(profileId, monthKey);
  const reopenMutation = useReopenMonth();

  const handleReopen = async () => {
    if (!confirm(t('monthClose.confirmReopen'))) return;

    try {
      await reopenMutation.mutateAsync({
        profileId,
        monthKey,
      });
      onReopen?.();
    } catch {
      // Error handled by mutation
    }
  };

  if (!isClosed) return null;

  return (
    <div className="closed-month-warning">
      <div className="closed-month-warning-icon">
        <WarningIcon />
      </div>
      <div className="closed-month-warning-content">
        <span className="closed-month-warning-title">
          {t('monthClose.warning.title')}
        </span>
        <span className="closed-month-warning-text">
          {t('monthClose.warning.text', { month: formatMonthKey(monthKey, locale) })}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-secondary"
        onClick={handleReopen}
        disabled={reopenMutation.isPending}
      >
        {t('monthClose.warning.reopenButton')}
      </button>
    </div>
  );
}

function WarningIcon() {
  return (
    <svg
      width="20"
      height="20"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}
