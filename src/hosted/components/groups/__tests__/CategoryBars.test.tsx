import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { CategoryBars } from '../CategoryBars';

/** MUT-268 13A/23A: each category row toggles the member filter; Uncategorized is muted. */

describe('CategoryBars', () => {
  it('toggles a category on and off, and marks Uncategorized', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
    const onSelect = vi.fn();
    const rows = [
      { key: 'rent', name: 'Rent', total: '30.000', count: 2, share: 60 },
      { key: 'none', name: 'Uncategorized', total: '20.000', count: 1, share: 40 },
    ];
    const { rerender } = render(
      <HostedLanguageProvider>
        <CategoryBars rows={rows} currency="JOD" onSelect={onSelect} reducedMotion />
      </HostedLanguageProvider>,
    );
    const rent = screen.getByRole('button', { name: /Rent/ });
    expect(rent).toHaveAttribute('aria-pressed', 'false');
    expect(rent).toHaveTextContent('60%');
    expect(screen.getByRole('button', { name: /Uncategorized/ })).toHaveClass('hp-catbar-none');
    await userEvent.click(rent);
    expect(onSelect).toHaveBeenLastCalledWith('rent');
    rerender(
      <HostedLanguageProvider>
        <CategoryBars rows={rows} currency="JOD" selected="rent" onSelect={onSelect} reducedMotion />
      </HostedLanguageProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Rent/ }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  /** MUT-175 D5/DR23: pins today's rows before CategoryBars gains `meta` and plain rows. */
  it('renders each row as a toggle button with name, amount and share, its fill at the share', () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
    const rows = [
      { key: 'rent', name: 'Rent', total: '30.000', count: 2, share: 60 },
      { key: 'none', name: 'Uncategorized', total: '20.000', count: 1, share: 40 },
    ];
    render(
      <HostedLanguageProvider>
        <CategoryBars rows={rows} currency="JOD" onSelect={vi.fn()} reducedMotion />
      </HostedLanguageProvider>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.querySelector('.hp-catbar-name')).toHaveTextContent('Rent');
    expect(buttons[0]!.querySelector('.hp-catbar-amount')).toHaveTextContent(/30\.000.*· 60%/);
    expect([...document.querySelectorAll<HTMLElement>('.hp-catbar-fill')].map((f) => f.style.transform)).toEqual(['scaleX(0.6)', 'scaleX(0.4)']);
    expect(document.querySelector('.hp-catbar-meta')).toBeNull();
  });
});
