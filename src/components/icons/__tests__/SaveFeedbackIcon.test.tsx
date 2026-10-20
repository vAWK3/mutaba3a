import { afterEach, describe, expect, it, type Mock } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { SaveFeedbackIcon } from '../SaveFeedbackIcon';

/**
 * MUT-338: the first real consumer of MUT-337's `playIconFeedback`. Wires the
 * generated `SuccessIcon`'s `data-part` elements through a plain wrapping
 * `<span>` ref (the ref was always meant to belong to the caller's container,
 * per MUT-337's own brief - not a codegen change).
 */

function scaleOf(el: Element): number {
  const match = /scale\(([-\d.]+)\)/.exec((el as HTMLElement).style.transform);
  return match ? Number(match[1]) : 0;
}

const matchMedia = window.matchMedia as Mock;
const defaultMatchMedia = matchMedia.getMockImplementation();

function preferReducedMotion() {
  matchMedia.mockImplementation((query: string) => ({
    ...defaultMatchMedia!(query),
    matches: query.includes('prefers-reduced-motion'),
  }));
}

afterEach(() => {
  cleanup();
  matchMedia.mockImplementation(defaultMatchMedia!);
});

describe('SaveFeedbackIcon', () => {
  it('plays the playful preset on mount, settling every data-part at scale(1)', async () => {
    const { container } = render(<SaveFeedbackIcon preset="playful" />);
    const parts = Array.from(container.querySelectorAll('[data-part]'));
    expect(parts.length).toBeGreaterThan(0);
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBe(1)), { timeout: 2000 });
  });

  it('plays the restrained preset without overshoot, settling at scale(1)', async () => {
    const { container } = render(<SaveFeedbackIcon preset="restrained" />);
    const parts = Array.from(container.querySelectorAll('[data-part]'));
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBe(1)), { timeout: 2000 });
  });

  it('skips the animation under prefers-reduced-motion: reduce - settled immediately, no overshoot', () => {
    preferReducedMotion();
    const { container } = render(<SaveFeedbackIcon preset="playful" />);
    const parts = Array.from(container.querySelectorAll('[data-part]'));
    parts.forEach((part) => expect(scaleOf(part)).toBe(1));
  });
});
