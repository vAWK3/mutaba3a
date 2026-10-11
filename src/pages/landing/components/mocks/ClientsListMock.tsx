import { useT } from '../../../../lib/i18n';
import { SAMPLE_CLIENTS, sampleOwedTotals } from '../../sampleData';
import { CountUpAmount } from './CountUpAmount';
import { useMockFormat } from './useMockFormat';

const TOTALS = sampleOwedTotals(SAMPLE_CLIENTS);

/**
 * The Clients list as the app shows it: Owed now per currency, then clients
 * ranked by what they owe, with overdue in red. The literal answer to
 * "Know who owes you." (brief L5).
 */
export function ClientsListMock() {
  const t = useT();
  const { money } = useMockFormat();

  return (
    <div className="landing-mock landing-mock--clients">
      <div className="landing-mock-header">
        <span className="landing-mock-title">{t('clients.title')}</span>
      </div>

      <div className="landing-mock-owed">
        <span className="landing-mock-label">{t('clients.columns.owedNow')}</span>
        <div className="landing-mock-totals">
          {TOTALS.map((total) => (
            <div key={total.currency} className="landing-mock-total">
              <CountUpAmount minor={total.owedMinor} currency={total.currency} />
              {total.overdueMinor > 0 ? (
                <span className="landing-mock-overdue">
                  {t('clients.profile.overdueAmount', {
                    amount: money(total.overdueMinor, total.currency),
                  })}
                </span>
              ) : (
                <span className="landing-mock-settled">{t('clients.profile.nothingOverdue')}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="landing-mock-client landing-mock-client--head" aria-hidden="true">
        <span>{t('clients.columns.client')}</span>
        <span>{t('clients.columns.owedNow')}</span>
        <span>{t('clients.columns.overdue')}</span>
      </div>
      <ul className="landing-mock-rows">
        {SAMPLE_CLIENTS.map((client) => {
          const overdue = client.owed.find((o) => o.overdueMinor > 0);
          return (
            <li key={client.id} className="landing-mock-client">
              <span className="landing-mock-client-name">{t(client.nameKey)}</span>
              <span className="landing-mock-client-owed">
                {client.owed.map((o) => (
                  <span key={o.currency}>{money(o.owedMinor, o.currency)}</span>
                ))}
              </span>
              <span className="landing-mock-client-overdue">
                {overdue && (
                  <>
                    <span className="landing-mock-overdue-amount">
                      {money(overdue.overdueMinor, overdue.currency)}
                    </span>
                    <span className="landing-mock-oldest">
                      {t('clients.index.oldestOverdue', { days: overdue.oldestOverdueDays ?? 0 })}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
