import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../../db/database';
import { settingsRepo } from '../../../db/repository';
import { renderWithProviders } from '../../../test/utils';
import { CarryOverGate } from '../CarryOverScreen';
import { chooseLanguage } from '../../../test/language';

/**
 * MUT-291 §3.6 (T-U15, T-U23; D1, R7): the free web app's gate in front of the
 * app. The new address is a fake window; its messages arrive as `message`
 * events on this one.
 */

const PORTAL = 'https://app.example';
const leaveTo = vi.fn();
vi.mock('../../../lib/carryOver/leave', () => ({ leaveTo: (url: string) => leaveTo(url) }));
const backUpNow = vi.fn(() => Promise.resolve());
vi.mock('../../../utils/backupDownload', () => ({ backUpNow: () => backUpNow() }));

const STAMP = '2026-03-01T09:00:00.000Z';

function gate() {
  return renderWithProviders(
    <CarryOverGate>
      <p>the old app</p>
    </CarryOverGate>,
  );
}

async function withRecords() {
  await db.clients.add({ id: 'c1', name: 'Client', createdAt: STAMP, updatedAt: STAMP });
  await db.transactions.add({ id: 't1', kind: 'income', status: 'paid', amountMinor: 100, currency: 'ILS', occurredAt: '2026-02-01', createdAt: STAMP, updatedAt: STAMP });
}

function installed(value: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: value && query === '(display-mode: standalone)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
}

function deliver(data: unknown, origin: string, source: unknown) {
  const event = new Event('message');
  Object.defineProperties(event, { data: { value: data }, origin: { value: origin }, source: { value: source } });
  act(() => void window.dispatchEvent(event));
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  sessionStorage.clear();
  installed(false);
  (globalThis as { __CARRY_OVER__?: unknown }).__CARRY_OVER__ = { sources: {}, portalOrigin: PORTAL };
});

afterEach(() => {
  delete (globalThis as { __CARRY_OVER__?: unknown }).__CARRY_OVER__;
  vi.clearAllMocks();
});

describe('the free app\'s carry-over gate', () => {
  it('before stage live it is not there at all', async () => {
    (globalThis as { __CARRY_OVER__?: unknown }).__CARRY_OVER__ = { sources: {}, portalOrigin: null };
    await withRecords();
    gate();
    expect(screen.getByText('the old app')).toBeInTheDocument();
    expect(leaveTo).not.toHaveBeenCalled();
  });

  it('with nothing in this browser, goes to the new address', async () => {
    gate();
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith(PORTAL));
    expect(screen.queryByText('the old app')).toBeNull();
  });

  it('with records never carried, asks first; Keep using opens the app for this tab only', async () => {
    await withRecords();
    const user = userEvent.setup();
    gate();
    expect(await screen.findByRole('heading', { name: 'MTB3A has a new address' })).toBeInTheDocument();
    expect(await screen.findByText(/This browser holds 2 records/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep using the old app for now' }));
    expect(screen.getByText('the old app')).toBeInTheDocument();
    expect(sessionStorage.getItem('mtb3a-carry-over-later')).toBe('1');
  });

  it('carries the records over: the popup opens on the click, then the app opens under the banner (D1)', async () => {
    await withRecords();
    const popup = { posted: [] as Array<{ data: unknown; targetOrigin: string }>, closed: false, postMessage(data: unknown, targetOrigin: string) { this.posted.push({ data, targetOrigin }); }, focus: () => undefined };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const user = userEvent.setup();
    gate();
    await user.click(await screen.findByRole('button', { name: 'Carry my records over' }));
    expect(open).toHaveBeenCalledWith(`${PORTAL}/carry-over/receive?from=web`, 'mtb3a-carry-over');

    deliver({ type: 'mtb3a.carry-over.ready', v: 1 }, PORTAL, popup);
    await waitFor(() => expect(popup.posted).toHaveLength(1));
    const sent = popup.posted[0]!.data as { kind: string; payload: Blob };
    expect(sent.kind).toBe('free-app-backup');
    expect(JSON.parse(await sent.payload.text())).toMatchObject({ version: 24, tables: { clients: [expect.objectContaining({ id: 'c1' })] } });

    deliver({ type: 'mtb3a.carry-over.done', v: 1, counts: { clients: 1, income: 1, expenses: 0 }, totals: {} }, PORTAL, popup);
    expect(await screen.findByTestId('carry-over-arrived')).toHaveTextContent('Arrived: 1 clients, 1 income entries, 0 expenses.');
    expect((await settingsRepo.get()).carriedOverAt).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Keep using the old app for now' }));
    expect(screen.getByTestId('carry-over-banner')).toHaveTextContent("Your records were carried to app.example on");
    expect(screen.getByText('the old app')).toBeInTheDocument();
    open.mockRestore();
  });

  it('once carried, opens the app under the banner; Carry over again asks again', async () => {
    await withRecords();
    await settingsRepo.update({ carriedOverAt: '2026-10-24T10:00:00.000Z' });
    const user = userEvent.setup();
    gate();
    expect(await screen.findByTestId('carry-over-banner')).toHaveTextContent("Changes you make here won't follow.");
    expect(screen.getByText('the old app')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Carry over again' }));
    expect(screen.getByRole('heading', { name: 'MTB3A has a new address' })).toBeInTheDocument();
  });

  it('a blocked popup leads with the file and the new address\'s restore page', async () => {
    await withRecords();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    gate();
    await user.click(await screen.findByRole('button', { name: 'Carry my records over' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The new page couldn't be reached.");
    expect(screen.getByRole('link', { name: 'Open the new address' })).toHaveAttribute('href', `${PORTAL}/carry-over/receive`);
    await user.click(screen.getByRole('button', { name: 'Download my records file' }));
    expect(backUpNow).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it('speaks Arabic, right to left, when that is the language (the default for everyone, ADR-077)', async () => {
    chooseLanguage('ar');
    await withRecords();
    gate();
    expect(await screen.findByRole('heading', { name: 'لمتابعة عنوان جديد' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'انقل سجلاتي' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    localStorage.clear();
  });

  it('opened from the home screen, leads with the file and never tries the popup (R7)', async () => {
    installed(true);
    await withRecords();
    gate();
    expect(await screen.findByTestId('carry-over-installed')).toHaveTextContent('You opened MTB3A from your home screen.');
    expect(screen.queryByRole('button', { name: 'Carry my records over' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download my records file' })).toBeInTheDocument();
  });
});
