import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedTable, type Column } from '../HostedTable';

/**
 * MUT-194 (design D8, eng D11): a clickable row is keyboard-reachable through
 * a real button in its first cell. The row keeps its mouse click and its row
 * semantics: no role or tabIndex on the <tr>.
 */

interface Row {
  id: string;
  date: string;
  amount: string;
}

const rows: Row[] = [
  { id: 'r1', date: '1 Oct 2026', amount: '$100.00' },
  { id: 'r2', date: '2 Oct 2026', amount: '$200.00' },
];

const columns: Column<Row>[] = [
  { key: 'date', header: 'Date', cell: (r) => r.date },
  { key: 'amount', header: 'Amount', numeric: true, cell: (r) => r.amount },
];

function renderTable(onRowClick?: (row: Row) => void) {
  render(
    <>
      <button type="button">Before</button>
      <HostedTable label="Ledger" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />
    </>,
  );
  return screen.getByRole('table', { name: 'Ledger' });
}

describe('HostedTable row-link (MUT-194, D8/D11)', () => {
  it('puts a button holding the first cell’s content in each clickable row, reachable by Tab', async () => {
    const user = userEvent.setup();
    const table = renderTable(vi.fn());
    const buttons = within(table).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('1 Oct 2026');
    expect(buttons[0]).toHaveClass('row-link');
    // Every portal button presses (L10, MUT-91).
    expect(buttons[0]).toHaveClass('press');
    expect(buttons[0]).toHaveAttribute('type', 'button');
    // The button lives in the first cell; the amount cell stays plain.
    expect(buttons[0]!.closest('td')).toBe(within(table).getAllByRole('row')[1]!.querySelector('td'));

    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
  });

  it('Enter and Space on the row button call onRowClick once each, with that row', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const table = renderTable(onRowClick);
    within(table).getAllByRole('button')[1]!.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  });

  it('a mouse click on the button or anywhere else on the row fires once (no double fire)', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const table = renderTable(onRowClick);
    await user.click(within(table).getAllByRole('button')[0]!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await user.click(within(table).getByText('$200.00'));
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  });

  it('keeps table semantics: same rows, no role or tabIndex on a <tr>', () => {
    const table = renderTable(vi.fn());
    const all = within(table).getAllByRole('row');
    expect(all).toHaveLength(3);
    for (const tr of all) {
      expect(tr.tagName).toBe('TR');
      expect(tr).not.toHaveAttribute('role');
      expect(tr).not.toHaveAttribute('tabindex');
    }
    expect(all[1]).toHaveClass('clickable');
  });

  it('renders no button when rows are not clickable', () => {
    const table = renderTable();
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(within(table).getAllByRole('row')[1]).not.toHaveClass('clickable');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('styles .row-link as plain text with the shared focus ring', () => {
    const css = readFileSync('src/hosted/hosted.css', 'utf8');
    expect(css).toMatch(/\.row-link\s*\{[^}]*background:\s*none[^}]*\}/);
    expect(css).toMatch(/\.row-link:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)/);
  });
});

describe('HostedTable linkColumn and canOpen (MUT-224, eng review R5)', () => {
  function renderWith(props: { linkColumn?: string; canOpen?: (row: Row) => boolean; onRowClick?: (row: Row) => void }) {
    render(<HostedTable label="Ledger" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={props.onRowClick ?? vi.fn()} linkColumn={props.linkColumn} canOpen={props.canOpen} />);
    return screen.getByRole('table', { name: 'Ledger' });
  }

  it('linkColumn puts the row-link in that column instead of the first', () => {
    const table = renderWith({ linkColumn: 'amount' });
    const buttons = within(table).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('$100.00');
    const firstRowCells = within(table).getAllByRole('row')[1]!.querySelectorAll('td');
    expect(buttons[0]!.closest('td')).toBe(firstRowCells[1]);
    expect(firstRowCells[0]!.querySelector('button')).toBeNull();
  });

  it('a row canOpen refuses has no row-link, no clickable look and no click handler', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const table = renderWith({ onRowClick, canOpen: (r) => r.id === 'r1' });
    const [, open, closed] = within(table).getAllByRole('row');
    expect(open).toHaveClass('clickable');
    expect(closed).not.toHaveClass('clickable');
    expect(within(closed!).queryByRole('button')).toBeNull();
    await user.click(within(table).getByText('$200.00'));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
