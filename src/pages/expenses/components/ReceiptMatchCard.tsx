import { useLinkReceiptToExpense } from '../../../hooks/useExpenseQueries';
import { getConfidenceColor, getConfidenceLabel } from '../../../lib/matchingAlgorithm';
import { formatDate, cn } from '../../../lib/utils';
import { useT, useLanguage, getLocale } from '../../../lib/i18n';
import type { Receipt, ReceiptMatchSuggestion } from '../../../types';
import './ReceiptMatchCard.css';

export interface ReceiptMatchCardProps {
  receipt: Receipt;
  suggestions: ReceiptMatchSuggestion[];
  onLinkSuccess?: () => void;
  onCreateExpense?: (receipt: Receipt) => void;
}

export function ReceiptMatchCard({
  receipt,
  suggestions,
  onLinkSuccess,
  onCreateExpense,
}: ReceiptMatchCardProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const linkMutation = useLinkReceiptToExpense();

  const bestSuggestion = suggestions[0];

  const handleLink = async (suggestion: ReceiptMatchSuggestion) => {
    try {
      await linkMutation.mutateAsync({
        receiptId: receipt.id,
        expenseId: suggestion.expenseId,
      });
      onLinkSuccess?.();
    } catch {
      // Error handled by mutation
    }
  };

  const handleCreateAndLink = () => {
    onCreateExpense?.(receipt);
  };

  return (
    <div className="receipt-match-card">
      {/* Receipt preview */}
      <div className="receipt-match-card-preview">
        <div className="receipt-match-thumbnail">
          {receipt.mimeType.startsWith('image/') ? (
            <img
              src={`data:${receipt.mimeType};base64,${receipt.data}`}
              alt=""
            />
          ) : (
            <div className="receipt-pdf-icon">
              <PdfIcon />
            </div>
          )}
        </div>
        <div className="receipt-match-info">
          <div className="receipt-match-filename" title={receipt.fileName}>
            {receipt.fileName}
          </div>
          <div className="receipt-match-meta">
            <span className="text-muted text-sm">
              {formatDate(receipt.createdAt, locale)}
            </span>
            {receipt.amountMinor && (
              <span className="receipt-match-amount">
                {receipt.currency} {(receipt.amountMinor / 100).toFixed(2)}
              </span>
            )}
          </div>
          {receipt.vendorRaw && (
            <div className="receipt-match-vendor text-sm text-muted">
              {receipt.vendorRaw}
            </div>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 ? (
        <div className="receipt-match-suggestions">
          <div className="receipt-match-suggestions-header">
            <span className="text-sm text-muted">{t('receipts.suggestions.title')}</span>
          </div>
          {suggestions.slice(0, 3).map((suggestion) => (
            <div
              key={suggestion.expenseId}
              className={cn(
                'receipt-match-suggestion',
                suggestion === bestSuggestion && 'is-best'
              )}
            >
              <div className="suggestion-info">
                <div className="suggestion-title">
                  {suggestion.expense.title ||
                    suggestion.expense.vendor ||
                    t('expenses.untitled')}
                </div>
                <div className="suggestion-details text-sm text-muted">
                  <span>{formatDate(suggestion.expense.occurredAt, locale)}</span>
                  <span className="suggestion-amount">
                    {suggestion.expense.currency}{' '}
                    {(suggestion.expense.amountMinor / 100).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="suggestion-actions">
                <span
                  className={cn(
                    'suggestion-score',
                    getConfidenceColor(suggestion.confidence)
                  )}
                  title={getConfidenceLabel(suggestion.confidence)}
                >
                  {suggestion.score}%
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => handleLink(suggestion)}
                  disabled={linkMutation.isPending}
                >
                  {t('receipts.suggestions.link')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="receipt-match-no-suggestions">
          <span className="text-sm text-muted">{t('receipts.suggestions.noMatches')}</span>
        </div>
      )}

      {/* Create new expense action */}
      <div className="receipt-match-card-footer">
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={handleCreateAndLink}
        >
          {t('receipts.suggestions.createAndLink')}
        </button>
      </div>
    </div>
  );
}

function PdfIcon() {
  return (
    <svg
      width="32"
      height="32"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}
