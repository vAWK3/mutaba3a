import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';
import { Pagination } from '../Pagination';

describe('Pagination', () => {
  describe('visibility', () => {
    it('should not render when totalPages is 1', () => {
      const { container } = renderWithProviders(
        <Pagination currentPage={1} totalPages={1} onPageChange={() => {}} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should not render when totalPages is 0', () => {
      const { container } = renderWithProviders(
        <Pagination currentPage={1} totalPages={0} onPageChange={() => {}} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render when totalPages is greater than 1', () => {
      const { container } = renderWithProviders(
        <Pagination currentPage={1} totalPages={5} onPageChange={() => {}} />
      );
      expect(container.firstChild).toHaveClass('pagination');
    });
  });

  describe('page display', () => {
    it('should display current page and total pages', () => {
      renderWithProviders(
        <Pagination currentPage={2} totalPages={5} onPageChange={() => {}} />
      );
      expect(screen.getByText('2 / 5')).toBeInTheDocument();
    });

    it('should display item range when pageSize and totalItems provided', () => {
      renderWithProviders(
        <Pagination
          currentPage={1}
          totalPages={3}
          onPageChange={() => {}}
          pageSize={10}
          totalItems={25}
        />
      );
      expect(screen.getByText('1–10 of 25')).toBeInTheDocument();
    });

    it('should display correct range for middle page', () => {
      renderWithProviders(
        <Pagination
          currentPage={2}
          totalPages={3}
          onPageChange={() => {}}
          pageSize={10}
          totalItems={25}
        />
      );
      expect(screen.getByText('11–20 of 25')).toBeInTheDocument();
    });

    it('should display correct range for last page with partial items', () => {
      renderWithProviders(
        <Pagination
          currentPage={3}
          totalPages={3}
          onPageChange={() => {}}
          pageSize={10}
          totalItems={25}
        />
      );
      expect(screen.getByText('21–25 of 25')).toBeInTheDocument();
    });

    it('should not display range when pageSize not provided', () => {
      renderWithProviders(
        <Pagination
          currentPage={1}
          totalPages={3}
          onPageChange={() => {}}
          totalItems={25}
        />
      );
      expect(screen.queryByText(/of 25/)).not.toBeInTheDocument();
    });
  });

  describe('navigation buttons', () => {
    it('should render previous and next buttons', () => {
      renderWithProviders(
        <Pagination currentPage={2} totalPages={5} onPageChange={() => {}} />
      );
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('should disable previous button on first page', () => {
      renderWithProviders(
        <Pagination currentPage={1} totalPages={5} onPageChange={() => {}} />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toBeDisabled();
    });

    it('should disable next button on last page', () => {
      renderWithProviders(
        <Pagination currentPage={5} totalPages={5} onPageChange={() => {}} />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons[1]).toBeDisabled();
    });

    it('should enable both buttons on middle page', () => {
      renderWithProviders(
        <Pagination currentPage={3} totalPages={5} onPageChange={() => {}} />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).not.toBeDisabled();
      expect(buttons[1]).not.toBeDisabled();
    });
  });

  describe('onPageChange', () => {
    it('should call onPageChange with previous page when clicking previous', () => {
      const onPageChange = vi.fn();
      renderWithProviders(
        <Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />
      );

      fireEvent.click(screen.getAllByRole('button')[0]); // Previous button
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('should call onPageChange with next page when clicking next', () => {
      const onPageChange = vi.fn();
      renderWithProviders(
        <Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />
      );

      fireEvent.click(screen.getAllByRole('button')[1]); // Next button
      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    it('should not call onPageChange when clicking disabled previous', () => {
      const onPageChange = vi.fn();
      renderWithProviders(
        <Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} />
      );

      fireEvent.click(screen.getAllByRole('button')[0]); // Previous button (disabled)
      expect(onPageChange).not.toHaveBeenCalled();
    });

    it('should not call onPageChange when clicking disabled next', () => {
      const onPageChange = vi.fn();
      renderWithProviders(
        <Pagination currentPage={5} totalPages={5} onPageChange={onPageChange} />
      );

      fireEvent.click(screen.getAllByRole('button')[1]); // Next button (disabled)
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('should have aria-labels on navigation buttons', () => {
      renderWithProviders(
        <Pagination currentPage={2} totalPages={5} onPageChange={() => {}} />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toHaveAttribute('aria-label');
      expect(buttons[1]).toHaveAttribute('aria-label');
    });
  });
});
