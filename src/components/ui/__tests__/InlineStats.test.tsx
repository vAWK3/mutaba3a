import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineStats } from '../InlineStats';

describe('InlineStats', () => {
  describe('basic rendering', () => {
    it('should render stats with labels and values', () => {
      const stats = [
        { label: 'Paid', value: '$1,000' },
        { label: 'Unpaid', value: '$500' },
      ];

      render(<InlineStats stats={stats} />);

      expect(screen.getByText('Paid')).toBeInTheDocument();
      expect(screen.getByText('$1,000')).toBeInTheDocument();
      expect(screen.getByText('Unpaid')).toBeInTheDocument();
      expect(screen.getByText('$500')).toBeInTheDocument();
    });

    it('should render with empty stats array', () => {
      const { container } = render(<InlineStats stats={[]} />);
      expect(container.querySelector('.inline-stats')).toBeInTheDocument();
      expect(container.querySelectorAll('.inline-stat')).toHaveLength(0);
    });

    it('should have inline-stats class', () => {
      const { container } = render(<InlineStats stats={[{ label: 'Test', value: '100' }]} />);
      expect(container.querySelector('.inline-stats')).toBeInTheDocument();
    });
  });

  describe('className', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <InlineStats stats={[]} className="custom-class" />
      );
      expect(container.querySelector('.inline-stats')).toHaveClass('custom-class');
    });
  });

  describe('stat styling', () => {
    it('should render each stat with inline-stat class', () => {
      const stats = [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
      ];

      const { container } = render(<InlineStats stats={stats} />);
      expect(container.querySelectorAll('.inline-stat')).toHaveLength(2);
    });

    it('should render labels with inline-stat-label class', () => {
      const stats = [{ label: 'Revenue', value: '$5,000' }];

      const { container } = render(<InlineStats stats={stats} />);
      expect(container.querySelector('.inline-stat-label')).toHaveTextContent('Revenue');
    });

    it('should render values with inline-stat-value class', () => {
      const stats = [{ label: 'Revenue', value: '$5,000' }];

      const { container } = render(<InlineStats stats={stats} />);
      expect(container.querySelector('.inline-stat-value')).toHaveTextContent('$5,000');
    });
  });

  describe('color variants', () => {
    it('should apply positive color class', () => {
      const stats = [{ label: 'Profit', value: '$1,000', color: 'positive' as const }];

      const { container } = render(<InlineStats stats={stats} />);
      expect(container.querySelector('.inline-stat-value')).toHaveClass('amount-positive');
    });

    it('should apply negative color class', () => {
      const stats = [{ label: 'Loss', value: '-$500', color: 'negative' as const }];

      const { container } = render(<InlineStats stats={stats} />);
      expect(container.querySelector('.inline-stat-value')).toHaveClass('amount-negative');
    });

    it('should apply warning color class', () => {
      const stats = [{ label: 'Overdue', value: '$200', color: 'warning' as const }];

      const { container } = render(<InlineStats stats={stats} />);
      expect(container.querySelector('.inline-stat-value')).toHaveClass('amount-warning');
    });

    it('should not apply color class for neutral', () => {
      const stats = [{ label: 'Balance', value: '$0', color: 'neutral' as const }];

      const { container } = render(<InlineStats stats={stats} />);
      const value = container.querySelector('.inline-stat-value');
      expect(value).not.toHaveClass('amount-positive');
      expect(value).not.toHaveClass('amount-negative');
      expect(value).not.toHaveClass('amount-warning');
    });

    it('should not apply color class when no color specified', () => {
      const stats = [{ label: 'Count', value: '42' }];

      const { container } = render(<InlineStats stats={stats} />);
      const value = container.querySelector('.inline-stat-value');
      expect(value).not.toHaveClass('amount-positive');
      expect(value).not.toHaveClass('amount-negative');
      expect(value).not.toHaveClass('amount-warning');
    });
  });

  describe('multiple stats with different colors', () => {
    it('should render multiple stats with different color classes', () => {
      const stats = [
        { label: 'Income', value: '$1,000', color: 'positive' as const },
        { label: 'Expenses', value: '$800', color: 'negative' as const },
        { label: 'Due Soon', value: '$200', color: 'warning' as const },
        { label: 'Net', value: '$0', color: 'neutral' as const },
      ];

      const { container } = render(<InlineStats stats={stats} />);
      const values = container.querySelectorAll('.inline-stat-value');

      expect(values[0]).toHaveClass('amount-positive');
      expect(values[1]).toHaveClass('amount-negative');
      expect(values[2]).toHaveClass('amount-warning');
      // Neutral has no special class
      expect(values[3]).not.toHaveClass('amount-positive');
    });
  });
});
