import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../../__tests__/harness';

/**
 * MUT-191 S1 through the real shell: You › App (MUT-425; was the account menu) carries Malafat on an owned business
 * profile, and toggles the switch in place.
 */
const business = profile({ id: ORG_A, name: 'Nour Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });

describe('You › App, Malafat (MUT-191)', () => {
  it('lists the link and the switch, and the switch PATCHes in place', async () => {
    const api = stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok(me([business])),
      'PATCH /v1/me/malafat-suggestions': () => ok({ off: true, dismissed: [] }),
    });
    const { user } = renderPortal(`/p/${ORG_A}/you/app`);
    const link = await screen.findByRole('link', { name: /Malafat, for law firms and accounting offices/ });
    expect(link.getAttribute('href')).toContain('utm_medium=portal&utm_campaign=malafat-upsell&utm_content=settings');
    const toggle = screen.getByRole('switch', { name: 'Show Malafat suggestions' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ off: true });
  });

  it('carries nothing on their own business profile for someone who is also in a Malafat-fed firm', async () => {
    const firm = profile({ id: '33333333-3333-4333-8333-333333333333', writerOfRecord: 'MALAFAT' });
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me([business, firm])) });
    renderPortal(`/p/${ORG_A}/you/app`);
    await screen.findByRole('group', { name: 'Language' });
    expect(screen.queryByText(/Malafat/)).toBeNull();
  });
});
