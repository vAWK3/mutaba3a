import { useState, useMemo } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs } from '../../components/filters';
import { RowActionsMenu } from '../../components/ui';
import { CopyIcon, TrashIcon } from '../../components/icons';
import {
  useExpenses,
  useExpenseYearlyTotals,
  useRecurringRules,
  useDeleteExpense,
  usePauseRecurringRule,
  useResumeRecurringRule,
  useDeleteRecurringRule,
  useExpenseCategories,
  useSeedExpenseCategories,
} from '../../hooks/useExpenseQueries';
import type { CategoryPreset } from '../../db/defaultExpenseCategories';
import { useBusinessProfile } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, ExpenseFilters } from '../../types';
import './ProfileExpensesPage.css';
import '../../components/modals/DeleteAllDataModal.css';

export function ProfileExpensesPage() {
  const { profileId } = useParams({ from: '/expenses/profile/$profileId' });
  const { openExpenseDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showRecurring, setShowRecurring] = useState(true);
  const [showCategorySetup, setShowCategorySetup] = useState(false);

  const { data: profile, isLoading: profileLoading } = useBusinessProfile(profileId);
  const { data: totals } = useExpenseYearlyTotals(profileId, year);
  const { data: categories = [] } = useExpenseCategories(profileId);
  const { data: recurringRules = [] } = useRecurringRules(profileId);

  const deleteExpenseMutation = useDeleteExpense();
  const pauseRuleMutation = usePauseRecurringRule();
  const resumeRuleMutation = useResumeRecurringRule();
  const deleteRuleMutation = useDeleteRecurringRule();

  const filters = useMemo((): ExpenseFilters => ({
    profileId,
    year,
    currency,
    categoryId: categoryId || undefined,
    search: search || undefined,
    sort: { by: 'occurredAt', dir: 'desc' },
  }), [profileId, year, currency, categoryId, search]);

  const { data: expenses = [], isLoading: expensesLoading } = useExpenses(filters);

  // Year options
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const handleRowClick = (id: string) => {
    openExpenseDrawer({ mode: 'edit', expenseId: id, defaultProfileId: profileId });
  };

  const handleAddExpense = () => {
    openExpenseDrawer({ mode: 'create', defaultProfileId: profileId });
  };

  const handleAddRecurring = () => {
    openExpenseDrawer({ mode: 'create', defaultProfileId: profileId, isRecurring: true });
  };

  if (profileLoading) {
    return (
      <>
        <TopBar
          title={t('common.loading')}
          breadcrumbs={[{ label: t('nav.expenses'), href: '/expenses' }]}
        />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <TopBar
          title={t('expenses.profileNotFound')}
          breadcrumbs={[{ label: t('nav.expenses'), href: '/expenses' }]}
        />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.profileNotFound')}</h3>
            <p className="empty-state-description">{t('expenses.profileNotFoundHint')}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={profile.name}
        breadcrumbs={[
          { label: t('nav.expenses'), href: '/expenses' },
          { label: profile.name },
        ]}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <select
              className="select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        }
        rightSlot={
          <Link
            to="/expenses/profile/$profileId/receipts"
            params={{ profileId }}
            className="btn btn-ghost"
          >
            {t('expenses.manageReceipts')}
          </Link>
        }
      />
      <div className="page-content">
        {/* Stats Row */}
        {totals && (
          <div className="inline-stats" style={{ marginBottom: 24 }}>
            <div className="inline-stat">
              <span className="inline-stat-label">USD ({year})</span>
              <span className="inline-stat-value amount-negative">
                {totals.totalMinorUSD > 0
                  ? formatAmount(totals.totalMinorUSD, 'USD', locale)
                  : '-'}
              </span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">ILS ({year})</span>
              <span className="inline-stat-value amount-negative">
                {totals.totalMinorILS > 0
                  ? formatAmount(totals.totalMinorILS, 'ILS', locale)
                  : '-'}
              </span>
            </div>
            <div className="inline-stat">
              <span className="inline-stat-label">{t('expenses.recurringRules')}</span>
              <span className="inline-stat-value">
                {recurringRules.filter((r) => !r.isPaused).length}
              </span>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="filters-row">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('expenses.searchPlaceholder')}
          />
          <CurrencyTabs value={currency} onChange={setCurrency} />
          {categories.length > 0 ? (
            <select
              className="select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t('expenses.allCategories')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowCategorySetup(true)}
            >
              + {t('expenses.categories.setup')}
            </button>
          )}
        </div>

        {/* Expenses Table */}
        {expensesLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.emptyExpenses')}</h3>
            <p className="empty-state-description">
              {search ? t('expenses.emptyExpensesSearch') : t('expenses.emptyExpensesHint')}
            </p>
            <button className="btn btn-primary" onClick={handleAddExpense}>
              {t('expenses.addExpense')}
            </button>
          </div>
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('expenses.columns.date')}</th>
                  <th>{t('expenses.columns.title')}</th>
                  <th>{t('expenses.columns.vendor')}</th>
                  <th>{t('expenses.columns.category')}</th>
                  <th style={{ textAlign: 'end' }}>{t('expenses.columns.amount')}</th>
                  <th style={{ textAlign: 'center' }}>{t('expenses.columns.receipts')}</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr
                    key={expense.id}
                    className="clickable"
                    onClick={() => handleRowClick(expense.id)}
                  >
                    <td>{formatDate(expense.occurredAt, locale)}</td>
                    <td>
                      <span style={{ fontWeight: 500 }}>
                        {expense.title || '-'}
                      </span>
                      {expense.isFromRecurring && (
                        <span className="recurring-badge" title={t('expenses.fromRecurring')}>
                          <RecurringIcon />
                        </span>
                      )}
                    </td>
                    <td className="text-secondary">{expense.vendor || '-'}</td>
                    <td className="text-secondary">
                      {expense.categoryName ? (
                        <span className="category-badge" style={{ '--category-color': expense.categoryColor || '#888' } as React.CSSProperties}>
                          {expense.categoryName}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="amount-cell amount-negative">
                      {formatAmount(expense.amountMinor, expense.currency, locale)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {expense.receiptCount > 0 ? (
                        <span className="receipt-count">{expense.receiptCount}</span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>
                      <RowActionsMenu
                        actions={[
                          {
                            label: t('common.duplicate'),
                            icon: <CopyIcon size={16} />,
                            onClick: () =>
                              openExpenseDrawer({
                                mode: 'create',
                                defaultProfileId: profileId,
                                expenseId: expense.id, // Use as template
                              }),
                          },
                          {
                            label: t('common.delete'),
                            icon: <TrashIcon size={16} />,
                            variant: 'danger',
                            onClick: () => {
                              if (confirm(t('expenses.confirmDelete'))) {
                                deleteExpenseMutation.mutate(expense.id);
                              }
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Expense Button */}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleAddExpense}>
            {t('expenses.addExpense')}
          </button>
          <button className="btn btn-secondary" onClick={handleAddRecurring}>
            {t('expenses.addRecurring')}
          </button>
        </div>

        {/* Recurring Rules Section */}
        {recurringRules.length > 0 && (
          <div className="recurring-rules-section">
            <button
              className="recurring-rules-header"
              onClick={() => setShowRecurring(!showRecurring)}
            >
              <span className="recurring-rules-title">
                {t('expenses.recurringRules')} ({recurringRules.length})
              </span>
              <ChevronIcon className={cn('recurring-rules-chevron', showRecurring && 'expanded')} />
            </button>

            {showRecurring && (
              <div className="recurring-rules-list">
                {recurringRules.map((rule) => (
                  <div key={rule.id} className={cn('recurring-rule-item', rule.isPaused && 'paused')}>
                    <div className="recurring-rule-info">
                      <div className="recurring-rule-title">
                        {rule.title}
                        {rule.isPaused && (
                          <span className="paused-badge">{t('expenses.paused')}</span>
                        )}
                      </div>
                      <div className="recurring-rule-meta">
                        <span className="amount-negative">
                          {formatAmount(rule.amountMinor, rule.currency, locale)}
                        </span>
                        <span className="text-muted">
                          / {rule.frequency === 'monthly' ? t('expenses.monthly') : t('expenses.yearly')}
                        </span>
                      </div>
                    </div>
                    <div className="recurring-rule-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          rule.isPaused
                            ? resumeRuleMutation.mutate(rule.id)
                            : pauseRuleMutation.mutate(rule.id)
                        }
                      >
                        {rule.isPaused ? t('expenses.resume') : t('expenses.pause')}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          openExpenseDrawer({
                            mode: 'edit',
                            recurringRuleId: rule.id,
                            defaultProfileId: profileId,
                            isRecurring: true,
                          })
                        }
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm text-danger"
                        onClick={() => {
                          if (confirm(t('expenses.confirmDeleteRule'))) {
                            deleteRuleMutation.mutate(rule.id);
                          }
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category Setup Modal */}
      <CategorySetupModal
        isOpen={showCategorySetup}
        onClose={() => setShowCategorySetup(false)}
        profileId={profileId}
      />
    </>
  );
}

function RecurringIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3"
      />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

// Category Setup Modal
interface CategorySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
}

function CategorySetupModal({ isOpen, onClose, profileId }: CategorySetupModalProps) {
  const t = useT();
  const { language } = useLanguage();
  const [selectedPreset, setSelectedPreset] = useState<CategoryPreset>('general');
  const seedMutation = useSeedExpenseCategories();

  const presets: { value: CategoryPreset; label: string; description: string }[] = [
    {
      value: 'general',
      label: t('expenses.categories.presets.general'),
      description: t('expenses.categories.presetDescriptions.general'),
    },
    {
      value: 'startup',
      label: t('expenses.categories.presets.startup'),
      description: t('expenses.categories.presetDescriptions.startup'),
    },
    {
      value: 'lawFirm',
      label: t('expenses.categories.presets.lawFirm'),
      description: t('expenses.categories.presetDescriptions.lawFirm'),
    },
    {
      value: 'freelancer',
      label: t('expenses.categories.presets.freelancer'),
      description: t('expenses.categories.presetDescriptions.freelancer'),
    },
  ];

  const handleSeed = async () => {
    try {
      await seedMutation.mutateAsync({
        profileId,
        preset: selectedPreset,
        language: language === 'ar' ? 'ar' : 'en',
      });
      onClose();
    } catch (error) {
      console.error('Failed to seed categories:', error);
      // Error will be shown via mutation state
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal category-setup-modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">{t('expenses.categories.setupTitle')}</h2>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">{t('expenses.categories.selectPreset')}</p>
          {seedMutation.isError && (
            <div className="modal-warning" style={{ marginBottom: 16 }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <p>{t('common.error') || 'An error occurred. Please try again.'}</p>
            </div>
          )}
          <div className="preset-options">
            {presets.map((preset) => (
              <label
                key={preset.value}
                className={cn('preset-option', selectedPreset === preset.value && 'selected')}
              >
                <input
                  type="radio"
                  name="preset"
                  value={preset.value}
                  checked={selectedPreset === preset.value}
                  onChange={() => setSelectedPreset(preset.value)}
                />
                <div className="preset-content">
                  <span className="preset-label">{preset.label}</span>
                  <span className="preset-description">{preset.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSeed}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending ? t('common.saving') : t('expenses.categories.seedCategories')}
          </button>
        </div>
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
