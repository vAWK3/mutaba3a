import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Me, PasskeyPrompt } from '../../../api/client';
import { emptyProfileRoutes, fail, me, ok, profile, renderPortal, stubApi, type Handler, ORG_A, ORG_B } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-769 (DR-1, DR-7; ACCT-6, B7, B9): `/setup` for an account an accountant created. Who set it up and for which
 * business, the six-digit code (tries left, locked), then the password with the code, the hand-over moment with the
 * passkey nudge, then the card when due (Billing › Subscribe on the business profile), then the app. A dead
 * accountant's link and a locked code send the customer to the accountant, never to recovery.
 */
const browser = vi.hoisted(() => ({ supported: { value: false } }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  browserSupportsWebAuthn: () => browser.supported.value,
  browserSupportsWebAuthnAutofill: async () => false,
}));

const TOKEN = 'k'.repeat(43);
const EMAIL = 'samer@cafenour.ps';
const PASSWORD = 'a long enough passphrase';
const CODE = '481702';
const CHECK = 'POST /v1/account-setup/check';
const CLAIM = 'POST /v1/account-setup/claim-code';
const REDEEM = 'POST /v1/account-setup';
const DUE: PasskeyPrompt = { due: true, notNowCount: 0, hiddenUntil: null };
const BUSINESS = profile({ id: ORG_A, name: 'Café Nour', owned: true, isPersonalDefault: false, type: 'BUSINESS' });
const PERSONAL = profile({ id: ORG_B, name: 'Personal', owned: true, isPersonalDefault: true, type: 'PERSONAL' });

type Claim = { accountantName: string | null; businessName: string | null; codeLocked: boolean };
const claimed = (claim: Partial<Claim> = {}, locale: 'en' | 'ar' = 'en') => () =>
  ok({
    state: 'valid',
    email: EMAIL,
    locale,
    purpose: 'SETUP',
    expiresAt: '2026-12-11T09:00:00.000Z',
    termsVersion: '2026-10-19',
    twoFactor: null,
    claim: { accountantName: 'Hadi Khatib', businessName: 'Café Nour', codeLocked: false, ...claim },
  });

function setup(routes: Record<string, Handler> = {}, options: { paid?: boolean; prompt?: PasskeyPrompt | null } = {}) {
  let signedIn = false;
  const meNow = (): Me => {
    const base = me([PERSONAL, BUSINESS]);
    return { ...base, user: { ...base.user, passkeyPrompt: options.prompt ?? null } };
  };
  return stubApi({
    ...emptyProfileRoutes(),
    'GET /v1/me': () => (signedIn ? ok(meNow()) : fail(401, 'UNAUTHENTICATED')),
    [CHECK]: claimed(),
    [CLAIM]: (request) => ((request.body as { claimCode: string }).claimCode === CODE ? ok({ ok: true }) : fail(403, 'CLAIM_CODE_WRONG', { triesLeft: 3 })),
    [REDEEM]: () => ok({ email: EMAIL, status: 'ACTIVE' }),
    'POST /v1/sessions': () => {
      signedIn = true;
      return ok(meNow());
    },
    'GET /v1/billing': () =>
      ok({
        configured: true,
        canManage: true,
        trial: null,
        catalog: { ILS: { month: 2900, year: 29000 }, USD: null },
        countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL'] },
        coveredProfileIds: [],
        offer: null,
        yearlySwitch: null,
        comeback: null,
        accountantPlan: null,
        currentPlan: null,
        usage: null,
        starter: null,
        activeBusinesses: null,
        subscription: options.paid
          ? { tier: 'SOLO', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: '2026-12-27T00:00:00.000Z', cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: null, pause: null }
          : null,
      }),
    ...routes,
  });
}

const calls = (api: ReturnType<typeof setup>, key: string) => api.calls.filter((c) => `${c.method} ${c.url.pathname}` === key);

async function typeCode(user: ReturnType<typeof renderPortal>['user'], code: string) {
  const first = await screen.findByRole('textbox', { name: 'Digit 1 of 6' });
  await user.click(first);
  await user.paste(code);
}

async function passCodeStep(user: ReturnType<typeof renderPortal>['user']) {
  await typeCode(user, CODE);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  return screen.findByLabelText('New password');
}

async function setPassword(user: ReturnType<typeof renderPortal>['user']) {
  const password = await passCodeStep(user);
  await user.type(password, PASSWORD);
  await user.click(screen.getByRole('checkbox', { name: /terms of service/ }));
  await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  browser.supported.value = false;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the code step', () => {
  it('names the accountant and the business, with the welcome scene, step 1 of 3, and six LTR digit boxes', async () => {
    setup();
    const { container } = renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByText('Hadi Khatib set up MTB3A for Café Nour.')).toBeInTheDocument();
    expect(container.querySelector('[data-scene="handover-welcome"]')).not.toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 1, name: 'Enter the code your accountant gave you' });
    await waitFor(() => expect(heading).toHaveFocus());
    const group = screen.getByRole('group', { name: 'Enter the code your accountant gave you' });
    expect(group).toHaveAttribute('dir', 'ltr');
    const boxes = within(group).getAllByRole('textbox');
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toHaveAttribute('inputmode', 'numeric');
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(boxes[5]).toHaveAccessibleName('Digit 6 of 6');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('a paste fills all six; a wrong code says the tries left in an alert and empties the boxes', async () => {
    const api = setup();
    const { user } = renderPortal(`/setup#${TOKEN}`);
    await typeCode(user, '111 111');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong code. 3 tries left.');
    expect(calls(api, CLAIM)[0]?.body).toEqual({ token: TOKEN, claimCode: '111111' });
    expect(screen.getByRole('textbox', { name: 'Digit 1 of 6' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Digit 1 of 6' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks for all six digits before checking', async () => {
    const api = setup();
    const { user } = renderPortal(`/setup#${TOKEN}`);
    await typeCode(user, '481');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter all six digits.');
    expect(calls(api, CLAIM)).toHaveLength(0);
  });

  it('locks on the fifth wrong code: the code-locked scene and "ask your accountant", no password, no recovery', async () => {
    setup({ [CLAIM]: () => fail(403, 'CLAIM_CODE_LOCKED') });
    const { user, container } = renderPortal(`/setup#${TOKEN}`);
    await typeCode(user, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Too many tries' })).toBeInTheDocument();
    expect(screen.getByText('Ask your accountant for a new code.')).toBeInTheDocument();
    expect(container.querySelector('[data-scene="code-locked"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Send a new link' })).toBeNull();
  });

  it('opens on the locked screen when the check says the code is locked', async () => {
    setup({ [CHECK]: claimed({ codeLocked: true }) });
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Too many tries' })).toBeInTheDocument();
  });

  it('in Arabic: the context line, the digit names and the verify button, right to left with the code still LTR', async () => {
    localStorage.clear();
    setup({ [CHECK]: claimed({ accountantName: 'هادي الخطيب', businessName: 'مقهى نور' }, 'ar') });
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByText('أعدّ هادي الخطيب حساب متابعة لـمقهى نور.')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('textbox', { name: 'الرقم 1 من 6' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'أدخل الرمز الذي أعطاك إياه محاسبك' })).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: 'تحقّق' })).toBeInTheDocument();
  });
});

describe('the password, then the account is theirs', () => {
  it('step 2 of 3 keeps the context line and sends the code with the password', async () => {
    const api = setup();
    const { user } = renderPortal(`/setup#${TOKEN}`);
    await passCodeStep(user);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Hadi Khatib set up MTB3A for Café Nour.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.click(screen.getByRole('checkbox', { name: /terms of service/ }));
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    await waitFor(() => expect(calls(api, REDEEM)).toHaveLength(1));
    expect(calls(api, REDEEM)[0]?.body).toMatchObject({ token: TOKEN, password: PASSWORD, claimCode: CODE });
  });

  it('without a card yet: the hand-over moment, then Continue opens Billing › Subscribe on the business profile', async () => {
    setup();
    const { user, router, container } = renderPortal(`/setup#${TOKEN}`);
    await setPassword(user);
    expect(await screen.findByRole('heading', { name: 'The account is yours' })).toBeInTheDocument();
    expect(container.querySelector('[data-motion="handover-claimed"] [data-scene="handover-claimed"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${ORG_A}`));
    expect(router.state.location.search).toMatchObject({ billing: true, step: 'subscribe' });
  });

  it('with the card the accountant took: Continue goes straight to the business', async () => {
    setup({}, { paid: true });
    const { user, router } = renderPortal(`/setup#${TOKEN}`);
    await setPassword(user);
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${ORG_A}`));
    expect(router.state.location.search).not.toHaveProperty('step');
  });

  it('on a device that can make a passkey: the moment sits on the passkey nudge (DR-7: passkey, then card)', async () => {
    browser.supported.value = true;
    vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
    setup({ 'PATCH /v1/me/passkey-prompt': () => ok({ due: false, notNowCount: 1, hiddenUntil: null }) }, { prompt: DUE });
    const { user, router, container } = renderPortal(`/setup#${TOKEN}`);
    await setPassword(user);
    expect(await screen.findByRole('heading', { name: 'Create a passkey' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The account is yours');
    expect(container.querySelector('[data-motion="handover-claimed"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ billing: true, step: 'subscribe' }));
  });

  it('a code that locked since its step (the redeem says so) ends on the locked screen', async () => {
    setup({ [REDEEM]: () => fail(403, 'CLAIM_CODE_LOCKED') });
    const { user } = renderPortal(`/setup#${TOKEN}`);
    await setPassword(user);
    expect(await screen.findByRole('heading', { name: 'Too many tries' })).toBeInTheDocument();
  });

  it('a code replaced since its step goes back to the code step', async () => {
    setup({ [REDEEM]: () => fail(403, 'CLAIM_CODE_WRONG', { triesLeft: 4 }) });
    const { user } = renderPortal(`/setup#${TOKEN}`);
    await setPassword(user);
    expect(await screen.findByRole('heading', { name: 'Enter the code your accountant gave you' })).toBeInTheDocument();
  });
});

describe('a dead accountant’s link (B7)', () => {
  it.each(['expired', 'superseded'])('%s: the link-expired scene and "ask your accountant", never Send a new link', async (state) => {
    setup({ [CHECK]: () => ok({ state, purpose: 'SETUP', provisioned: true }), 'GET /v1/self-service': () => ok({ signup: true, recovery: true, malafatSignIn: false, signInCode: false, starterPlan: false, openSignup: false }) });
    const { container } = renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link is no longer valid' })).toBeInTheDocument();
    expect(screen.getByText('Ask your accountant for a new one.')).toBeInTheDocument();
    expect(container.querySelector('[data-scene="link-expired"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Send a new link' })).toBeNull();
  });

  it('an operator’s dead link keeps today’s notice', async () => {
    setup({ [CHECK]: () => ok({ state: 'expired', purpose: 'SETUP' }) });
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
  });
});
