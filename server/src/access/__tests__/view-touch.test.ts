import { describe, expect, it } from 'vitest';
import { VIEW_TOUCH_MS, viewTouch } from '../view-touch.js';

/** MUT-560: the "last viewed" throttle shared by accountant grants (MUT-559) and share links. */
describe('viewTouch', () => {
  const t0 = new Date('2026-11-06T09:00:00Z');
  it('stamps the first view, and it is the first of its UTC day', () => {
    expect(viewTouch(null, t0)).toEqual({ touch: true, firstOfDay: true });
  });
  it('skips inside the hour, stamps after it', () => {
    expect(viewTouch(t0, new Date(t0.getTime() + VIEW_TOUCH_MS - 1))).toEqual({ touch: false, firstOfDay: false });
    expect(viewTouch(t0, new Date(t0.getTime() + VIEW_TOUCH_MS))).toEqual({ touch: true, firstOfDay: false });
  });
  it('a stamp on a new UTC day is the first of that day', () => {
    expect(viewTouch(t0, new Date('2026-11-07T00:00:00Z'))).toEqual({ touch: true, firstOfDay: true });
  });
});
