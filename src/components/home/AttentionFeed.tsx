/**
 * AttentionFeed Component
 *
 * Displays severity-ordered attention items for the Home page.
 * Shows unpaid income that needs attention (overdue, due soon, missing due dates).
 *
 * Per design doc:
 * - Maximum 5 items shown
 * - Critical items always visible
 * - Warning/Info items collapse if >3 total
 * - "View all" links to Income page with unpaid filter
 * - Actions route through canonical drawers
 */

import { useState, useMemo } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useDrawerStore } from '../../lib/stores';
import { useGuidance } from '../../hooks/useMoneyAnswersQueries';
import { getCurrentMonthKey } from '../../lib/monthDetection';
import { formatAmount, cn } from '../../lib/utils';
import type { GuidanceItem, Currency } from '../../types';

// Max items to show before "show more"
const MAX_VISIBLE_ITEMS = 5;
const COLLAPSE_THRESHOLD = 3;

export interface AttentionFeedProps {
  className?: string;
}

/**
 * AttentionFeed - Shows items needing attention on Home page
 */
export function AttentionFeed({ className }: AttentionFeedProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const currentMonth = getCurrentMonthKey();

  // Fetch guidance items for both currencies
  const { data: guidanceUSD = [], isLoading: loadingUSD } = useGuidance({
    month: currentMonth,
    currency: 'USD',
    includeUnpaidIncome: true,
    includeProjectedRetainer: true,
  });

  const { data: guidanceILS = [], isLoading: loadingILS } = useGuidance({
    month: currentMonth,
    currency: 'ILS',
    includeUnpaidIncome: true,
    includeProjectedRetainer: true,
  });

  const isLoading = loadingUSD || loadingILS;

  // Combine and sort items by severity
  const allItems = useMemo(() => {
    const combined = [...guidanceUSD, ...guidanceILS];

    // Sort by severity (critical > warning > info)
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    combined.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return combined;
  }, [guidanceUSD, guidanceILS]);

  // Determine visible items based on expansion state
  const visibleItems = useMemo(() => {
    if (allItems.length === 0) return [];

    // Always show critical items
    const criticalItems = allItems.filter(item => item.severity === 'critical');
    const otherItems = allItems.filter(item => item.severity !== 'critical');

    if (expanded || allItems.length <= COLLAPSE_THRESHOLD) {
      // Show all up to MAX_VISIBLE_ITEMS
      return allItems.slice(0, MAX_VISIBLE_ITEMS);
    }

    // Show critical items + some others up to COLLAPSE_THRESHOLD
    const remainingSlots = Math.max(0, COLLAPSE_THRESHOLD - criticalItems.length);
    return [...criticalItems, ...otherItems.slice(0, remainingSlots)].slice(0, MAX_VISIBLE_ITEMS);
  }, [allItems, expanded]);

  const hiddenCount = Math.min(allItems.length, MAX_VISIBLE_ITEMS) - visibleItems.length;
  const hasMore = hiddenCount > 0;

  if (isLoading) {
    return (
      <div className={cn('attention-feed', className)}>
        <div className="attention-header">
          <h3 className="attention-title">{t('home.attention.title')}</h3>
        </div>
        <div className="attention-loading">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('attention-feed', className)}>
      <div className="attention-header">
        <h3 className="attention-title">{t('home.attention.title')}</h3>
        {allItems.length > 0 && (
          <Link
            to="/income"
            search={{ status: 'unpaid' }}
            className="attention-view-all"
          >
            {t('home.attention.viewAll')} →
          </Link>
        )}
      </div>

      {allItems.length === 0 ? (
        <div className="attention-empty">
          <CheckCircleIcon />
          <p>{t('home.attention.empty')}</p>
        </div>
      ) : (
        <>
          <ul className="attention-list" role="list" aria-label={t('home.attention.title')}>
            {visibleItems.map(item => (
              <AttentionItem key={item.id} item={item} />
            ))}
          </ul>

          {(hasMore || (expanded && allItems.length > COLLAPSE_THRESHOLD)) && (
            <button
              className="attention-toggle"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              {expanded
                ? t('home.attention.showLess')
                : t('home.attention.showMore', { count: hiddenCount })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface AttentionItemProps {
  item: GuidanceItem;
}

function AttentionItem({ item }: AttentionItemProps) {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { openIncomeDrawer } = useDrawerStore();

  const handleAction = () => {
    if (!item.primaryAction) return;

    switch (item.primaryAction.type) {
      case 'openIncomeDrawer':
        // Open income drawer for the specific transaction
        if (item.primaryAction.payload?.entityId) {
          openIncomeDrawer({
            mode: 'edit',
            transactionId: item.primaryAction.payload.entityId as string,
          });
        }
        break;
      case 'navigateToIncome':
        // Navigate to income page with unpaid filter
        navigate({ to: '/income', search: { status: 'unpaid' } });
        break;
      case 'viewRetainers':
        // Navigate to retainers page
        navigate({ to: '/retainers' });
        break;
      default:
        // Default: navigate to income unpaid
        navigate({ to: '/income', search: { status: 'unpaid' } });
        break;
    }
  };

  const getActionLabel = () => {
    if (!item.primaryAction) return null;

    // Use translated labels
    if (item.primaryAction.type === 'openIncomeDrawer') {
      return t('home.attention.markPaid');
    }
    return t('home.attention.viewUnpaid');
  };

  return (
    <li className={cn('attention-item', `attention-item-${item.severity}`)} role="listitem">
      <div className="attention-item-icon" aria-hidden="true">
        {item.severity === 'critical' && <AlertCircleIcon />}
        {item.severity === 'warning' && <AlertTriangleIcon />}
        {item.severity === 'info' && <InfoCircleIcon />}
      </div>

      <div className="attention-item-content">
        <div className="attention-item-title">{item.title}</div>
        <div className="attention-item-amount">
          {formatAmountDisplay(item.impactMinor, item.impactCurrency, locale)}
        </div>
      </div>

      {item.primaryAction && (
        <button
          className="attention-item-action"
          onClick={handleAction}
          aria-label={`${getActionLabel()}: ${item.title}`}
        >
          {getActionLabel()}
        </button>
      )}
    </li>
  );
}

function formatAmountDisplay(amountMinor: number, currency: Currency, locale: string): string {
  return formatAmount(amountMinor, currency, locale);
}

// Icons
function AlertCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
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
