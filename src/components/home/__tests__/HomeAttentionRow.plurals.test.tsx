/**
 * MUT-179: Needs attention says how late or how soon in the count's own form,
 * with the real dictionaries ("Due in 1d"; Arabic "متأخر 3 أيام", "متأخر 11 يومًا").
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeAttentionRow } from '../HomeAttentionRow';
import { I18nProvider } from '../../../lib/i18n/core';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import type { Language } from '../../../lib/i18n';
import type { WorkRow } from '../../clients/clientProfileRows';
import type { TransactionDisplay } from '../../../types';

function workRow(days: Pick<WorkRow, 'overdueDays' | 'dueInDays'>): WorkRow {
  const tx = {
    id: 'tx-1',
    profileId: 'p-1',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 50000,
    currency: 'USD',
    occurredAt: '2026-10-01',
    title: 'Logo design',
  } as unknown as TransactionDisplay;
  return {
    id: tx.id,
    tx,
    date: tx.occurredAt,
    title: tx.title,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paymentStatus: 'unpaid',
    isReceivable: true,
    ...days,
  };
}

function renderRow(row: WorkRow, language: Language) {
  render(
    <I18nProvider translations={{ en, ar }} language={language} setLanguage={() => {}}>
      <table>
        <tbody>
          <HomeAttentionRow
            row={row}
            locale={language === 'ar' ? 'ar' : 'en-US'}
            onOpen={vi.fn()}
            onRecordPayment={vi.fn()}
            onArrive={vi.fn()}
            onLeave={vi.fn()}
          />
        </tbody>
      </table>
    </I18nProvider>
  );
}

describe('HomeAttentionRow counts (MUT-179)', () => {
  it('reads "Due in 1d" in English at one day', () => {
    renderRow(workRow({ dueInDays: 1 }), 'en');
    expect(screen.getByText('Due in 1d')).toBeInTheDocument();
  });

  it.each([
    [3, 'متأخر 3 أيام'],
    [11, 'متأخر 11 يومًا'],
  ])('reads %i days overdue in the Arabic few/many form', (days, text) => {
    renderRow(workRow({ overdueDays: days }), 'ar');
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
