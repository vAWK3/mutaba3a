import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../../lib/theme';
import { Wordmark } from '../Wordmark';

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
    const { container } = renderWordmark({ name: 'Mutaba3a · متابعة', markSize: 24 });
    const wordmark = container.querySelector('.wordmark');
    expect(wordmark).toHaveTextContent('Mutaba3a · متابعة');
    const img = wordmark?.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width', '24');
  });

  it('adds the caller’s classes to the lockup and the mark', () => {
    const { container } = renderWordmark({ name: 'X', className: 'landing-wordmark', markClassName: 'landing-wordmark-mark' });
    expect(container.querySelector('.wordmark')).toHaveClass('landing-wordmark');
    expect(container.querySelector('img')).toHaveClass('wordmark-mark', 'landing-wordmark-mark');
  });
});
