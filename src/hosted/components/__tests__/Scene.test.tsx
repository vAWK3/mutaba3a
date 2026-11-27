import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { I18nProvider } from '../../../lib/i18n/core';
import { PLACEHOLDER_SCENE, SCENE_NAMES, Scene, sceneArtFor, type SceneName } from '../Scene';

/**
 * MUT-561 (D10): the portal's scene renderer. A scene not drawn yet shows the empty-state art until Claude Design
 * delivers it and the generator reruns; the art is decorative, painted with tokens, and the drop-in rests on its final
 * frame under reduced motion.
 */

describe('Scene', () => {
  it('draws a scene that exists, hidden from assistive tech', () => {
    const { container } = render(<Scene name="empty-state" />);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap).toHaveAttribute('data-scene', 'empty-state');
    expect(wrap).toHaveAttribute('data-scene-art', 'empty-state');
    expect(wrap).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('falls back to the placeholder for a scene still being drawn, and says so for the swap', () => {
    expect(PLACEHOLDER_SCENE).toBe('empty-state');
    // A name a plan has ordered but Claude Design hasn't delivered (none today: cast to stand in for one)
    const onOrder = 'not-drawn-yet' as SceneName;
    const { container } = render(<Scene name={onOrder} />);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap).toHaveAttribute('data-scene', 'not-drawn-yet');
    expect(wrap).toHaveAttribute('data-scene-art', 'empty-state');
    expect(wrap).toHaveAttribute('data-placeholder', 'true');
    expect(sceneArtFor(onOrder).name).toBe('empty-state');
  });

  it.each(['accountant-empty', 'link-ready', 'shared-books', 'link-closed', 'client-books-empty', 'share-ended'] as const)(
    "MUT-558's %s is drawn (Claude Design, b2a02e37): its own art, no placeholder",
    (name) => {
      const { container } = render(<Scene name={name} />);
      expect(container.firstElementChild).toHaveAttribute('data-scene-art', name);
      expect(container.firstElementChild).not.toHaveAttribute('data-placeholder');
      expect(sceneArtFor(name)).toEqual({ name, placeholder: false });
    },
  );

  it('sizes the art and takes the drop-in motion as a class', () => {
    const { container } = render(<Scene name="empty-state" size={120} motion="drop-in" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '120');
    expect(container.firstElementChild).toHaveClass('hp-scene', 'hp-scene--drop-in');
  });

  describe('direction (2026-11-27: Claude Design ships -rtl art for scenes with a reading direction)', () => {
    afterEach(() => {
      document.documentElement.dir = '';
    });

    it('in an RTL document, picks the -rtl art when it exists', () => {
      document.documentElement.dir = 'rtl';
      const { container } = render(<Scene name="gift-used" />);
      const wrap = container.firstElementChild as HTMLElement;
      expect(wrap).toHaveAttribute('data-scene', 'gift-used');
      expect(wrap).toHaveAttribute('data-scene-art', 'gift-used-rtl');
      expect(sceneArtFor('gift-used', 'rtl')).toEqual({ name: 'gift-used-rtl', placeholder: false });
    });

    it('in an LTR document, keeps the plain art', () => {
      document.documentElement.dir = 'ltr';
      const { container } = render(<Scene name="gift-used" />);
      expect(container.firstElementChild).toHaveAttribute('data-scene-art', 'gift-used');
      expect(sceneArtFor('gift-used', 'ltr')).toEqual({ name: 'gift-used', placeholder: false });
    });

    it('a scene with no -rtl art uses the plain one in both directions', () => {
      for (const dir of ['rtl', 'ltr'] as const) {
        document.documentElement.dir = dir;
        const { container, unmount } = render(<Scene name="gift-month" />);
        expect(container.firstElementChild).toHaveAttribute('data-scene-art', 'gift-month');
        expect(sceneArtFor('gift-month', dir).name).toBe('gift-month');
        unmount();
      }
    });

    it('follows the language provider over the document attribute', () => {
      document.documentElement.dir = 'ltr';
      const { container } = render(
        <I18nProvider translations={{ ar: {}, en: {} }} language="ar" setLanguage={() => {}}>
          <Scene name="claimed-spot" />
        </I18nProvider>,
      );
      expect(container.querySelector('[data-scene]')).toHaveAttribute('data-scene-art', 'claimed-spot-rtl');
    });

    it('never mirrors with CSS: no scaleX(-1) on the wrapper or in the scene styles', () => {
      document.documentElement.dir = 'rtl';
      const { container } = render(<Scene name="gift-used" />);
      expect((container.firstElementChild as HTMLElement).getAttribute('style') ?? '').not.toMatch(/scale/);
      const css = readFileSync(join(process.cwd(), 'src/hosted/hosted.css'), 'utf8');
      expect(css).not.toMatch(/\.hp-scene[^{]*\{[^}]*scaleX\(-1\)/);
    });

    it('-rtl art is not a scene name of its own', () => {
      expect(SCENE_NAMES).toContain('gift-used');
      expect(SCENE_NAMES.some((name) => name.endsWith('-rtl'))).toBe(false);
    });
  });

  it('registers every 2026-11-27 scene', () => {
    for (const name of [
      'gift-month', 'gift-used', 'plan-upgraded', 'handover-welcome', 'handover-claimed', 'claimed-spot',
      'pilot-welcome-1', 'pilot-welcome-2', 'pilot-welcome-3', 'milestone-first-scan', 'milestone-first-invoice',
      'activating', 'change-scheduled', 'pilot-ended', 'link-expired', 'code-locked', 'ledger-empty',
    ] as const satisfies readonly SceneName[]) {
      expect(SCENE_NAMES).toContain(name);
      expect(sceneArtFor(name).placeholder).toBe(false);
    }
  });

  it('sizes a 120x96 scene by width, keeping its aspect ratio; defaults to its drawn width', () => {
    const { container, rerender } = render(<Scene name="claimed-spot" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '120');
    expect(container.querySelector('svg')).toHaveAttribute('height', '96');
    rerender(<Scene name="claimed-spot" size={240} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '240');
    expect(container.querySelector('svg')).toHaveAttribute('height', '192');
    rerender(<Scene name="gift-month" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '160');
    expect(container.querySelector('svg')).toHaveAttribute('height', '160');
  });

  it('rests the drop-in on its final frame under reduced motion', () => {
    const css = readFileSync(join(process.cwd(), 'src/hosted/hosted.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hp-scene--drop-in \[data-part="nuqta"\] \{ animation: none; \}/);
  });
});
