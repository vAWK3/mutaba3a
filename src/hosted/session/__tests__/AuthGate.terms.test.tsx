import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ME_KEY } from '../me';

/**
 * MUT-346: terms that change while the portal is open are asked for in a dialog above it, so an open
 * drawer and what was typed in it survive. At boot the step stays the full page (MUT-324).
 */
const NEWER = '2027-01-01';
const ACCEPT = 'POST /v1/me/terms-acceptance';

function portal(path: string) {
  let behind = false;
  const routes: Record<string, Handler> = {
    ...emptyProfileRoutes(),
    'GET /v1/me': () => ok(behind ? { ...me([profile()]), terms: { version: NEWER, accepted: false } } : me([profile()])),
    [ACCEPT]: () => ok({ version: NEWER, accepted: true }),
  };
  const api = stubApi(routes);
  const rendered = renderPortal(path);
  /** A server release bumps the terms; the portal's next /v1/me read learns it. */
  async function bumpTerms() {
    behind = true;
    await rendered.queryClient.invalidateQueries({ queryKey: ME_KEY });
  }
  return { ...rendered, api, bumpTerms };
}

async function typeDraft(user: ReturnType<typeof renderPortal>['user']) {
  const drawer = await screen.findByRole('dialog', { name: 'Change password' });
  const field = within(drawer).getByLabelText('Current password');
  await user.type(field, 'half typed');
  return field;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('terms bumped mid-session (MUT-346)', () => {
  it('asks in a dialog above the portal, and the open drawer keeps what was typed', async () => {
    const { user, api, bumpTerms } = portal(`/p/${ORG_A}?changePassword=true`);
    const field = await typeDraft(user);

    await bumpTerms();
    const step = await screen.findByRole('dialog', { name: "We've updated our terms" });
    expect(field).toBeInTheDocument();
    expect(field).toHaveValue('half typed');

    await user.click(within(step).getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: "We've updated our terms" })).not.toBeInTheDocument());
    expect(api.calls.some((c) => `${c.method} ${c.url.pathname}` === ACCEPT)).toBe(true);
    expect(screen.getByLabelText('Current password')).toHaveValue('half typed');
  });

  it('leaves the portal behind it unreachable while it is open, and gives it back after', async () => {
    const { user, container, bumpTerms } = portal(`/p/${ORG_A}?changePassword=true`);
    await typeDraft(user);
    await bumpTerms();
    const step = await screen.findByRole('dialog', { name: "We've updated our terms" });

    expect(container).toHaveAttribute('inert');
    expect(container).toHaveAttribute('aria-hidden', 'true');
    expect(step.contains(document.activeElement)).toBe(true);

    await user.click(within(step).getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(container).not.toHaveAttribute('inert'));
    expect(container).not.toHaveAttribute('aria-hidden');
  });

  it('Escape does not close the drawer underneath', async () => {
    const { user, bumpTerms } = portal(`/p/${ORG_A}?changePassword=true`);
    await typeDraft(user);
    await bumpTerms();
    await screen.findByRole('dialog', { name: "We've updated our terms" });

    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Current password')).toHaveValue('half typed');
    expect(screen.getByRole('dialog', { name: "We've updated our terms", hidden: true })).toBeInTheDocument();
  });

  it('when /v1/me answers for someone else (records restored, every query reset), a person behind is asked on the full page, not over a fresh portal (review)', async () => {
    const other = { ...me([profile()]), user: { ...me([profile()]).user, id: '88888888-8888-4888-8888-888888888888' }, terms: { version: NEWER, accepted: false } };
    let answer = me([profile()]);
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(answer) });
    const { queryClient } = renderPortal(`/p/${ORG_A}`);
    await screen.findByRole('navigation', { name: 'Sections' });

    // restoredHome.ts: the restored person's /v1/me, read from nothing
    answer = other;
    await act(() => queryClient.resetQueries());
    expect(await screen.findByRole('heading', { level: 1, name: "We've updated our terms" })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: "We've updated our terms" })).not.toBeInTheDocument();
  });

  it('a failed Sign out says so inside the dialog, where it can be seen (review)', async () => {
    const { user, bumpTerms } = portal(`/p/${ORG_A}`);
    await screen.findByRole('navigation', { name: 'Sections' });
    await bumpTerms();
    const step = await screen.findByRole('dialog', { name: "We've updated our terms" });

    await user.click(within(step).getByRole('button', { name: 'Sign out' }));
    expect(await within(step).findByRole('alert')).toHaveTextContent(/sign out/i);
    expect(within(step).getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('at boot the step is still the full page, with no portal behind it (MUT-324)', async () => {
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok({ ...me([profile()]), terms: { version: NEWER, accepted: false } }) });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByRole('heading', { level: 1, name: "We've updated our terms" })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: "We've updated our terms" })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { hidden: true })).not.toBeInTheDocument();
  });
});
