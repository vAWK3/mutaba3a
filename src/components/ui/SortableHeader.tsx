/**
 * SortableHeader
 *
 * A table header cell that sorts its column when clicked (MUT-7). The button
 * gives keyboard access; `aria-sort` on the cell tells assistive tech which
 * column is sorted and how. Props-in: the caller owns the sort state (usually
 * useSortState) and decides what a click does -- toggle the active column, or
 * switch to this one with its natural direction.
 *
 * Usage:
 *   <SortableHeader field="owed" label={t('clients.columns.owedNow')}
 *     sortField={sortField} sortDir={sortDir} onSort={handleSort} align="end" />
 */

import type { SortDir } from '../../hooks/useSortState';
import './SortableHeader.css';

export interface SortableHeaderProps<F extends string> {
  field: F;
  label: string;
  sortField: F;
  sortDir: SortDir;
  onSort: (field: F) => void;
  /** Numeric columns align to the end (right in LTR, left in RTL) */
  align?: 'start' | 'end';
  /** Optional explanation shown on hover, e.g. how the column is ordered */
  title?: string;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;
const INDICATOR = { asc: '▲', desc: '▼' } as const;

export function SortableHeader<F extends string>({
  field,
  label,
  sortField,
  sortDir,
  onSort,
  align = 'start',
  title,
}: SortableHeaderProps<F>) {
  const isActive = field === sortField;

  return (
    <th className="sortable" aria-sort={isActive ? ARIA_SORT[sortDir] : 'none'} style={{ textAlign: align }}>
      <button type="button" className="sortable-header-button" onClick={() => onSort(field)} title={title}>
        {label}
        <span className="sortable-header-indicator" aria-hidden="true">
          {isActive ? INDICATOR[sortDir] : ''}
        </span>
      </button>
    </th>
  );
}
