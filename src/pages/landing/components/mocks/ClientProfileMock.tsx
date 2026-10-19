import { useT } from '../../../../lib/i18n';
import { useTp } from '../../../../lib/i18n/plural';
import { SAMPLE_CLIENT, SAMPLE_WORK, type SampleWorkRow } from '../../sampleData';
import { useMockFormat } from './useMockFormat';

function StatusBadge({ row }: { row: SampleWorkRow }) {
  const t = useT();
  const tp = useTp();
  const label =
    row.status === 'overdue'
      ? tp('transactions.status.overdue', row.daysOverdue ?? 0)
      : t(`transactions.status.${row.status}`);

  return <span className={`landing-mock-badge landing-mock-badge--${row.status}`}>{label}</span>;
}

/** A client's page: Owed now first, then the work and what each piece is worth. */
export function ClientProfileMock() {
  const t = useT();
  const { money, date } = useMockFormat();

  return (
    <div className="landing-mock">
      <div className="landing-mock-header">
        <span className="landing-mock-title">{t(SAMPLE_CLIENT.nameKey)}</span>
      </div>

      <div className="landing-mock-owed">
        <span className="landing-mock-label">{t('clients.profile.owedNow')}</span>
        <span className="landing-mock-amount">
          {money(SAMPLE_CLIENT.owedMinor, SAMPLE_CLIENT.currency)}
        </span>
        <span className="landing-mock-overdue">
          {t('clients.profile.overdueAmount', {
            amount: money(SAMPLE_CLIENT.overdueMinor, SAMPLE_CLIENT.currency),
          })}
        </span>
      </div>

      <div className="landing-mock-section-title">{t('clients.profile.work.title')}</div>
      <ul className="landing-mock-rows">
        {SAMPLE_WORK.map((row) => (
          <li key={row.id} className="landing-mock-row">
            <span className="landing-mock-date">{date(row.date)}</span>
            <span className="landing-mock-what">{t(row.titleKey)}</span>
            <span className="landing-mock-money">{money(row.amountMinor, row.currency)}</span>
            <StatusBadge row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
