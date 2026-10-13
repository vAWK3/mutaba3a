import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import tokens from '../../../styles/brand/mutaba3a.tokens.json';
import { ThemeProvider, useTheme, type ThemeMode } from '..';

/**
 * The browser's tab bar and an installed app's title bar take their colour
 * from <meta name="theme-color">. The heads set one per OS scheme; the
 * ThemeProvider keeps them in step with the app's own toggle (MUT-104, D6).
 */

const LIGHT = tokens.color.canvas.hex;
const DARK = tokens.colorDark.canvas.hex;

function addHeadMetas() {
  document.head.insertAdjacentHTML(
    'beforeend',
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT}">` +
      `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK}">`,
  );
}

const contents = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.getAttribute('content'));

function Toggle({ to }: { to: ThemeMode }) {
  const { setTheme } = useTheme();
  return <button onClick={() => setTheme(to)}>{to}</button>;
}

function renderProvider(stored: ThemeMode) {
  localStorage.setItem('mutaba3a-theme', stored);
  render(
    <ThemeProvider>
      <Toggle to="dark" />
      <Toggle to="light" />
      <Toggle to="system" />
    </ThemeProvider>,
  );
}

afterEach(() => {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('theme-color follows the app theme (MUT-104)', () => {
  it('paints both schemes with the dark canvas when Dark is chosen', () => {
    addHeadMetas();
    renderProvider('dark');
    expect(contents()).toEqual([DARK, DARK]);
  });

  it('paints both schemes with the light canvas when Light is chosen', () => {
    addHeadMetas();
    renderProvider('light');
    expect(contents()).toEqual([LIGHT, LIGHT]);
  });

  it('hands the bar back to the OS scheme when System is chosen again', () => {
    addHeadMetas();
    renderProvider('dark');
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    expect(contents()).toEqual([LIGHT, DARK]);
  });

  it('follows a toggle press without a reload', () => {
    addHeadMetas();
    renderProvider('light');
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(contents()).toEqual([DARK, DARK]);
  });

  it('does nothing on a page without theme-color metas', () => {
    expect(() => renderProvider('dark')).not.toThrow();
    expect(contents()).toEqual([]);
  });
});
