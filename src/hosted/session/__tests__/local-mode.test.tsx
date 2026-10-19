import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
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
  exportRecords: vi.fn(() => new Blob(['{}'], { type: 'application/json' })),
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

async function openAccountMenu(user: ReturnType<typeof renderPortal>['user']) {
  await user.click(await screen.findByRole('button', { name: /Account/ }));
  return screen.getByRole('menu', { name: 'Account' });
}

describe('first visit (AC1)', () => {
  it('asks the server once, then opens the app on this device: no sign-in, no further requests', async () => {
    setUnhintedMode('probe');
    const server = stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });

    const { router } = renderPortal('/');

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
    expect(server.count('GET /v1/me')).toBe(1);
    expect(server.calls).toHaveLength(1);
    expect(localStorage.getItem(MODE_KEY)).toBe('local');
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('opens in Arabic when nobody chose a language', async () => {
    localStorage.removeItem(PORTAL_LANGUAGE_KEY);
    setMode('local');
    stubApi({});

    renderPortal('/');

    expect(await screen.findByRole('navigation', { name: 'الأقسام' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('a session from before local mode is kept: the probe answers 200 and the account opens', async () => {
    setUnhintedMode('probe');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });

    renderPortal('/');

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBe('remote');
    expect(boot).not.toHaveBeenCalled();
  });
});

describe('the shell signed out', () => {
  beforeEach(() => setMode('local'));

  it('shows "On this device", never the placeholder email', async () => {
    stubApi({});
    renderPortal(`/p/${ORG_A}`);
    const account = await screen.findByRole('button', { name: /Account/ });
    expect(account).toHaveTextContent('On this device');
    expect(account).not.toHaveTextContent('local@device.invalid');
  });

  it('offers Sign in and Your data, and nothing that needs an account or a phone', async () => {
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    const menu = await openAccountMenu(user);
    const items = [...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(['Sign in', 'Your data']);
    expect(within(menu).queryByText(/Sign out|Change password|iPhone|Android|Malafat/)).toBeNull();
  });

  it('Sign in opens the sign-in form instead of bouncing back to the app', async () => {
    const server = stubApi({});
    const { user, router } = renderPortal(`/p/${ORG_A}`);
    const menu = await openAccountMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(locationOf(router)).toBe('/sign-in');
    expect(server.calls).toHaveLength(0);
  });

  it('hides Expenses and Conversions until MUT-287 brings them to this device', async () => {
    stubApi({});
    renderPortal(`/p/${ORG_A}`);
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    const links = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['Overview', 'Clients', 'Receivables', 'Payments', 'Documents']);
  });

  it('drops the "Hosted" chip and the old local-app note from the profile switcher', async () => {
    stubApi({});
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Switch profile/ }));
    const menu = screen.getByRole('menu', { name: 'Switch profile' });
    expect(within(menu).queryByText('Hosted')).toBeNull();
    expect(within(menu).queryByText(/stay in the Mutaba3a app on your device/)).toBeNull();
  });

  it('shows no Malafat suggestion even on an owned business profile (AC5)', async () => {
    const business = profile({ id: ORG_A, name: 'Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });
    useLocalRoutes({ 'GET /v1/me': () => ok({ ...localMe, profiles: [business] }) });
    stubApi({});
    const { user, container } = renderPortal(`/p/${ORG_A}`);
    const menu = await openAccountMenu(user);
    expect(within(menu).queryByText(/Malafat/)).toBeNull();
    expect(container.textContent).not.toMatch(/Malafat/);
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
    const menu = await openAccountMenu(user);

    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(localStorage.getItem(MODE_KEY)).toBe('local'));
  });
});

describe('Your data (D2)', () => {
  beforeEach(() => setMode('local'));

  async function openYourData() {
    stubApi({});
    const rendered = renderPortal(`/p/${ORG_A}`);
    const menu = await openAccountMenu(rendered.user);
    await rendered.user.click(within(menu).getByRole('menuitem', { name: 'Your data' }));
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
    expect(link.download).toMatch(/^mutaba3a-records-\d{4}-\d{2}-\d{2}\.json$/);
    expect(backend.exportRecords).toHaveBeenCalledTimes(1);
  });

  it('restores only after a confirm that names the record count, then starts again from / on the restored profile', async () => {
    // The file's person and profile are not this device's: after Replace, /v1/me answers with the file's profile.
    const restoredProfile = { ...personal, id: ORG_B, name: 'Restored' };
    const apply = vi.fn(() => {
      useLocalRoutes({ 'GET /v1/me': () => ok({ ...localMe, profiles: [restoredProfile] }) });
      return Promise.resolve();
    });
    backend.readRecordsFile.mockResolvedValue({ recordCount: 12, apply });
    const { user, router } = await openYourData();

    chooseFile();
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Replace everything on this device with the 12 records in this file?');
    expect(apply).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Records restored.')).toBeInTheDocument();
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}`));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText("This profile isn't available")).toBeNull();
  });

  it('Cancel leaves everything as it was', async () => {
    const apply = vi.fn(() => Promise.resolve());
    backend.readRecordsFile.mockResolvedValue({ recordCount: 1, apply });
    const { user } = await openYourData();

    chooseFile();
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-records-file', "This isn't a Mutaba3a records file."],
    ['too-new', 'This file was saved by a newer version of Mutaba3a. Reload and try again.'],
  ] as const)('refuses a %s file with its own message, changing nothing', async (reason, message) => {
    backend.readRecordsFile.mockRejectedValue(new LocalRecordsFileRefused(reason));
    await openYourData();

    chooseFile();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is not there signed in, even by URL', async () => {
    setMode('remote');
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()) });
    renderPortal(`/p/${ORG_A}?yourData=true`);
    await screen.findByRole('navigation', { name: 'Sections' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
