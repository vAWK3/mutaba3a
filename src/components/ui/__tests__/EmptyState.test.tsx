import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  describe('basic rendering', () => {
    it('should render title', () => {
      render(<EmptyState title="No items" />);
      expect(screen.getByText('No items')).toBeInTheDocument();
    });

    it('should render title as h3', () => {
      render(<EmptyState title="No items" />);
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('No items');
    });

    it('should have empty-state class', () => {
      const { container } = render(<EmptyState title="No items" />);
      expect(container.firstChild).toHaveClass('empty-state');
    });
  });

  describe('description', () => {
    it('should render description when provided', () => {
      render(<EmptyState title="No items" description="Add some items to get started" />);
      expect(screen.getByText('Add some items to get started')).toBeInTheDocument();
    });

    it('should render hint when provided', () => {
      render(<EmptyState title="No items" hint="Click the + button to add" />);
      expect(screen.getByText('Click the + button to add')).toBeInTheDocument();
    });

    it('should prefer description over hint when both provided', () => {
      render(
        <EmptyState
          title="No items"
          description="Description text"
          hint="Hint text"
        />
      );
      expect(screen.getByText('Description text')).toBeInTheDocument();
      expect(screen.queryByText('Hint text')).not.toBeInTheDocument();
    });

    it('should not render description paragraph when not provided', () => {
      const { container } = render(<EmptyState title="No items" />);
      expect(container.querySelector('.empty-state-description')).not.toBeInTheDocument();
    });
  });

  describe('action button', () => {
    it('should render action button when action prop provided', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add Item', onClick }}
        />
      );
      expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
    });

    it('should render action button with actionLabel and onAction', () => {
      const onAction = vi.fn();
      render(
        <EmptyState
          title="No items"
          actionLabel="Create New"
          onAction={onAction}
        />
      );
      expect(screen.getByRole('button', { name: 'Create New' })).toBeInTheDocument();
    });

    it('should call onClick when action button is clicked', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add Item', onClick }}
        />
      );

      fireEvent.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should call onAction when button is clicked', () => {
      const onAction = vi.fn();
      render(
        <EmptyState
          title="No items"
          actionLabel="Create"
          onAction={onAction}
        />
      );

      fireEvent.click(screen.getByRole('button'));
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('should prefer action prop over actionLabel/onAction', () => {
      const onClick = vi.fn();
      const onAction = vi.fn();
      render(
        <EmptyState
          title="No items"
          action={{ label: 'From action', onClick }}
          actionLabel="From props"
          onAction={onAction}
        />
      );

      expect(screen.getByRole('button', { name: 'From action' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'From props' })).not.toBeInTheDocument();
    });

    it('should not render button without actionLabel when only onAction provided', () => {
      const onAction = vi.fn();
      render(
        <EmptyState
          title="No items"
          onAction={onAction}
        />
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should have btn btn-primary classes', () => {
      const onClick = vi.fn();
      render(
        <EmptyState
          title="No items"
          action={{ label: 'Add', onClick }}
        />
      );
      const button = screen.getByRole('button');
      expect(button).toHaveClass('btn');
      expect(button).toHaveClass('btn-primary');
    });
  });

  describe('icon', () => {
    it('should render icon when provided', () => {
      const icon = <span data-testid="custom-icon">📦</span>;
      render(<EmptyState title="No items" icon={icon} />);
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    });

    it('should not render icon container when not provided', () => {
      const { container } = render(<EmptyState title="No items" />);
      expect(container.querySelector('.empty-state-icon')).not.toBeInTheDocument();
    });

    it('should wrap icon in container div', () => {
      const icon = <span data-testid="icon">🔍</span>;
      const { container } = render(<EmptyState title="No items" icon={icon} />);
      expect(container.querySelector('.empty-state-icon')).toBeInTheDocument();
    });
  });

  describe('full example', () => {
    it('should render all elements together', () => {
      const onClick = vi.fn();
      const icon = <span data-testid="icon">📝</span>;

      render(
        <EmptyState
          title="No projects found"
          description="Create your first project to get started"
          action={{ label: 'Create Project', onClick }}
          icon={icon}
        />
      );

      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'No projects found' })).toBeInTheDocument();
      expect(screen.getByText('Create your first project to get started')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create Project' })).toBeInTheDocument();
    });
  });
});
