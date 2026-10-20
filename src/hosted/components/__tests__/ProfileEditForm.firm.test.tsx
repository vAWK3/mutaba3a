import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, fail, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { HostedProfile } from '../../api/client';

/**
 * MUT-300 (DR1): the owner of a Business profile asks for firm features from
 * its edit pane. Offer → Requested (read from /v1/me, so it survives a reload)
 * → nothing once firm features are on. Never on a Personal profile, the
 * built-in one or a profile the user doesn't own.
 */

const STUDIO = 'd1111111-1111-4111-8111-111111111111';
const HOME = 'd3333333-3333-4333-8333-333333333333';
const studio = profile({ id: STUDIO, name: 'Khatib Law', writerOfRecord: null, owned: true, type: 'BUSINESS', version: 1 });
const home = profile({ id: HOME, name: 'Home', writerOfRecord: null, owned: true, type: 'PERSONAL', version: 1 });
const builtIn = profile({ id: ORG_B, name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true });

function portal(path: string, profiles: HostedProfile[], routes: Record<string, Handler> = {}) {
  let current = profiles;
  const api = stubApi({
    'GET /v1/me': () => ok(me(current)),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok([]),
    'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
    ...routes,
  });
  const setProfiles = (next: HostedProfile[]) => {
    current = next;
  };
  return { ...renderPortal(path), api, setProfiles };
}

const requests = (calls: { method: string; url: URL }[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/firm-request'));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(PORTAL_LANGUAGE_KEY);
});

describe('Firm request in the edit pane (MUT-300)', () => {
  it('offers the request on an owned Business profile, sends it once with an Idempotency-Key, then shows Requested', async () => {
    const REQUESTED_AT = '2026-10-20T09:00:00.000Z';
    const { user, api, setProfiles } = portal(`/p/${STUDIO}?editProfile=${STUDIO}`, [studio, builtIn], {
      [`POST /v1/profiles/${STUDIO}/firm-request`]: () => {
        setProfiles([{ ...studio, firmRequestedAt: REQUESTED_AT }, builtIn]);
        return ok({ firmRequest: { requestedAt: REQUESTED_AT } }, 202);
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Khatib Law' });
    const section = within(dialog).getByRole('region', { name: 'Use this profile for a firm' });
    await user.click(within(section).getByRole('button', { name: 'Request firm features' }));
    await waitFor(() => expect(requests(api.calls)).toHaveLength(1));
    expect(requests(api.calls)[0].headers.get('Idempotency-Key')).toMatch(/.+/);
    expect(await within(section).findByText(/^Requested on .*Firm features show up here once they're turned on\.$/)).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Request firm features' })).toBeNull();
  });

  it('shows Requested straight away when /v1/me already has the request', async () => {
    portal(`/p/${STUDIO}?editProfile=${STUDIO}`, [{ ...studio, firmRequestedAt: '2026-10-19T09:00:00.000Z' }, builtIn]);
    const dialog = await screen.findByRole('dialog', { name: 'Khatib Law' });
    expect(within(dialog).getByText(/^Requested on /)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Request firm features' })).toBeNull();
  });

  it('shows an inline error when the request fails, and keeps the button to try again', async () => {
    const { user } = portal(`/p/${STUDIO}?editProfile=${STUDIO}`, [studio, builtIn], {
      [`POST /v1/profiles/${STUDIO}/firm-request`]: () => fail(500, 'INTERNAL'),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Khatib Law' });
    await user.click(within(dialog).getByRole('button', { name: 'Request firm features' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Your request didn't go through. Try again.");
    expect(within(dialog).getByRole('button', { name: 'Request firm features' })).toBeInTheDocument();
  });

  it('never shows the request on a Personal profile, the built-in one, or once firm features are on', async () => {
    const { unmount } = portal(`/p/${HOME}?editProfile=${HOME}`, [home, builtIn]);
    await screen.findByRole('dialog', { name: 'Home' });
    expect(screen.queryByText('Use this profile for a firm')).toBeNull();
    unmount();
    vi.unstubAllGlobals();

    const second = portal(`/p/${ORG_B}?editProfile=${ORG_B}`, [builtIn]);
    await screen.findByRole('dialog', { name: 'Personal' });
    expect(screen.queryByText('Use this profile for a firm')).toBeNull();
    second.unmount();
    vi.unstubAllGlobals();

    portal(`/p/${STUDIO}?editProfile=${STUDIO}`, [{ ...studio, firm: true, role: 'OWNER' }, builtIn]);
    await screen.findByRole('dialog', { name: 'Khatib Law' });
    expect(screen.queryByText('Use this profile for a firm')).toBeNull();
  });

  it('reads Arabic in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${STUDIO}?editProfile=${STUDIO}`, [studio, builtIn]);
    expect(await screen.findByRole('button', { name: 'اطلب ميزات المكتب' })).toBeInTheDocument();
    expect(screen.getByText('استخدم هذا الملف لمكتب')).toBeInTheDocument();
  });
});
