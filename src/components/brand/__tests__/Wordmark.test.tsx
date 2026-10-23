import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../../lib/theme';
import { Wordmark } from '../Wordmark';
import { repoPath, sourceFiles } from '../../../test/css/brandCss';

/**
 * The shared mark + name lockup (MUT-104, moved for MUT-77): the portal and
 * the landing header pass their own name and classes.
 */

function renderWordmark(props: Parameters<typeof Wordmark>[0]) {
  return render(
    <ThemeProvider>
      <Wordmark {...props} />
    </ThemeProvider>,
  );
}

afterEach(() => localStorage.clear());

describe('Wordmark', () => {
  it('shows the given name after a decorative mark at the given size', () => {
    const { container } = renderWordmark({ name: 'متابعة', markSize: 32 });
    const wordmark = container.querySelector('.wordmark');
    expect(wordmark).toHaveTextContent('متابعة');
    const img = wordmark?.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width', '32');
  });

  it('hands the mark size to the CSS as one px value, so the logotype and the mark size from one source (design D7)', () => {
    const { container } = renderWordmark({ name: 'X', markSize: 40 });
    const wordmark = container.querySelector<HTMLElement>('.wordmark')!;
    expect(wordmark.style.getPropertyValue('--wordmark-mark')).toBe('40px');
    expect(wordmark.querySelector('img')).toHaveAttribute('height', '40');
  });

  it('defaults to a 30px mark, the kit minimum that keeps the logotype at 12px (eng D3)', () => {
    const { container } = renderWordmark({ name: 'X' });
    expect(container.querySelector<HTMLElement>('.wordmark')!.style.getPropertyValue('--wordmark-mark')).toBe('30px');
  });

  it('adds the caller’s classes to the lockup and the mark', () => {
    const { container } = renderWordmark({ name: 'X', className: 'landing-wordmark', markClassName: 'landing-wordmark-mark' });
    expect(container.querySelector('.wordmark')).toHaveClass('landing-wordmark');
    expect(container.querySelector('img')).toHaveClass('wordmark-mark', 'landing-wordmark-mark');
  });
});

/** Every literal mark size a lockup is given in source: `markSize={n}` and the `*_MARK_SIZE = n` constants. */
function markSizesInSource(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles().filter((name) => name.endsWith('.tsx') && !name.includes('__tests__'))) {
    const code = readFileSync(file, 'utf8');
    for (const match of code.matchAll(/markSize(?:\s*=|=\{)\s*(\d+)|_MARK_SIZE\s*=\s*(\d+)/g)) found.push(`${file.slice(repoPath('').length)} ${match[1] ?? match[2]}`);
  }
  return found;
}

describe('the lockup size rules', () => {
  it('never gives a lockup a mark under 30px, so the logotype is never under its 12px minimum (eng D3)', () => {
    const sizes = markSizesInSource();
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((entry) => Number(entry.split(' ').pop()) < 30)).toEqual([]);
  });

  it('lets no stylesheet set --wordmark-mark: the markSize prop is its only source (design D7)', () => {
    const setters = sourceFiles()
      .filter((name) => name.endsWith('.css'))
      .filter((file) => /--wordmark-mark\s*:/.test(readFileSync(file, 'utf8')));
    expect(setters).toEqual([]);
  });
});
