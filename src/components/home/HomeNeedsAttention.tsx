/**
 * HomeNeedsAttention
 *
 * "Who is late?" on Home (MUT-8): every receivable that is overdue or due
 * within 7 days, oldest due date first -- the list getAttentionReceivables
 * already returns. Bucketing goes through the shared ADR-010/022 helpers
 * (via toWorkRow); amounts stay in their own currency. A row opens its
 * client, or the entry itself when it has no client.
 */

import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAttentionReceivables } from '../../hooks/useIncomeQueries';
import { useDrawerStore } from '../../lib/stores';
import { toWorkRow } from '../clients/clientProfileRows';
import { CheckCircleIcon } from '../icons';
import { formatAmount } from '../../lib/utils';
import { todayLocalISO } from '../../lib/dates';
import { useT, useLanguage, getLocale } from '../../lib/i18n';

export interface HomeNeedsAttentionProps {
  profileId?: string;
}

export function HomeNeedsAttention({ profileId }: HomeNeedsAttentionProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const { openIncomeDrawer } = useDrawerStore();
  const { data: receivables = [], isLoading } = useAttentionReceivables(undefined, profileId);

  const today = todayLocalISO();
  const rows = useMemo(() => receivables.map((tx) => toWorkRow(tx, today)), [receivables, today]);

  const open = (clientId: string | undefined, transactionId: string) =>
    clientId
      ? navigate({ to: '/clients/$clientId', params: { clientId } })
      : openIncomeDrawer({ mode: 'edit', transactionId });

  return (
    <section className="card home-section" aria-labelledby="home-attention-title">
      <div className="card-header">
        <h2 id="home-attention-title" className="card-title">
          {t('overview.needsAttention')}
        </h2>
        {rows.length > 0 && <span className="home-section-count">{rows.length}</span>}
      </div>

      {isLoading ? null : rows.length === 0 ? (
        <div className="card-empty home-section-empty">
          <CheckCircleIcon size={20} />
          <p>{t('overview.noAttention')}</p>
        </div>
      ) : (
        <div className="data-table home-table">
          <table>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="clickable" onClick={() => open(row.tx.clientId, row.id)}>
                  <td className="home-row-main">
                    <span className="home-row-primary">{row.tx.clientName ?? t('overview.noClient')}</span>
                    <span className="home-row-secondary">{row.title ?? t('clients.profile.work.untitled')}</span>
                  </td>
                  <td className="amount-cell">
                    <bdi dir="ltr">{formatAmount(row.tx.remainingAmountMinor ?? row.amountMinor, row.currency, locale)}</bdi>
                    {row.overdueDays !== undefined ? (
                      <span className="home-row-status text-danger">
                        {t('transactions.status.overdue', { days: row.overdueDays })}
                      </span>
                    ) : (
                      row.dueInDays !== undefined && (
                        <span className="home-row-status">
                          {row.dueInDays === 0
                            ? t('transactions.status.dueToday')
                            : t('transactions.status.dueIn', { days: row.dueInDays })}
                        </span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
