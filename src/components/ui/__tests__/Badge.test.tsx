import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Badge,
  PaidBadge,
  UnpaidBadge,
  OverdueBadge,
  TypeBadge,
} from '../Badge';

describe('Badge', () => {
  describe('rendering', () => {
    it('should render children', () => {
      render(<Badge>Status</Badge>);
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('should render as a span', () => {
      render(<Badge>Status</Badge>);
      expect(screen.getByText('Status').tagName).toBe('SPAN');
    });
  });

  describe('variants', () => {
    it('should apply neutral variant by default', () => {
      render(<Badge>Neutral</Badge>);
      expect(screen.getByText('Neutral')).toHaveClass('badge-neutral');
    });

    it('should apply paid variant', () => {
      render(<Badge variant="paid">Paid</Badge>);
      expect(screen.getByText('Paid')).toHaveClass('badge-paid');
    });

    it('should apply unpaid variant', () => {
      render(<Badge variant="unpaid">Unpaid</Badge>);
      expect(screen.getByText('Unpaid')).toHaveClass('badge-unpaid');
    });

    it('should apply overdue variant', () => {
      render(<Badge variant="overdue">Overdue</Badge>);
      expect(screen.getByText('Overdue')).toHaveClass('badge-overdue');
    });

    it('should apply success variant', () => {
      render(<Badge variant="success">Success</Badge>);
      expect(screen.getByText('Success')).toHaveClass('badge-success');
    });

    it('should apply warning variant', () => {
      render(<Badge variant="warning">Warning</Badge>);
      expect(screen.getByText('Warning')).toHaveClass('badge-warning');
    });

    it('should apply error variant', () => {
      render(<Badge variant="error">Error</Badge>);
      expect(screen.getByText('Error')).toHaveClass('badge-error');
    });

    it('should apply info variant', () => {
      render(<Badge variant="info">Info</Badge>);
      expect(screen.getByText('Info')).toHaveClass('badge-info');
    });

    it('should apply accent variant', () => {
      render(<Badge variant="accent">Accent</Badge>);
      expect(screen.getByText('Accent')).toHaveClass('badge-accent');
    });
  });

  describe('sizes', () => {
    it('should apply md size by default', () => {
      render(<Badge>Medium</Badge>);
      expect(screen.getByText('Medium')).toHaveClass('badge-md');
    });

    it('should apply sm size', () => {
      render(<Badge size="sm">Small</Badge>);
      expect(screen.getByText('Small')).toHaveClass('badge-sm');
    });
  });

  describe('className', () => {
    it('should apply custom className', () => {
      render(<Badge className="custom">Badge</Badge>);
      expect(screen.getByText('Badge')).toHaveClass('custom');
    });

    it('should preserve base classes', () => {
      render(<Badge className="custom">Badge</Badge>);
      const badge = screen.getByText('Badge');
      expect(badge).toHaveClass('badge');
      expect(badge).toHaveClass('badge-neutral');
      expect(badge).toHaveClass('custom');
    });
  });
});

describe('PaidBadge', () => {
  it('should render with default "Paid" text', () => {
    render(<PaidBadge />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('should apply paid variant', () => {
    render(<PaidBadge />);
    expect(screen.getByText('Paid')).toHaveClass('badge-paid');
  });

  it('should allow custom children', () => {
    render(<PaidBadge>Complete</PaidBadge>);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});

describe('UnpaidBadge', () => {
  it('should render with default "Unpaid" text', () => {
    render(<UnpaidBadge />);
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
  });

  it('should apply unpaid variant', () => {
    render(<UnpaidBadge />);
    expect(screen.getByText('Unpaid')).toHaveClass('badge-unpaid');
  });

  it('should allow custom children', () => {
    render(<UnpaidBadge>Pending</UnpaidBadge>);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});

describe('OverdueBadge', () => {
  it('should render with default "Overdue" text', () => {
    render(<OverdueBadge />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('should apply overdue variant', () => {
    render(<OverdueBadge />);
    expect(screen.getByText('Overdue')).toHaveClass('badge-overdue');
  });

  it('should allow custom children', () => {
    render(<OverdueBadge>Late</OverdueBadge>);
    expect(screen.getByText('Late')).toBeInTheDocument();
  });
});

describe('TypeBadge', () => {
  it('should render income type with success variant', () => {
    render(<TypeBadge type="income" />);
    const badge = screen.getByText('Income');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-success');
  });

  it('should render expense type with neutral variant', () => {
    render(<TypeBadge type="expense" />);
    const badge = screen.getByText('Expense');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-neutral');
  });

  it('should render receivable type with warning variant', () => {
    render(<TypeBadge type="receivable" />);
    const badge = screen.getByText('Receivable');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-warning');
  });

  it('should apply size prop', () => {
    render(<TypeBadge type="income" size="sm" />);
    expect(screen.getByText('Income')).toHaveClass('badge-sm');
  });

  it('should apply custom className', () => {
    render(<TypeBadge type="income" className="custom" />);
    expect(screen.getByText('Income')).toHaveClass('custom');
  });
});
