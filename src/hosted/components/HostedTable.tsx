import { Fragment, useState, type DragEvent, type ReactNode } from 'react';
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
  /** Pinned to the table's inline end while the other columns scroll (MUT-133, design 8A): the row action stays in view on a narrow window. */
  stickyEnd?: boolean;
}

function cellClass<Row>(column: Column<Row>): string | undefined {
  const classes = [column.numeric && 'hp-num', column.stickyEnd && 'hp-sticky-end'].filter(Boolean);
  return classes.length ? classes.join(' ') : undefined;
}

interface HostedTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  label: string;
  detail?: (row: Row) => ReactNode | null;
  /**
   * Opt-in (MUT-44): makes each row open something (an edit drawer) on click. MUT-194 (design D8, eng D11):
   * the first cell's content then sits in a real `<button className="row-link press">`, so the row is reachable by
   * Tab and opens with Enter/Space; the `<tr>` keeps its mouse click and its row semantics (no role, no tabIndex),
   * the ClientsPage link-in-cell precedent. Every other list is still read-only.
   */
  onRowClick?: (row: Row) => void;
  /**
   * MUT-224 (eng review R5): which column's cell hosts the row-link button. Default: the first. Payments points it
   * at its date, because its first cell already holds the allocations expander (a button can't nest a button).
   */
  linkColumn?: string;
  /** MUT-224 (R5): rows that may open. A refused row gets no row-link, no clickable look and no click handler. */
  canOpen?: (row: Row) => boolean;
  /** Extra classes for a row, e.g. the after-save `row-flash` tint (MUT-91). */
  rowClassName?: (row: Row) => string | undefined;
  /**
   * MUT-647 (round 3, path B): a file dropped on a row is handed to the caller with that row (an invoice issued
   * elsewhere, attached to the entry). Rows refused by `canDropFile` take no drop. Mouse-only by nature: every row
   * that takes a drop has the same action in its own cell, reachable by keyboard.
   */
  onRowFileDrop?: (row: Row, file: File) => void;
  canDropFile?: (row: Row) => boolean;
}

const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

export function HostedTable<Row>({ columns, rows, rowKey, label, detail, onRowClick, linkColumn, canOpen, rowClassName, onRowFileDrop, canDropFile }: HostedTableProps<Row>) {
  const linkKey = linkColumn ?? columns[0]?.key;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  return (
    <div className="table-wrapper hp-table-wrapper">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const extra = detail?.(row);
            const open = onRowClick && (canOpen?.(row) ?? true) ? onRowClick : undefined;
            const key = rowKey(row);
            const drop = onRowFileDrop && (canDropFile?.(row) ?? true) ? onRowFileDrop : undefined;
            const className = [open ? 'clickable' : undefined, dropTarget === key ? 'hp-drop-target' : undefined, rowClassName?.(row)].filter(Boolean).join(' ') || undefined;
            const dropProps = drop
              ? {
                  onDragOver: (event: DragEvent) => {
                    if (!carriesFiles(event)) return;
                    event.preventDefault();
                    setDropTarget(key);
                  },
                  onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
                  onDrop: (event: DragEvent) => {
                    const file = event.dataTransfer.files[0];
                    setDropTarget(null);
                    if (!file) return;
                    event.preventDefault();
                    drop(row, file);
                  },
                  'data-drop-row': key,
                }
              : {};
            return (
              <Fragment key={key}>
                <tr className={className} onClick={open ? () => open(row) : undefined} {...dropProps}>
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {open && column.key === linkKey ? <RowLink onActivate={() => open(row)}>{column.cell(row)}</RowLink> : column.cell(row)}
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

/**
 * The row's keyboard door (MUT-194): its own click must not bubble to the row's, or the row would open twice.
 * `.press` keeps the portal's rule that every <button> presses (L10, ADR-074; pressFeedback.test.tsx).
 */
function RowLink({ onActivate, children }: { onActivate: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="row-link press"
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
    >
      {children}
    </button>
  );
}
