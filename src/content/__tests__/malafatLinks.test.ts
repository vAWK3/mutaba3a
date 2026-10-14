import { describe, it, expect } from 'vitest';
import { malafatUrl } from '../malafatLinks';

/** One builder for every link to Malafat, so the referral vocabulary MAL-1153 recognises lives in one place (MUT-189). */
describe('malafatUrl', () => {
  it('sends the landing to Malafat\'s home in the page language, with the landing referral tags', () => {
    expect(malafatUrl({ locale: 'ar', medium: 'landing', content: 'landing-section' })).toBe(
      'https://malafat.app/ar?utm_source=mutaba3a&utm_medium=landing&utm_campaign=malafat-upsell&utm_content=landing-section',
    );
    expect(malafatUrl({ locale: 'en', medium: 'landing', content: 'landing-section' })).toMatch(/^https:\/\/malafat\.app\/en\?/);
  });

  it('builds MUT-189\'s in-app contract: contact page, topic first, then the four tags', () => {
    expect(malafatUrl({ locale: 'en', medium: 'portal', content: 'client-threshold', contact: true })).toBe(
      'https://malafat.app/en/contact?topic=mutaba3a&utm_source=mutaba3a&utm_medium=portal&utm_campaign=malafat-upsell&utm_content=client-threshold',
    );
  });

  it('puts nothing else in the query', () => {
    const url = new URL(malafatUrl({ locale: 'en', medium: 'web-local', content: 'settings', contact: true }));
    expect([...url.searchParams.keys()]).toEqual(['topic', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content']);
    expect(url.hash).toBe('');
  });
});
