import { useEffect } from 'react';
import type { Period, ReportScope, Stage } from '../data/reports';
import { trackPortal } from './portalAnalytics';

/**
 * MUT-175 (D6): `report_viewed` once Reports settles on a period and scope —
 * debounced, so stepping through periods counts the one the person stopped on.
 * Never signed out (ADR-024), and never amounts, names or profile ids. Like
 * every portal event it is sent only when the person turned sharing on.
 * MUT-448: `layer` tells the account-level Glance from one profile's Reports
 * (taxonomy 2.3.0).
 */

export const REPORT_VIEWED_DEBOUNCE_MS = 1000;

/** Sends `properties` once they hold still for the debounce; null (not ready yet) sends nothing. */
function useSettledReportViewed(properties: Record<string, string> | null, local: boolean) {
  const settled = properties && !local ? JSON.stringify(properties) : null;
  useEffect(() => {
    if (settled === null) return;
    const timer = setTimeout(() => void trackPortal('report_viewed', JSON.parse(settled) as Record<string, string>), REPORT_VIEWED_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [settled]);
}

/** One profile's Reports (`/p/:id/reports`), once its stage is known. */
export function useReportViewed(period: Period, scope: ReportScope, stage: Stage | null, local: boolean) {
  useSettledReportViewed(stage === null ? null : { layer: 'profile', period, scope, stage: `stage_${stage}` }, local);
}

/** The Glance (`/reports`), once its verdict has answered. */
export function useGlanceViewed(period: Period, ready: boolean, local: boolean) {
  useSettledReportViewed(ready ? { layer: 'glance', period } : null, local);
}
