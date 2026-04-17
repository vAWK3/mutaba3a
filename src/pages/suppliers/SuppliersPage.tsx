import { Fragment, useMemo, useState } from 'react';
import { TopBar } from '../../components/layout';
import { EmptyState } from '../../components/ui';
import { useExpenses, useVendors } from '../../hooks/useExpenseQueries';
import { useActiveProfile, useProfileFilter } from '../../hooks/useActiveProfile';
import { formatAmount } from '../../lib/utils';
import { getLocale, useLanguage, useT } from '../../lib/i18n';
import type { Currency } from '../../types';
import './SuppliersPage.css';

const SUPPORTED_CURRENCIES: Currency[] = ['USD', 'ILS', 'EUR'];

interface MonthlyTotal {
  month: number;
  totals: Record<Currency, number>;
}

interface SupplierRow {
  id: string;
  name: string;
  expenseCount: number;
  totals: Record<Currency, number>;
  monthly: MonthlyTotal[];
}

function zeroCurrencies(): Record<Currency, number> {
  return { USD: 0, ILS: 0, EUR: 0 };
}

function getMonthLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2025, i, 1)));
}

export function SuppliersPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { activeProfile } = useActiveProfile();
  const profileId = useProfileFilter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const monthLabels = useMemo(() => getMonthLabels(locale), [locale]);

  const { data: vendors = [], isLoading: vendorsLoading } = useVendors(profileId);
  const { data: expenses = [], isLoading: expensesLoading } = useExpenses({
    profileId,
    year,
    sort: { by: 'occurredAt', dir: 'desc' },
  });

  const suppliers = useMemo((): SupplierRow[] => {
    const map = new Map<string, SupplierRow>(
      vendors.map((v) => [
        v.id,
        {
          id: v.id,
          name: v.canonicalName,
          expenseCount: 0,
          totals: zeroCurrencies(),
          monthly: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            totals: zeroCurrencies(),
          })),
        },
      ])
    );

    for (const exp of expenses) {
      if (!exp.vendorId) continue;
      const row = map.get(exp.vendorId);
      if (!row) continue;
      const cur = exp.currency;
      const mi = new Date(exp.occurredAt).getMonth();
      row.expenseCount += 1;
      row.totals[cur] += exp.amountMinor;
      row.monthly[mi].totals[cur] += exp.amountMinor;
    }

    return Array.from(map.values())
      .filter((r) => r.expenseCount > 0)
      .sort((a, b) => {
        const ta = a.totals.USD + a.totals.ILS + a.totals.EUR;
        const tb = b.totals.USD + b.totals.ILS + b.totals.EUR;
        return tb - ta || a.name.localeCompare(b.name);
      });
  }, [expenses, vendors]);

  const isLoading = vendorsLoading || expensesLoading;

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => cur - i);
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!activeProfile || !profileId) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>{t('suppliers.noProfile')}</p>
      </div>
    );
  }

  return (
    <>
      <TopBar
        title={t('suppliers.title')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <select
              className="select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label={t('suppliers.year')}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        }
      />

      <div className="page-content">
        <p className="text-muted suppliers-hint">{t('suppliers.hint')}</p>

        <div className="inline-stats" style={{ marginBottom: 16 }}>
          <div className="inline-stat">
            <span className="inline-stat-label">{t('suppliers.totalSuppliers')}</span>
            <span className="inline-stat-value">{suppliers.length}</span>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            {t('common.loading')}
          </div>
        ) : suppliers.length === 0 ? (
          <EmptyState
            title={t('suppliers.empty')}
            hint={t('suppliers.emptyHint')}
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('suppliers.name')}</th>
                  <th style={{ textAlign: 'end' }}>{t('suppliers.expenses')}</th>
                  <th style={{ textAlign: 'end' }}>{t('suppliers.totalSpent')} ({year})</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => {
                  const expanded = expandedIds.has(s.id);
                  const hasAmounts = SUPPORTED_CURRENCIES.some((c) => s.totals[c] > 0);

                  return (
                    <Fragment key={s.id}>
                      <tr>
                        <td className="suppliers-name-cell">{s.name}</td>
                        <td style={{ textAlign: 'end' }}>{s.expenseCount}</td>
                        <td style={{ textAlign: 'end' }}>
                          {hasAmounts ? (
                            <span className="suppliers-total-cell">
                              {SUPPORTED_CURRENCIES.map((c) => {
                                if (s.totals[c] <= 0) return null;
                                return (
                                  <span key={c} className="amount-negative">
                                    {formatAmount(s.totals[c], c, locale)}
                                  </span>
                                );
                              })}
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'end' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => toggleExpand(s.id)}
                          >
                            {expanded ? t('suppliers.hideMonthly') : t('suppliers.showMonthly')}
                          </button>
                        </td>
                      </tr>

                      {expanded && (
                        <tr>
                          <td colSpan={4}>
                            <div className="suppliers-monthly-panel">
                              <div className="data-table">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>{t('suppliers.month')}</th>
                                      {SUPPORTED_CURRENCIES.flatMap((c) => {
                                        if (s.totals[c] <= 0) return [];
                                        return [
                                          <th key={c} style={{ textAlign: 'end' }}>{c}</th>,
                                          <th key={`${c}-d`} style={{ textAlign: 'end' }}>{t('suppliers.delta')}</th>,
                                        ];
                                      })}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.monthly.map((md, idx) => {
                                      const prev = idx > 0 ? s.monthly[idx - 1] : undefined;
                                      return (
                                        <tr key={md.month}>
                                          <td>{monthLabels[idx]}</td>
                                          {SUPPORTED_CURRENCIES.flatMap((c) => {
                                            if (s.totals[c] <= 0) return [];
                                            const cur = md.totals[c];
                                            const prv = prev?.totals[c] ?? 0;
                                            const delta = cur - prv;
                                            return [
                                              <td key={c} style={{ textAlign: 'end' }}>
                                                {cur > 0 ? formatAmount(cur, c, locale) : '-'}
                                              </td>,
                                              <td key={`${c}-d`} style={{ textAlign: 'end' }}>
                                                {idx === 0 || delta === 0
                                                  ? '-'
                                                  : `${delta > 0 ? '+' : ''}${formatAmount(delta, c, locale)}`}
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
