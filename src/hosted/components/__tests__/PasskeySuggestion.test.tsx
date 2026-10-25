import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';
import type { Me, PasskeyPrompt, TrialPrompt } from '../../api/client';
import { resetTrialWelcomeOffer } from '../../session/trialWelcomeOffer';

/**
 * MUT-370: the Home "Add a passkey" card through the real portal (router, account drawers, query client), /v1 stubbed.
 * The platform ceremony is the browser's, so @simplewebauthn/browser is replaced; the server's rules are the server
 * suite's (routes-passkeys.test.ts) and the live flows are release-QA's (portal-selfservice.passkeys.suggest-*).
 */
const browser = vi.hoisted(() => ({ startRegistration: vi.fn(), supported: { value: true } }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  startRegistration: browser.startRegistration,
  browserSupportsWebAuthn: () => browser.supported.value,
  browserSupportsWebAuthnAutofill: async () => false,
}));

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const DUE: PasskeyPrompt = { due: true, notNowCount: 0, hiddenUntil: null };
const PASSKEY = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'iCloud Keychain', createdAt: '2026-10-25T09:00:00.000Z', lastUsedAt: null, deviceType: 'multiDevice', backedUp: true };
const OPTIONS = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rp: { id: 'localhost', name: 'MTB3A' }, user: { id: 'dQ', name: 'n@firm.ps', displayName: 'Nour' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } };
const REGISTRATION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'e30' }, clientExtensionResults: {} };
const TITLE = 'Add a passkey: the more secure way to sign in.';
const BILLING = {
  configured: true,
  subscription: null,
  canManage: false,
  trial: { startedAt: iso(-0.01), endsAt: iso(14), lockAt: iso(30) },
  catalog: { ILS: { month: 4900, year: 49000 }, USD: { month: 1600, year: 16000 } },
  countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [ORG_A],
};

beforeEach(() => {
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.supported.value = true;
  browser.startRegistration.mockReset().mockResolvedValue(REGISTRATION);
  resetTrialWelcomeOffer();
});
afterEach(() => vi.unstubAllGlobals());

function portal(opts: { prompt?: PasskeyPrompt | null; trialPrompt?: TrialPrompt; trial?: boolean; locale?: 'en' | 'ar'; routes?: Record<string, Handler>; path?: string } = {}) {
  let prompt: PasskeyPrompt | null = opts.prompt === undefined ? DUE : opts.prompt;
  let passkeys: unknown[] = [];
  let trialPrompt = opts.trialPrompt;
  const meNow = (): Me => {
    const open = opts.trial ? profile({ isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: iso(14) } }) : profile();
    const base = me([open], opts.locale ?? 'en');
    return { ...base, user: { ...base.user, passkeyPrompt: prompt && (passkeys.length ? { ...prompt, due: false } : prompt), ...(trialPrompt ? { trialPrompt } : {}) } };
  };
  const api = stubApi({
    'GET /v1/me': () => ok(meNow()),
    'GET /v1/billing': () => ok(BILLING),
    'PATCH /v1/me/trial-prompt': () => {
      trialPrompt = { welcomedAt: new Date().toISOString(), welcomeAnswer: 'skipped', bannerSnoozedUntil: null };
      return ok(trialPrompt);
    },
    ...emptyProfileRoutes(),
    'GET /v1/passkeys': () => ok({ items: passkeys, limit: 10 }),
    'POST /v1/passkeys/creation-options': () => ok(OPTIONS),
    'POST /v1/passkeys': () => {
      passkeys = [PASSKEY];
      return ok(PASSKEY, 201);
    },
    'PATCH /v1/me/passkey-prompt': () => {
      prompt = { due: false, notNowCount: (prompt?.notNowCount ?? 0) + 1, hiddenUntil: iso(30) };
      return ok(prompt);
    },
    ...opts.routes,
  });
  return { ...renderPortal(opts.path ?? `/p/${ORG_A}`), api };
}
const calls = (all: StubRequest[], method: string, path: string) => all.filter((c) => c.method === method && c.url.pathname === path);
const card = () => screen.findByRole('region', { name: TITLE });

describe('the "Add a passkey" card on Home (MUT-370)', () => {
  it('shows the suggestion with Add a passkey and Not now when the server says it is due', async () => {
    portal();
    await card();
    expect(screen.getByText('Your password still works.')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: TITLE });
    expect(within(region).getByRole('button', { name: 'Add a passkey' })).toBeEnabled();
    expect(within(region).getByRole('button', { name: 'Not now' })).toBeEnabled();
  });

  it('reads in Arabic', async () => {
    portal({ locale: 'ar' });
    const region = await screen.findByRole('region', { name: 'أضف مفتاح مرور: الطريقة الأكثر أمانًا لتسجيل الدخول.' });
    expect(within(region).getByText('وتبقى كلمة المرور صالحة.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'إضافة مفتاح مرور' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'ليس الآن' })).toBeInTheDocument();
  });

  it('is not shown when not due, on a server without passkeys, or on a browser that cannot make one', async () => {
    for (const setup of [() => portal({ prompt: { due: false, notNowCount: 3, hiddenUntil: null } }), () => portal({ prompt: null })]) {
      const { unmount } = setup();
      expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
      expect(screen.queryByText(TITLE)).toBeNull();
      unmount();
    }
    browser.supported.value = false;
    portal();
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('waits behind the trial’s first-run step, which opens first, and shows once the step is answered (D4)', async () => {
    const { user, router } = portal({ trial: true, trialPrompt: { welcomedAt: null, welcomeAnswer: null, bannerSnoozedUntil: null } });
    const step = await screen.findByRole('dialog', { name: 'Your free trial' });
    expect(locationOf(router)).toBe(`/p/${ORG_A}?billing=true&step=welcome`);
    expect(screen.queryByText(TITLE)).toBeNull();
    await user.click(await within(step).findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await card()).toBeInTheDocument();
  });

  it('Not now hides it at once and tells the server', async () => {
    const { user, api } = portal();
    const region = await card();
    await user.click(within(region).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(calls(api.calls, 'PATCH', '/v1/me/passkey-prompt').map((c) => c.body)).toEqual([{ action: 'not-now' }]);
  });

  it('a Not now the server refuses still hides the card for this visit (code review)', async () => {
    const { user } = portal({ routes: { 'PATCH /v1/me/passkey-prompt': () => fail(503, 'UNAVAILABLE') } });
    const region = await card();
    await user.click(within(region).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    // Give a refetch the chance to bring it back: none is made on a failure
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('Add a passkey runs the ceremony with no password, says "Passkey added", and the card goes', async () => {
    const { user, api } = portal();
    const region = await card();
    await user.click(within(region).getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByText('Passkey added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(calls(api.calls, 'POST', '/v1/passkeys/creation-options').map((c) => c.body)).toEqual([{}]);
    expect(calls(api.calls, 'POST', '/v1/passkeys')).toHaveLength(1);
    expect(calls(api.calls, 'PATCH', '/v1/me/passkey-prompt')).toHaveLength(0);
  });

  it('cancelling the system sheet shows nothing and keeps the card', async () => {
    browser.startRegistration.mockRejectedValue(Object.assign(new Error('cancel'), { name: 'NotAllowedError' }));
    const { user, api } = portal();
    const region = await card();
    await user.click(within(region).getByRole('button', { name: 'Add a passkey' }));
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Add a passkey' })).not.toHaveAttribute('aria-busy', 'true'));
    expect(within(region).queryByRole('alert')).toBeNull();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(calls(api.calls, 'POST', '/v1/passkeys')).toHaveLength(0);
  });

  it('an older sign-in that needs the password hands over to You › Account › Passkeys (D6)', async () => {
    const { user, router } = portal({ routes: { 'POST /v1/passkeys/creation-options': () => fail(403, 'RECENT_SIGN_IN_REQUIRED') } });
    const region = await card();
    await user.click(within(region).getByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByRole('dialog', { name: 'Passkeys' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}?passkeys=true`);
  });

  it('a failure says so in the card and keeps it', async () => {
    const { user } = portal({ routes: { 'POST /v1/passkeys': () => fail(422, 'PASSKEY_NOT_VERIFIED') } });
    const region = await card();
    await user.click(within(region).getByRole('button', { name: 'Add a passkey' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent('Couldn’t add the passkey. Try again.');
  });

  it('a passkey added in the Passkeys drawer takes the card away too (eng review E3)', async () => {
    const { user } = portal({ path: `/p/${ORG_A}?passkeys=true` });
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    await card();
    await user.click(await within(dialog).findByRole('button', { name: 'Add a passkey' }));
    expect(await screen.findByText('Passkey added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  });
});
