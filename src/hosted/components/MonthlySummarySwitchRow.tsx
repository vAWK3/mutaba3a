import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../lib/i18n/core';
import { api } from '../api/client';
import { RowGroup, RowSwitch } from './YouRows';

export const MONTHLY_SUMMARY_KEY = ['monthly-summary-mail'] as const;

/**
 * MUT-535 (D7): You › Account's monthly summary switch. It shows the server's answer (on exactly when next month's run
 * would mail this person), so a Malafat-only person sees it off until they turn it on. Hidden until that answer comes,
 * and on a server without the route (no empty group either); a failed save says so in place and the switch keeps what the server has.
 */
export function MonthlySummarySwitchRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: MONTHLY_SUMMARY_KEY, queryFn: ({ signal }) => api.monthlySummaryMail(signal), retry: false });
  const change = useMutation({
    mutationFn: (on: boolean) => api.setMonthlySummaryMail(on),
    onMutate: () => queryClient.cancelQueries({ queryKey: MONTHLY_SUMMARY_KEY }),
    onSuccess: (answer) => queryClient.setQueryData(MONTHLY_SUMMARY_KEY, answer),
  });
  if (!state.data) return null;
  const on = change.isPending && change.variables !== undefined ? change.variables : state.data.on;
  return (
    <RowGroup>
      <RowSwitch label={t('hosted.monthlySummary.row')} sub={t('hosted.monthlySummary.rowSub')} on={on} busy={change.isPending} onToggle={() => change.mutate(!state.data.on)} />
      {change.isError && (
        <p role="status" className="hp-you-row-note">
          {t('hosted.monthlySummary.saveFailed')}
        </p>
      )}
    </RowGroup>
  );
}
