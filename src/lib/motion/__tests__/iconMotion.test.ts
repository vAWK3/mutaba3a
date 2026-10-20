import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { ICON_OVERSHOOT_EASE, ICON_RESTRAINED_EASE, playIconFeedback } from '../iconMotion';

/**
 * MUT-337 prototype: the same transform (scale 0 -> 1) played through one of
 * two named curves, mirroring Flutter's MMotion.overshoot/.spring
 * (mutaba3a_theme.dart:74-76) byte-for-byte. No new UI ships from this
 * ticket (MUT-338 wires it into a real trigger) - proven headless here.
 */

function scaleOf(el: HTMLElement): number {
  const match = /scale\(([-\d.]+)\)/.exec(el.style.transform);
  return match ? Number(match[1]) : 0;
}

function part() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ICON_OVERSHOOT_EASE / ICON_RESTRAINED_EASE', () => {
  it('match MMotion.overshoot and MMotion.spring exactly (mutaba3a_theme.dart:74-76)', () => {
    expect(ICON_OVERSHOOT_EASE).toEqual([0.34, 1.56, 0.64, 1]);
    expect(ICON_RESTRAINED_EASE).toEqual([0.32, 0.72, 0, 1]);
  });
});

describe('playIconFeedback', () => {
  it('scales each part around the icon\'s centre, not the SVG origin (MUT-338)', () => {
    const target = part();
    playIconFeedback([target], { preset: 'playful', reducedMotion: false });
    expect(target.style.transformOrigin).toBe('center');
  });

  it('starts a playful target at scale(0) and settles at scale(1)', async () => {
    const target = part();
    playIconFeedback([target], { preset: 'playful', reducedMotion: false });
    expect(scaleOf(target)).toBe(0);
    await waitFor(() => expect(scaleOf(target)).toBe(1), { timeout: 2000 });
  });

  it('settles a restrained target at scale(1) too', async () => {
    const target = part();
    playIconFeedback([target], { preset: 'restrained', reducedMotion: false });
    await waitFor(() => expect(scaleOf(target)).toBe(1), { timeout: 2000 });
  });

  it('the playful preset overshoots past 1 before settling (what "playful" means here)', async () => {
    const target = part();
    playIconFeedback([target], { preset: 'playful', reducedMotion: false });
    await waitFor(() => expect(scaleOf(target)).toBeGreaterThan(1), { timeout: 2000 });
    await waitFor(() => expect(scaleOf(target)).toBe(1), { timeout: 2000 });
  });

  it('reduced motion jumps straight to the end state, no overshoot, regardless of preset', () => {
    const target = part();
    playIconFeedback([target], { preset: 'playful', reducedMotion: true });
    expect(scaleOf(target)).toBe(1);
  });

  it('animates every target in the list', async () => {
    const a = part();
    const b = part();
    playIconFeedback([a, b], { preset: 'playful', reducedMotion: false });
    await waitFor(() => {
      expect(scaleOf(a)).toBe(1);
      expect(scaleOf(b)).toBe(1);
    }, { timeout: 2000 });
  });

  it('re-triggering mid-flight stops the prior play and still settles cleanly, without throwing', async () => {
    const target = part();
    playIconFeedback([target], { preset: 'playful', reducedMotion: false });
    await waitFor(() => expect(scaleOf(target)).toBeGreaterThan(0), { timeout: 2000 });
    expect(() => playIconFeedback([target], { preset: 'playful', reducedMotion: false })).not.toThrow();
    await waitFor(() => expect(scaleOf(target)).toBe(1), { timeout: 2000 });
  });
});
