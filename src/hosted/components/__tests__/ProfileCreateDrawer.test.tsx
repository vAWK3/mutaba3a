import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';
import type { HostedProfile } from '../../api/client';
import { SLOW_UNDER_COVERAGE } from '../../../test/timeouts';

/**
 * MUT-183: the New profile drawer, driven through the real router. Opened from
 * the switcher or by `?newProfile=true` (ADR-008), never a page.
 */

const NEW_ID = '44444444-4444-4444-8444-444444444444';
const builtIn = profile({ name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true, defaultCurrency: 'USD' });
const created = (name: string): HostedProfile =>
  profile({ id: NEW_ID, name, writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false, defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' });

function portal(path: string, routes: Record<string, Handler> = {}, profiles: HostedProfile[] = [builtIn]) {
  const api = stubApi({ 'GET /v1/me': () => ok(me(profiles)), ...emptyProfileRoutes(), ...routes });
  return { ...renderPortal(path), api };
}

const posts = (calls: StubRequest[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/v1/profiles');

async function openFromSwitcher(user: ReturnType<typeof renderPortal>['user']) {
  await user.click(await screen.findByRole('button', { name: /Switch profile/ }));
  await user.click(screen.getByRole('menuitem', { name: /New profile/ }));
  return screen.findByRole('dialog', { name: 'New profile' });
}

async function fill(user: ReturnType<typeof renderPortal>['user'], name: string, type: 'Personal' | 'Business' = 'Business') {
  const dialog = screen.getByRole('dialog', { name: 'New profile' });
  await user.type(within(dialog).getByLabelText('Name'), name);
  await user.click(within(dialog).getByRole('radio', { name: new RegExp(`^${type}`) }));
}

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Jerusalem' } as Intl.ResolvedDateTimeFormatOptions);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('New profile drawer (MUT-183)', () => {
  it('CR1: opens over the current page through the URL, not as a page', SLOW_UNDER_COVERAGE, async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    const dialog = await openFromSwitcher(user);
    expect(locationOf(router)).toBe(`/p/${ORG_A}?newProfile=true`);
    expect(within(dialog).getByRole('heading', { name: 'New profile' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });

  it("CR2/CR2b: the zone is a fact row from the browser; Change reveals the select; the currency starts at the open profile's", async () => {
    const { user } = portal(`/p/${ORG_A}?newProfile=true`);
    const dialog = await screen.findByRole('dialog', { name: 'New profile' });
    expect(within(dialog).getByText('Asia/Jerusalem')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Time zone' })).toBeNull();
    expect(within(dialog).getByRole('combobox', { name: 'Currency' })).toHaveValue('USD');
    await user.click(within(dialog).getByRole('button', { name: 'Change' }));
    const zone = within(dialog).getByRole('combobox', { name: 'Time zone' });
    expect(zone).toHaveFocus();
    expect(zone).toHaveValue('Asia/Jerusalem');
  });

  it('CR2b: a 422 on the time zone reveals the select with its error', async () => {
    const { user } = portal(`/p/${ORG_A}?newProfile=true`, { 'POST /v1/profiles': () => fail(422, 'VALIDATION_FAILED', { field: 'timezone' }) });
    await screen.findByRole('dialog', { name: 'New profile' });
    await fill(user, 'Zone check');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText('Choose a valid time zone')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toBeInTheDocument();
  });

  it('MUT-388: the currency picker offers the four supported currencies, no Gulf one, and sends the one chosen', async () => {
    let list = [builtIn];
    const { user, api } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => ok(me(list)),
      'POST /v1/profiles': () => {
        list = [created('Dubai Office'), builtIn];
        return ok(created('Dubai Office'), 201);
      },
    });
    await openFromSwitcher(user);
    const currencySelect = screen.getByRole('combobox', { name: 'Currency' });
    expect(within(currencySelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['USD', 'ILS', 'EUR', 'JOD']);
    await user.selectOptions(currencySelect, 'JOD');
    await fill(user, '  Dubai Office ');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(posts(api.calls)[0].body).toMatchObject({ defaultCurrency: 'JOD' });
  });

  it('CR3: creates with the exact body and lands on the new profile, named in the switcher', async () => {
    let list = [builtIn];
    const { user, router, api } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => ok(me(list)),
      'POST /v1/profiles': () => {
        list = [created('Nour Studio'), builtIn];
        return ok(created('Nour Studio'), 201);
      },
    });
    await openFromSwitcher(user);
    await fill(user, '  Nour Studio ');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${NEW_ID}`));
    expect(posts(api.calls)[0].body).toEqual({ name: 'Nour Studio', type: 'BUSINESS', defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' });
    expect(await screen.findByRole('button', { name: 'Switch profile: Nour Studio' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull();
    expect(await screen.findByText('Nour Studio is ready')).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET /v1/me')).toBeGreaterThanOrEqual(2));
  });

  it('CR3c (MUT-191): a new Business profile opens with the Malafat note; a Personal one never does', async () => {
    let list = [builtIn];
    const { user } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => ok(me(list)),
      'POST /v1/profiles': () => {
        list = [created('Nour Studio'), builtIn];
        return ok(created('Nour Studio'), 201);
      },
    });
    await openFromSwitcher(user);
    await fill(user, 'Nour Studio');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    const note = await screen.findByRole('group', { name: 'A suggestion for law firms and accounting offices' });
    expect(within(note).getByRole('link').getAttribute('href')).toContain('utm_medium=portal');
    expect(within(note).getByRole('link').getAttribute('href')).toContain('utm_content=business-profile');
    // Dismissed, focus lands on the page's heading rather than the body
    await user.click(within(note).getByRole('button', { name: "Don't show this again" }));
    expect(screen.queryByRole('group', { name: 'A suggestion for law firms and accounting offices' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('CR3d (MUT-191): a new Personal profile gets no Malafat note', async () => {
    const personal = profile({ id: NEW_ID, name: 'Home', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: false, defaultCurrency: 'USD' });
    let list = [builtIn];
    const { user, router } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => ok(me(list)),
      'POST /v1/profiles': () => {
        list = [personal, builtIn];
        return ok(personal, 201);
      },
    });
    await openFromSwitcher(user);
    await fill(user, 'Home', 'Personal');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${NEW_ID}`));
    expect(await screen.findByText('Home is ready')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'A suggestion for law firms and accounting offices' })).toBeNull();
  });

  it('CR3b (R2): a failed me refetch after the 201 still lands on the new profile', async () => {
    let meCalls = 0;
    const { user, router } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => (++meCalls === 1 ? ok(me([builtIn])) : fail(503, 'INTERNAL')),
      'POST /v1/profiles': () => ok(created('Side Studio'), 201),
    });
    await openFromSwitcher(user);
    await fill(user, 'Side Studio');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${NEW_ID}`));
    expect(await screen.findByRole('button', { name: 'Switch profile: Side Studio' })).toBeInTheDocument();
    expect(screen.queryByText("This profile isn't available")).toBeNull();
  });

  it('CR4/CR5: offline keeps the values, a retry reuses the key, an edited body gets a new one', async () => {
    let attempt = 0;
    const { user, api } = portal(`/p/${ORG_A}?newProfile=true`, {
      'POST /v1/profiles': () => {
        attempt += 1;
        if (attempt <= 2) throw new TypeError('offline');
        return ok(created('Offline Edited'), 201);
      },
    });
    await screen.findByRole('dialog', { name: 'New profile' });
    await fill(user, 'Offline Studio');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText("Can't reach MTB3A. Nothing was saved. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Offline Studio');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(2));
    const [first, second] = posts(api.calls);
    expect(second.headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Offline Edited');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(3));
    expect(posts(api.calls)[2].headers.get('Idempotency-Key')).not.toBe(first.headers.get('Idempotency-Key'));
  });

  it('CR4b (R6): closing mid-save and saving the same profile again replays the same key', async () => {
    const { user, api } = portal(`/p/${ORG_A}`, { 'POST /v1/profiles': never });
    await openFromSwitcher(user);
    await fill(user, 'Slow Studio');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull());
    await openFromSwitcher(user);
    await fill(user, 'Slow Studio');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(2));
    const [first, second] = posts(api.calls);
    expect(second.headers.get('Idempotency-Key')).toBe(first.headers.get('Idempotency-Key'));
  });

  it("CR6: the server's PROFILE_LIMIT shows the cap banner and blocks Create", async () => {
    const { user, api } = portal(`/p/${ORG_A}?newProfile=true`, { 'POST /v1/profiles': () => fail(409, 'CONFLICT', { reason: 'PROFILE_LIMIT', limit: 6 }) });
    await screen.findByRole('dialog', { name: 'New profile' });
    await fill(user, 'One Too Many');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText("You've reached your limit of 6 profiles.")).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create profile' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await user.click(create);
    expect(posts(api.calls)).toHaveLength(1);
  });

  it('CR7: opened at the cap, it explains and never posts', async () => {
    const owned = Array.from({ length: 6 }, (_, i) =>
      profile({ id: `5555555${i}-5555-4555-8555-555555555555`, name: `Owned ${i}`, writerOfRecord: null, owned: true, type: 'BUSINESS' }),
    );
    const { user, api } = portal(`/p/${owned[0].id}?newProfile=true`, {}, owned);
    await screen.findByRole('dialog', { name: 'New profile' });
    expect(screen.getByText("You've reached your limit of 6 profiles.")).toBeInTheDocument();
    await fill(user, 'Seventh');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('CR8 (R5): no type is chosen at first, and Create without one asks for it', async () => {
    const { user, api } = portal(`/p/${ORG_A}?newProfile=true`);
    const dialog = await screen.findByRole('dialog', { name: 'New profile' });
    for (const radio of within(dialog).getAllByRole('radio')) expect(radio).not.toBeChecked();
    await user.type(within(dialog).getByLabelText('Name'), 'Typeless');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    expect(await screen.findByText('Choose Personal or Business')).toBeInTheDocument();
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('CR9: a double click sends one POST', async () => {
    const { user, api } = portal(`/p/${ORG_A}?newProfile=true`, { 'POST /v1/profiles': never });
    await screen.findByRole('dialog', { name: 'New profile' });
    await fill(user, 'Double');
    const create = screen.getByRole('button', { name: 'Create profile' });
    await user.dblClick(create);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument());
    expect(posts(api.calls)).toHaveLength(1);
  });

  it('RT4: Back closes the drawer it opened', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    await openFromSwitcher(user);
    await act(() => router.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New profile' })).toBeNull());
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });
});
