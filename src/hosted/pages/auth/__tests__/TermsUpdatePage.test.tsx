import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-324 (D1, D6): a signed-in person whose latest acceptance is older than
 * the current terms reads and accepts the new version before the portal opens.
 */
const CURRENT = '2027-01-01';
const TERMS_URL = 'https://mutaba3a.example/terms';
const ACCEPT = 'POST /v1/me/terms-acceptance';
const behind = () => ({ ...me(), terms: { version: CURRENT, accepted: false } });

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...emptyProfileRoutes(),
    'GET /v1/me': () => ok(behind()),
    [ACCEPT]: () => ok({ version: CURRENT, accepted: true }),
    'DELETE /v1/sessions/current': () => new Response(null, { status: 204 }),
    ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Updated terms step (MUT-324)', () => {
  it('stands before the portal, linking the exact version, with a way out that names the support email', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    stubApi(routes());
    renderPortal('/');
    expect(await screen.findByRole('heading', { level: 1, name: "We've updated our terms" })).toBeInTheDocument();
    const read = screen.getByRole('link', { name: 'Read the terms' });
    expect(read).toHaveAttribute('href', `${TERMS_URL}/${CURRENT}?lang=en`);
    expect(read).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/info@malafat\.app/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('I agree records the version in the page language, then opens the portal', async () => {
    const api = stubApi(routes());
    const { user, router } = renderPortal('/');
    await user.click(await screen.findByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === ACCEPT)?.body).toEqual({ version: CURRENT, locale: 'en' });
    expect(screen.queryByRole('heading', { level: 1, name: "We've updated our terms" })).not.toBeInTheDocument();
  });

  it('records Arabic when the page is in Arabic, and links the Arabic text', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    const api = stubApi(routes({ 'GET /v1/me': () => ok({ ...behind(), user: { ...behind().user, locale: 'ar' } }) }));
    const { user } = renderPortal('/');
    expect(await screen.findByRole('link', { name: 'اقرأ الشروط' })).toHaveAttribute('href', `${TERMS_URL}/${CURRENT}?lang=ar`);
    await user.click(await screen.findByRole('button', { name: 'أوافق' }));
    await waitFor(() => expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === ACCEPT)?.body).toEqual({ version: CURRENT, locale: 'ar' }));
  });

  it('says so when saving fails, and stays on the step', async () => {
    stubApi(routes({ [ACCEPT]: () => fail(503, 'INTERNAL') }));
    const { user } = renderPortal('/');
    await user.click(await screen.findByRole('button', { name: 'I agree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save");
    expect(screen.getByRole('heading', { level: 1, name: "We've updated our terms" })).toBeInTheDocument();
  });

  it('when the terms changed again while the step was open, says so, shows the new version, and the retry accepts it (review fix 4)', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    const NEWER = '2027-02-01';
    let current = CURRENT;
    const api = stubApi(
      routes({
        'GET /v1/me': () => ok({ ...me(), terms: { version: current, accepted: false } }),
        [ACCEPT]: (call) => {
          if ((call.body as { version: string }).version !== NEWER) {
            current = NEWER;
            return fail(409, 'TERMS_VERSION_STALE', { current: NEWER });
          }
          return ok({ version: NEWER, accepted: true });
        },
      }),
    );
    const { user, router } = renderPortal('/');
    await user.click(await screen.findByRole('button', { name: 'I agree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The terms changed while this page was open');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Read the terms' })).toHaveAttribute('href', `${TERMS_URL}/${NEWER}?lang=en`));
    await user.click(screen.getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    const accepts = api.calls.filter((c) => `${c.method} ${c.url.pathname}` === ACCEPT).map((c) => c.body);
    expect(accepts).toEqual([
      { version: CURRENT, locale: 'en' },
      { version: NEWER, locale: 'en' },
    ]);
  });

  it('Sign out on the step signs out and opens sign-in', async () => {
    const api = stubApi(routes());
    const { user, router } = renderPortal('/');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(locationOf(router)).toBe('/sign-in?reason=signed_out'));
    expect(api.calls.some((c) => `${c.method} ${c.url.pathname}` === 'DELETE /v1/sessions/current')).toBe(true);
    expect(api.calls.some((c) => `${c.method} ${c.url.pathname}` === ACCEPT)).toBe(false);
  });

  it('is never shown to someone who has accepted, or where no terms apply', async () => {
    for (const terms of [{ version: CURRENT, accepted: true }, null]) {
      stubApi(routes({ 'GET /v1/me': () => ok({ ...me(), terms }) }));
      const { router, unmount } = renderPortal('/');
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
      expect(screen.queryByRole('heading', { level: 1, name: "We've updated our terms" })).not.toBeInTheDocument();
      unmount();
    }
  });
});
