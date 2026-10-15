import { LOADER_DELAY_MS } from './BrandLoader';

/**
 * How long a boot screen keeps the still mark before it blooms (MUT-207 DR9):
 * `LOADER_DELAY_MS` counted from page start, not from mount. On a slow load
 * the page has already waited, so it is 0 and the mark blooms the moment
 * React mounts; frame 0 is the same mark, so nothing jumps. In-content
 * loaders keep their 400 ms from mount.
 */
export function bootDelayMs(now: number = performance.now()): number {
  return Math.max(0, LOADER_DELAY_MS - now);
}
