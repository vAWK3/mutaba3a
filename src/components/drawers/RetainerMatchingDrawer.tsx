import { useState, useMemo } from 'react';
import { Drawer } from './Drawer';
import { SearchInput } from '../filters';
import { useDrawerStore } from '../../lib/stores';
import { useTransactions } from '../../hooks/useQueries';
import {
  useRetainerMatchSuggestions,
  useDueItems,
  useMatchTransaction,
} from '../../hooks/useRetainerQueries';
import { formatAmount, formatDate, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { ProjectedIncomeDisplay } from '../../types';

export function RetainerMatchingDrawer() {
  const {
    retainerMatchingDrawer,
    closeRetainerMatchingDrawer,
    setRetainerMatchingTransaction,
    openTransactionDrawer,
  } = useDrawerStore();
  const { step, transactionId } = retainerMatchingDrawer;
  const t = useT();

  const matchMutation = useMatchTransaction();

  const getTitle = () => {
    if (step === 'select-transaction') {
      return t('retainerMatching.selectTransaction');
    }
    return t('retainerMatching.selectProjectedIncome');
  };

  const handleMatch = async (projectedId: string) => {
    if (!transactionId) return;

    try {
      await matchMutation.mutateAsync({
        projectedIncomeId: projectedId,
        transactionId,
      });
      closeRetainerMatchingDrawer();
    } catch (error) {
      console.error('Failed to match transaction:', error);
    }
  };

  return (
    <Drawer
      title={getTitle()}
      onClose={closeRetainerMatchingDrawer}
      footer={
        <div className="drawer-footer-right">
          <button type="button" className="btn btn-secondary" onClick={closeRetainerMatchingDrawer}>
            {t('common.cancel')}
          </button>
        </div>
      }
    >
      {step === 'select-transaction' ? (
        <TransactionSelector
          onSelect={(txId) => setRetainerMatchingTransaction(txId)}
          onCreateNew={() => {
            closeRetainerMatchingDrawer();
            openTransactionDrawer({ mode: 'create', defaultKind: 'income' });
          }}
        />
      ) : (
        <ProjectedIncomeSelector
          transactionId={transactionId!}
          onSelect={handleMatch}
          isMatching={matchMutation.isPending}
        />
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
    return unlinkedTransactions.filter((tx) =>
      tx.title?.toLowerCase().includes(searchLower) ||
      tx.clientName?.toLowerCase().includes(searchLower) ||
      tx.projectName?.toLowerCase().includes(searchLower)
    );
  }, [unlinkedTransactions, search]);

  return (
    <div className="matching-step">
      <p className="matching-description">{t('retainerMatching.selectTransactionDesc')}</p>

      <div className="matching-filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('retainerMatching.searchTransactions')}
        />
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
            <button
              key={tx.id}
              className="matching-item"
              onClick={() => onSelect(tx.id)}
            >
              <div className="matching-item-main">
                <span className="matching-item-title">
                  {tx.title || tx.clientName || t('retainerMatching.untitled')}
                </span>
                <span className="matching-item-meta">
                  {formatDate(tx.occurredAt, locale)}
                  {tx.clientName && ` • ${tx.clientName}`}
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
  isMatching: boolean;
}

function ProjectedIncomeSelector({ transactionId, onSelect, isMatching }: ProjectedIncomeSelectorProps) {
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
    const otherItems = dueItems.filter(
      (item) => !suggestedIds.has(item.id)
    );

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
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('retainerMatching.searchProjected')}
        />
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
                  <button
                    key={suggestion.projectedIncomeId}
                    className="matching-item matching-item-suggested"
                    onClick={() => onSelect(suggestion.projectedIncomeId)}
                    disabled={isMatching}
                  >
                    <div className="matching-item-main">
                      <span className="matching-item-title">
                        {suggestion.projectedIncome.retainerTitle || t('retainerMatching.untitledRetainer')}
                      </span>
                      <span className="matching-item-meta">
                        {new Date(suggestion.projectedIncome.expectedDate).toLocaleDateString(locale, {
                          month: 'short',
                          year: 'numeric',
                        })}
                        {suggestion.projectedIncome.clientName && ` • ${suggestion.projectedIncome.clientName}`}
                      </span>
                    </div>
                    <div className="matching-item-right">
                      <span className="matching-item-amount">
                        {formatAmount(
                          suggestion.projectedIncome.expectedAmountMinor - suggestion.projectedIncome.receivedAmountMinor,
                          suggestion.projectedIncome.currency,
                          locale
                        )}
                      </span>
                      <ConfidenceBadge confidence={suggestion.confidence} />
                    </div>
                  </button>
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
                  <button
                    key={item.id}
                    className="matching-item"
                    onClick={() => onSelect(item.id)}
                    disabled={isMatching}
                  >
                    <div className="matching-item-main">
                      <span className="matching-item-title">
                        {item.retainerTitle || t('retainerMatching.untitledRetainer')}
                      </span>
                      <span className="matching-item-meta">
                        {new Date(item.expectedDate).toLocaleDateString(locale, {
                          month: 'short',
                          year: 'numeric',
                        })}
                        {item.clientName && ` • ${item.clientName}`}
                      </span>
                    </div>
                    <span className="matching-item-amount">
                      {formatAmount(
                        item.expectedAmountMinor - item.receivedAmountMinor,
                        item.currency,
                        locale
                      )}
                    </span>
                  </button>
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

// Confidence Badge
function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const t = useT();
  return (
    <span className={cn('confidence-badge', `confidence-${confidence}`)}>
      {t(`retainerMatching.confidence.${confidence}`)}
    </span>
  );
}
