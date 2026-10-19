import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, me, ok, renderPortal, stubApi } from '../../__tests__/harness';

const TERMS_URL = 'https://mutaba3a.example/terms';

afterEach(() => vi.unstubAllGlobals());

/** MUT-324: the terms are one click away from the account menu and the sign-in page. */
describe('Terms links (MUT-324)', () => {
  it('the account menu links the terms in a new tab, before the app downloads', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    const terms = within(menu).getByRole('menuitem', { name: 'Terms of service' });
    expect(terms).toHaveAttribute('href', `${TERMS_URL}?lang=en`);
    expect(terms).toHaveAttribute('target', '_blank');
    const items = [...menu.querySelectorAll('[role^="menuitem"]')];
    expect(items.indexOf(terms)).toBeLessThan(items.findIndex((i) => /Get the iPhone app/.test(i.textContent ?? '')));
  });

  it('the sign-in page links the terms', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    renderPortal('/sign-in');
    expect(await screen.findByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', `${TERMS_URL}?lang=en`);
  });
});
