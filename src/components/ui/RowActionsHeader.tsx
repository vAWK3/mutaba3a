/**
 * RowActionsHeader
 *
 * The header cell of a table's row-actions column (Record payment and the row
 * kebab). The column has no visible title, but a header with no text leaves
 * screen-reader users with an unnamed column (axe empty-table-header, TD-009),
 * so it carries a visually hidden "Actions".
 *
 * Usage:
 *   <tr>
 *     <th>{t('transactions.columns.amount')}</th>
 *     <RowActionsHeader />
 *   </tr>
 */

import { useT } from '../../lib/i18n';
import './RowActionsHeader.css';

export function RowActionsHeader() {
  const t = useT();

  return (
    <th className="row-actions-header">
      <span className="sr-only">{t('common.actions')}</span>
    </th>
  );
}
