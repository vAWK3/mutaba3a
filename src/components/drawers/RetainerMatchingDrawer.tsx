import { useState, useMemo, useEffect, useRef } from 'react';
import { Drawer } from './Drawer';
import { SearchInput } from '../filters';
import { useDrawerStore } from '../../lib/stores';
import { useTransactions, useTransactionDisplay } from '../../hooks/useQueries';
import {
  useRetainerMatchSuggestions,
  useDueItems,
  useMatchTransaction,
  useUnmatchTransaction,
} from '../../hooks/useRetainerQueries';
import { formatAmount, formatDate, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import type { ProjectedIncomeDisplay, RetainerMatchSuggestion, MatchScoreBreakdown } from '../../types';
import { CheckCircleIcon, ChevronDownIcon, ArrowRightIcon } from '../icons';

// Step Progress Indicator
function StepIndicator({ currentStep }: { currentStep: 1 | 2 }) {
  return (
    <div className="matching-steps">
      <div className={cn('matching-step-dot', currentStep >= 1 && 'active', currentStep > 1 && 'completed')} />
      <div className={cn('matching-step-line', currentStep >= 2 && 'active')} />
      <div className={cn('matching-step-dot', currentStep >= 2 && 'active')} />
    </div>
  );
}

// Selected Transaction Context Card
interface SelectedTransactionCardProps {
  transactionId: string;
  onBack: () => void;
}

function SelectedTransactionCard({ transactionId, onBack }: SelectedTransactionCardProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { data: transaction } = useTransactionDisplay(transactionId);

  if (!transaction) return null;

  return (
    <div className="matching-context-card">
      <div className="matching-context-info">
        <span className="matching-context-title">
          {transaction.title || transaction.clientName || t('retainerMatching.untitled')}
        </span>
        <span className="matching-context-meta">
          {formatDate(transaction.occurredAt, locale)}
          {transaction.clientName && ` \u2022 ${transaction.clientName}`}
        </span>
      </div>
      <span className="matching-context-amount">
        {formatAmount(transaction.amountMinor, transaction.currency, locale)}
      </span>
      <button className="matching-context-change" onClick={onBack}>
        {t('retainerMatching.change')}
      </button>
    </div>
  );
}

// Score Breakdown Badge (expandable)
interface ScoreBadgeProps {
  score: number;
  confidence: 'high' | 'medium' | 'low';
  breakdown?: MatchScoreBreakdown;
}

function ScoreBadge({ score, confidence, breakdown }: ScoreBadgeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [expanded]);

  return (
    <div className="score-breakdown-wrapper" ref={wrapperRef}>
      <button
        className={cn('score-badge', `confidence-${confidence}`)}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        type="button"
      >
        <span className="score-badge-value">{score}</span>
        <ChevronDownIcon size={12} className={cn('score-badge-chevron', expanded && 'expanded')} />
      </button>

      {expanded && breakdown && (
        <div className="score-breakdown">
          <div className="score-breakdown-title">{t('retainerMatching.scoreBreakdown.title')}</div>
          <div className="score-breakdown-row">
            <span className="score-breakdown-label">{t('retainerMatching.scoreBreakdown.currency')}</span>
            <span className={cn('score-breakdown-value', breakdown.currency > 0 ? 'positive' : 'zero')}>
              +{breakdown.currency}
            </span>
          </div>
          <div className="score-breakdown-row">
            <span className="score-breakdown-label">{t('retainerMatching.scoreBreakdown.client')}</span>
            <span className={cn('score-breakdown-value', breakdown.client > 0 ? 'positive' : 'zero')}>
              +{breakdown.client}
            </span>
          </div>
          <div className="score-breakdown-row">
            <span className="score-breakdown-label">{t('retainerMatching.scoreBreakdown.amount')}</span>
            <span className={cn('score-breakdown-value', breakdown.amount > 0 ? 'positive' : 'zero')}>
              +{breakdown.amount}
            </span>
          </div>
          <div className="score-breakdown-row">
            <span className="score-breakdown-label">{t('retainerMatching.scoreBreakdown.date')}</span>
            <span className={cn('score-breakdown-value', breakdown.date > 0 ? 'positive' : 'zero')}>
              +{breakdown.date}
            </span>
          </div>
          <div className="score-breakdown-row score-breakdown-total">
            <span className="score-breakdown-label">{t('retainerMatching.scoreBreakdown.total')}</span>
            <span className="score-breakdown-value positive">{breakdown.total}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Match Confirmation Preview
interface MatchConfirmationProps {
  transactionId: string;
  projectedIncome: ProjectedIncomeDisplay;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function MatchConfirmation({ transactionId, projectedIncome, onConfirm, onCancel, isLoading }: MatchConfirmationProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { data: transaction } = useTransactionDisplay(transactionId);

  if (!transaction) return null;

  return (
    <div className="matching-confirmation">
      <h4 className="matching-confirmation-header">{t('retainerMatching.confirmation.title')}</h4>
      <div className="matching-confirmation-preview">
        <div className="matching-confirmation-card">
          <div className="matching-confirmation-card-title">{t('retainerMatching.confirmation.transaction')}</div>
          <div className="matching-confirmation-card-main">
            {transaction.title || transaction.clientName || t('retainerMatching.untitled')}
          </div>
          <div className="matching-confirmation-card-meta">{formatDate(transaction.occurredAt, locale)}</div>
          <div className="matching-confirmation-card-amount">
            {formatAmount(transaction.amountMinor, transaction.currency, locale)}
          </div>
        </div>

        <ArrowRightIcon size={24} className="matching-confirmation-arrow" />

        <div className="matching-confirmation-card">
          <div className="matching-confirmation-card-title">{t('retainerMatching.confirmation.period')}</div>
          <div className="matching-confirmation-card-main">
            {projectedIncome.retainerTitle || t('retainerMatching.untitledRetainer')}
          </div>
          <div className="matching-confirmation-card-meta">
            {new Date(projectedIncome.expectedDate).toLocaleDateString(locale, {
              month: 'short',
              year: 'numeric',
            })}
          </div>
          <div className="matching-confirmation-card-amount">
            {formatAmount(
              projectedIncome.expectedAmountMinor - projectedIncome.receivedAmountMinor,
              projectedIncome.currency,
              locale
            )}
          </div>
        </div>
      </div>

      <div className="matching-confirmation-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isLoading}>
          {t('retainerMatching.confirmation.cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isLoading}>
          {isLoading ? t('common.loading') : t('retainerMatching.confirmation.confirm')}
        </button>
      </div>
    </div>
  );
}

// Match Success State
function MatchSuccess() {
  const t = useT();
  return (
    <div className="matching-success">
      <CheckCircleIcon size={64} className="matching-success-icon" />
      <h3 className="matching-success-title">{t('retainerMatching.success.title')}</h3>
      <p className="matching-success-message">{t('retainerMatching.success.message')}</p>
    </div>
  );
}

export function RetainerMatchingDrawer() {
  const {
    retainerMatchingDrawer,
    closeRetainerMatchingDrawer,
    setRetainerMatchingTransaction,
    setRetainerMatchingStep,
    setRetainerMatchingPendingProjected,
    setRetainerMatchingSuccess,
    openTransactionDrawer,
  } = useDrawerStore();
  const { step, transactionId, pendingProjectedId, matchSuccess, lastMatchedIds } = retainerMatchingDrawer;
  const t = useT();
  const { showToast } = useToast();

  const matchMutation = useMatchTransaction();
  const unmatchMutation = useUnmatchTransaction();

  // Get due items to find the pending projected income details
  const { data: dueItems = [] } = useDueItems();
  const { data: suggestions = [] } = useRetainerMatchSuggestions(transactionId ?? '');

  const pendingProjectedIncome = useMemo(() => {
    if (!pendingProjectedId) return null;
    // First check suggestions
    const suggestion = suggestions.find((s) => s.projectedIncomeId === pendingProjectedId);
    if (suggestion) return suggestion.projectedIncome;
    // Then check due items
    return dueItems.find((item) => item.id === pendingProjectedId) || null;
  }, [pendingProjectedId, suggestions, dueItems]);

  const getTitle = () => {
    if (matchSuccess) return t('retainerMatching.success.title');
    if (pendingProjectedId) return t('retainerMatching.confirmation.title');
    if (step === 'select-transaction') {
      return t('retainerMatching.selectTransaction');
    }
    return t('retainerMatching.selectProjectedIncome');
  };

  const handleSelectProjectedIncome = (projectedId: string) => {
    // Show confirmation instead of immediate match
    setRetainerMatchingPendingProjected(projectedId);
  };

  const handleConfirmMatch = async () => {
    if (!transactionId || !pendingProjectedId) return;

    try {
      await matchMutation.mutateAsync({
        projectedIncomeId: pendingProjectedId,
        transactionId,
      });

      // Show success state
      setRetainerMatchingSuccess(true, { transactionId, projectedId: pendingProjectedId });

      // Show toast with undo option
      showToast(t('retainerMatching.toast.matched'), {
        action: {
          label: t('retainerMatching.toast.undo'),
          onClick: handleUndo,
        },
        duration: 5000,
      });

      // Close drawer after delay
      setTimeout(() => {
        closeRetainerMatchingDrawer();
      }, 1500);
    } catch (error) {
      console.error('Failed to match transaction:', error);
    }
  };

  const handleUndo = async () => {
    if (!lastMatchedIds) return;
    try {
      await unmatchMutation.mutateAsync({
        projectedIncomeId: lastMatchedIds.projectedId,
        transactionId: lastMatchedIds.transactionId,
      });
      showToast(t('retainerMatching.toast.undone'));
    } catch (error) {
      console.error('Failed to undo match:', error);
    }
  };

  const handleCancelConfirmation = () => {
    setRetainerMatchingPendingProjected(undefined);
  };

  const handleBack = () => {
    setRetainerMatchingStep('select-transaction');
  };

  return (
    <Drawer
      title={getTitle()}
      onClose={closeRetainerMatchingDrawer}
      footer={
        !matchSuccess && !pendingProjectedId ? (
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeRetainerMatchingDrawer}>
              {t('common.cancel')}
            </button>
          </div>
        ) : null
      }
    >
      {/* Step indicator */}
      {!matchSuccess && !pendingProjectedId && <StepIndicator currentStep={step === 'select-transaction' ? 1 : 2} />}

      {matchSuccess ? (
        <MatchSuccess />
      ) : pendingProjectedId && pendingProjectedIncome && transactionId ? (
        <MatchConfirmation
          transactionId={transactionId}
          projectedIncome={pendingProjectedIncome}
          onConfirm={handleConfirmMatch}
          onCancel={handleCancelConfirmation}
          isLoading={matchMutation.isPending}
        />
      ) : step === 'select-transaction' ? (
        <TransactionSelector
          onSelect={(txId) => setRetainerMatchingTransaction(txId)}
          onCreateNew={() => {
            closeRetainerMatchingDrawer();
            openTransactionDrawer({ mode: 'create', defaultKind: 'income' });
          }}
        />
      ) : (
        <>
          {/* Show selected transaction context */}
          {transactionId && <SelectedTransactionCard transactionId={transactionId} onBack={handleBack} />}
          <ProjectedIncomeSelector transactionId={transactionId!} onSelect={handleSelectProjectedIncome} />
        </>
      )}
    </Drawer>
  );
}

// Step 1: Transaction Selector
interface TransactionSelectorProps {
  onSelect: (transactionId: string) => void;
  onCreateNew: () => void;
}

function TransactionSelector({ onSelect, onCreateNew }: TransactionSelectorProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [search, setSearch] = useState('');

  // Get paid income transactions that are not linked to projected income
  const { data: transactions = [], isLoading } = useTransactions({
    kind: 'income',
    status: 'paid',
    sort: { by: 'occurredAt', dir: 'desc' },
    limit: 50,
  });

  // Filter unlinked transactions
  const unlinkedTransactions = useMemo(() => {
    return transactions.filter((tx) => !tx.linkedProjectedIncomeId);
  }, [transactions]);

  // Apply search filter
  const filteredTransactions = useMemo(() => {
    if (!search) return unlinkedTransactions;
    const searchLower = search.toLowerCase();
    return unlinkedTransactions.filter(
      (tx) =>
        tx.title?.toLowerCase().includes(searchLower) ||
        tx.clientName?.toLowerCase().includes(searchLower) ||
        tx.projectName?.toLowerCase().includes(searchLower)
    );
  }, [unlinkedTransactions, search]);

  return (
    <div className="matching-step">
      <p className="matching-description">{t('retainerMatching.selectTransactionDesc')}</p>

      <div className="matching-filters">
        <SearchInput value={search} onChange={setSearch} placeholder={t('retainerMatching.searchTransactions')} />
      </div>

      <div className="matching-actions">
        <button className="btn btn-secondary" onClick={onCreateNew}>
          + {t('retainerMatching.createNewTransaction')}
        </button>
      </div>

      {isLoading ? (
        <div className="loading">
          <div className="spinner" />
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="matching-empty">
          <p>{search ? t('retainerMatching.noMatchingTransactions') : t('retainerMatching.noUnlinkedTransactions')}</p>
        </div>
      ) : (
        <div className="matching-list">
          {filteredTransactions.map((tx) => (
            <button key={tx.id} className="matching-item" onClick={() => onSelect(tx.id)}>
              <div className="matching-item-main">
                <span className="matching-item-title">
                  {tx.title || tx.clientName || t('retainerMatching.untitled')}
                </span>
                <span className="matching-item-meta">
                  {formatDate(tx.occurredAt, locale)}
                  {tx.clientName && ` \u2022 ${tx.clientName}`}
                </span>
              </div>
              <span className="matching-item-amount amount-positive">
                {formatAmount(tx.amountMinor, tx.currency, locale)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Step 2: Projected Income Selector
interface ProjectedIncomeSelectorProps {
  transactionId: string;
  onSelect: (projectedIncomeId: string) => void;
}

function ProjectedIncomeSelector({ transactionId, onSelect }: ProjectedIncomeSelectorProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [search, setSearch] = useState('');

  // Get suggestions for this transaction
  const { data: suggestions = [], isLoading: suggestionsLoading } = useRetainerMatchSuggestions(transactionId);

  // Get all due items as fallback
  const { data: dueItems = [], isLoading: dueLoading } = useDueItems();

  // Filter and combine results
  const displayItems = useMemo(() => {
    // Create a set of suggested IDs
    const suggestedIds = new Set(suggestions.map((s) => s.projectedIncomeId));

    // Filter due items that are not in suggestions
    const otherItems = dueItems.filter((item) => !suggestedIds.has(item.id));

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      const filterFn = (item: ProjectedIncomeDisplay) =>
        item.retainerTitle?.toLowerCase().includes(searchLower) ||
        item.clientName?.toLowerCase().includes(searchLower);

      return {
        suggestions: suggestions.filter((s) => filterFn(s.projectedIncome)),
        others: otherItems.filter(filterFn),
      };
    }

    return { suggestions, others: otherItems };
  }, [suggestions, dueItems, search]);

  const isLoading = suggestionsLoading || dueLoading;

  return (
    <div className="matching-step">
      <p className="matching-description">{t('retainerMatching.selectProjectedDesc')}</p>

      <div className="matching-filters">
        <SearchInput value={search} onChange={setSearch} placeholder={t('retainerMatching.searchProjected')} />
      </div>

      {isLoading ? (
        <div className="loading">
          <div className="spinner" />
        </div>
      ) : (
        <>
          {/* Suggestions Section */}
          {displayItems.suggestions.length > 0 && (
            <div className="matching-section">
              <h4 className="matching-section-title">{t('retainerMatching.suggestions')}</h4>
              <div className="matching-list">
                {displayItems.suggestions.map((suggestion) => (
                  <ProjectedIncomeItem
                    key={suggestion.projectedIncomeId}
                    item={suggestion.projectedIncome}
                    suggestion={suggestion}
                    onSelect={() => onSelect(suggestion.projectedIncomeId)}
                    locale={locale}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other Due Items */}
          {displayItems.others.length > 0 && (
            <div className="matching-section">
              <h4 className="matching-section-title">{t('retainerMatching.otherDueItems')}</h4>
              <div className="matching-list">
                {displayItems.others.map((item) => (
                  <ProjectedIncomeItem key={item.id} item={item} onSelect={() => onSelect(item.id)} locale={locale} />
                ))}
              </div>
            </div>
          )}

          {displayItems.suggestions.length === 0 && displayItems.others.length === 0 && (
            <div className="matching-empty">
              <p>{search ? t('retainerMatching.noMatchingProjected') : t('retainerMatching.noDueItems')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Projected Income Item (with optional suggestion score)
interface ProjectedIncomeItemProps {
  item: ProjectedIncomeDisplay;
  suggestion?: RetainerMatchSuggestion;
  onSelect: () => void;
  locale: string;
}

function ProjectedIncomeItem({ item, suggestion, onSelect, locale }: ProjectedIncomeItemProps) {
  const t = useT();

  return (
    <button className={cn('matching-item', suggestion && 'matching-item-suggested')} onClick={onSelect}>
      <div className="matching-item-main">
        <span className="matching-item-title">{item.retainerTitle || t('retainerMatching.untitledRetainer')}</span>
        <span className="matching-item-meta">
          {new Date(item.expectedDate).toLocaleDateString(locale, {
            month: 'short',
            year: 'numeric',
          })}
          {item.clientName && ` \u2022 ${item.clientName}`}
        </span>
      </div>
      <div className="matching-item-right">
        <span className="matching-item-amount">
          {formatAmount(item.expectedAmountMinor - item.receivedAmountMinor, item.currency, locale)}
        </span>
        {suggestion && (
          <ScoreBadge
            score={suggestion.score}
            confidence={suggestion.confidence}
            breakdown={suggestion.scoreBreakdown}
          />
        )}
      </div>
    </button>
  );
}
