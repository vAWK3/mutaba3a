import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, openYou, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { LocalRecordsFileRefused, type PendingRestore } from '../localBackendContract';
import { MODE_KEY, setMode, setUnhintedMode } from '../mode';

/**
 * The portal signed out on this device (MUT-286 Phase C, brief §2.6) through
 * the real router and shell. `stubApi` stands for the server; the local
 * backend is a fake answering from its own route table, so each test can say
 * which side answered. The real local backend has its own tests
 * (local/__tests__/boot.test.ts, no-network.test.ts).
 */

const localRoutes: Record<string, Handler> = {};
const localCalls: string[] = [];
let remoteWriteHandler: (() => void) | null = null;
const backend = {
  fetch: vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    localCalls.push(key);
    const handler = localRoutes[key];
    if (!handler) return fail(404, 'NOT_FOUND');
    const text = await request.text();
    return handler({ method: request.method, url, headers: request.headers, body: text ? JSON.parse(text) : undefined });
  }),
  onRemoteWrite: vi.fn((handler: () => void) => {
    remoteWriteHandler = handler;
    return () => {
      remoteWriteHandler = null;
    };
  }),
  exportRecords: vi.fn(() => Promise.resolve(new Blob(['{}'], { type: 'application/json' }))),
  readRecordsFile: vi.fn<(file: Blob) => Promise<PendingRestore>>(),
};
const boot = vi.fn(() => Promise.resolve(backend));

vi.mock('@mut/local-backend', () => ({ bootLocalBackend: () => boot() }));

/** The local person as `/v1/me` describes them: an owned personal profile, nothing Malafat about it. */
const personal = profile({ id: ORG_A, name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true, income: { received: true, owed: true, customer: 'optional' } });
const localMe = { ...me([personal]), user: { ...me().user, email: 'local@device.invalid', displayName: 'Personal' } };

function useLocalRoutes(routes: Record<string, Handler> = {}) {
  for (const key of Object.keys(localRoutes)) delete localRoutes[key];
  Object.assign(localRoutes, { ...emptyProfileRoutes(), 'GET /v1/me': () => ok(localMe), ...routes });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  localCalls.length = 0;
  remoteWriteHandler = null;
  boot.mockClear();
  boot.mockImplementation(() => Promise.resolve(backend));
  backend.readRecordsFile.mockReset();
  backend.exportRecords.mockClear();
  useLocalRoutes();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** MUT-425: the account menu became You › Account; the You island opens the page (MUT-426). Returns the page. */
async function openAccount(user: ReturnType<typeof renderPortal>['user']) {
  await openYou(user, 'account');
  return screen.getByRole('main');
}

const youRows = (page: HTMLElement) => [...page.querySelectorAll('.hp-you-row')].map((row) => row.textContent);

const WELCOME = 'Every amount, accounted for.';
const nobody = () => fail(401, 'UNAUTHENTICATED');

describe('first visit: the welcome (MUT-513)', () => {
  beforeEach(() => setUnhintedMode('probe'));

  it('asks the server once and shows the welcome, not the app: nothing saved, nothing opened on this device', async () => {
    const server = stubApi({ 'GET /v1/me': nobody });

    const { router } = renderPortal('/');

    expect(await screen.findByRole('heading', { level: 1, name: WELCOME })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
    expect(locationOf(router)).toBe('/');
    expect(server.calls).toHaveLength(1);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(boot).not.toHaveBeenCalled();
  });

  it('opens in Arabic, right to left, when nobody chose a language', async () => {
    localStorage.removeItem(PORTAL_LANGUAGE_KEY);
    stubApi({ 'GET /v1/me': nobody });

    renderPortal('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'كل مبلغ في مكانه.' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('says plainly what this device keeps, and promises no phone', async () => {
    stubApi({ 'GET /v1/me': nobody });
    renderPortal('/');

    const device = await screen.findByRole('region', { name: 'On this device only' });
    expect(device).toHaveTextContent('Stays in this browser only. No account, and nothing is sent to us.');
    expect(device).toHaveTextContent("Clearing this site's data erases it.");
    expect(device).toHaveTextContent('Back it up from Your data › Download my records.');
    expect(device).toHaveTextContent("It doesn't move into an account later.");
    expect(device).not.toHaveTextContent(/phone|sync/i);
  });

  it('Try it on this device opens the app in one tap and remembers the choice', async () => {
    const server = stubApi({ 'GET /v1/me': nobody });
    const { user, router } = renderPortal('/');

    await user.click(await screen.findByRole('button', { name: 'Try it on this device' }));

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
    expect(localStorage.getItem(MODE_KEY)).toBe('local');
    expect(server.calls).toHaveLength(1);
  });

  it('Sign in goes to sign-in; coming back without signing in returns to the welcome, still undecided', async () => {
    stubApi({ 'GET /v1/me': nobody, 'GET /v1/self-service': () => ok({ signup: true, recovery: true }) });
    const { user, router } = renderPortal('/');

    await user.click(await screen.findByRole('link', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    act(() => router.history.back());

    expect(await screen.findByRole('heading', { level: 1, name: WELCOME })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(boot).not.toHaveBeenCalled();
  });

  // QA found it: while the router moves to /signup, the welcome's gate must not read the new address and send it to
  // sign-in before the signup page mounts.
  it('Create an account goes to the signup page, not to sign-in', async () => {
    stubApi({ 'GET /v1/me': nobody, 'GET /v1/self-service': () => ok({ signup: true, recovery: true }) });
    const { user, router } = renderPortal('/');

    await user.click(await screen.findByRole('link', { name: 'Create an account' }));

    await waitFor(() => expect(locationOf(router)).toBe('/signup'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(locationOf(router)).toBe('/signup');
  });

  it('a deep link while undecided goes to sign-in, keeping where it was headed', async () => {
    stubApi({ 'GET /v1/me': nobody });
    const { router } = renderPortal(`/p/${ORG_A}/receivables`);

    await waitFor(() => expect(locationOf(router)).toBe(`/sign-in?next=${encodeURIComponent(`/p/${ORG_A}/receivables`)}`));
    expect(screen.queryByRole('heading', { level: 1, name: WELCOME })).toBeNull();
  });

  it('a session from before local mode is kept: the probe answers 200 and the account opens', async () => {
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });

    renderPortal('/');

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBe('remote');
    expect(boot).not.toHaveBeenCalled();
  });

  it('a saved choice never shows the welcome again', async () => {
    setMode('local');
    const server = stubApi({});

    renderPortal('/');

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: WELCOME })).toBeNull();
    expect(server.calls).toHaveLength(0);
  });

  it("when the server can't be reached: the welcome, a Retry, and Try lasts for this visit only (D7)", async () => {
    const server = stubApi({});
    server.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const { user } = renderPortal('/');

    expect(await screen.findByText("Can't reach MTB3A right now")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try it on this device' }));

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it("Retry asks the server again: nobody signed in leaves the plain welcome", async () => {
    const server = stubApi({ 'GET /v1/me': nobody });
    server.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const { user } = renderPortal('/');

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByText("Can't reach MTB3A right now")).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: WELCOME })).toBeInTheDocument();
  });

  it('a server error is not "unreachable": it keeps the can\'t-connect screen', async () => {
    stubApi({ 'GET /v1/me': () => fail(503, 'INTERNAL') });
    renderPortal('/');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: WELCOME })).toBeNull();
  });
});

describe('the welcome, reopened (MUT-513)', () => {
  it('You › Account › What is MTB3A? shows it, and Continue on this device goes back', async () => {
    setMode('local');
    stubApi({});
    const { user, router } = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(user);

    await user.click(within(page).getByRole('button', { name: 'What is MTB3A?' }));
    expect(await screen.findByRole('heading', { level: 1, name: WELCOME })).toBeInTheDocument();
    expect(locationOf(router)).toBe('/welcome');

    await user.click(screen.getByRole('button', { name: 'Continue on this device' }));
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });

  // Review: opened with no saved mode, /welcome asks the server first instead of offering Try over a live account
  it('with no saved mode, /welcome asks the server first: signed in, the app; nobody, the welcome at /', async () => {
    setUnhintedMode('probe');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    const { router } = renderPortal('/welcome');

    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(localStorage.getItem(MODE_KEY)).toBe('remote');
  });

  it('signed in, /welcome is not for you: it goes to the app', async () => {
    setMode('remote');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    const { router } = renderPortal('/welcome');

    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
  });
});

describe('first visit (AC1)', () => {
  it('opens in Arabic when nobody chose a language', async () => {
    localStorage.removeItem(PORTAL_LANGUAGE_KEY);
    setMode('local');
    stubApi({});

    renderPortal('/');

    expect(await screen.findByRole('navigation', { name: 'الأقسام' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

});

describe('the shell signed out', () => {
  beforeEach(() => setMode('local'));

  it('shows "On this device", never the placeholder email', async () => {
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    await openYou(user);
    const page = screen.getByRole('main');
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('On this device');
    expect(page).not.toHaveTextContent('local@device.invalid');
  });

  it('offers Sign in and Your data, and nothing that needs an account or a phone', async () => {
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(user);
    expect(youRows(page)).toEqual(['Sign in', 'Your dataDownload my records', 'What is MTB3A?']);
    expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('On this device');
    expect(within(page).queryByText(/Sign out|Change password|Billing|iPhone|Android|Malafat|local@device.invalid/)).toBeNull();
  });

  it('You › App has Language and the terms only: no usage switch, no Malafat, no phone apps (MUT-425)', async () => {
    vi.stubGlobal('__TERMS_URL__', 'https://mutaba3a.example/terms');
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(user);
    await user.click(within(page).getByRole('link', { name: 'App' }));
    await within(page).findByRole('group', { name: 'Language' });
    expect(youRows(page)).toEqual(['LanguageENعربي', expect.stringMatching(/^Terms of service/)]);
    expect(within(page).queryByRole('switch')).toBeNull();
  });

  it('Sign in opens the sign-in form instead of bouncing back to the app', async () => {
    const server = stubApi({});
    const { user, router } = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(user);
    await user.click(within(page).getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(locationOf(router)).toBe('/sign-in');
    // No bounce (no /v1/me). The one request is the server's public doors (MUT-368 D1): the person chose the server.
    expect(server.calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual(['GET /v1/self-service']);
  });

  it('shows the same four destinations as signed in, with Conversions one level in under Paid (MUT-287, MUT-424)', async () => {
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['Owed', 'Paid', 'Spent', 'Clients']);
    await user.click(within(nav).getByRole('link', { name: 'Paid' }));
    const deeper = await screen.findByRole('navigation', { name: 'More in Paid' });
    expect(within(deeper).getByRole('link', { name: /^Currency conversions/ })).toHaveAttribute('href', `/p/${ORG_A}/conversions`);
  });

  it('drops the "Hosted" chip and the old local-app note from You › Profiles', async () => {
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    await openYou(user);
    const page = await screen.findByRole('main');
    await within(page).findByRole('button', { name: /Personal/ });
    expect(screen.queryByText('Hosted')).toBeNull();
    expect(screen.queryByText(/stay in the MTB3A app on your device/)).toBeNull();
    expect(youRows(page)).toEqual(['✓Personal' + 'Your built-in profile', '+ New profile', 'Manage profiles']);
  });

  it('shows no Malafat suggestion even on an owned business profile (AC5)', async () => {
    const business = profile({ id: ORG_A, name: 'Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });
    useLocalRoutes({ 'GET /v1/me': () => ok({ ...localMe, profiles: [business] }) });
    stubApi({});
    const { user, container } = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(user);
    await user.click(within(page).getByRole('link', { name: 'App' }));
    await within(page).findByRole('group', { name: 'Language' });
    expect(within(page).queryByText(/Malafat/)).toBeNull();
    expect(container.textContent).not.toMatch(/Malafat/);
  });

  it('never offers firm features on an owned business profile: no operator sees a request made on this device (MUT-300)', async () => {
    const business = profile({ id: ORG_A, name: 'Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });
    useLocalRoutes({ 'GET /v1/me': () => ok({ ...localMe, profiles: [business] }) });
    stubApi({});
    renderPortal(`/p/${ORG_A}?editProfile=${ORG_A}`);
    const dialog = await screen.findByRole('dialog', { name: 'Studio' });
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
    expect(within(dialog).queryByText('Use this profile for a firm')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Request firm features' })).toBeNull();
  });

  it('another tab\'s save refreshes this tab', async () => {
    let payments = 0;
    useLocalRoutes({ 'GET /v1/payments': () => ok({ items: [], nextCursor: null }, 200, { 'x-count': String(++payments) }) });
    stubApi({});
    renderPortal(`/p/${ORG_A}/payments`);
    await waitFor(() => expect(remoteWriteHandler).not.toBeNull());
    await waitFor(() => expect(payments).toBeGreaterThan(0));
    const before = payments;

    act(() => remoteWriteHandler?.());

    await waitFor(() => expect(payments).toBeGreaterThan(before));
  });

  it('a save this browser refuses stops the page with a reload screen, whatever page it happened on (review)', async () => {
    const refused = new Error('quota');
    refused.name = 'LocalSaveFailedError';
    useLocalRoutes({
      'GET /v1/payments': () => {
        throw refused;
      },
    });
    stubApi({});

    renderPortal(`/p/${ORG_A}/payments`);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save on this device");
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('a browser that won\'t let the app save here says so, with Try again and Sign in (review)', async () => {
    useLocalRoutes({
      'GET /v1/me': () => {
        throw new Error('IndexedDB blocked');
      },
    });
    stubApi({});

    const { router, user } = renderPortal('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This browser won't let MTB3A save here");
    expect(alert).not.toHaveTextContent("Can't reach MTB3A");
    await user.click(within(alert).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(locationOf(router)).toBe('/sign-in'));
  });

  it('records saved by a newer version in another tab ask for a reload (D1)', async () => {
    const tooNew = new Error('newer');
    tooNew.name = 'LocalFormatTooNewError';
    useLocalRoutes({
      'GET /v1/me': () => {
        throw tooNew;
      },
    });
    stubApi({});

    renderPortal('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reload to continue');
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('moving between modes', () => {
  it('sign-in page: "Continue on this device" opens the local app', async () => {
    setMode('remote');
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { user, router } = renderPortal('/sign-in?reason=expired');

    await user.click(await screen.findByRole('button', { name: 'Continue on this device' }));

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBe('local');
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });

  it('an expired session offers both doors and never switches by itself', async () => {
    setMode('remote');
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });

    renderPortal('/sign-in?reason=expired');

    expect(await screen.findByText("You've been signed out. Sign in again to continue.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue on this device' })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBe('remote');
    expect(boot).not.toHaveBeenCalled();
  });

  function otherTabSets(mode: 'local' | 'remote') {
    const oldValue = localStorage.getItem(MODE_KEY);
    act(() => {
      localStorage.setItem(MODE_KEY, mode);
      window.dispatchEvent(new StorageEvent('storage', { key: MODE_KEY, oldValue, newValue: mode }));
    });
  }

  it('another tab signing in moves this tab to the account, with nothing of this device left on screen (review)', async () => {
    setMode('local');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    const { queryClient } = renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByRole('link', { name: 'You · Personal' })).toBeInTheDocument();
    queryClient.setQueryData(['p', 'device-profile', 'payments'], { items: [] });

    otherTabSets('remote');

    await waitFor(() => expect(screen.getByRole('link', { name: 'You · Haddad & Partners' })).toBeInTheDocument());
    expect(queryClient.getQueryData(['p', 'device-profile', 'payments'])).toBeUndefined();
  });

  it('another tab continuing on this device drops the account\'s figures from this tab (review)', async () => {
    setMode('remote');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByRole('link', { name: 'You · Haddad & Partners' })).toBeInTheDocument();

    otherTabSets('local');

    await waitFor(() => expect(screen.getByRole('link', { name: 'You · Personal' })).toBeInTheDocument());
    expect(screen.queryByText('Nour Haddad')).toBeNull();
  });

  it('someone typing on the sign-in page is left alone when another tab continues on this device', async () => {
    setMode('remote');
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { router, user } = renderPortal('/sign-in');
    await user.type(await screen.findByLabelText('Email'), 'nour@firm.ps');

    otherTabSets('local');

    expect(locationOf(router)).toBe('/sign-in');
    expect(screen.getByLabelText('Email')).toHaveValue('nour@firm.ps');
  });

  it('signing in switches to the account and drops what was cached locally', async () => {
    setMode('local');
    stubApi({ ...emptyProfileRoutes(), 'POST /v1/sessions': () => ok(me(), 201), 'GET /v1/me': () => ok(me()) });
    const { user, queryClient } = renderPortal('/sign-in');
    queryClient.setQueryData(['p', 'local-profile', 'payments'], { items: [] });

    await user.type(await screen.findByLabelText('Email'), 'nour@firm.ps');
    await user.type(screen.getByLabelText('Password'), 'a-long-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(localStorage.getItem(MODE_KEY)).toBe('remote'));
    expect(queryClient.getQueryData(['p', 'local-profile', 'payments'])).toBeUndefined();
  });

  it('signing out returns this device to local mode', async () => {
    setMode('remote');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()), 'DELETE /v1/sessions/current': () => new Response(null, { status: 204 }) });
    const { user } = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(user);

    await user.click(within(page).getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(localStorage.getItem(MODE_KEY)).toBe('local'));
  });
});

describe('Your data (D2)', () => {
  beforeEach(() => setMode('local'));

  async function openYourData() {
    stubApi({});
    const rendered = renderPortal(`/p/${ORG_A}`);
    const page = await openAccount(rendered.user);
    await rendered.user.click(within(page).getByRole('button', { name: /^Your data/ }));
    await screen.findByRole('dialog');
    return rendered;
  }

  function chooseFile(name = 'records.json') {
    const input = screen.getByTestId('your-data-file') as HTMLInputElement;
    const file = new File(['{}'], name, { type: 'application/json' });
    act(() => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('downloads every record on this device as one dated file', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = await openYourData();

    await user.click(screen.getByRole('button', { name: 'Download my records' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(link.download).toMatch(/^mtb3a-records-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(backend.exportRecords).toHaveBeenCalledTimes(1);
  });

  it('says before Replace how many receipt files the file is missing (MUT-287 review D4)', async () => {
    const apply = vi.fn(() => Promise.resolve());
    backend.readRecordsFile.mockResolvedValue({ recordCount: 4, missingReceiptFiles: 2, exportedFromAccountAt: null, apply });
    await openYourData();

    chooseFile();
    const confirm = await screen.findByRole('alertdialog');

    expect(confirm).toHaveTextContent("2 receipt files aren't in this file. Those receipts will be restored without their files.");
    expect(apply).not.toHaveBeenCalled();
  });

  it('reads the old web app\'s backup file too, and says what came over before Replace (MUT-291 E5)', async () => {
    const carryOver = { counts: { clients: 3, income: 2 }, totals: { ILS: { paid: '50.00', outstanding: '0.00', expenses: '0.00', convertedOut: '0.00', convertedIn: '0.00' } }, changed: [], notCarried: [{ code: 'vendors', count: 4 }], jodEntries: 0 };
    backend.readRecordsFile.mockResolvedValue({ recordCount: 5, missingReceiptFiles: 0, exportedFromAccountAt: null, deviceRecordCount: 0, carryOver, apply: vi.fn(() => Promise.resolve()) });
    await openYourData();

    chooseFile('mtb3a-backup-v24-2026-10-24.json');
    const confirm = await screen.findByRole('alertdialog');

    expect(backend.readRecordsFile).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ labels: { noClient: 'No client', defaultBusiness: 'My business' }, locale: 'en' }));
    expect(within(confirm).getByTestId('carry-over-counts')).toHaveTextContent('Clients3');
    expect(within(confirm).getByTestId('carry-over-not-carried')).toHaveTextContent('Your saved vendor list');
  });

  it('says a file from an account is an export, and from when (MUT-325)', async () => {
    backend.readRecordsFile.mockResolvedValue({ recordCount: 4, missingReceiptFiles: 0, exportedFromAccountAt: new Date('2026-10-20T09:00:00.000Z'), apply: vi.fn(() => Promise.resolve()) });
    await openYourData();

    chooseFile();
    const confirm = await screen.findByRole('alertdialog');

    expect(confirm).toHaveTextContent(/downloaded from your MTB3A account on .*20.*It's an export/);
  });

  it('restores only after a confirm that names the record count, then starts again from / on the restored profile', async () => {
    // The file's person and profile are not this device's: after Replace, /v1/me answers with the file's profile.
    const restoredProfile = { ...personal, id: ORG_B, name: 'Restored' };
    const apply = vi.fn(() => {
      useLocalRoutes({ 'GET /v1/me': () => ok({ ...localMe, profiles: [restoredProfile] }) });
      return Promise.resolve();
    });
    backend.readRecordsFile.mockResolvedValue({ recordCount: 12, missingReceiptFiles: 0, exportedFromAccountAt: null, apply });
    const { user, router } = await openYourData();

    chooseFile();
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Replace everything on this device with the 12 records in this file?');
    expect(apply).not.toHaveBeenCalled();
    expect(confirm).not.toHaveTextContent(/receipt file/);
    await user.click(within(confirm).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Records restored.')).toBeInTheDocument();
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}`));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText("This profile isn't available")).toBeNull();
  });

  it('a slow earlier file never replaces a later pick (review)', async () => {
    let finishFirst: (value: PendingRestore) => void = () => {};
    backend.readRecordsFile
      .mockImplementationOnce(() => new Promise<PendingRestore>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ recordCount: 2, missingReceiptFiles: 0, exportedFromAccountAt: null, apply: vi.fn(() => Promise.resolve()) });
    await openYourData();

    chooseFile('first.json');
    chooseFile('second.json');
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('the 2 records');
    await act(async () => finishFirst({ recordCount: 1, missingReceiptFiles: 0, exportedFromAccountAt: null, apply: vi.fn(() => Promise.resolve()) }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('the 2 records');
  });

  it('once the records are replaced, a later hiccup still says restored, never "nothing was changed" (review)', async () => {
    const apply = vi.fn(() => {
      useLocalRoutes({ 'GET /v1/me': () => fail(500, 'INTERNAL') });
      return Promise.resolve();
    });
    backend.readRecordsFile.mockResolvedValue({ recordCount: 3, missingReceiptFiles: 0, exportedFromAccountAt: null, apply });
    const { user } = await openYourData();

    chooseFile();
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace' }));

    expect(await screen.findByText('Records restored.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't restore the file. Nothing was changed.")).toBeNull();
  });

  it('Cancel leaves everything as it was', async () => {
    const apply = vi.fn(() => Promise.resolve());
    backend.readRecordsFile.mockResolvedValue({ recordCount: 1, missingReceiptFiles: 0, exportedFromAccountAt: null, apply });
    const { user } = await openYourData();

    chooseFile();
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-records-file', "This isn't an MTB3A records file."],
    ['too-new', 'This file was saved by a newer version of MTB3A. Reload and try again.'],
  ] as const)('refuses a %s file with its own message, changing nothing', async (reason, message) => {
    backend.readRecordsFile.mockRejectedValue(new LocalRecordsFileRefused(reason));
    await openYourData();

    chooseFile();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it("signed in, is the account's Download (MUT-325): no Restore, never this device's backend", async () => {
    setMode('remote');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    renderPortal(`/p/${ORG_A}?yourData=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Your data' });
    expect(within(dialog).queryByRole('button', { name: 'Restore from file' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Download my records' })).toBeInTheDocument();
    expect(backend.exportRecords).not.toHaveBeenCalled();
  });
});
