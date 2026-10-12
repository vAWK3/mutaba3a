import { describe, expect, it } from 'vitest';
import {
  projectMomentum,
  rubberband,
  rubberbandInverse,
  springFromResponse,
  velocityFromSamples,
} from '../physics';

describe('projectMomentum', () => {
  it('projects nothing from rest', () => {
    expect(projectMomentum(0)).toBe(0);
  });

  it('throws 1000 px/s about 499 px at the scroll-view rate', () => {
    expect(projectMomentum(1000)).toBeCloseTo(499, 5);
  });

  it('keeps the direction of the gesture', () => {
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 5);
  });

  it('projects less at a snappier rate', () => {
    expect(projectMomentum(1000, 0.99)).toBeLessThan(projectMomentum(1000));
    expect(projectMomentum(1000, 0.99)).toBeCloseTo(99, 5);
  });
});

describe('rubberband', () => {
  const width = 480;

  it('does not move at the boundary', () => {
    expect(rubberband(0, width)).toBe(0);
  });

  it('follows a small overshoot at about 0.55 of its distance', () => {
    expect(rubberband(4, width)).toBeCloseTo(4 * 0.55, 1);
  });

  it('resists more the further it is pulled, and never reaches the dimension', () => {
    const near = rubberband(100, width);
    const far = rubberband(400, width);
    const extreme = rubberband(100_000, width);
    expect(far).toBeGreaterThan(near);
    expect(far - near).toBeLessThan(300);
    expect(extreme).toBeLessThan(width);
  });

  it('keeps the sign of the overshoot', () => {
    expect(rubberband(-100, width)).toBeCloseTo(-rubberband(100, width), 10);
  });

  it('is undone by rubberbandInverse', () => {
    for (const overshoot of [0, 3, 50, 240, 900, -120]) {
      expect(rubberbandInverse(rubberband(overshoot, width), width)).toBeCloseTo(overshoot, 6);
    }
  });
});

describe('springFromResponse', () => {
  it("turns Apple's response 0.3 / damping 1.0 into stiffness and damping at mass 1", () => {
    const spring = springFromResponse(0.3, 1);
    expect(spring.mass).toBe(1);
    expect(spring.stiffness).toBeCloseTo(438.65, 1);
    expect(spring.damping).toBeCloseTo(41.89, 1);
  });

  it('damps less for a lower damping ratio', () => {
    expect(springFromResponse(0.3, 0.8).damping).toBeLessThan(springFromResponse(0.3, 1).damping);
    expect(springFromResponse(0.3, 0.8).stiffness).toBeCloseTo(springFromResponse(0.3, 1).stiffness, 10);
  });
});

describe('velocityFromSamples', () => {
  it('is 0 with fewer than two samples', () => {
    expect(velocityFromSamples([])).toBe(0);
    expect(velocityFromSamples([{ time: 10, position: 50 }])).toBe(0);
  });

  it('measures px/s across the samples', () => {
    const samples = [
      { time: 0, position: 0 },
      { time: 50, position: 25 },
      { time: 100, position: 50 },
    ];
    expect(velocityFromSamples(samples)).toBeCloseTo(500, 5);
  });

  it('only counts the last 100ms before the newest sample', () => {
    const samples = [
      { time: 0, position: 0 },
      { time: 400, position: 0 },
      { time: 450, position: 30 },
      { time: 500, position: 60 },
    ];
    // 0→400 was a pause; the release speed is the last 100ms: 60px in 0.1s.
    expect(velocityFromSamples(samples)).toBeCloseTo(600, 5);
  });

  it('is 0 when the samples share a timestamp', () => {
    expect(velocityFromSamples([{ time: 7, position: 0 }, { time: 7, position: 40 }])).toBe(0);
  });

  it('is negative when moving back', () => {
    expect(velocityFromSamples([{ time: 0, position: 100 }, { time: 50, position: 50 }])).toBeCloseTo(-1000, 5);
  });
});
