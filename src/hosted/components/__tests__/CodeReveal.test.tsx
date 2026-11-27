import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HostedLanguageProvider } from '../../i18n/HostedLanguageProvider';
import { CodeReveal } from '../CodeReveal';
import { COPIED_HOLD_MS, codeGroups, spokenCode } from '../claimCode';

/**
 * MUT-770 (DR-8, DR-11): the claim code the accountant reads out, shown once. Codes are LTR in every language, grouped
 * 3 and 3, heard digit by digit; Copy turns to Copied for 2 s. The motion is the claim-code spec, checked in the CSS.
 */

const css = readFileSync(join(process.cwd(), 'src/hosted/hosted.css'), 'utf8');

function renderIn(language: 'ar' | 'en', code = '481702') {
  return render(
    <HostedLanguageProvider linkedLanguage={language}>
      <CodeReveal code={code} />
    </HostedLanguageProvider>,
  );
}

describe('CodeReveal', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups six digits 3 and 3 and spells them for a screen reader', () => {
    expect(codeGroups('481702')).toEqual(['481', '702']);
    expect(codeGroups(' 481 702 ')).toEqual(['481', '702']);
    expect(codeGroups('12')).toEqual(['12']);
    expect(spokenCode('481702')).toBe('4 8 1 7 0 2');
  });

  it.each(['ar', 'en'] as const)('in %s, reads left to right as one image named by its spaced digits', (language) => {
    renderIn(language);
    const code = screen.getByRole('img', { name: '4 8 1 7 0 2' });
    expect(code).toHaveAttribute('dir', 'ltr');
    expect(code.querySelectorAll('.hp-code-reveal-group')).toHaveLength(2);
    const digits = [...code.querySelectorAll<HTMLElement>('.hp-code-digit')];
    expect(digits.map((d) => d.textContent).join('')).toBe('481702');
    // Leftmost first in both directions: the stagger index follows the digits' order
    expect(digits.map((d) => d.style.getPropertyValue('--digit'))).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('copies the bare digits, says Copied politely, and goes back to Copy after the 2 s hold', async () => {
    vi.useFakeTimers();
    renderIn('en');
    const button = screen.getByRole('button', { name: /copy/i });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith('481702');
    expect(button).toHaveAttribute('data-state', 'copied');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    act(() => {
      vi.advanceTimersByTime(COPIED_HOLD_MS - 1);
    });
    expect(button).toHaveAttribute('data-state', 'copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button).toHaveAttribute('data-state', 'idle');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says so when the copy fails, and the code stays on screen to read out', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderIn('ar');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'نسخ' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('تعذّر النسخ.');
    expect(screen.getByRole('img', { name: '4 8 1 7 0 2' })).toBeInTheDocument();
  });

  describe('motion-claim-code (spec values in hosted.css)', () => {
    it('settles each digit 10 px up and in over 320 ms on the spring, 60 ms apart', () => {
      expect(css).toMatch(/\.hp-code-digit \{[^}]*animation: hp-code-digit-settle 320ms var\(--ease-spring\) calc\(var\(--digit, 0\) \* 60ms\) both;/);
      expect(css).toMatch(/@keyframes hp-code-digit-settle \{ from \{ opacity: 0; transform: translateY\(10px\); \} to \{ opacity: 1; transform: none; \} \}/);
    });

    it('cross-fades the label in 150 ms linear and grows the check from 0.6 over 240 ms on the spring', () => {
      expect(css).toMatch(/\.hp-code-reveal-copy-label, \.hp-code-reveal-copied-label \{ transition: opacity 150ms linear; \}/);
      expect(css).toMatch(/\.hp-code-reveal-check-glyph \{ opacity: 0; transform: scale\(0\.6\); transition: opacity 150ms linear, transform 240ms var\(--ease-spring\); \}/);
    });

    it('shows the still under reduced motion: a 150 ms fade, no rise, no scale', () => {
      const reduced = css.slice(css.indexOf('/* The still pose (motion-claim-code-still.svg)'));
      expect(reduced).toMatch(/^[^@]*\.hp-code-digit \{ animation: hp-fade-in-still 150ms linear both; \}/);
      expect(reduced).toMatch(/^[^@]*\.hp-code-reveal-check-glyph \{ transform: none;/);
    });
  });
});
