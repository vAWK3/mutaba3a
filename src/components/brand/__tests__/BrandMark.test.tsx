import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme, type ThemeMode } from '../../../lib/theme';
import { fakeOsColorScheme } from '../../../test/osColorScheme';
import { BrandMark } from '../BrandMark';

/**
 * The Brand v2 mark follows the app's theme, not just the OS (MUT-104): the
 * light file on the light canvas, the dark file (butter dot) on the dark one.
 */

const os = fakeOsColorScheme();
/** Stands in for ThemeToggle: one press picks Dark. */
function DarkButton() {
  const { setTheme } = useTheme();
  return <button onClick={() => setTheme('dark')}>Dark</button>;
}

function renderMark(stored: ThemeMode, osDark = false) {
  os.install(osDark);
  localStorage.setItem('mutaba3a-theme', stored);
  render(
    <ThemeProvider>
      <DarkButton />
      <BrandMark size={28} className="brand-mark" />
    </ThemeProvider>,
  );
}

const src = () => screen.getByRole('presentation').getAttribute('src') ?? '';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('BrandMark (MUT-104)', () => {
  it('draws the light mark in Light, even when the OS is dark', () => {
    renderMark('light', true);
    expect(src()).toMatch(/\/mark\.svg/);
  });

  it('draws the dark mark in Dark, even when the OS is light', () => {
    renderMark('dark', false);
    expect(src()).toMatch(/\/mark-dark\.svg/);
  });

  it('follows the OS in System, including a live switch', () => {
    renderMark('system', true);
    expect(src()).toMatch(/\/mark-dark\.svg/);
    act(() => os.set(false));
    expect(src()).toMatch(/\/mark\.svg/);
  });

  it('switches when the theme toggle changes the mode', () => {
    renderMark('light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(src()).toMatch(/\/mark-dark\.svg/);
  });

  it('is decorative and sized, so its link or heading carries the name', () => {
    renderMark('light');
    const img = screen.getByRole('presentation');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width', '28');
    expect(img).toHaveAttribute('height', '28');
    expect(img).toHaveClass('brand-mark');
  });
});
