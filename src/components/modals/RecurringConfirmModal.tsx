/**
 * RecurringConfirmModal Component
 *
 * Modal for confirming a recurring expense payment.
 * Allows user to:
 * - Adjust the amount
 * - Set actual payment date
 * - Add notes
 */

import { useState, useEffect } from 'react';
import { useT } from '../../lib/i18n';
import { formatAmount, todayISO } from '../../lib/utils';
import type { VirtualOccurrenceDisplay } from '../../types';
import './RecurringConfirmModal.css';

interface RecurringConfirmModalProps {
  occurrence: VirtualOccurrenceDisplay | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: {
    ruleId: string;
    profileId: string;
    expectedDate: string;
    amountMinor?: number;
    actualPaidDate?: string;
    notes?: string;
  }) => void;
  isLoading?: boolean;
}

export function RecurringConfirmModal({
  occurrence,
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}: RecurringConfirmModalProps) {
  const t = useT();

  const [amountStr, setAmountStr] = useState('');
  const [actualDate, setActualDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [amountEdited, setAmountEdited] = useState(false);

  // Initialize form when occurrence changes
  /* eslint-disable react-hooks/set-state-in-effect -- Form initialization from props is intentional */
  useEffect(() => {
    if (occurrence) {
      setAmountStr(String(occurrence.effectiveAmount / 100));
      setActualDate(todayISO());
      setNotes('');
      setAmountEdited(false);
    }
  }, [occurrence]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen || !occurrence) return null;

  const handleAmountChange = (value: string) => {
    setAmountStr(value);
    setAmountEdited(true);
  };

  const handleConfirm = () => {
    const amountMinor = amountEdited
      ? Math.round(parseFloat(amountStr || '0') * 100)
      : undefined;

    onConfirm({
      ruleId: occurrence.ruleId,
      profileId: occurrence.profileId,
      expectedDate: occurrence.expectedDate,
      amountMinor,
      actualPaidDate: actualDate !== occurrence.expectedDate ? actualDate : undefined,
      notes: notes.trim() || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="modal recurring-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <h2 id="confirm-modal-title" className="modal-title">
            {t('expenses.recurring.occurrence.confirmPayment')}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {/* Occurrence summary */}
          <div className="confirm-summary">
            <div className="confirm-title">{occurrence.ruleTitle}</div>
            {occurrence.vendorName && (
              <div className="confirm-vendor">{occurrence.vendorName}</div>
            )}
            <div className="confirm-expected">
              {t('expenses.recurring.occurrence.expectedOn')}{' '}
              {new Date(occurrence.expectedDate).toLocaleDateString()}
            </div>
          </div>

          {/* Amount */}
          <div className="form-group">
            <label htmlFor="amount">
              {t('expenses.recurring.occurrence.editAmount')}
            </label>
            <div className="amount-input-group">
              <span className="currency-symbol">
                {occurrence.effectiveCurrency === 'USD' ? '$' : '₪'}
              </span>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                className="input amount-input"
                value={amountStr}
                onChange={(e) => handleAmountChange(e.target.value)}
              />
            </div>
            {!amountEdited && (
              <p className="form-hint">
                Original: {formatAmount(occurrence.amountMinor, occurrence.currency)}
              </p>
            )}
          </div>

          {/* Actual Date */}
          <div className="form-group">
            <label htmlFor="actualDate">
              {t('expenses.recurring.occurrence.actualDate')}
            </label>
            <input
              id="actualDate"
              type="date"
              className="input"
              value={actualDate}
              onChange={(e) => setActualDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="form-group">
            <label htmlFor="notes">
              {t('expenses.recurring.occurrence.notes')}
            </label>
            <textarea
              id="notes"
              className="textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('expenses.recurring.occurrence.notesPlaceholder')}
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? t('common.saving') : t('common.confirm')}
          </button>
        </div>
      </div>
    </>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * Snooze Modal Component
 */
interface RecurringSnoozeModalProps {
  occurrence: VirtualOccurrenceDisplay | null;
  isOpen: boolean;
  onClose: () => void;
  onSnooze: (params: {
    ruleId: string;
    profileId: string;
    expectedDate: string;
    snoozeUntil: string;
    notes?: string;
  }) => void;
  isLoading?: boolean;
}

export function RecurringSnoozeModal({
  occurrence,
  isOpen,
  onClose,
  onSnooze,
  isLoading = false,
}: RecurringSnoozeModalProps) {
  const t = useT();

  const [snoozeUntil, setSnoozeUntil] = useState('');
  const [notes, setNotes] = useState('');

  // Initialize with tomorrow's date
  /* eslint-disable react-hooks/set-state-in-effect -- Form initialization from props is intentional */
  useEffect(() => {
    if (occurrence) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7); // Default to 1 week
      setSnoozeUntil(tomorrow.toISOString().split('T')[0]);
      setNotes('');
    }
  }, [occurrence]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!isOpen || !occurrence) return null;

  const handleSnooze = () => {
    onSnooze({
      ruleId: occurrence.ruleId,
      profileId: occurrence.profileId,
      expectedDate: occurrence.expectedDate,
      snoozeUntil,
      notes: notes.trim() || undefined,
    });
  };

  const today = todayISO();

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="modal recurring-snooze-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-modal-title"
      >
        <div className="modal-header">
          <h2 id="snooze-modal-title" className="modal-title">
            {t('expenses.recurring.occurrence.snooze')}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {/* Occurrence summary */}
          <div className="confirm-summary">
            <div className="confirm-title">{occurrence.ruleTitle}</div>
            <div className="confirm-amount">
              {formatAmount(occurrence.effectiveAmount, occurrence.effectiveCurrency)}
            </div>
          </div>

          {/* Snooze until */}
          <div className="form-group">
            <label htmlFor="snoozeUntil">
              {t('expenses.recurring.occurrence.snoozeUntil')}
            </label>
            <input
              id="snoozeUntil"
              type="date"
              className="input"
              value={snoozeUntil}
              min={today}
              onChange={(e) => setSnoozeUntil(e.target.value)}
            />
          </div>

          {/* Quick snooze options */}
          <div className="snooze-quick-options">
            {[1, 3, 7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  const date = new Date();
                  date.setDate(date.getDate() + days);
                  setSnoozeUntil(date.toISOString().split('T')[0]);
                }}
              >
                {days === 1 ? '1 day' : `${days} days`}
              </button>
            ))}
          </div>

          {/* Notes */}
          <div className="form-group">
            <label htmlFor="snoozeNotes">
              {t('expenses.recurring.occurrence.notes')}
            </label>
            <textarea
              id="snoozeNotes"
              className="textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('expenses.recurring.occurrence.notesPlaceholder')}
              rows={2}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSnooze}
            disabled={isLoading || !snoozeUntil || snoozeUntil <= today}
          >
            {isLoading ? t('common.saving') : t('expenses.recurring.occurrence.snooze')}
          </button>
        </div>
      </div>
    </>
  );
}
