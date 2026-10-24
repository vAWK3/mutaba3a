import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';

const business = profile({ id: ORG_A, name: 'Nour Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });

/**
 * MUT-261: the last rows of You › App (MUT-425; was the account menu) are "get the app", reading the same
 * MOBILE_APP_LINKS config as the landing page (MUT-173) — both phone apps link out to their store listings.
 */
describe('You › App, app download (MUT-261)', () => {
  it('links the iPhone and Android apps, last', async () => {
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me([business])) });
    renderPortal(`/p/${ORG_A}/you/app`);

    const iosLink = await screen.findByRole('link', { name: /Get the iPhone app/ });
    // MUT-155: the portal's store links name their source, as the landing's do (A6)
    const href = new URL(iosLink.getAttribute('href')!);
    expect(decodeURI(`${href.origin}${href.pathname}`)).toBe('https://apps.apple.com/us/app/متابعة-مالية/id6821813829');
    expect(href.searchParams.get('ct')).toBe('mutaba3a-portal');
    expect(iosLink).toHaveAttribute('target', '_blank');
    expect(iosLink.getAttribute('rel')).toContain('noopener');

    const androidLink = screen.getByRole('link', { name: /Get the Android app/ });
    const androidHref = new URL(androidLink.getAttribute('href')!);
    expect(`${androidHref.origin}${androidHref.pathname}`).toBe('https://play.google.com/store/apps/details');
    expect(androidHref.searchParams.get('id')).toBe('com.barmajiyat.mutaba3a');
    expect(androidHref.searchParams.get('referrer')).toContain('utm_campaign=mutaba3a-portal');
    expect(androidLink).toHaveAttribute('target', '_blank');
    expect(androidLink.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByText(/coming soon/)).toBeNull();

    const rows = document.querySelectorAll('.hp-you-row');
    expect(rows[rows.length - 2]).toBe(iosLink);
    expect(rows[rows.length - 1]).toBe(androidLink);
  });
});
