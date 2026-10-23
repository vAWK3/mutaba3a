import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../api/client';
import { AlertIcon } from './Icons';
import { ME_KEY } from '../session/me';
import { useFocusOnMount } from './focusOnMount';

/**
 * The four states of every view (hosted-portal.md §7.5): loading, empty, error,
 * populated. The rule that matters: **a view in error renders no data**. After a
 * failed refetch TanStack Query keeps the last `data`; it is ignored here, so a
 * figure on screen is always one the server just confirmed. A 404 also asks
 * `/v1/me` again, in case the profile itself was removed (auth-states S12).
 */

export interface QueryState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  isRefetching?: boolean;
}

interface QueryViewProps<T> {
  queries: QueryState[];
  data: T | undefined;
  isEmpty?: (data: T) => boolean;
  loading?: ReactNode;
  empty?: ReactNode;
  notFound?: ReactNode;
  children: (data: T) => ReactNode;
}

export function QueryView<T>({ queries, data, isEmpty, loading, empty, notFound, children }: QueryViewProps<T>) {
  const queryClient = useQueryClient();
  const errors = queries.filter((q) => q.isError).map((q) => q.error);
  const lostProfile = errors.some((e) => e instanceof ApiError && e.status === 404);

  useEffect(() => {
    if (lostProfile) void queryClient.invalidateQueries({ queryKey: ME_KEY });
  }, [lostProfile, queryClient]);

  if (errors.length > 0) {
    if (lostProfile && notFound) return <>{notFound}</>;
    return <Unreachable onRetry={() => queries.filter((q) => q.isError).forEach((q) => q.refetch())} />;
  }
  if (queries.some((q) => q.isPending) || data === undefined) return <>{loading ?? <Skeleton />}</>;
  if (isEmpty?.(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}

export function Unreachable({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="hp-card hp-unreachable" role="alert">
      <AlertIcon />
      <div>
        <h2>{t('hosted.states.unreachable.title')}</h2>
        <p>{t('hosted.states.unreachable.body')}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('hosted.states.unreachable.retry')}
      </Button>
    </div>
  );
}

/**
 * A page crashed (MUT-149 design D3–D7): the router shows this in place of the
 * page, so the shell and its navigation stay usable, and leaving the page
 * clears it. Unreachable's layout, one Reload, never the error's own text.
 */
export function CrashCard() {
  const t = useT();
  const title = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="hp-card hp-unreachable" role="alert">
      <AlertIcon />
      <div>
        <h2 ref={title} tabIndex={-1}>
          {t('hosted.crash.title')}
        </h2>
        <p>{t('hosted.crash.body')}</p>
      </div>
      <Button onClick={() => window.location.reload()}>{t('hosted.crash.reload')}</Button>
    </div>
  );
}

const SKELETON_ROWS = 2;

/** Loading: a strip and two table rows of placeholders (or `rows`), never a number. */
export function Skeleton({ strip = false, rows = SKELETON_ROWS }: { strip?: boolean; rows?: number }) {
  const t = useT();
  return (
    <div className="hp-skeleton" aria-busy="true" aria-label={t('hosted.states.loading')}>
      {strip && (
        <div className="hp-skeleton-strip">
          <span />
          <span />
          <span />
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="hp-skeleton-row" />
      ))}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="hp-empty">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}
