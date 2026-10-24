import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { Currency } from '../../api/client';
import { InfoIcon } from '../../components/Icons';
import { DecimalAmount, isZeroDecimal } from '../../format/DecimalAmount';
import type { CarryOverSummary } from '../../session/localBackendContract';

/**
 * What a carry-over brings (MUT-291 §3.6), shown before anything is saved:
 * the counts per kind, the totals per currency, what was changed to fit and
 * what didn't come, one line per kind with its count, and the JOD warning
 * (TD-112). Display only: the receive page and Your data › Restore put their
 * own buttons under it.
 */

const COUNT_ORDER = ['businesses', 'clients', 'projects', 'income', 'payments', 'expenses', 'receipts', 'conversions'] as const;
const TOTAL_FIELDS = ['paid', 'outstanding', 'expenses', 'convertedOut', 'convertedIn'] as const;

export function CarryOverDetails({ summary }: { summary: CarryOverSummary }) {
  const { t } = useLanguage();
  const tp = useTp();
  const counts = COUNT_ORDER.filter((kind) => (summary.counts[kind] ?? 0) > 0);
  const currencies = Object.keys(summary.totals).filter((currency) => TOTAL_FIELDS.some((field) => !isZeroDecimal(summary.totals[currency]?.[field] ?? '0')));
  const fields = TOTAL_FIELDS.filter((field) => currencies.some((currency) => !isZeroDecimal(summary.totals[currency]?.[field] ?? '0')));

  return (
    <div className="hp-carry-over-details">
      <dl className="hp-carry-over-counts" data-testid="carry-over-counts">
        {counts.map((kind) => (
          <div key={kind}>
            <dt>{t(`hosted.carryOver.receive.counts.${kind}`)}</dt>
            <dd>
              <bdi>{summary.counts[kind]}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      {currencies.length > 0 && (
        <div className="hp-carry-over-totals hp-table-wrapper">
          <h3>{t('hosted.carryOver.receive.totalsTitle')}</h3>
          <table className="table" data-testid="carry-over-totals">
            <thead>
              <tr>
                <th scope="col">{t('hosted.carryOver.receive.totals.currency')}</th>
                {fields.map((field) => (
                  <th key={field} scope="col" className="hp-num">
                    {t(`hosted.carryOver.receive.totals.${field}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currencies.map((currency) => (
                <tr key={currency} data-currency={currency}>
                  <th scope="row">
                    <bdi>{currency}</bdi>
                  </th>
                  {fields.map((field) => (
                    <td key={field} data-field={field} className="hp-num">
                      <DecimalAmount value={summary.totals[currency]?.[field] ?? '0'} currency={currency as Currency} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.jodEntries > 0 && (
        <div className="hp-banner hp-banner-info" role="note" data-testid="carry-over-jod">
          <InfoIcon />
          <span>{tp('hosted.carryOver.receive.jod', summary.jodEntries)}</span>
        </div>
      )}

      {summary.changed.length === 0 && summary.notCarried.length === 0 ? (
        <p className="hp-muted">{t('hosted.carryOver.receive.everythingCame')}</p>
      ) : (
        <>
          <ReportList title={t('hosted.carryOver.receive.changedTitle')} lines={summary.changed} prefix="hosted.carryOver.changed" testId="carry-over-changed" />
          <ReportList title={t('hosted.carryOver.receive.notCarriedTitle')} lines={summary.notCarried} prefix="hosted.carryOver.notCarried" testId="carry-over-not-carried" />
        </>
      )}
    </div>
  );
}

function ReportList({ title, lines, prefix, testId }: { title: string; lines: CarryOverSummary['notCarried']; prefix: string; testId: string }) {
  const { t } = useLanguage();
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, line) => sum + line.count, 0);
  return (
    <details className="hp-carry-over-report" data-testid={testId}>
      <summary>
        {title} <bdi className="hp-chip">{total}</bdi>
      </summary>
      <ul>
        {lines.map((line) => (
          <li key={`${line.code}:${line.reason ?? ''}`} data-code={line.code}>
            <span>{t(`${prefix}.${line.code}`, { reason: line.reason ?? '' })}</span> <bdi className="hp-chip">{line.count}</bdi>
          </li>
        ))}
      </ul>
    </details>
  );
}
