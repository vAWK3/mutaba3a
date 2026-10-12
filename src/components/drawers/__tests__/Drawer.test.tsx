import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../../../lib/i18n';
import { Drawer } from '../Drawer';

const LANGUAGE_KEY = 'mutaba3a-language';

function Wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

afterEach(() => {
  localStorage.removeItem(LANGUAGE_KEY);
});

// TD-009: axe's aria-dialog-name fired on every drawer
describe('Drawer', () => {
  it('is a dialog named by its title', () => {
    const { rerender } = render(
      <Drawer title="New income" onClose={vi.fn()}>body</Drawer>,
      { wrapper: Wrapper },
    );

    expect(screen.getByRole('dialog', { name: 'New income' })).toBeInTheDocument();

    rerender(<Drawer title="Edit income" onClose={vi.fn()}>body</Drawer>);
    expect(screen.getByRole('dialog', { name: 'Edit income' })).toBeInTheDocument();
  });

  it('gives each open drawer its own name', () => {
    render(
      <>
        <Drawer title="Income" onClose={vi.fn()}>one</Drawer>
        <Drawer title="Record payment" onClose={vi.fn()}>two</Drawer>
      </>,
      { wrapper: Wrapper },
    );

    expect(screen.getByRole('dialog', { name: 'Income' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Record payment' })).toBeInTheDocument();
  });

  it('names the close button in English', () => {
    localStorage.setItem(LANGUAGE_KEY, 'en');
    render(<Drawer title="Income" onClose={vi.fn()}>body</Drawer>, { wrapper: Wrapper });

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('names the close button in Arabic', () => {
    localStorage.setItem(LANGUAGE_KEY, 'ar');
    render(<Drawer title="دخل" onClose={vi.fn()}>body</Drawer>, { wrapper: Wrapper });

    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeInTheDocument();
  });
});
