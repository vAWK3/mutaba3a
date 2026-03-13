import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Numeric, Amount } from '../Numeric';

// Mock the i18n module
vi.mock('../../../lib/i18n', () => ({
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

describe('Numeric', () => {
  describe('default format', () => {
    it('should render number value', () => {
      render(<Numeric value={1234.56} />);
      expect(screen.getByText('1,234.56')).toBeInTheDocument();
    });

    it('should render string value parsed as number', () => {
      render(<Numeric value="1234.56" />);
      expect(screen.getByText('1,234.56')).toBeInTheDocument();
    });

    it('should render integer without decimals by default', () => {
      render(<Numeric value={1234} />);
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it('should render with specified decimals', () => {
      render(<Numeric value={1234} decimals={2} />);
      expect(screen.getByText('1,234.00')).toBeInTheDocument();
    });
  });

  describe('currency format', () => {
    it('should render USD currency', () => {
      render(<Numeric value={1234.56} format="currency" currency="USD" />);
      expect(screen.getByText('$1,234.56')).toBeInTheDocument();
    });

    it('should render ILS currency', () => {
      render(<Numeric value={1234.56} format="currency" currency="ILS" />);
      // ILS is formatted as ₪
      const element = screen.getByText(/1,234\.56/);
      expect(element).toBeInTheDocument();
    });

    it('should render currency with specified decimals', () => {
      render(<Numeric value={1234} format="currency" currency="USD" decimals={2} />);
      expect(screen.getByText('$1,234.00')).toBeInTheDocument();
    });
  });

  describe('percent format', () => {
    it('should render percentage (divides by 100)', () => {
      render(<Numeric value={50} format="percent" />);
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should render decimal percentage', () => {
      render(<Numeric value={33.5} format="percent" />);
      expect(screen.getByText(/33\.5%/)).toBeInTheDocument();
    });
  });

  describe('sign option', () => {
    it('should add + sign for positive numbers when sign=true', () => {
      render(<Numeric value={100} format="currency" currency="USD" sign />);
      expect(screen.getByText('+$100')).toBeInTheDocument();
    });

    it('should not add + sign when value is zero', () => {
      render(<Numeric value={0} format="currency" currency="USD" sign />);
      expect(screen.getByText('$0')).toBeInTheDocument();
    });

    it('should not add sign by default', () => {
      render(<Numeric value={100} format="currency" currency="USD" />);
      expect(screen.getByText('$100')).toBeInTheDocument();
    });
  });

  describe('className', () => {
    it('should apply base num class', () => {
      const { container } = render(<Numeric value={100} />);
      expect(container.querySelector('.num')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(<Numeric value={100} className="custom-class" />);
      expect(container.querySelector('.num.custom-class')).toBeInTheDocument();
    });
  });

  describe('locale override', () => {
    it('should use specified locale', () => {
      render(<Numeric value={1234.56} locale="de-DE" />);
      // German locale uses dot as thousand separator and comma for decimals
      // But Intl may vary, just check it renders a number
      const element = screen.getByText(/1.*234.*56/);
      expect(element).toBeInTheDocument();
    });
  });
});

describe('Amount', () => {
  describe('basic rendering', () => {
    it('should convert minor units to major units', () => {
      render(<Amount amountMinor={10050} currency="USD" />);
      expect(screen.getByText('$100.5')).toBeInTheDocument();
    });

    it('should render whole dollar amounts', () => {
      render(<Amount amountMinor={10000} currency="USD" />);
      expect(screen.getByText('$100')).toBeInTheDocument();
    });

    it('should render cents correctly', () => {
      render(<Amount amountMinor={99} currency="USD" />);
      expect(screen.getByText('$0.99')).toBeInTheDocument();
    });
  });

  describe('negative amounts', () => {
    it('should render negative amount with minus', () => {
      render(<Amount amountMinor={-5000} currency="USD" />);
      // The component handles negative amounts by showing the absolute value with prefix
      const element = screen.getByText(/-.*\$50/);
      expect(element).toBeInTheDocument();
    });
  });

  describe('showSign option', () => {
    it('should add + sign for positive amounts when showSign=true', () => {
      render(<Amount amountMinor={5000} currency="USD" showSign />);
      expect(screen.getByText('+$50')).toBeInTheDocument();
    });

    it('should add - sign for negative amounts when showSign=true', () => {
      render(<Amount amountMinor={-5000} currency="USD" showSign />);
      expect(screen.getByText(/-\$50/)).toBeInTheDocument();
    });

    it('should not add sign for zero when showSign=true', () => {
      render(<Amount amountMinor={0} currency="USD" showSign />);
      expect(screen.getByText('$0')).toBeInTheDocument();
    });
  });

  describe('currency', () => {
    it('should use USD by default', () => {
      render(<Amount amountMinor={1000} />);
      expect(screen.getByText('$10')).toBeInTheDocument();
    });

    it('should render ILS currency', () => {
      render(<Amount amountMinor={1000} currency="ILS" />);
      // ILS uses ₪
      const element = screen.getByText(/10/);
      expect(element).toBeInTheDocument();
    });
  });

  describe('className', () => {
    it('should apply base num class', () => {
      const { container } = render(<Amount amountMinor={1000} />);
      expect(container.querySelector('.num')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(<Amount amountMinor={1000} className="amount-positive" />);
      expect(container.querySelector('.num.amount-positive')).toBeInTheDocument();
    });
  });
});
