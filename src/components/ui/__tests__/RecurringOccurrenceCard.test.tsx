/**
 * MUT-179: the occurrence card words how late or how soon in the count's own form.
 * (The ledger shows only projected occurrences today, so these branches are proven here.)
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecurringOccurrenceCard } from '../RecurringOccurrenceCard';
import { I18nProvider } from '../../../lib/i18n/core';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import type { Language } from '../../../lib/i18n';
import type { VirtualOccurrenceDisplay } from '../../../types';

function occurrence(daysUntilDue: number): VirtualOccurrenceDisplay {
  return {
    ruleId: 'rule-hosting',
    profileId: 'profile-1',
    expectedDate: '2026-10-05',
    amountMinor: 8000,
    currency: 'USD',
    computedState: daysUntilDue < 0 ? 'overdue' : 'due',
    ruleTitle: 'Server hosting',
    frequency: 'monthly',
    daysUntilDue,
    isOverdue: daysUntilDue < 0,
    isUpcoming: daysUntilDue >= 0,
    effectiveAmount: 8000,
    effectiveCurrency: 'USD',
  };
}

function renderCard(daysUntilDue: number, language: Language) {
  render(
    <I18nProvider translations={{ en, ar }} language={language} setLanguage={() => {}}>
      <RecurringOccurrenceCard occurrence={occurrence(daysUntilDue)} />
    </I18nProvider>
  );
}

describe('RecurringOccurrenceCard counts (MUT-179)', () => {
  it.each([
    [1, 'en', 'Due in 1 day'],
    [-1, 'en', 'Overdue by 1 day'],
    [3, 'ar', 'مستحق خلال 3 أيام'],
    [-11, 'ar', 'متأخر 11 يومًا'],
    [2, 'ar', 'مستحق خلال يومين'],
  ] as const)('%i days in %s reads "%s"', (days, language, text) => {
    renderCard(days, language);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
