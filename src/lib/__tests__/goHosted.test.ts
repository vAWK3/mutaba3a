import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostedPortalUrl } from '../goHosted';

describe('hostedPortalUrl (MUT-187)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the portal URL the build defined, or nothing', () => {
    expect(hostedPortalUrl()).toBe('');
    vi.stubGlobal('__PORTAL_URL__', 'https://portal.test');
    expect(hostedPortalUrl()).toBe('https://portal.test');
  });
});
