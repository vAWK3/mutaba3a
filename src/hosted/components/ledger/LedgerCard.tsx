import { Fragment } from 'react';
import { Link } from '@tanstack/react-router';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { Currency, StatementLine } from '../../api/client';
import { LEDGER_PERIODS, type LedgerPeriod } from '../../data/filters';
import { useCustomerStatement } from '../../data/statementQueries';
import { formatDecimal, isZeroDecimal } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { formatBalance, formatMonth } from '../../format/ledger';
import { Empty, QueryView, Skeleton } from '../QueryView';

/**
 * MUT-664: the client's ledger card (כרטסת), layout A. Newest first (D14), 50 lines a page with "Show earlier"; one
 * card per currency, never summed; a month row carries the balance at that month's end; a balance below zero reads
 * "Client in credit" (D15). Documents never move the balance: they are tags beside the line, and "due" says what is
 * still to issue. Read-only for everyone; a row opens its entry, a tag its document.
 */

export interface LedgerCardProps {
  profileId: string;
  customerId: string;
  currencies: readonly Currency[];
  currency: Currency | undefined;
  period: LedgerPeriod;
  writable: boolean;
  onChange: (next: { currency?: Currency; period?: LedgerPeriod }) => void;
  /** What a row opens (record a payment, re-date), or null where nothing can be done here: the row is then plain text. */
  openLine: (line: StatementLine) => (() => void) | null;
}

export function LedgerCard({ profileId, customerId, currencies, currency, period, writable, onChange, openLine }: LedgerCardProps) {
  const { t, language } = useLanguage();
  const active = currency && currencies.includes(currency) ? currency : currencies[0];
  const statement = useCustomerStatement(profileId, customerId, active, period);
  if (!active) return <Empty title={t('hosted.ledger.empty.title')} body={t('hosted.ledger.empty.body')} />;

  const balance = (value: string) => {
    const b = formatBalance(value, active, language);
    return b.inCredit ? (
      <bdi className="hp-ledger-credit" data-testid="ledger-in-credit">
        {t('hosted.ledger.inCredit', { amount: b.text })}
      </bdi>
    ) : (
      <bdi>{b.text}</bdi>
    );
  };
  const money = (value: string) => (isZeroDecimal(value) ? '' : <bdi>{formatDecimal(value, active, language)}</bdi>);

  return (
    <section className="hp-ledger" aria-label={t('hosted.ledger.title')} data-testid="ledger-card">
      <div className="hp-ledger-controls">
        {currencies.length > 1 && (
          <SegmentedTabs<Currency> className="hp-tabs" options={currencies.map((c) => ({ value: c, label: c }))} value={active} onChange={(next) => onChange({ currency: next, period })} />
        )}
        <label className="hp-ledger-period">
          <span>{t('hosted.ledger.period')}</span>
          <select value={period} onChange={(e) => onChange({ currency: active, period: e.target.value as LedgerPeriod })} data-testid="ledger-period">
            {LEDGER_PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`hosted.ledger.periods.${p}`)}
              </option>
            ))}
          </select>
        </label>
        {!writable && <span className="hp-chip">{t('hosted.ledger.viewOnly')}</span>}
      </div>
      <QueryView queries={[statement]} data={statement.data} loading={<Skeleton />}>
        {({ head, lines }) =>
          lines.length === 0 ? (
            <Empty title={t('hosted.ledger.empty.title')} body={t('hosted.ledger.empty.body')} />
          ) : (
            <>
              <p className="hp-ledger-closing" data-testid="ledger-closing">
                <span>{t('hosted.ledger.closing')}</span> <strong>{balance(head.closingBalance)}</strong>
              </p>
              <table className="hp-issued-table hp-ledger-table">
                <thead>
                  <tr>
                    <th scope="col">{t('hosted.ledger.cols.date')}</th>
                    <th scope="col">{t('hosted.ledger.cols.movement')}</th>
                    <th scope="col">{t('hosted.ledger.cols.document')}</th>
                    <th scope="col" className="hp-num">
                      {t('hosted.ledger.cols.debit')}
                    </th>
                    <th scope="col" className="hp-num">
                      {t('hosted.ledger.cols.credit')}
                    </th>
                    <th scope="col" className="hp-num">
                      {t('hosted.ledger.cols.balance')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <Fragment key={line.id}>
                      {(i === 0 || lines[i - 1]!.date.slice(0, 7) !== line.date.slice(0, 7)) && (
                        <tr className="hp-ledger-month">
                          <th scope="rowgroup" colSpan={5}>
                            {formatMonth(line.date, language)}
                          </th>
                          <td className="hp-num">{balance(line.runningBalance)}</td>
                        </tr>
                      )}
                      <tr className="hp-ledger-row" data-testid="ledger-line">
                        <td>{formatDay(line.date, language)}</td>
                        <td>{rowAction(openLine(line), movement(t, line))}</td>
                        <td>
                          <span className="hp-ledger-tags">
                            {line.documents.map((d) =>
                              d.id ? (
                                <Link key={`${d.docType}-${d.number}`} className="hp-chip" to={`/p/${profileId}/documents/issued/${d.id}`}>
                                  {t(`hosted.issue.types.${d.docType}`)} {d.number}
                                </Link>
                              ) : (
                                <span key={`${d.docType}-${d.number}`} className="hp-chip">
                                  {t(`hosted.issue.types.${d.docType}`)} {d.number}
                                </span>
                              ),
                            )}
                            {line.due && (
                              <span className="hp-chip hp-chip-due" data-testid="ledger-due">
                                {t(`hosted.ledger.due.${line.due}`)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="hp-num">{money(line.debit)}</td>
                        <td className="hp-num">{money(line.credit)}</td>
                        <td className="hp-num">{balance(line.runningBalance)}</td>
                      </tr>
                    </Fragment>
                  ))}
                  {!statement.hasNextPage && (head.from !== null || !isZeroDecimal(head.openingBalance)) && (
                    <tr className="hp-ledger-month">
                      <th scope="row" colSpan={5}>
                        {t('hosted.ledger.opening')}
                      </th>
                      <td className="hp-num">{balance(head.openingBalance)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {statement.hasNextPage && (
                <Button variant="secondary" onClick={() => void statement.fetchNextPage()} disabled={statement.isFetchingNextPage} data-testid="ledger-earlier">
                  {t('hosted.ledger.showEarlier')}
                </Button>
              )}
            </>
          )
        }
      </QueryView>
    </section>
  );
}

function rowAction(open: (() => void) | null, label: string) {
  return open ? (
    <button type="button" className="hp-link" onClick={open}>
      {label}
    </button>
  ) : (
    label
  );
}

function movement(t: (key: string, vars?: Record<string, string>) => string, line: StatementLine): string {
  const number = line.number ? ` ${line.number}` : '';
  return `${t(`hosted.ledger.kinds.${line.kind}`)}${number}`;
}
