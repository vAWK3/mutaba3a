import { Fragment, type ReactNode } from 'react';
import '../../components/ui/Table.css';

/**
 * A page-local table on the app's `Table.css` (hosted-portal.md §11: the app has
 * no shared `DataTable`). Rows arrive already shaped; columns are expected to be
 * memoised by the caller (performance guardrails). An optional second row per
 * item holds expandable detail (payments → allocations).
 */

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
}

interface HostedTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  label: string;
  detail?: (row: Row) => ReactNode | null;
  /** Opt-in (MUT-44): makes each row open something (the expense drawer) on click. Every other list is still read-only. */
  onRowClick?: (row: Row) => void;
  /** Extra classes for a row, e.g. the after-save `row-flash` tint (MUT-91). */
  rowClassName?: (row: Row) => string | undefined;
}

export function HostedTable<Row>({ columns, rows, rowKey, label, detail, onRowClick, rowClassName }: HostedTableProps<Row>) {
  return (
    <div className="table-wrapper hp-table-wrapper">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'hp-num' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const extra = detail?.(row);
            const className = [onRowClick ? 'clickable' : undefined, rowClassName?.(row)].filter(Boolean).join(' ') || undefined;
            return (
              <Fragment key={rowKey(row)}>
                <tr className={className} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map((column) => (
                    <td key={column.key} className={column.numeric ? 'hp-num' : undefined}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
                {extra && (
                  <tr className="hp-detail-row">
                    <td colSpan={columns.length}>{extra}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
