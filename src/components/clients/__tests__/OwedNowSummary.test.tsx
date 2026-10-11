/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OwedNowSummary } from '../OwedNowSummary';

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'clients.profile.owedNow': 'Owed now',
      'clients.profile.nothingOwed': 'Nothing owed',
      'clients.profile.overdueAmount': '{amount} overdue',
      'clients.profile.nothingOverdue': 'Nothing overdue',
    };
    const template = translations[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
  },
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

describe('OwedNowSummary', () => {
  it('shows one amount per currency, never a combined total', () => {
    render(
      <OwedNowSummary
        owed={[
          { currency: 'USD', owedMinor: 150000, overdueMinor: 0 },
          { currency: 'ILS', owedMinor: 420000, overdueMinor: 0 },
        ]}
      />
    );

    const amounts = screen.getAllByTestId('owed-now-amount');
    expect(amounts.map((el) => el.textContent)).toEqual(['$1,500', '₪4,200']);
  });

  it('calls out the overdue part of a currency in the overdue style', () => {
    render(<OwedNowSummary owed={[{ currency: 'USD', owedMinor: 150000, overdueMinor: 50000 }]} />);

    const overdue = screen.getByText(/overdue$/);
    expect(overdue.textContent?.replace(/[\u2066-\u2069]/g, '')).toBe('$500 overdue');
    expect(overdue).toHaveClass('owed-now-overdue');
  });

  it('says nothing is overdue when the whole balance is on time', () => {
    render(<OwedNowSummary owed={[{ currency: 'USD', owedMinor: 150000, overdueMinor: 0 }]} />);

    expect(screen.getByText('Nothing overdue')).toBeInTheDocument();
  });

  it('reads "Nothing owed" when the list is empty', () => {
    render(<OwedNowSummary owed={[]} />);

    expect(screen.getByText('Owed now')).toBeInTheDocument();
    expect(screen.getByText('Nothing owed')).toBeInTheDocument();
    expect(screen.queryByTestId('owed-now-amount')).toBeNull();
  });

  it('keeps amounts left-to-right inside right-to-left text', () => {
    render(<OwedNowSummary owed={[{ currency: 'USD', owedMinor: 150000, overdueMinor: 50000 }]} />);

    expect(screen.getByTestId('owed-now-amount')).toHaveAttribute('dir', 'ltr');
    // The overdue sentence isolates its amount with U+2066 / U+2069.
    expect(screen.getByText(/overdue$/).textContent).toContain('⁦$500⁩');
  });
});
