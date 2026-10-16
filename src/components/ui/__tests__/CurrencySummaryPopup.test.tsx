import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CurrencySummaryPopup } from '../CurrencySummaryPopup';
import { formatAmount } from '../../../lib/utils';
import * as useFxRateModule from '../../../hooks/useFxRate';
import * as i18nModule from '../../../lib/i18n';

/**
 * MUT-24 §C: the unified-ILS amount on Projects and Income. Converts only when
 * every currency present has a rate (ADR-004: never guess), otherwise lists
 * each currency; colours net by sign; and the breakdown popup opens, closes
 * and stays inside the viewport.
 */

vi.mock('../../../hooks/useFxRate', () => ({ useFxRate: vi.fn() }));
vi.mock('../../../lib/i18n', () => ({ useLanguage: vi.fn(), getLocale: vi.fn(), useT: vi.fn() }));

const LOCALE = 'en-US';
const ils = (minor: number) => formatAmount(minor, 'ILS', LOCALE);

function setRates(rates: { USD?: number | null; EUR?: number | null }) {
  vi.mocked(useFxRateModule.useFxRate).mockImplementation((base) => {
    const rate = (base === 'EUR' ? rates.EUR : rates.USD) ?? null;
    return { rate, source: rate ? 'live' : 'none', isLoading: false, isError: false, rateDate: null, lastUpdated: null, refetch: vi.fn() } as never;
  });
}

const amount = () => document.querySelector('.currency-summary-amount')!;
const toggle = () => screen.getByRole('button', { name: 'Show currency breakdown' });
const dropdown = () => document.querySelector<HTMLElement>('.currency-summary-dropdown');

function placeTrigger(rect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100, bottom: 120, left: 50, right: 90, width: 40, height: 20, x: 50, y: 100, toJSON: () => ({}), ...rect,
  } as DOMRect);
}

beforeEach(() => {
  setRates({ USD: 3.75, EUR: 4 });
  vi.mocked(i18nModule.useLanguage).mockReturnValue({ language: 'en' } as never);
  vi.mocked(i18nModule.getLocale).mockReturnValue(LOCALE);
  vi.mocked(i18nModule.useT).mockReturnValue(((key: string) => key) as never);
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.dir = '';
});

describe('the amount', () => {
  it('shows one ILS total when every currency present has a rate', () => {
    render(<CurrencySummaryPopup usdAmountMinor={10000} ilsAmountMinor={5000} eurAmountMinor={1000} label="Paid" size="large" />);

    expect(amount()).toHaveTextContent(ils(37500 + 5000 + 4000));
    expect(amount()).toHaveClass('large');
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('lists each currency instead of guessing when a rate is missing', () => {
    setRates({ USD: null, EUR: 4 });
    render(<CurrencySummaryPopup usdAmountMinor={10000} ilsAmountMinor={5000} eurAmountMinor={200} />);

    expect(amount().textContent).toBe(
      [formatAmount(10000, 'USD', LOCALE), formatAmount(5000, 'ILS', LOCALE), formatAmount(200, 'EUR', LOCALE)].join(' + ')
    );
  });

  it('shows zero shekels when there is nothing and no rate', () => {
    setRates({});
    render(<CurrencySummaryPopup usdAmountMinor={0} ilsAmountMinor={0} />);

    expect(amount()).toHaveTextContent(ils(0));
  });

  it.each([
    ['income', { usd: 100, ils: 0 }, { USD: 3.75 }, 'amount-positive'],
    ['expense', { usd: 100, ils: 0 }, { USD: 3.75 }, 'amount-negative'],
    ['net', { usd: -100, ils: 200 }, { USD: 3.75 }, 'amount-negative'],
    ['net', { usd: 100, ils: -200 }, { USD: 3.75 }, 'amount-positive'],
    ['net', { usd: 100, ils: -200 }, { USD: null }, 'amount-negative'],
    ['net', { usd: 300, ils: -200 }, { USD: null }, 'amount-positive'],
  ] as const)('colours %s %j (rates %j) as %s', (type, a, rates, expected) => {
    setRates(rates);
    render(<CurrencySummaryPopup type={type} usdAmountMinor={a.usd} ilsAmountMinor={a.ils} />);

    expect(amount()).toHaveClass(expected);
  });

  it('leaves a neutral amount uncoloured', () => {
    render(<CurrencySummaryPopup usdAmountMinor={-100} ilsAmountMinor={0} />);

    expect(amount()).not.toHaveClass('amount-positive');
    expect(amount()).not.toHaveClass('amount-negative');
  });
});

describe('the breakdown', () => {
  it('opens with each currency and the rates it used, then closes from the toggle', () => {
    render(<CurrencySummaryPopup usdAmountMinor={10000} ilsAmountMinor={5000} eurAmountMinor={300} />);

    fireEvent.click(toggle());
    expect(dropdown()).toHaveTextContent(formatAmount(300, 'EUR', LOCALE));
    expect(dropdown()).toHaveTextContent('$1 = 3.75 ₪');
    expect(dropdown()).toHaveTextContent('€1 = 4.00 ₪');
    expect(dropdown()).toHaveTextContent('(fx.live)');

    fireEvent.click(toggle());
    expect(dropdown()).toBeNull();
  });

  it('shows no rate lines when no rate is known', () => {
    setRates({});
    render(<CurrencySummaryPopup usdAmountMinor={0} ilsAmountMinor={100} />);

    fireEvent.click(toggle());
    expect(dropdown()?.querySelectorAll('.currency-breakdown-rate')).toHaveLength(0);
  });

  it('closes on Escape but not on another key', () => {
    render(<CurrencySummaryPopup usdAmountMinor={100} ilsAmountMinor={0} />);
    fireEvent.click(toggle());

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(dropdown()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dropdown()).toBeNull();
  });

  it('closes on a click outside, not on a click inside it or on the toggle', () => {
    render(<CurrencySummaryPopup usdAmountMinor={100} ilsAmountMinor={0} />);
    fireEvent.click(toggle());

    fireEvent.mouseDown(dropdown()!);
    fireEvent.mouseDown(toggle());
    expect(dropdown()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(dropdown()).toBeNull();
  });
});

describe('where the breakdown opens', () => {
  it('opens below the trigger when there is room', () => {
    placeTrigger({ top: 100, bottom: 120, left: 50 });
    render(<CurrencySummaryPopup usdAmountMinor={100} ilsAmountMinor={0} />);
    fireEvent.click(toggle());

    expect(dropdown()!.style.top).toBe('124px');
    expect(dropdown()!.style.left).toBe('50px');
  });

  it('opens above the trigger near the bottom of the window, and stays inside the right edge', () => {
    placeTrigger({ top: 700, bottom: 720, left: 1150, right: 1190 });
    render(<CurrencySummaryPopup usdAmountMinor={100} ilsAmountMinor={0} />);
    fireEvent.click(toggle());

    expect(dropdown()!.style.top).toBe(`${700 - 160 - 4}px`);
    expect(dropdown()!.style.left).toBe(`${1200 - 180 - 8}px`);
  });

  it('lines up with the trigger’s right edge in right-to-left, never past the left padding', () => {
    document.documentElement.dir = 'rtl';
    placeTrigger({ left: 300, right: 400 });
    render(<CurrencySummaryPopup usdAmountMinor={100} ilsAmountMinor={0} />);
    fireEvent.click(toggle());
    expect(dropdown()!.style.left).toBe('220px');

    placeTrigger({ left: 0, right: 40 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(dropdown()!.style.left).toBe('8px');
  });

  it('follows the trigger on scroll', () => {
    placeTrigger({ top: 100, bottom: 120 });
    render(<CurrencySummaryPopup usdAmountMinor={100} ilsAmountMinor={0} />);
    fireEvent.click(toggle());

    placeTrigger({ top: 200, bottom: 220 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(dropdown()!.style.top).toBe('224px');
  });
});
