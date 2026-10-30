import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '..';

/**
 * A browser that refuses to save anything for the site (private mode, a storage setting): the theme still applies for
 * the visit, and nothing it renders crashes. MUT-513's welcome must work there (AC8); this provider wraps every page.
 */

function Toggle() {
  const { theme, setTheme } = useTheme();
  return <button onClick={() => setTheme('dark')}>{theme}</button>;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider with storage blocked', () => {
  it('renders, and a theme change still applies for this visit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    render(
      <ThemeProvider>
        <Toggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
