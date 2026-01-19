import { useMemo } from 'react';
import { ReceiptMatchCard } from './ReceiptMatchCard';
import { useT } from '../../../lib/i18n';
import { cn } from '../../../lib/utils';
import type { Receipt, ReceiptMatchSuggestion } from '../../../types';
import './ReceiptMatchList.css';

export interface ReceiptWithSuggestions {
  receipt: Receipt;
  suggestions: ReceiptMatchSuggestion[];
}

export interface ReceiptMatchListProps {
  items: ReceiptWithSuggestions[];
  isLoading?: boolean;
  onLinkSuccess?: () => void;
  onCreateExpense?: (receipt: Receipt) => void;
  groupByConfidence?: boolean;
}

type ConfidenceGroup = 'high' | 'medium' | 'low' | 'none';

export function ReceiptMatchList({
  items,
  isLoading,
  onLinkSuccess,
  onCreateExpense,
  groupByConfidence = true,
}: ReceiptMatchListProps) {
  const t = useT();

  // Group items by best suggestion confidence
  const grouped = useMemo(() => {
    if (!groupByConfidence) {
      return { all: items };
    }

    const groups: Record<ConfidenceGroup, ReceiptWithSuggestions[]> = {
      high: [],
      medium: [],
      low: [],
      none: [],
    };

    for (const item of items) {
      const bestSuggestion = item.suggestions[0];
      if (!bestSuggestion) {
        groups.none.push(item);
      } else {
        groups[bestSuggestion.confidence].push(item);
      }
    }

    return groups;
  }, [items, groupByConfidence]);

  if (isLoading) {
    return (
      <div className="receipt-match-list-loading">
        <div className="spinner" />
        <span className="text-muted">{t('common.loading')}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="receipt-match-list-empty">
        <h4 className="empty-state-title">{t('receipts.suggestions.allLinked')}</h4>
        <p className="text-muted">{t('receipts.suggestions.allLinkedHint')}</p>
      </div>
    );
  }

  const renderGroup = (
    group: ConfidenceGroup,
    items: ReceiptWithSuggestions[],
    label: string
  ) => {
    if (items.length === 0) return null;

    return (
      <div className="receipt-match-group" key={group}>
        <div className="receipt-match-group-header">
          <span className={cn('receipt-match-group-badge', `confidence-${group}`)}>
            {items.length}
          </span>
          <span className="receipt-match-group-label">{label}</span>
        </div>
        <div className="receipt-match-group-items">
          {items.map(({ receipt, suggestions }) => (
            <ReceiptMatchCard
              key={receipt.id}
              receipt={receipt}
              suggestions={suggestions}
              onLinkSuccess={onLinkSuccess}
              onCreateExpense={onCreateExpense}
            />
          ))}
        </div>
      </div>
    );
  };

  if (groupByConfidence && 'high' in grouped) {
    const typedGroups = grouped as Record<ConfidenceGroup, ReceiptWithSuggestions[]>;
    return (
      <div className="receipt-match-list">
        {renderGroup('high', typedGroups.high, t('receipts.suggestions.highConfidence'))}
        {renderGroup('medium', typedGroups.medium, t('receipts.suggestions.mediumConfidence'))}
        {renderGroup('low', typedGroups.low, t('receipts.suggestions.lowConfidence'))}
        {renderGroup('none', typedGroups.none, t('receipts.suggestions.noMatches'))}
      </div>
    );
  }

  return (
    <div className="receipt-match-list">
      <div className="receipt-match-group-items">
        {items.map(({ receipt, suggestions }) => (
          <ReceiptMatchCard
            key={receipt.id}
            receipt={receipt}
            suggestions={suggestions}
            onLinkSuccess={onLinkSuccess}
            onCreateExpense={onCreateExpense}
          />
        ))}
      </div>
    </div>
  );
}

export { ReceiptMatchCard };
