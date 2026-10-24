import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderPortal, stubApi } from '../../../__tests__/harness';
import { LocalRecordsFileRefused, type CarryOverSummary, type PendingRestore } from '../../../session/localBackendContract';
import { setMode } from '../../../session/mode';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-291 §3.6 through the real router: the new address's receiver and the
 * old address's /carry-over page. The local backend is a fake (its real
 * carry-over is local/carryOver/__tests__); the other window is a fake too,
 * and its messages arrive as `message` events on this window.
 */

const OLD_WEB = 'https://old-web.example';
const OLD_PORTAL = 'https://old-portal.example';
const NEW_PORTAL = 'https://app.example';

const backend = {
  fetch: vi.fn(async () => new Response('{}', { status: 404 })),
  onRemoteWrite: vi.fn(() => () => undefined),
  exportRecords: vi.fn(() => Promise.resolve(new Blob(['zip']))),
  readRecordsFile: vi.fn<(file: Blob, options?: unknown) => Promise<PendingRestore>>(),
  prepareCarryOver: vi.fn<(kind: string, payload: Blob, options: unknown) => Promise<PendingRestore>>(),
  putBlob: vi.fn(),
  readBlob: vi.fn(),
};
const countRecordsOnThisDevice = vi.fn(() => Promise.resolve(0));
vi.mock('@mut/local-backend', () => ({ bootLocalBackend: () => Promise.resolve(backend), countRecordsOnThisDevice: () => countRecordsOnThisDevice() }));
const leaveTo = vi.fn();
vi.mock('../../../../lib/carryOver/leave', () => ({ leaveTo: (url: string) => leaveTo(url) }));

const SUMMARY: CarryOverSummary = {
  counts: { businesses: 1, clients: 3, projects: 0, income: 5, payments: 4, expenses: 2, receipts: 0, conversions: 0 },
  totals: { ILS: { paid: '400.00', outstanding: '100.00', expenses: '25.00', convertedOut: '0.00', convertedIn: '0.00' } },
  changed: [{ code: 'owed-no-client', count: 2 }],
  notCarried: [{ code: 'vendors', count: 1 }, { code: 'refused', count: 1, reason: 'DATE_INVALID' }],
  jodEntries: 0,
};

function pending(extra: Partial<PendingRestore> = {}): PendingRestore {
  return { recordCount: 14, missingReceiptFiles: 0, exportedFromAccountAt: null, deviceRecordCount: 0, carryOver: SUMMARY, apply: vi.fn(() => Promise.resolve()), ...extra };
}

interface FakeWindow {
  posted: Array<{ data: unknown; targetOrigin: string }>;
  closed: boolean;
  postMessage(data: unknown, targetOrigin: string): void;
  focus(): void;
}

function fakeWindow(): FakeWindow {
  const posted: FakeWindow['posted'] = [];
  return { posted, closed: false, postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }), focus: () => undefined };
}

/** A `message` event from another window, the way the browser delivers one. */
function deliver(data: unknown, origin: string, source: unknown) {
  const event = new Event('message');
  Object.defineProperties(event, { data: { value: data }, origin: { value: origin }, source: { value: source } });
  act(() => void window.dispatchEvent(event));
}

const payload = (kind: string, blob: Blob) => ({ type: 'mtb3a.carry-over.payload', v: 1, kind, payload: blob });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  (globalThis as { __CARRY_OVER__?: unknown }).__CARRY_OVER__ = { sources: { web: OLD_WEB, portal: OLD_PORTAL }, portalOrigin: NEW_PORTAL };
  setMode('local');
  stubApi({});
});

afterEach(() => {
  delete (globalThis as { __CARRY_OVER__?: unknown }).__CARRY_OVER__;
  Object.defineProperty(window, 'opener', { value: null, configurable: true });
  vi.clearAllMocks();
});

describe('the new address: /carry-over/receive', () => {
  function openFrom(from: string) {
    const opener = fakeWindow();
    Object.defineProperty(window, 'opener', { value: opener, configurable: true });
    const rendered = renderPortal(`/carry-over/receive?from=${from}`);
    return { ...rendered, opener };
  }

  it('says ready to the old app only, checks what it sends, shows what came, and saves on Save', async () => {
    backend.prepareCarryOver.mockResolvedValue(pending());
    const { opener, user } = openFrom('web');
    await waitFor(() => expect(opener.posted[0]).toEqual({ data: { type: 'mtb3a.carry-over.ready', v: 1 }, targetOrigin: OLD_WEB }));

    const blob = new Blob(['{"version":24,"tables":{}}']);
    deliver(payload('free-app-backup', blob), OLD_WEB, opener);

    expect(await screen.findByRole('heading', { name: 'Your records from the old app' })).toBeInTheDocument();
    expect(backend.prepareCarryOver).toHaveBeenCalledWith('free-app-backup', blob, expect.objectContaining({ labels: { noClient: 'No client', defaultBusiness: 'My business' } }));
    expect(screen.getByTestId('carry-over-counts')).toHaveTextContent('Clients3');
    expect(screen.getByTestId('carry-over-totals')).toHaveTextContent('Still owed');
    expect(screen.getByTestId('carry-over-not-carried')).toHaveTextContent('Records the rules refused (DATE_INVALID)');
    expect(screen.queryByTestId('carry-over-existing')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save on this device' }));
    expect(await screen.findByRole('heading', { name: 'Your records are here.' })).toBeInTheDocument();
    expect(opener.posted.at(-1)).toEqual({ targetOrigin: OLD_WEB, data: { type: 'mtb3a.carry-over.done', v: 1, counts: SUMMARY.counts, totals: SUMMARY.totals } });
  });

  it('ignores a payload from anywhere but the old app\'s window', async () => {
    const { opener } = openFrom('web');
    await waitFor(() => expect(opener.posted).toHaveLength(1));
    deliver(payload('free-app-backup', new Blob(['{}'])), 'https://evil.example', opener);
    deliver(payload('free-app-backup', new Blob(['{}'])), OLD_WEB, fakeWindow());
    await act(async () => undefined);
    expect(backend.prepareCarryOver).not.toHaveBeenCalled();
  });

  it('with records already here, warns, offers a download first, and replaces only on a second confirm (D3)', async () => {
    const apply = vi.fn(() => Promise.resolve());
    backend.prepareCarryOver.mockResolvedValue(pending({ deviceRecordCount: 3, apply }));
    const { opener, user } = openFrom('web');
    await waitFor(() => expect(opener.posted).toHaveLength(1));
    deliver(payload('free-app-backup', new Blob(['{}'])), OLD_WEB, opener);

    expect(await screen.findByTestId('carry-over-existing')).toHaveTextContent('This device already has 3 records. Saving replaces them.');
    await user.click(screen.getByRole('button', { name: "Download what's here first" }));
    await waitFor(() => expect(backend.exportRecords).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Replace with the carried records' }));
    expect(screen.getByTestId('carry-over-replace-confirm')).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Replace with the carried records' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it('signed in, says the records go to this browser\'s signed-out space (E3)', async () => {
    setMode('remote');
    backend.prepareCarryOver.mockResolvedValue(pending());
    const { opener } = openFrom('web');
    await waitFor(() => expect(opener.posted).toHaveLength(1));
    deliver(payload('free-app-backup', new Blob(['{}'])), OLD_WEB, opener);
    expect(await screen.findByTestId('carry-over-signed-in')).toHaveTextContent('Sign out to see them.');
  });

  it('cancel tells the old app, and saves nothing', async () => {
    const apply = vi.fn(() => Promise.resolve());
    backend.prepareCarryOver.mockResolvedValue(pending({ apply }));
    const { opener, user } = openFrom('web');
    await waitFor(() => expect(opener.posted).toHaveLength(1));
    deliver(payload('free-app-backup', new Blob(['{}'])), OLD_WEB, opener);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(opener.posted.at(-1)).toEqual({ targetOrigin: OLD_WEB, data: { type: 'mtb3a.carry-over.declined', v: 1 } });
    expect(await screen.findByTestId('carry-over-file-reason')).toHaveAttribute('data-reason', 'declined');
    expect(apply).not.toHaveBeenCalled();
  });

  it('records that don\'t add up are never offered: the page says nothing changed and offers the file (E4)', async () => {
    backend.prepareCarryOver.mockRejectedValue(new LocalRecordsFileRefused('carry-over-failed'));
    const { opener } = openFrom('web');
    await waitFor(() => expect(opener.posted).toHaveLength(1));
    deliver(payload('free-app-backup', new Blob(['{}'])), OLD_WEB, opener);
    expect(await screen.findByTestId('carry-over-file-reason')).toHaveAttribute('data-reason', 'failed');
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
  });

  it('opened on its own, offers the file and reads it the way the hand-off does', async () => {
    backend.readRecordsFile.mockResolvedValue(pending());
    renderPortal('/carry-over/receive');
    expect(await screen.findByRole('heading', { name: 'Bring your records from a file' })).toBeInTheDocument();

    const input = screen.getByTestId('carry-over-file') as HTMLInputElement;
    const file = new File(['{"version":24,"tables":{}}'], 'mtb3a-backup-v24.json', { type: 'application/json' });
    act(() => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await screen.findByRole('button', { name: 'Save on this device' })).toBeInTheDocument();
    expect(backend.readRecordsFile).toHaveBeenCalledWith(file, expect.objectContaining({ labels: expect.any(Object) }));
  });
});

describe('the old address: /carry-over', () => {
  it('with no records in this browser, goes straight on to the new address', async () => {
    countRecordsOnThisDevice.mockResolvedValue(0);
    renderPortal('/carry-over?next=%2Fp%2Fabc%2Fexpenses');
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(`${NEW_PORTAL}/p/abc/expenses`));
  });

  it('on the new address itself, only goes on to next', async () => {
    (globalThis as { __CARRY_OVER__?: unknown }).__CARRY_OVER__ = { sources: {}, portalOrigin: window.location.origin };
    renderPortal('/carry-over?next=%2Fsign-in');
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith('/'));
    expect(countRecordsOnThisDevice).not.toHaveBeenCalled();
  });

  it('with records, offers the move; the popup opens on the click and done goes on to the new address', async () => {
    countRecordsOnThisDevice.mockResolvedValue(4);
    const popup = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const { user } = renderPortal('/carry-over?next=%2F');
    await user.click(await screen.findByRole('button', { name: 'Carry my records over' }));

    expect(open).toHaveBeenCalledWith(`${NEW_PORTAL}/carry-over/receive?from=portal`, 'mtb3a-carry-over');
    deliver({ type: 'mtb3a.carry-over.ready', v: 1 }, NEW_PORTAL, popup);
    await waitFor(() => expect(popup.posted[0]).toEqual({ targetOrigin: NEW_PORTAL, data: expect.objectContaining({ kind: 'records-file' }) }));
    deliver({ type: 'mtb3a.carry-over.done', v: 1, counts: {}, totals: {} }, NEW_PORTAL, popup);
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(`${NEW_PORTAL}/`));
    open.mockRestore();
  });

  it('a blocked popup falls back to the download and a link to the new address', async () => {
    countRecordsOnThisDevice.mockResolvedValue(4);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = renderPortal('/carry-over?next=%2F');
    await user.click(await screen.findByRole('button', { name: 'Carry my records over' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The new page couldn't be reached.");
    expect(screen.getByRole('link', { name: 'Open the new address' })).toHaveAttribute('href', `${NEW_PORTAL}/`);
    open.mockRestore();
  });
});
