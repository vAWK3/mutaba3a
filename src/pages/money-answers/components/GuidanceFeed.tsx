import { useT } from '../../../lib/i18n';
import { useNavigate } from '@tanstack/react-router';
import { useDrawerStore } from '../../../lib/stores';
import type { GuidanceItem } from '../../../types';

interface GuidanceFeedProps {
  items: GuidanceItem[];
}

function formatAmount(amountMinor: number, currency: string): string {
  const formatted = (amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export function GuidanceFeed({ items }: GuidanceFeedProps) {
  const t = useT();

  if (items.length === 0) {
    return (
      <div className="guidance-feed">
        <div className="guidance-empty">
          <CheckCircleIcon />
          <p>{t('moneyAnswers.guidance.allGood')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="guidance-feed">
      {items.map(item => (
        <GuidanceCard key={item.id} item={item} />
      ))}
    </div>
  );
}

interface GuidanceCardProps {
  item: GuidanceItem;
}

function GuidanceCard({ item }: GuidanceCardProps) {
  const t = useT();
  const navigate = useNavigate();
  const openTransactionDrawer = useDrawerStore((s) => s.openTransactionDrawer);

  const handleAction = () => {
    if (!item.primaryAction) return;

    switch (item.primaryAction.type) {
      case 'viewReceivables':
        navigate({ to: '/transactions', search: { status: 'unpaid' } });
        break;
      case 'viewRetainers':
        navigate({ to: '/retainers' });
        break;
      case 'markPaid':
        if (item.primaryAction.payload?.eventId) {
          openTransactionDrawer({
            mode: 'edit',
            transactionId: item.primaryAction.payload.eventId as string,
          });
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className={`guidance-card ${item.severity}`}>
      <div className={`guidance-icon ${item.severity}`}>
        {item.severity === 'critical' && <AlertCircleIcon />}
        {item.severity === 'warning' && <AlertTriangleIcon />}
        {item.severity === 'info' && <InfoCircleIcon />}
      </div>
      <div className="guidance-content">
        <div className="guidance-header">
          <span className="guidance-title">{item.title}</span>
          <span className={`guidance-badge ${item.category}`}>
            {t(`moneyAnswers.guidance.category.${item.category}`)}
          </span>
        </div>
        <div className="guidance-description">{item.description}</div>
        <div className="guidance-impact">
          {t('moneyAnswers.guidance.impact')}: {formatAmount(item.impactMinor, item.impactCurrency)}
        </div>
      </div>
      {item.primaryAction && (
        <div className="guidance-actions">
          <button
            type="button"
            className="guidance-action-btn"
            onClick={handleAction}
          >
            {item.primaryAction.label}
          </button>
        </div>
      )}
    </div>
  );
}

// Icons
function AlertCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
      />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
      />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}
