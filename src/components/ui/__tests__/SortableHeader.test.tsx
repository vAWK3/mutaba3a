/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableHeader } from '../SortableHeader';

function renderHeader(props: Partial<React.ComponentProps<typeof SortableHeader<string>>> = {}) {
  const onSort = vi.fn();
  render(
    <table>
      <thead>
        <tr>
          <SortableHeader field="owed" label="Owed now" sortField="name" sortDir="asc" onSort={onSort} {...props} />
        </tr>
      </thead>
    </table>
  );
  return { onSort, header: screen.getByRole('columnheader') };
}

describe('SortableHeader', () => {
  it('reports no sort on an inactive column and asks to sort by it on click', () => {
    const { onSort, header } = renderHeader();

    expect(header).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(screen.getByRole('button', { name: 'Owed now' }));
    expect(onSort).toHaveBeenCalledWith('owed');
  });

  it('reports the direction of the active column', () => {
    expect(renderHeader({ sortField: 'owed', sortDir: 'desc' }).header).toHaveAttribute('aria-sort', 'descending');
  });

  it('reports ascending too', () => {
    expect(renderHeader({ sortField: 'owed', sortDir: 'asc' }).header).toHaveAttribute('aria-sort', 'ascending');
  });

  it('aligns to the end for numeric columns and carries an explanatory title', () => {
    const { header } = renderHeader({ align: 'end', title: 'Ordered by today\'s rate' });

    expect(header).toHaveStyle({ textAlign: 'end' });
    expect(screen.getByRole('button', { name: 'Owed now' })).toHaveAttribute('title', 'Ordered by today\'s rate');
  });
});
