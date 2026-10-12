import { describe, it, expect } from 'vitest';
import { nudgeInside } from '../popoverPosition';

const span = (left: number, right: number) => ({ left, right });

describe('nudgeInside (MUT-79)', () => {
  it('leaves a panel that already fits where it is', () => {
    expect(nudgeInside(span(100, 340), span(0, 800), 8)).toBe(0);
  });

  it('moves a panel that runs past the right edge back inside, keeping the margin', () => {
    expect(nudgeInside(span(170, 410), span(0, 335), 8)).toBe(-83);
  });

  it('moves a panel that runs past the left edge back inside, keeping the margin', () => {
    expect(nudgeInside(span(-40, 200), span(0, 800), 8)).toBe(48);
  });

  it('pins a panel wider than the bounds to the left edge', () => {
    expect(nudgeInside(span(50, 450), span(100, 400), 8)).toBe(58);
  });
});
