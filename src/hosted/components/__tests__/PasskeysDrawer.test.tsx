import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';

/**
 * MUT-115 (DR2–DR7, DR11): You › Account › Passkeys (`?passkeys=true`). The platform ceremony is the browser's, so
 * @simplewebauthn/browser is replaced here; the server's verification is covered by the server suite and QA.
 */
const browser = vi.hoisted(() => ({ startRegistration: vi.fn(), startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  startRegistration: browser.startRegistration,
  startAuthentication: browser.startAuthentication,
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: async () => false,
}));

const ICLOUD = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'iCloud Keychain', createdAt: '2026-10-12T09:00:00.000Z', lastUsedAt: null, deviceType: 'multiDevice', backedUp: true };
const CHROME = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Chrome on Mac', createdAt: '2026-10-03T09:00:00.000Z', lastUsedAt: '2026-10-20T09:00:00.000Z', deviceType: 'singleDevice', backedUp: false };
const OPTIONS = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rp: { id: 'localhost', name: 'MTB3A' }, user: { id: 'dQ', name: 'n@firm.ps', displayName: 'Nour' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } };
const REGISTRATION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'e30' }, clientExtensionResults: {} };

beforeEach(() => {
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.startRegistration.mockReset().mockResolvedValue(REGISTRATION);
});
afterEach(() => vi.unstubAllGlobals());

function portal(path: string, items: unknown[], routes: Record<string, Handler> = {}) {
  let list = [...items];
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile()])),
    ...emptyProfileRoutes(),
    'GET /v1/passkeys': () => ok({ items: list, limit: 10 }),
    'POST /v1/passkeys/creation-options': () => ok(OPTIONS),
    'POST /v1/passkeys': () => {
      list = [...list, ICLOUD];
      return ok(ICLOUD, 201);
    },
    ...routes,
  });
  return { ...renderPortal(path), api, setList: (next: unknown[]) => (list = next) };
}
const calls = (all: StubRequest[], method: string, path: string) => all.filter((c) => c.method === method && c.url.pathname === path);

describe('Passkeys drawer (MUT-115)', () => {
  it('opens from You › Account, directly after Change password, as a drawer', async () => {
    const { user, router } = portal(`/p/${ORG_A}/you/account`, []);
    const rows = await screen.findAllByRole('button', { name: /^(Change password|Passkeys)/ });
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/^Change password/), expect.stringMatching(/^Passkeys/)]);
    await user.click(rows[1]!);
    expect(await screen.findByRole('dialog', { name: 'Passkeys' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?passkeys=true`);
  });

  it('is not offered on a host outside the passkey RP ID (the legacy run.app portal)', async () => {
    vi.stubGlobal('__PASSKEY_RP_ID__', 'placeholder.example');
    portal(`/p/${ORG_A}/you/account?passkeys=true`, []);
    await screen.findByRole('button', { name: /^Change password/ });
    expect(screen.queryByRole('button', { name: /^Passkeys/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Passkeys' })).toBeNull();
  });

  it('empty: explains a passkey and offers Add', async () => {
    portal(`/p/${ORG_A}?passkeys=true`, []);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    expect(await within(dialog).findByText('No passkeys yet')).toBeInTheDocument();
    expect(within(dialog).getByText(/Your password still works/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add a passkey' })).toBeEnabled();
  });

  it('lists each passkey with when it was added and last used', async () => {
    portal(`/p/${ORG_A}?passkeys=true`, [CHROME]);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    const row = await within(dialog).findByText('Chrome on Mac');
    expect(row).toHaveAttribute('dir', 'auto');
    expect(within(dialog).getByText(/Added .*Oct.* · Last used .*Oct/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Rename Chrome on Mac' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove Chrome on Mac' })).toBeInTheDocument();
  });

  it('adds a passkey right after sign-in with no password prompt', async () => {
    const { user, api } = portal(`/p/${ORG_A}?passkeys=true`, []);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByText('Passkey added')).toBeInTheDocument();
    expect(await within(dialog).findByText('iCloud Keychain')).toBeInTheDocument();
    expect(calls(api.calls, 'POST', '/v1/passkeys')[0]?.body).toEqual({ challengeId: OPTIONS.challengeId, response: REGISTRATION });
  });

  it('asks for the password only on RECENT_SIGN_IN_REQUIRED, then sends it with both calls (DR6)', async () => {
    let asked = 0;
    const { user, api } = portal(`/p/${ORG_A}?passkeys=true`, [], {
      'POST /v1/passkeys/creation-options': (req) => ((req.body as { currentPassword?: string })?.currentPassword ? ok(OPTIONS) : (asked++, fail(403, 'RECENT_SIGN_IN_REQUIRED'))),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));
    expect(await within(dialog).findByText('For your security, enter your password to add a passkey.')).toBeInTheDocument();
    const field = within(dialog).getByLabelText('Password');
    await waitFor(() => expect(field).toHaveFocus());
    expect(browser.startRegistration).not.toHaveBeenCalled();
    await user.type(field, 'correct-horse-battery-staple');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Passkey added')).toBeInTheDocument();
    expect(asked).toBe(1);
    expect(calls(api.calls, 'POST', '/v1/passkeys')[0]?.body).toMatchObject({ currentPassword: 'correct-horse-battery-staple' });
  });

  it('a wrong password is the change-password banner', async () => {
    const { user } = portal(`/p/${ORG_A}?passkeys=true`, [], {
      'POST /v1/passkeys/creation-options': (req) => ((req.body as { currentPassword?: string })?.currentPassword ? fail(403, 'CURRENT_PASSWORD_WRONG') : fail(403, 'RECENT_SIGN_IN_REQUIRED')),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));
    await user.type(await within(dialog).findByLabelText('Password'), 'not it');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Current password is wrong.');
  });

  it('cancelling the system sheet shows nothing', async () => {
    browser.startRegistration.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    const { user, api } = portal(`/p/${ORG_A}?passkeys=true`, []);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(browser.startRegistration).toHaveBeenCalled());
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(calls(api.calls, 'POST', '/v1/passkeys')).toHaveLength(0);
  });

  it('a refused registration says so', async () => {
    const { user } = portal(`/p/${ORG_A}?passkeys=true`, [], { 'POST /v1/passkeys': () => fail(422, 'VALIDATION_FAILED', { reason: 'PASSKEY_NOT_VERIFIED' }) });
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(within(dialog).getByRole('button', { name: 'Add a passkey' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t add the passkey. Try again.');
  });

  it('at 10 passkeys, Add is off and says why', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...CHROME, id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`, name: `Key ${i}` }));
    portal(`/p/${ORG_A}?passkeys=true`, ten);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await within(dialog).findByText('Key 9');
    expect(within(dialog).getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
    expect(within(dialog).getByText('You can have up to 10 passkeys. Remove one to add another.')).toBeInTheDocument();
  });

  it('renames inline; an empty name is refused before sending', async () => {
    const { user, api, setList } = portal(`/p/${ORG_A}?passkeys=true`, [CHROME], {
      'PATCH /v1/passkeys/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': (req) => {
        const renamed = { ...CHROME, name: (req.body as { name: string }).name };
        setList([renamed]);
        return ok(renamed);
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(await within(dialog).findByRole('button', { name: 'Rename Chrome on Mac' }));
    const field = within(dialog).getByLabelText('Name');
    await user.clear(field);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Use 1–64 characters.')).toBeInTheDocument();
    expect(calls(api.calls, 'PATCH', '/v1/passkeys/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toHaveLength(0);
    await user.type(field, 'هاتف العمل');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name saved')).toBeInTheDocument();
    expect(await within(dialog).findByText('هاتف العمل')).toBeInTheDocument();
  });

  it('removes after an in-row confirm; Cancel (or Escape) keeps it and returns focus to Remove (DR7, DR11)', async () => {
    const { user, api, setList } = portal(`/p/${ORG_A}?passkeys=true`, [CHROME], {
      'DELETE /v1/passkeys/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': () => {
        setList([]);
        return new Response(null, { status: 204 });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await user.click(await within(dialog).findByRole('button', { name: 'Remove Chrome on Mac' }));
    expect(within(dialog).getByText(/Remove “Chrome on Mac”\? You won’t be able to sign in with it/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Passkeys' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Remove Chrome on Mac' })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: 'Remove Chrome on Mac' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Passkey removed. Devices signed in with it are signed out.')).toBeInTheDocument();
    expect(calls(api.calls, 'DELETE', '/v1/passkeys/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toHaveLength(1);
    expect(await within(dialog).findByText('No passkeys yet')).toBeInTheDocument();
  });
});
