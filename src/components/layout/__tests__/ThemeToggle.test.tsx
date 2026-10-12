/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../../lib/theme';
import { ThemeToggle } from '../ThemeToggle';

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key} ${Object.values(vars).join(' ')}` : key,
}));

const STORAGE_KEY = 'mutaba3a-theme';

function renderToggle() {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  return screen.getByRole('button', { name: /^nav\.theme / });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle (MUT-79)', () => {
  it('names the current mode, starting from the saved one', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    expect(renderToggle()).toHaveAccessibleName('nav.theme settings.theme.dark');
  });

  it('cycles Light → Dark → System, applying and saving each mode as Settings does', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const toggle = renderToggle();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('nav.theme settings.theme.dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('nav.theme settings.theme.system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');

    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('nav.theme settings.theme.light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });
});
