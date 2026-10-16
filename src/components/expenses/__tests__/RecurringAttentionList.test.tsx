/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RecurringAttentionList } from '../RecurringAttentionList';
import { groupOccurrencesByRule } from '../recurringAttention';
import { I18nProvider } from '../../../lib/i18n/core';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import type { Language } from '../../../lib/i18n';
import type { VirtualOccurrenceDisplay } from '../../../types';

function occurrence(overrides: Partial<VirtualOccurrenceDisplay> = {}): VirtualOccurrenceDisplay {
  const amountMinor = overrides.amountMinor ?? 8000;
  const currency = overrides.currency ?? 'USD';
  return {
    ruleId: 'rule-hosting',
    profileId: 'profile-1',
    expectedDate: '2026-08-05',
    amountMinor,
    currency,
    computedState: 'overdue',
    ruleTitle: 'Server hosting',
    frequency: 'monthly',
    daysUntilDue: -68,
    isOverdue: true,
    isUpcoming: false,
    effectiveAmount: amountMinor,
    effectiveCurrency: currency,
    ...overrides,
  };
}

const HOSTING = [
  occurrence({ expectedDate: '2026-10-05', daysUntilDue: -7 }),
  occurrence({ expectedDate: '2026-08-05', daysUntilDue: -68 }),
  occurrence({ expectedDate: '2026-09-05', daysUntilDue: -37 }),
];
const RENT = occurrence({
  ruleId: 'rule-rent',
  ruleTitle: 'Office rent',
  expectedDate: '2026-10-12',
  amountMinor: 350000,
  currency: 'ILS',
  computedState: 'due',
  daysUntilDue: 0,
  isOverdue: false,
  isUpcoming: true,
});

function renderList(occurrences: VirtualOccurrenceDisplay[], language: Language = 'en') {
  const handlers = {
    onMarkPaid: vi.fn(),
    onSkipAll: vi.fn(),
    onSnoozeAll: vi.fn(),
    onEditRule: vi.fn(),
  };
  const ui: ReactElement = (
    <I18nProvider translations={{ en, ar }} language={language} setLanguage={() => {}}>
      <RecurringAttentionList groups={groupOccurrencesByRule(occurrences)} {...handlers} />
    </I18nProvider>
  );
  render(ui);
  return handlers;
}

const rows = () => screen.getAllByRole('listitem');
const rowFor = (title: string) => rows().find((row) => within(row).queryByText(title))!;
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/[\u2066-\u2069]/g, '');

describe('RecurringAttentionList (MUT-87)', () => {
  it('shows one row per rule with its months, period amount, total and lateness (T17)', () => {
    renderList(HOSTING);

    expect(rows()).toHaveLength(1);
    const row = rowFor('Server hosting');
    expect(text(row)).toContain('$80 monthly · Aug, Sep, Oct not marked');
    expect(within(row).getByTestId('recurring-attention-amount')).toHaveTextContent('$240');
    expect(within(row).getByText('68d overdue')).toBeInTheDocument();
    // One primary action per row, not one per month
    expect(within(row).getAllByRole('button', { name: 'Mark Paid' })).toHaveLength(1);
  });

  it('reads naturally for a rule with one missed payment (T18)', () => {
    renderList([RENT]);

    const row = rowFor('Office rent');
    expect(text(row)).toContain('₪3,500 monthly · Oct not marked');
    expect(within(row).getByText('Due today')).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Office rent' }));
    expect(screen.getByRole('menuitem', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Snooze…' })).toBeInTheDocument();
  });

  it('counts the rules and totals each currency side by side in the header (T19)', () => {
    renderList([...HOSTING, RENT]);

    const section = screen.getByRole('region', { name: /Needs Attention/ });
    expect(within(section).getByTestId('recurring-attention-count')).toHaveTextContent('2');
    const totals = within(section).getAllByTestId('currency-amount');
    expect(totals.map((el) => el.textContent)).toEqual(['$240', '₪3,500']);
    expect(totals.every((el) => el.getAttribute('dir') === 'ltr')).toBe(true);
  });

  it('opens the drawer from Mark Paid and runs the ⋯ menu from the keyboard (T20)', () => {
    const handlers = renderList(HOSTING);
    const row = rowFor('Server hosting');

    fireEvent.click(within(row).getByRole('button', { name: 'Mark Paid' }));
    expect(handlers.onMarkPaid).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'rule-hosting' }));

    const more = within(row).getByRole('button', { name: 'Actions for Server hosting' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(more);
    const menu = screen.getByRole('menu');
    const skipAll = screen.getByRole('menuitem', { name: 'Skip all 3' });
    expect(skipAll).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Snooze all 3…' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Edit recurring rule' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Skip all 3' }));
    expect(handlers.onSkipAll).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'rule-hosting' }));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze all 3…' }));
    expect(handlers.onSnoozeAll).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'rule-hosting' }));

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit recurring rule' }));
    expect(handlers.onEditRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: 'rule-hosting' }));
  });

  it('is right-to-left correct in Arabic (T21)', () => {
    renderList([...HOSTING, RENT], 'ar');

    const row = rowFor('Server hosting');
    expect(text(row)).toContain('أغسطس');
    expect(text(row)).toContain('أكتوبر');
    expect(text(row)).toContain('شهريًا');
    const amount = within(row).getByTestId('recurring-attention-amount');
    expect(amount).toHaveAttribute('dir', 'ltr');

    fireEvent.click(within(row).getByRole('button', { name: 'إجراءات Server hosting' }));
    // Three is "few" in Arabic: the few form, not the English "other"
    expect(screen.getByRole('menuitem', { name: 'تخطي 3 دفعات' })).toBeInTheDocument();
  });

  describe('a long-running rule (MUT-96)', () => {
    // Three years unmarked: 37 monthly payments, Oct 2023 to Oct 2026
    const THREE_YEARS = Array.from({ length: 37 }, (_, i) => {
      const date = new Date(2023, 9 + i, 5);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-05`;
      return occurrence({ expectedDate: iso, daysUntilDue: -(36 - i) * 30 });
    });

    it('summarises the months instead of listing all of them, and the total counts every one', () => {
      renderList(THREE_YEARS);
      const row = rowFor('Server hosting');

      expect(text(row)).toContain('37 payments since Oct 2023 not marked');
      expect(text(row)).not.toContain('Nov 2023');
      expect(text(within(row).getByTestId('recurring-attention-amount'))).toBe('$2,960');
    });

    it('still lists a handful of months by name', () => {
      renderList(HOSTING);
      expect(text(rowFor('Server hosting'))).toContain('Aug, Sep, Oct not marked');
    });

    it('summarises in Arabic with the right plural', () => {
      renderList(THREE_YEARS, 'ar');
      expect(text(rowFor('Server hosting'))).toContain('37 دفعة منذ');
    });
  });
});

