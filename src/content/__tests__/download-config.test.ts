import { describe, it, expect } from 'vitest';
import { APP_STORE_PROVIDER_TOKEN, storeLinkUrl } from '../download-config';

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

/** MUT-154: store links name their campaign so the store consoles can attribute installs (no ID, no cookie). */
describe('storeLinkUrl with a campaign', () => {
  it('adds Apple\'s campaign token to an App Store link, keeping the listing\'s own query', () => {
    const url = new URL(storeLinkUrl({ available: true, url: 'https://apps.apple.com/us/app/x/id1?l=ar' }, 'mutaba3a-landing')!);
    expect(url.searchParams.get('ct')).toBe('mutaba3a-landing');
    expect(url.searchParams.get('l')).toBe('ar');
    expect(url.searchParams.has('pt')).toBe(APP_STORE_PROVIDER_TOKEN !== null);
  });

  it('adds a UTM install referrer to a Play link', () => {
    const url = new URL(storeLinkUrl({ available: true, url: 'https://play.google.com/store/apps/details?id=x' }, 'mutaba3a-portal')!);
    expect(url.searchParams.get('id')).toBe('x');
    expect(url.searchParams.get('referrer')).toBe('utm_source=mutaba3a&utm_medium=web&utm_campaign=mutaba3a-portal');
  });

  it('leaves any other host as it is, and still refuses an unavailable app', () => {
    expect(storeLinkUrl({ available: true, url: 'https://example.com/app' }, 'mutaba3a-landing')).toBe('https://example.com/app');
    expect(storeLinkUrl({ available: false, url: 'https://apps.apple.com/app/id1' }, 'mutaba3a-landing')).toBeNull();
  });
});
