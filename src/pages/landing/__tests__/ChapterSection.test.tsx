import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ChapterSection } from '../components/ChapterSection';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';

/**
 * Chapter visuals rise and fade in once (MUT-77, L10). The figure is only
 * hidden when it's below the fold, motion is allowed and an observer exists to
 * bring it back (D4: reduced motion shows it with no animation).
 */

const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock('../../../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => motion.reduced,
}));

function renderChapter() {
  render(<ChapterSection part="chapter-clients" title="Every client on one page." body="Body" visual={<div>visual</div>} />);
  return document.querySelector<HTMLElement>('.landing-chapter-visual')!;
}

/** Puts every element's top at `top` px from the viewport's top. */
function placeAt(top: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 300 } as DOMRect);
}

beforeEach(() => {
  motion.reduced = false;
  installFakeIntersectionObserver();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ChapterSection reveal', () => {
  it('holds a below-the-fold visual back, then reveals it once it scrolls into view', () => {
    placeAt(window.innerHeight + 200);
    const figure = renderChapter();
    expect(figure).toHaveAttribute('data-reveal', 'pending');

    FakeIntersectionObserver.reportFor(figure, true);
    expect(figure).toHaveAttribute('data-reveal', 'done');

    FakeIntersectionObserver.reportFor(figure, false);
    expect(figure).toHaveAttribute('data-reveal', 'done');
  });

  it('never hides a visual that is already on screen at load', () => {
    placeAt(100);
    expect(renderChapter()).not.toHaveAttribute('data-reveal');
  });

  it('never hides a visual under reduced motion', () => {
    motion.reduced = true;
    placeAt(window.innerHeight + 200);
    expect(renderChapter()).not.toHaveAttribute('data-reveal');
  });

  it('never hides a visual when nothing could bring it back (no IntersectionObserver)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    placeAt(window.innerHeight + 200);
    expect(renderChapter()).not.toHaveAttribute('data-reveal');
  });
});

describe('ChapterSection extra slot (MUT-173)', () => {
  it('renders the extra inside the copy column, after the body', () => {
    placeAt(100);
    render(
      <ChapterSection part="phone" title="Title" body="Body" visual={<div>visual</div>} extra={<p data-testid="extra">more</p>} />,
    );
    const copy = document.querySelector('.landing-chapter-copy')!;
    const extra = copy.querySelector('[data-testid="extra"]')!;
    expect(extra).toBeInTheDocument();
    expect(copy.querySelector('.landing-chapter-body')!.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.landing-chapter-visual')!.contains(extra)).toBe(false);
  });

  it('renders nothing extra by default', () => {
    placeAt(100);
    renderChapter();
    expect(document.querySelector('.landing-chapter-copy')!.children).toHaveLength(2);
  });
});
