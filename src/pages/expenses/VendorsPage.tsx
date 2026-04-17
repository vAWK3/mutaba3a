import { Fragment, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { EmptyState } from '../../components/ui';
import { useExpenses, useVendors } from '../../hooks/useExpenseQueries';
import { useActiveProfile, useProfileFilter } from '../../hooks/useActiveProfile';
import { formatAmount } from '../../lib/utils';
import { getLocale, useLanguage, useT } from '../../lib/i18n';
import type { Currency } from '../../types';
import './VendorsPage.css';

const SUPPORTED_CURRENCIES: Currency[] = ['USD', 'ILS', 'EUR'];

interface VendorMonthlyData {
  month: number;
  totals: Record<Currency, number>;
}

interface VendorSummary {
  id: string;
  name: string;
  expenseCount: number;
  totals: Record<Currency, number>;
  monthly: VendorMonthlyData[];
}

function initCurrencyTotals(): Record<Currency, number> {
  return {
    USD: 0,
    ILS: 0,
    EUR: 0,
  };
}

function getMonthLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short' });
  return Array.from({ length: 12 }, (_, monthIndex) =>
    formatter.format(new Date(2025, monthIndex, 1))
  );
}

export function VendorsPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { activeProfile } = useActiveProfile();
  const profileId = useProfileFilter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [expandedVendorIds, setExpandedVendorIds] = useState<Set<string>>(new Set());

  const monthLabels = useMemo(() => getMonthLabels(locale), [locale]);

  const { data: vendors = [], isLoading: vendorsLoading } = useVendors(profileId);
  const { data: expenses = [], isLoading: expensesLoading } = useExpenses({
    profileId,
    year,
    sort: { by: 'occurredAt', dir: 'desc' },
  });

  const vendorSummaries = useMemo((): VendorSummary[] => {
    const vendorMap = new Map<string, VendorSummary>(
      vendors.map((vendor) => [
        vendor.id,
        {
          id: vendor.id,
          name: vendor.canonicalName,
          expenseCount: 0,
          totals: initCurrencyTotals(),
          monthly: Array.from({ length: 12 }, (_, idx) => ({
            month: idx + 1,
            totals: initCurrencyTotals(),
          })),
        },
      ])
    );

    for (const expense of expenses) {
      if (!expense.vendorId) continue;
      const summary = vendorMap.get(expense.vendorId);
      if (!summary) continue;

      const currency = expense.currency;
      const monthIndex = new Date(expense.occurredAt).getMonth();

      summary.expenseCount += 1;
      summary.totals[currency] += expense.amountMinor;
      summary.monthly[monthIndex].totals[currency] += expense.amountMinor;
    }

    return Array.from(vendorMap.values()).sort((a, b) => {
      const totalA = a.totals.USD + a.totals.ILS + a.totals.EUR;
      const totalB = b.totals.USD + b.totals.ILS + b.totals.EUR;
      if (totalA !== totalB) return totalB - totalA;
      return a.name.localeCompare(b.name);
    });
  }, [expenses, vendors]);

  const isLoading = vendorsLoading || expensesLoading;

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => currentYear - i);
  }, []);

  const totalVendorsWithExpenses = vendorSummaries.filter((v) => v.expenseCount > 0).length;

  const toggleVendorDetails = (vendorId: string) => {
    setExpandedVendorIds((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) {
        next.delete(vendorId);
      } else {
        next.add(vendorId);
      }
      return next;
    });
  };

  if (!activeProfile || !profileId) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>{t('expenses.noProfileSelected')}</p>
      </div>
    );
  }

  return (
    <>
      <TopBar
        title={t('expenses.vendors.title')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <select
              className="select"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              aria-label={t('expenses.year')}
            >
              {yearOptions.map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="page-content">
        <div className="vendors-page-header-row">
          <p className="text-muted vendors-page-hint">{t('expenses.vendors.hint')}</p>
          <Link to="/expenses" className="btn btn-ghost btn-sm">
            {t('expenses.vendors.backToExpenses')}
          </Link>
        </div>

        <div className="inline-stats" style={{ marginBottom: 16 }}>
          <div className="inline-stat">
            <span className="inline-stat-label">{t('expenses.vendors.definedVendors')}</span>
            <span className="inline-stat-value">{vendors.length}</span>
          </div>
          <div className="inline-stat">
            <span className="inline-stat-label">{t('expenses.vendors.activeInYear', { year })}</span>
            <span className="inline-stat-value">{totalVendorsWithExpenses}</span>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            {t('common.loading')}
          </div>
        ) : vendorSummaries.length === 0 ? (
          <EmptyState
            title={t('expenses.vendors.empty')}
            hint={t('expenses.vendors.emptyHint')}
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('expenses.columns.vendor')}</th>
                  <th style={{ textAlign: 'end' }}>{t('expenses.vendors.expenseCount')}</th>
                  <th style={{ textAlign: 'end' }}>{t('expenses.totalExpenses')} ({year})</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {vendorSummaries.map((vendor) => {
                  const isExpanded = expandedVendorIds.has(vendor.id);
                  const hasAmounts = SUPPORTED_CURRENCIES.some((currency) => vendor.totals[currency] > 0);

                  return (
                    <Fragment key={vendor.id}>
                      <tr key={vendor.id}>
                        <td>{vendor.name}</td>
                        <td style={{ textAlign: 'end' }}>{vendor.expenseCount}</td>
                        <td style={{ textAlign: 'end' }}>
                          {hasAmounts ? (
                            <span className="vendors-total-cell">
                              {SUPPORTED_CURRENCIES.map((currency) => {
                                const amount = vendor.totals[currency];
                                if (amount <= 0) return null;
                                return (
                                  <span key={`${vendor.id}-${currency}`} className="amount-negative">
                                    {formatAmount(amount, currency, locale)}
                                  </span>
                                );
                              })}
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleVendorDetails(vendor.id)}>
                            {isExpanded
                              ? t('expenses.vendors.hideMonthlyVariation')
                              : t('expenses.vendors.showMonthlyVariation')}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={4}>
                            <div className="vendors-monthly-panel">
                              <div className="data-table">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>{t('expenses.vendors.month')}</th>
                                      <th style={{ textAlign: 'end' }}>USD</th>
                                      <th style={{ textAlign: 'end' }}>{t('expenses.vendors.delta')}</th>
                                      <th style={{ textAlign: 'end' }}>ILS</th>
                                      <th style={{ textAlign: 'end' }}>{t('expenses.vendors.delta')}</th>
                                      <th style={{ textAlign: 'end' }}>EUR</th>
                                      <th style={{ textAlign: 'end' }}>{t('expenses.vendors.delta')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {vendor.monthly.map((monthData, index) => {
                                      const prevMonth = index > 0 ? vendor.monthly[index - 1] : undefined;

                                      return (
                                        <tr key={`${vendor.id}-${monthData.month}`}>
                                          <td>{monthLabels[index]}</td>
                                          {SUPPORTED_CURRENCIES.flatMap((currency) => {
                                            const currentAmount = monthData.totals[currency];
                                            const prevAmount = prevMonth?.totals[currency] ?? 0;
                                            const delta = currentAmount - prevAmount;

                                            return [
                                              <td key={`${vendor.id}-${monthData.month}-${currency}`} style={{ textAlign: 'end' }}>
                                                {currentAmount > 0 ? formatAmount(currentAmount, currency, locale) : '-'}
                                              </td>,
                                              <td key={`${vendor.id}-${monthData.month}-${currency}-delta`} style={{ textAlign: 'end' }}>
                                                {index === 0
                                                  ? '-'
                                                  : delta === 0
                                                    ? '-'
                                                    : `${delta > 0 ? '+' : ''}${formatAmount(delta, currency, locale)}`}
                                              </td>,
                                            ];
                                          })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
