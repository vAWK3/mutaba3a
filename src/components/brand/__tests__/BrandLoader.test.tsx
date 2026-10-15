import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../../lib/i18n/core';
import type { Language } from '../../../lib/i18n/types';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { sourceFiles } from '../../../test/css/brandCss';
import { BLOOM_PIECES } from '../bloomLoaderData';
import {
  BrandLoader,
  LOADER_CHAIN_MS,
  LOADER_DELAY_MS,
  LOADER_SLOW_MS,
  __resetLoaderChainForTests,
} from '../BrandLoader';

/**
 * MUT-206: the bloom loader. A status region from mount, empty until the
 * 400 ms delay ends (D5, DR14); a fresh SVG at frame 0 (A1); a still mark and
 * a visible word under reduced motion (D3, DR7); the slow caption at 3 s (DR5);
 * a fade only when it appears after a delay (DR3); chained waits skip the
 * delay (DR11); no `style` anywhere (portal CSP).
 */

const REDUCE = '(prefers-reduced-motion: reduce)';
let clock = 10_000;

function prefersReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query === REDUCE,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

function Providers({ language = 'en', children }: { language?: Language; children: ReactNode }) {
  return (
    <I18nProvider translations={{ en, ar }} language={language} setLanguage={() => {}}>
      {children}
    </I18nProvider>
  );
}

function renderLoader(ui: ReactNode, language: Language = 'en') {
  return render(<Providers language={language}>{ui}</Providers>);
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const status = () => screen.getByRole('status');
const svgOf = (container: HTMLElement) => container.querySelector('svg')!;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  prefersReducedMotion(false);
  __resetLoaderChainForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BrandLoader (MUT-206)', () => {
  describe('delay and label (D5, DR13, DR14)', () => {
    it('keeps an empty status with the same footprint for 400 ms, then says "Loading"', () => {
      const { container } = renderLoader(<BrandLoader size={40} />);
      const placeholder = svgOf(container);

      expect(status()).toHaveTextContent('');
      expect(status()).not.toHaveAttribute('aria-label');
      expect(placeholder).toHaveAttribute('width', '40');
      expect(placeholder).toHaveAttribute('height', '40');
      expect(placeholder.querySelectorAll('path')).toHaveLength(0);

      advance(LOADER_DELAY_MS - 1);
      expect(status()).toHaveTextContent('');

      advance(1);
      expect(status()).toHaveTextContent('Loading');
      expect(status()).not.toHaveAttribute('aria-label');
      const shown = svgOf(container);
      expect(shown).toHaveAttribute('width', '40');
      expect(shown).toHaveAttribute('height', '40');
      expect(shown.querySelectorAll('path')).toHaveLength(4);
    });

    it('says "جارٍ التحميل" in Arabic', () => {
      renderLoader(<BrandLoader size={64} />, 'ar');
      advance(LOADER_DELAY_MS);
      expect(status()).toHaveTextContent('جارٍ التحميل');
    });

    it('mounts a fresh SVG when it shows, so the SMIL loop starts at frame 0 (A1)', () => {
      const { container } = renderLoader(<BrandLoader size={40} />);
      const placeholder = svgOf(container);
      advance(LOADER_DELAY_MS);
      expect(svgOf(container)).not.toBe(placeholder);
      expect(placeholder.isConnected).toBe(false);
    });

    it('shows at once with delay 0, without the enter fade, and takes a label', () => {
      renderLoader(<BrandLoader size={96} delay={0} label="Checking your session" />);
      expect(status()).toHaveTextContent('Checking your session');
      expect(status()).not.toHaveClass('brand-loader--enter');
    });

    it('fades in when it appears after its delay (DR3)', () => {
      renderLoader(<BrandLoader size={40} />);
      expect(status()).not.toHaveClass('brand-loader--enter');
      advance(LOADER_DELAY_MS);
      expect(status()).toHaveClass('brand-loader--enter');
    });

    it('keeps the label out of sight when motion is allowed: the moving mark says it', () => {
      const { container } = renderLoader(<BrandLoader size={40} delay={0} />);
      expect(container.querySelector('.sr-only')).toHaveTextContent('Loading');
      expect(container.querySelector('.brand-loader__caption')).toBeNull();
    });
  });

  describe('motion (D1, D3, DR7)', () => {
    it('blooms: four path morphs and one turn, each over 4.5 s', () => {
      const { container } = renderLoader(<BrandLoader size={40} delay={0} />);
      const animates = container.querySelectorAll('animate');
      expect(animates).toHaveLength(4);
      expect(container.querySelectorAll('animateTransform')).toHaveLength(1);
      for (const node of [...animates, container.querySelector('animateTransform')!]) {
        expect(node).toHaveAttribute('dur', '4.5s');
        expect(node).toHaveAttribute('repeatCount', 'indefinite');
      }
      expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('class'))).toEqual(
        BLOOM_PIECES.map((piece) => `brand-loader-${piece.cls}`),
      );
    });

    it('under reduced motion holds the mark still and shows the word once', () => {
      prefersReducedMotion(true);
      const { container } = renderLoader(<BrandLoader size={40} />);
      advance(LOADER_DELAY_MS);

      expect(container.querySelectorAll('animate, animateTransform')).toHaveLength(0);
      expect([...container.querySelectorAll('path')].map((path) => path.getAttribute('d'))).toEqual(
        BLOOM_PIECES.map((piece) => piece.values[0]),
      );
      expect(container.querySelector('.brand-loader__caption')).toHaveTextContent('Loading');
      expect(container.querySelector('.sr-only')).toBeNull();
      expect(status().textContent).toBe('Loading');
      expect(status()).not.toHaveClass('brand-loader--enter');
    });

    it('under reduced motion says "جارٍ التحميل" in Arabic', () => {
      prefersReducedMotion(true);
      const { container } = renderLoader(<BrandLoader size={64} delay={0} />, 'ar');
      expect(container.querySelector('.brand-loader__caption')).toHaveTextContent('جارٍ التحميل');
    });
  });

  describe('long wait (DR5)', () => {
    it('replaces the label with the slow caption at 3 s, counted from mount, and the mark stays put', () => {
      const { container } = renderLoader(<BrandLoader size={64} slowCaption="Still loading…" />);
      advance(LOADER_DELAY_MS);
      const svg = svgOf(container);
      expect(container.querySelector('.brand-loader__caption')).toBeNull();

      advance(LOADER_SLOW_MS - LOADER_DELAY_MS - 1);
      expect(status()).toHaveTextContent('Loading');

      advance(1);
      expect(status().textContent).toBe('Still loading…');
      expect(container.querySelector('.brand-loader__caption')).toHaveTextContent('Still loading…');
      expect(svgOf(container)).toBe(svg);
      expect(svg).toHaveAttribute('width', '64');
      expect(svg).toHaveAttribute('height', '64');
    });

    it('under reduced motion the word gives way to the slow caption', () => {
      prefersReducedMotion(true);
      renderLoader(<BrandLoader size={64} slowCaption="Still loading…" />);
      advance(LOADER_DELAY_MS);
      expect(status().textContent).toBe('Loading');
      advance(LOADER_SLOW_MS);
      expect(status().textContent).toBe('Still loading…');
    });

    it('has no caption at all without a slowCaption', () => {
      const { container } = renderLoader(<BrandLoader size={40} />);
      advance(LOADER_SLOW_MS * 2);
      expect(container.querySelector('.brand-loader__caption')).toBeNull();
    });
  });

  describe('chained waits (DR11)', () => {
    it('a loader mounting within 100 ms of a shown one leaving shows at once, with no fade', () => {
      const first = renderLoader(<BrandLoader size={64} />);
      advance(LOADER_DELAY_MS);
      first.unmount();

      clock += LOADER_CHAIN_MS / 2;
      renderLoader(<BrandLoader size={64} />);
      expect(status()).toHaveTextContent('Loading');
      expect(status()).not.toHaveClass('brand-loader--enter');
    });

    it('a loader mounting later waits its own 400 ms', () => {
      const first = renderLoader(<BrandLoader size={64} />);
      advance(LOADER_DELAY_MS);
      first.unmount();

      clock += LOADER_CHAIN_MS + 50;
      renderLoader(<BrandLoader size={64} />);
      expect(status()).toHaveTextContent('');
      advance(LOADER_DELAY_MS);
      expect(status()).toHaveTextContent('Loading');
    });

    it('a placeholder that never showed does not chain', () => {
      const first = renderLoader(<BrandLoader size={64} />);
      advance(LOADER_DELAY_MS - 100);
      first.unmount();

      clock += 10;
      renderLoader(<BrandLoader size={64} />);
      expect(status()).toHaveTextContent('');
    });
  });

  it('leaves no timer behind when it unmounts during the delay', () => {
    const { unmount } = renderLoader(<BrandLoader size={40} slowCaption="Still loading…" />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('writes no style attribute in any state (the portal CSP blocks parsed style="")', () => {
    prefersReducedMotion(false);
    const { container, rerender } = renderLoader(<BrandLoader size={24} slowCaption="Still loading…" />);
    expect(container.querySelector('[style]')).toBeNull();
    advance(LOADER_DELAY_MS);
    expect(container.querySelector('[style]')).toBeNull();
    advance(LOADER_SLOW_MS);
    expect(container.querySelector('[style]')).toBeNull();
    prefersReducedMotion(true);
    rerender(
      <Providers>
        <BrandLoader size={96} delay={0} />
      </Providers>,
    );
    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('old spinners are gone (MUT-206 D7)', () => {
  const css = sourceFiles().filter((file) => file.endsWith('.css'));

  it('no stylesheet keeps a ring spinner selector', () => {
    const offenders = css.filter((file) => /\.(?:spinner|hp-spinner|demo-spinner|table-spinner)(?![\w-])/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no stylesheet keeps their keyframes', () => {
    const offenders = css.filter((file) => /@keyframes\s+(?:spin|hp-spin|table-spin)(?![\w-])/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
