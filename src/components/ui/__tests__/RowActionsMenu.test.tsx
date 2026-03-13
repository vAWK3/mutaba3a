import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RowActionsMenu, type RowAction } from '../RowActionsMenu';

describe('RowActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render trigger button', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });

  it('should not render anything when actions array is empty', () => {
    const { container } = render(<RowActionsMenu actions={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('should have aria-expanded false initially', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('should set aria-expanded true when clicked', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('should toggle aria-expanded on click', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    const trigger = screen.getByRole('button', { name: 'Actions' });

    // Open
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Close
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('should have proper aria-label', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-label', 'Actions');
  });

  it('should render with single action', () => {
    const editAction = vi.fn();
    const actions: RowAction[] = [{ label: 'Edit', onClick: editAction }];

    render(<RowActionsMenu actions={actions} />);

    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });

  it('should render with multiple actions', () => {
    const actions: RowAction[] = [
      { label: 'Edit', onClick: vi.fn() },
      { label: 'Delete', onClick: vi.fn(), variant: 'danger' },
      { label: 'Duplicate', onClick: vi.fn() },
    ];

    render(<RowActionsMenu actions={actions} />);

    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });

  it('should stop event propagation on trigger click', () => {
    const parentClickHandler = vi.fn();
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];

    render(
      <div onClick={parentClickHandler}>
        <RowActionsMenu actions={actions} />
      </div>
    );

    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);

    expect(parentClickHandler).not.toHaveBeenCalled();
  });

  it('should render container with class', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    expect(document.querySelector('.row-actions-container')).toBeInTheDocument();
  });

  it('should render trigger with class', () => {
    const actions: RowAction[] = [{ label: 'Edit', onClick: vi.fn() }];
    render(<RowActionsMenu actions={actions} />);

    expect(document.querySelector('.row-actions-trigger')).toBeInTheDocument();
  });
});
