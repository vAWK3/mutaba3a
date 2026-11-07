import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PLACEHOLDER_SCENE, Scene, sceneArtFor, type SceneName } from '../Scene';

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

  it('rests the drop-in on its final frame under reduced motion', () => {
    const css = readFileSync(join(process.cwd(), 'src/hosted/hosted.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hp-scene--drop-in \[data-part="nuqta"\] \{ animation: none; \}/);
  });
});
