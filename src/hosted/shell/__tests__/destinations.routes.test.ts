import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from '@tanstack/react-router';
import { createPortalQueryClient } from '../../queryClient';
import { createPortalRouter } from '../../router';
import { NO_DESTINATION, destinationOf } from '../destinations';

const PROFILE_PREFIX = '/p/$profileId';
const SECTION_SEGMENT_INDEX = 3; // '' / 'p' / ':id' / section

/** MUT-424 eng review R3: a page added under a profile without a destination would silently light no tab. */
describe('every profile route has a destination', () => {
  const router = createPortalRouter(createPortalQueryClient(), createMemoryHistory());
  const paths = Object.keys(router.routesByPath).filter((path) => path.startsWith(PROFILE_PREFIX));

  it('walks the real route tree', () => {
    expect(paths.length).toBeGreaterThan(10);
  });

  it.each(paths)('%s maps to a destination or is a named exception', (path) => {
    const concrete = path.replace(/\$\w+/g, 'x');
    const segment = concrete.split('/')[SECTION_SEGMENT_INDEX] ?? '';
    expect(destinationOf(concrete) !== null || NO_DESTINATION.has(segment), `${path} has no destination`).toBe(true);
  });
});
