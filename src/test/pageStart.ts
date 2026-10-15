import { vi } from 'vitest';

/**
 * Makes `performance.now()` count from this moment, as if the page had just
 * started loading `offsetMs` ago. Boot screens time their still mark from page
 * start (`bootDelayMs`, MUT-207 DR9), and a test process has long passed 400 ms.
 * Under fake timers that fake `performance`, it follows the fake clock.
 */
export function pageStartsNow(offsetMs = 0) {
  const real = performance.now.bind(performance);
  const start = real() - offsetMs;
  return vi.spyOn(performance, 'now').mockImplementation(() => real() - start);
}
