/**
 * HomeRecentPayments
 *
 * "What came in?" on Home (MUT-8): the last 10 payments across every client
 * -- the same payment rows as a client's Payments section (ADR-033), so
 * income saved as Received counts. Each amount stays in its own currency;
 * nothing is totalled. A row opens its client, or the entry when it has none.
 */

import { useNavigate } from '@tanstack/react-router';
import { useRecentPayments } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { RecentPaymentRow } from '../../types';

export interface HomeRecentPaymentsProps {
  profileId?: string;
}

export function HomeRecentPayments({ profileId }: HomeRecentPaymentsProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const { openIncomeDrawer } = useDrawerStore();
  // Rows arrive shaped from the repository: newest first, client named, at most 10
  const { data: payments = [], isLoading } = useRecentPayments(profileId);

  const open = (payment: RecentPaymentRow) =>
    payment.clientId
      ? navigate({ to: '/clients/$clientId', params: { clientId: payment.clientId } })
      : openIncomeDrawer({ mode: 'edit', transactionId: payment.transactionId });

  return (
    <section className="card home-section" aria-labelledby="home-payments-title">
      <div className="card-header">
        <h2 id="home-payments-title" className="card-title">
          {t('overview.recentPayments')}
        </h2>
      </div>

      {isLoading ? null : payments.length === 0 ? (
        <div className="card-empty">{t('overview.noPayments')}</div>
      ) : (
        <div className="data-table home-table">
          <table>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="clickable" onClick={() => open(payment)}>
                  <td className="home-row-main">
                    <span className="home-row-primary">{payment.clientName ?? t('overview.noClient')}</span>
                    <span className="home-row-secondary">
                      {payment.transactionTitle ?? t('clients.profile.work.untitled')}
                    </span>
                  </td>
                  <td className="home-row-date">{formatDate(payment.paidAt, locale)}</td>
                  <td className="amount-cell amount-positive">
                    <bdi dir="ltr">{formatAmount(payment.amountMinor, payment.currency, locale)}</bdi>
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
