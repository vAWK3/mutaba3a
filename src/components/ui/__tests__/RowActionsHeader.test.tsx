import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../../../lib/i18n';
import { RowActionsHeader } from '../RowActionsHeader';

function TableWrapper({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <table>
        <thead>
          <tr>{children}</tr>
        </thead>
      </table>
    </LanguageProvider>
  );
}

// TD-009: axe's empty-table-header fired on the row-actions column
describe('RowActionsHeader', () => {
  it('is a column header named "Actions"', () => {
    render(<RowActionsHeader />, { wrapper: TableWrapper });

    const header = screen.getByRole('columnheader', { name: 'Actions' });
    expect(header).toHaveClass('row-actions-header');
  });

  it('keeps the name off screen', () => {
    render(<RowActionsHeader />, { wrapper: TableWrapper });

    expect(screen.getByText('Actions')).toHaveClass('sr-only');
  });
});
