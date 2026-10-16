/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RecurringMarkPaidDrawer } from '../RecurringMarkPaidDrawer';
import { groupOccurrencesByRule, snoozeDateAfter } from '../../expenses/recurringAttention';
import { I18nProvider } from '../../../lib/i18n/core';
import { todayLocalISO } from '../../../lib/dates';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import type { Language } from '../../../lib/i18n';
import type { VirtualOccurrenceDisplay } from '../../../types';

const { confirmPayments, skipOccurrences, snoozeOccurrences } = vi.hoisted(() => ({
  confirmPayments: vi.fn(),
  skipOccurrences: vi.fn(),
  snoozeOccurrences: vi.fn(),
}));

// The hooks run each batch as one all-or-nothing write (tested in the service);
// here they only record what the drawer asked for.
vi.mock('../../../hooks/useRecurringExpenseQueries', () => {
  const mutation = (fn: ReturnType<typeof vi.fn>) => () => ({
    mutate: (params: unknown, options?: { onSuccess?: () => void }) => {
      fn(params);
      options?.onSuccess?.();
    },
    isPending: false,
  });
  return {
    useConfirmRecurringPayments: mutation(confirmPayments),
    useSkipRecurringOccurrences: mutation(skipOccurrences),
    useSnoozeRecurringOccurrences: mutation(snoozeOccurrences),
  };
});

function occurrence(expectedDate: string, overrides: Partial<VirtualOccurrenceDisplay> = {}): VirtualOccurrenceDisplay {
  return {
    ruleId: 'rule-hosting',
    profileId: 'profile-1',
    expectedDate,
    amountMinor: 8000,
    currency: 'USD',
    computedState: 'overdue',
    ruleTitle: 'Server hosting',
    frequency: 'monthly',
    daysUntilDue: -30,
    isOverdue: true,
    isUpcoming: false,
    effectiveAmount: 8000,
    effectiveCurrency: 'USD',
    ...overrides,
  };
}

const [GROUP] = groupOccurrencesByRule([
  occurrence('2026-08-05'),
  occurrence('2026-09-05'),
  occurrence('2026-10-05'),
]);

function renderDrawer(options: { language?: Language; initialView?: 'list' | 'snooze' } = {}) {
  const onClose = vi.fn();
  render(
    <I18nProvider translations={{ en, ar }} language={options.language ?? 'en'} setLanguage={() => {}}>
      <RecurringMarkPaidDrawer group={GROUP} initialView={options.initialView} onClose={onClose} />
    </I18nProvider>
  );
  return { onClose };
}

const monthBox = (name: string) => screen.getByRole('checkbox', { name: new RegExp(name) });
const amountBox = (month: string) => screen.getByRole('textbox', { name: `Amount for ${month}` });
const markPaidButton = () => screen.getByRole('button', { name: /^Mark (\d+ )?paid$/i });

describe('RecurringMarkPaidDrawer (MUT-87)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists every missed payment, checked, with its date (T22)', () => {
    renderDrawer();

    expect(screen.getByRole('dialog', { name: 'Server hosting' })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(monthBox('August 2026')).toBeInTheDocument();
    expect(screen.getByText('Aug 5, 2026')).toBeInTheDocument();
    expect(screen.getByText('Oct 5, 2026')).toBeInTheDocument();
    expect(amountBox('August 2026')).toHaveValue('80');
  });

  it('marks every payment paid on its own expected date and closes (T22)', () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Mark 3 paid' }));

    expect(confirmPayments).toHaveBeenCalledWith({
      ruleId: 'rule-hosting',
      profileId: 'profile-1',
      payments: [{ expectedDate: '2026-08-05' }, { expectedDate: '2026-09-05' }, { expectedDate: '2026-10-05' }],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('marks only the checked payments; the button counts them; none checked disables it (T23)', () => {
    renderDrawer();

    fireEvent.click(monthBox('September 2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark 2 paid' }));
    expect(confirmPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ expectedDate: '2026-08-05' }, { expectedDate: '2026-10-05' }],
      })
    );

    fireEvent.click(monthBox('August 2026'));
    expect(screen.getByRole('button', { name: 'Mark 1 paid' })).toBeEnabled();
    fireEvent.click(monthBox('October 2026'));
    expect(markPaidButton()).toBeDisabled();
  });

  it('sends an edited amount and refuses one it cannot read (T24)', () => {
    renderDrawer();

    fireEvent.change(amountBox('August 2026'), { target: { value: '95.50' } });
    fireEvent.change(amountBox('September 2026'), { target: { value: 'abc' } });
    expect(screen.getByText('Enter an amount like 1200 or 1,200.50')).toBeInTheDocument();
    expect(markPaidButton()).toBeDisabled();

    fireEvent.change(amountBox('September 2026'), { target: { value: '0' } });
    expect(screen.getByText('Amount must be more than zero')).toBeInTheDocument();

    // An unchecked payment's amount does not block the others
    fireEvent.click(monthBox('September 2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark 2 paid' }));
    expect(confirmPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ expectedDate: '2026-08-05', amountMinor: 9550 }, { expectedDate: '2026-10-05' }],
      })
    );
  });

  it('refuses an amount typed in another currency', () => {
    renderDrawer();

    fireEvent.change(amountBox('August 2026'), { target: { value: '€80' } });
    expect(screen.getByText('The amount is in EUR, but this entry is in USD')).toBeInTheDocument();
    expect(markPaidButton()).toBeDisabled();
  });

  it('skips one payment after asking, and snoozes one from its own view (T25)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderDrawer();

    const skipSep = screen.getByRole('button', { name: 'Skip September 2026' });
    fireEvent.click(skipSep);
    expect(skipOccurrences).not.toHaveBeenCalled();
    fireEvent.click(skipSep);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(skipOccurrences).toHaveBeenCalledWith({
      ruleId: 'rule-hosting',
      profileId: 'profile-1',
      expectedDates: ['2026-09-05'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Snooze October 2026' }));
    const until = screen.getByLabelText('Snooze until');
    expect(until).toHaveValue(snoozeDateAfter(todayLocalISO(), 7));
    fireEvent.change(until, { target: { value: '2099-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    expect(snoozeOccurrences).toHaveBeenCalledWith({
      ruleId: 'rule-hosting',
      profileId: 'profile-1',
      expectedDates: ['2026-10-05'],
      snoozeUntil: '2099-01-01',
    });
    // Back on the list after snoozing one payment
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    confirmSpy.mockRestore();
  });

  it('opened on the snooze view, snoozes every payment; a quick pick sets the date (T26)', () => {
    const { onClose } = renderDrawer({ initialView: 'snooze' });

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const quickPicks = screen.getByRole('group', { name: 'Quick picks' });
    fireEvent.click(within(quickPicks).getByRole('button', { name: 'in 30 days' }));
    expect(screen.getByLabelText('Snooze until')).toHaveValue(snoozeDateAfter(todayLocalISO(), 30));

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    expect(snoozeOccurrences).toHaveBeenCalledWith({
      ruleId: 'rule-hosting',
      profileId: 'profile-1',
      expectedDates: ['2026-08-05', '2026-09-05', '2026-10-05'],
      snoozeUntil: snoozeDateAfter(todayLocalISO(), 30),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a snooze date that is not after today', () => {
    renderDrawer({ initialView: 'snooze' });

    fireEvent.change(screen.getByLabelText('Snooze until'), { target: { value: todayLocalISO() } });
    expect(screen.getByText('Pick a date after today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snooze' })).toBeDisabled();
  });

  it('Cancel on the snooze-all view closes the drawer', () => {
    const { onClose } = renderDrawer({ initialView: 'snooze' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('speaks Arabic (T27)', () => {
    renderDrawer({ language: 'ar' });

    expect(screen.getByRole('dialog', { name: 'Server hosting' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /أغسطس/ })).toBeInTheDocument();
    // Three is "few" in Arabic
    expect(screen.getByRole('button', { name: 'تسجيل 3 دفعات' })).toBeInTheDocument();
  });
});
