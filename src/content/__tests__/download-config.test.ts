import { describe, it, expect } from 'vitest';
import { storeLinkUrl } from '../download-config';

/** Only an available app with a real https listing may be linked from the landing (MUT-173). */
describe('storeLinkUrl', () => {
  it('returns the URL of an available app with an https listing', () => {
    expect(storeLinkUrl({ available: true, url: 'https://apps.apple.com/app/id1' })).toBe('https://apps.apple.com/app/id1');
  });

  it('returns null while the listing is unset', () => {
    expect(storeLinkUrl({ available: true, url: null })).toBeNull();
  });

  it('never links an app that is not yet available, even with a URL', () => {
    expect(storeLinkUrl({ available: false, url: 'https://play.google.com/store/apps/details?id=x' })).toBeNull();
  });

  it.each(['TBD', '#', 'http://apps.apple.com/app/id1', 'apps.apple.com/app/id1', ''])('never links the placeholder %j', (url) => {
    expect(storeLinkUrl({ available: true, url })).toBeNull();
  });
});
