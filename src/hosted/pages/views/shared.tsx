/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { useT } from '../../../lib/i18n/core';

/** Status words and the "show more" footer shared by the list views. */

const ITEM_VARIANT: Record<string, BadgeVariant> = {
  OVERDUE: 'overdue',
  DUE: 'unpaid',
  OUTSTANDING: 'unpaid',
  PARTIALLY_PAID: 'warning',
  PAID: 'paid',
  PAID_IN_FULL: 'paid',
  SETTLED: 'paid',
  UP_TO_DATE: 'success',
  POSTED: 'neutral',
  REVERSED: 'neutral',
};

export type StatusFamily = 'item' | 'customer' | 'project' | 'payment';

export function StatusBadge({ family, status }: { family: StatusFamily; status: string }) {
  const t = useT();
  return (
    <Badge variant={ITEM_VARIANT[status] ?? 'neutral'} size="sm">
      {t(`hosted.status.${family}.${status}`)}
    </Badge>
  );
}

export function ShowMore({ hasMore, loading, onMore }: { hasMore: boolean; loading: boolean; onMore: () => void }) {
  const t = useT();
  if (!hasMore) return null;
  return (
    <div className="hp-more">
      <Button variant="secondary" size="sm" onClick={onMore} disabled={loading}>
        {t(loading ? 'hosted.states.loadingMore' : 'hosted.states.showMore')}
      </Button>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="hp-page-header">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function NoMatch({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <div className="hp-empty">
      <p>{t('hosted.states.noMatch')}</p>
      <Button variant="secondary" size="sm" onClick={onClear}>
        {t('hosted.states.clearFilters')}
      </Button>
    </div>
  );
}

/** Later of two calendar dates; ISO `YYYY-MM-DD` strings order lexically. */
export function laterDay(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
