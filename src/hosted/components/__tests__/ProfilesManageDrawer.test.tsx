import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ME_KEY } from '../../session/me';
import type { HostedProfile } from '../../api/client';

/**
 * MUT-183: Manage profiles: the list pane, one profile's edit pane, and the
 * inline type-change confirm, driven through the real router.
 */

const STUDIO = 'd1111111-1111-4111-8111-111111111111';
const studio = profile({ id: STUDIO, name: 'Nour Studio', writerOfRecord: null, owned: true, type: 'PERSONAL', defaultCurrency: 'ILS', version: 1 });
const builtIn = profile({ id: ORG_B, name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true });
const malafat = profile({ id: ORG_A, name: 'Haddad & Partners' });
const firm = profile({ id: 'd2222222-2222-4222-8222-222222222222', name: 'Khalil Accounting', writerOfRecord: null });
const ALL = [malafat, firm, studio, builtIn];

function portal(path: string, routes: Record<string, Handler> = {}, profiles: HostedProfile[] = ALL) {
  const api = stubApi({
    'GET /v1/me': () => ok(me(profiles)),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok([]),
    'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

const patches = (calls: StubRequest[]) => calls.filter((c) => c.method === 'PATCH');
const saved = (p: HostedProfile, typeChange: unknown = null) => ok({ profile: { ...p, version: p.version + 1 }, typeChange });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem(PORTAL_LANGUAGE_KEY);
});

describe('Manage profiles list (MUT-183)', () => {
  it('MG1/MG2: lists every profile in me order; owned rows open, firm rows explain, the counter counts owned only', async () => {
    portal(`/p/${STUDIO}?manageProfiles=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Profiles' });
    const items = within(dialog).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Haddad & PartnersManaged in Malafat. Change it there.ILS',
      'Khalil AccountingSet up for you by your account administrator.ILS',
      'Nour StudioOpen nowPersonalILS›',
      'PersonalYour built-in profileILS›',
    ]);
    expect(within(items[0]).queryByRole('button')).toBeNull();
    expect(within(items[1]).queryByRole('button')).toBeNull();
    expect(within(dialog).getByText("You've used 2 of 6 profiles")).toBeInTheDocument();
  });

  it('RT5: an edit link to a profile the user does not own shows the list', async () => {
    portal(`/p/${STUDIO}?editProfile=${firm.id}`);
    expect(await screen.findByRole('dialog', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});

describe('Edit pane (MUT-183)', () => {
  it('MG3: renaming sends only the name, with the version read when the pane opened', async () => {
    const { user, api, router } = portal(`/p/${STUDIO}?manageProfiles=true`, { [`PATCH /v1/profiles/${STUDIO}`]: () => saved({ ...studio, name: 'Studio' }) });
    await user.click(await screen.findByRole('button', { name: /^Nour Studio/ }));
    expect(locationOf(router)).toBe(`/p/${STUDIO}?editProfile=${STUDIO}`);
    const dialog = screen.getByRole('dialog', { name: 'Nour Studio' });
    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Studio');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api.calls)).toHaveLength(1));
    expect(patches(api.calls)[0].body).toEqual({ name: 'Studio' });
    expect(patches(api.calls)[0].headers.get('If-Match')).toBe('1');
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${STUDIO}?manageProfiles=true`));
  });

  it('MUT-388: the currency picker offers the four supported currencies, no Gulf one, and sends the one chosen', async () => {
    const { user, api } = portal(`/p/${STUDIO}?manageProfiles=true`, { [`PATCH /v1/profiles/${STUDIO}`]: () => saved({ ...studio, defaultCurrency: 'JOD' }) });
    await user.click(await screen.findByRole('button', { name: /^Nour Studio/ }));
    const dialog = screen.getByRole('dialog', { name: 'Nour Studio' });
    const currencySelect = within(dialog).getByRole('combobox', { name: 'Currency' });
    expect(within(currencySelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['USD', 'ILS', 'EUR', 'JOD']);
    await user.selectOptions(currencySelect, 'JOD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api.calls)).toHaveLength(1));
    expect(patches(api.calls)[0].body).toMatchObject({ defaultCurrency: 'JOD' });
  });

  it('MG4: a newer version arriving mid-edit is not sent; the conflict offers Reload, which re-reads', async () => {
    let current = studio;
    const { user, api, queryClient } = portal(`/p/${STUDIO}?editProfile=${STUDIO}`, {
      'GET /v1/me': () => ok(me([malafat, firm, current, builtIn])),
      [`PATCH /v1/profiles/${STUDIO}`]: ({ headers }) =>
        headers.get('If-Match') === String(current.version) ? saved(current) : fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: current.version }),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Nour Studio' });
    current = { ...studio, name: 'Nour Studio (phone)', version: 2 };
    await act(() => queryClient.invalidateQueries({ queryKey: ME_KEY }));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Currency' }), 'USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This profile was changed elsewhere. Reload to see the latest, then save again.')).toBeInTheDocument();
    expect(patches(api.calls)[0].headers.get('If-Match')).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Nour Studio (phone)'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'USD');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches(api.calls)).toHaveLength(2));
    expect(patches(api.calls)[1].headers.get('If-Match')).toBe('2');
  });

  it('MG5: the built-in Personal profile has no type control and says why', async () => {
    portal(`/p/${STUDIO}?editProfile=${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Personal' });
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).getByText('Your built-in Personal profile is always Personal.')).toBeInTheDocument();
  });

  it('MG6: in Arabic the drawer reads right to left', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${STUDIO}?manageProfiles=true`);
    const dialog = await screen.findByRole('dialog', { name: 'الملفات' });
    expect(dialog.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir).toBe('rtl');
    expect(within(dialog).getByText('يُدار من «ملفات». عدّله هناك.')).toBeInTheDocument();
  });

  it('MG7: a 403 NOT_OWNER goes back to the list with the reason', async () => {
    const { user } = portal(`/p/${STUDIO}?editProfile=${STUDIO}`, { [`PATCH /v1/profiles/${STUDIO}`]: () => fail(403, 'READ_ONLY_PROFILE', { reason: 'NOT_OWNER' }) });
    const dialog = await screen.findByRole('dialog', { name: 'Nour Studio' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Currency' }), 'USD');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("You can't change this profile.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Profiles' })).toBeInTheDocument();
  });
});

describe('Type change (MUT-183)', () => {
  const preview = (n: number) => () => ok({ uncategorizedExpenses: n, deletedCategories: 14, preset: 'general' });

  async function startTypeChange(routes: Record<string, Handler>, path = `/p/${STUDIO}/expenses?editProfile=${STUDIO}`) {
    const harness = portal(path, routes);
    const dialog = await screen.findByRole('dialog', { name: 'Nour Studio' });
    await harness.user.click(within(dialog).getByRole('radio', { name: /^Business/ }));
    await harness.user.click(within(dialog).getByRole('button', { name: 'Save' }));
    return harness;
  }

  it('TC1/TC7: Save asks the server first, then confirms with its count, focused on the question', async () => {
    const { api } = await startTypeChange({ [`GET /v1/profiles/${STUDIO}/type-change`]: preview(12) });
    const heading = await screen.findByRole('heading', { name: 'Switch to Business?' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('12 expenses will become uncategorized.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.url.pathname.endsWith('/type-change'))?.url.searchParams.get('to')).toBe('BUSINESS');
    expect(patches(api.calls)).toHaveLength(0);
  });

  it('TC2: Back returns to the form without saving', async () => {
    const { user, api } = await startTypeChange({ [`GET /v1/profiles/${STUDIO}/type-change`]: preview(3) });
    await screen.findByRole('heading', { name: 'Switch to Business?' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus());
    expect(patches(api.calls)).toHaveLength(0);
  });

  it('TC3/TC4/TC4b: one PATCH; categories re-read; the list keeps the response count with Open Expenses', async () => {
    const { user, api, router } = await startTypeChange({
      [`GET /v1/profiles/${STUDIO}/type-change`]: preview(12),
      [`PATCH /v1/profiles/${STUDIO}`]: () => saved({ ...studio, type: 'BUSINESS' }, { uncategorizedExpenses: 11, deletedCategories: 14, preset: 'general' }),
    });
    const categoriesBefore = api.count('GET /v1/expense-categories');
    await user.click(await screen.findByRole('button', { name: 'Switch to Business' }));
    await waitFor(() => expect(patches(api.calls)).toHaveLength(1));
    expect(patches(api.calls)[0].body).toEqual({ type: 'BUSINESS' });
    expect(await screen.findByText('Now Business. 11 expenses are uncategorized.')).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET /v1/expense-categories')).toBeGreaterThan(categoriesBefore));
    await user.click(screen.getByRole('link', { name: 'Open Expenses' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${STUDIO}/expenses`));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('TC5: no categorised expenses says so, and saving toasts instead of a banner', async () => {
    const { user } = await startTypeChange({
      [`GET /v1/profiles/${STUDIO}/type-change`]: preview(0),
      [`PATCH /v1/profiles/${STUDIO}`]: () => saved({ ...studio, type: 'BUSINESS' }, { uncategorizedExpenses: 0, deletedCategories: 14, preset: 'general' }),
    });
    expect(await screen.findByText('No expenses use a category yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to Business' }));
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Expenses' })).toBeNull();
  });

  it('TC6: a failed preview shows no confirm and no count', async () => {
    await startTypeChange({ [`GET /v1/profiles/${STUDIO}/type-change`]: () => fail(500, 'INTERNAL') });
    expect(await screen.findByText('Something went wrong. Nothing was saved.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Switch to Business?' })).toBeNull();
  });
});
