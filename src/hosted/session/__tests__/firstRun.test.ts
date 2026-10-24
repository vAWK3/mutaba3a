import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/client';
import { firstRunPath } from '../firstRun';

/** MUT-368 (D13): where a person lands after their first sign-in from a signup link. MUT-418 adds its trial step here. */

const profile = (id: string, isPersonalDefault: boolean) => ({ id, isPersonalDefault }) as Me['profiles'][number];
const me = (profiles: Me['profiles']) => ({ profiles }) as Me;

describe('firstRunPath', () => {
  it('is the personal profile’s Home', () => {
    expect(firstRunPath(me([profile('biz', false), profile('mine', true)]))).toBe('/p/mine');
  });

  it('falls back to Home, which picks a profile or offers to create one', () => {
    expect(firstRunPath(me([profile('biz', false)]))).toBe('/');
    expect(firstRunPath(me([]))).toBe('/');
  });
});
