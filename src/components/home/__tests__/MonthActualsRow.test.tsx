/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonthActualsRow } from '../MonthActualsRow';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'home.actuals.title': 'Month to Date',
      'home.actuals.received': 'Received',
      'home.actuals.unpaid': 'Unpaid',
      'home.actuals.expenses': 'Expenses',
      'home.actuals.net': 'Net',
      'common.loading': 'Loading...',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

// Mock media query hook
let mockIsMobile = false;
vi.mock('../../../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mockIsMobile,
}));

// Mock FX rate hook
vi.mock('../../../hooks/useFxRate', () => ({
  useFxRate: () => ({ rate: 3.6, source: 'live' }),
}));

// Mock month detection
vi.mock('../../../lib/monthDetection', () => ({
  getCurrentMonthKey: () => '2026-03',
}));

// Mock FX calculation
vi.mock('../../../lib/fx', () => ({
  getUnifiedTotalWithEur: (usd: number, ils: number, _eur: number, rate: number) =>
    Math.round(usd * rate) + ils,
}));

// Mock summary data
const mockSummaryUSD = {
  totalInflowMinor: 500000, // $5,000 received
  awaitingMinor: 200000, // $2,000 unpaid
  totalOutflowMinor: 150000, // $1,500 expenses
};

const mockSummaryILS = {
  totalInflowMinor: 1800000, // ₪18,000 received
  awaitingMinor: 720000, // ₪7,200 unpaid
  totalOutflowMinor: 540000, // ₪5,400 expenses
};

vi.mock('../../../hooks/useMoneyAnswersQueries', () => ({
  useMonthSummary: ({ currency }: { currency: string }) => ({
    data: currency === 'USD' ? mockSummaryUSD : mockSummaryILS,
    isLoading: false,
  }),
}));

// Mock ChevronDownIcon
vi.mock('../../icons', () => ({
  ChevronDownIcon: ({ className }: { className?: string }) => (
    <svg data-testid="chevron-icon" className={className} />
  ),
}));

function renderWithProviders(component: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
}

describe('MonthActualsRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockIsMobile = false;
  });

  describe('Rendering', () => {
    it('renders the section title', () => {
      renderWithProviders(<MonthActualsRow />);
      expect(screen.getByText('Month to Date')).toBeInTheDocument();
    });

    it('renders chevron icon', () => {
      renderWithProviders(<MonthActualsRow />);
      expect(screen.getByTestId('chevron-icon')).toBeInTheDocument();
    });

    it('renders currency tabs', () => {
      renderWithProviders(<MonthActualsRow />);
      expect(screen.getByRole('tab', { name: 'ILS' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'USD' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Both' })).toBeInTheDocument();
    });
  });

  describe('Expand/Collapse', () => {
    it('is expanded by default on desktop', () => {
      mockIsMobile = false;
      renderWithProviders(<MonthActualsRow />);

      // Should show the actuals content
      expect(screen.getByText('Received')).toBeInTheDocument();
      expect(screen.getByText('Unpaid')).toBeInTheDocument();
      expect(screen.getByText('Expenses')).toBeInTheDocument();
      expect(screen.getByText('Net')).toBeInTheDocument();
    });

    it('toggles expansion when header clicked', () => {
      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      expect(header).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('persists expanded state to localStorage', () => {
      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      fireEvent.click(header); // Collapse

      expect(localStorageMock.getItem('home-actuals-expanded')).toBe('false');
    });

    it('restores expanded state from localStorage', () => {
      localStorageMock.setItem('home-actuals-expanded', 'false');

      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      expect(header).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Currency tabs', () => {
    it('shows ILS by default', () => {
      renderWithProviders(<MonthActualsRow />);

      const ilsTab = screen.getByRole('tab', { name: 'ILS' });
      expect(ilsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to USD when USD tab clicked', () => {
      renderWithProviders(<MonthActualsRow />);

      const usdTab = screen.getByRole('tab', { name: 'USD' });
      fireEvent.click(usdTab);

      expect(usdTab).toHaveAttribute('aria-selected', 'true');
    });

    it('shows both currencies when Both tab clicked', () => {
      renderWithProviders(<MonthActualsRow />);

      const bothTab = screen.getByRole('tab', { name: 'Both' });
      fireEvent.click(bothTab);

      expect(bothTab).toHaveAttribute('aria-selected', 'true');
    });

    it('does not collapse row when clicking currency tab', () => {
      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      expect(header).toHaveAttribute('aria-expanded', 'true');

      const usdTab = screen.getByRole('tab', { name: 'USD' });
      fireEvent.click(usdTab);

      // Should still be expanded
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('Actuals grid', () => {
    it('displays all four metric cards when expanded', () => {
      renderWithProviders(<MonthActualsRow />);

      expect(screen.getByText('Received')).toBeInTheDocument();
      expect(screen.getByText('Unpaid')).toBeInTheDocument();
      expect(screen.getByText('Expenses')).toBeInTheDocument();
      expect(screen.getByText('Net')).toBeInTheDocument();
    });

    it('hides metric cards when collapsed', () => {
      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      fireEvent.click(header); // Collapse

      expect(screen.queryByText('Received')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('header button has aria-expanded', () => {
      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      expect(header).toHaveAttribute('aria-expanded');
    });

    it('header button has aria-controls', () => {
      renderWithProviders(<MonthActualsRow />);

      const header = screen.getByRole('button', { name: /Month to Date/i });
      expect(header).toHaveAttribute('aria-controls', 'actuals-content');
    });

    it('content has matching id', () => {
      renderWithProviders(<MonthActualsRow />);

      const content = document.getElementById('actuals-content');
      expect(content).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('applies custom className', () => {
      const { container } = renderWithProviders(
        <MonthActualsRow className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Color coding', () => {
    it('applies positive color to received amounts', () => {
      renderWithProviders(<MonthActualsRow />);

      const receivedCard = screen.getByText('Received').closest('.actuals-card');
      const value = receivedCard?.querySelector('.actuals-value');
      expect(value).toHaveClass('amount-positive');
    });

    it('applies negative color to expenses amounts', () => {
      renderWithProviders(<MonthActualsRow />);

      const expensesCard = screen.getByText('Expenses').closest('.actuals-card');
      const value = expensesCard?.querySelector('.actuals-value');
      expect(value).toHaveClass('amount-negative');
    });
  });
});
