import { useEffect } from 'react';
import { trackPortal } from './portalAnalytics';

/**
 * MUT-175 (D6): `report_viewed` once Reports settles on a period and scope —
 * debounced, so stepping through periods counts the one the person stopped on.
 * Never signed out (ADR-024), and never amounts, names or profile ids. Like
 * every portal event it is sent only when the person turned sharing on.
 */

export const REPORT_VIEWED_DEBOUNCE_MS = 1000;

export function useReportViewed(period: 'week' | 'month' | 'year', scope: 'profile' | 'all', stage: 1 | 2 | 3 | null, local: boolean) {
  useEffect(() => {
    if (local || stage === null) return;
    const timer = setTimeout(() => void trackPortal('report_viewed', { period, scope, stage: `stage_${stage}` }), REPORT_VIEWED_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [period, scope, stage, local]);
}
