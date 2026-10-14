import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { MeProvider, ME_KEY, ProfileProvider } from '../../session/me';
import { me, profile } from '../../__tests__/harness';
import { customer } from '../../pages/__tests__/fixtures';
import { useMalafatPortalMoments } from '../../session/malafatMoments';
import { MalafatClientsCard, MalafatCreatedNote, MalafatMenuItems } from '../MalafatPortal';
import type { Me, HostedProfile } from '../../api/client';

const api = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>();
  return { ...real, api: { ...real.api, changeMalafatSuggestions: api.change } };
});

const business = (id: string) => profile({ id, name: `Office ${id}`, writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });

function wrap(account: Me, active: HostedProfile, children: ReactNode, language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(ME_KEY, account);
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <MeProvider me={account}>
          <ProfileProvider profile={active}>{children}</ProfileProvider>
        </MeProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

const customers = (n: number, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') =>
  new Map(Array.from({ length: n }, (_, i) => [`c${i}`, { ...customer(`0000000${i}-0000-4000-8000-000000000000`, `Client ${i}`), status }]));

beforeEach(() => {
  localStorage.clear();
  api.change.mockReset();
  api.change.mockImplementation(async (change: { off?: boolean; dismiss?: string[] }) => ({ off: change.off ?? false, dismissed: change.dismiss ?? [] }));
  useMalafatPortalMoments.getState().reset();
});

/** Malafat suggestions in the portal (MUT-191). */
describe('MalafatMenuItems (S1, in the account menu)', () => {
  it('offers Malafat and the switch on an eligible business profile', async () => {
    wrap(me([business('a')]), business('a'), <div role="menu"><MalafatMenuItems profile={business('a')} /></div>);
    const link = screen.getByRole('menuitem', { name: /Malafat, for law firms and accounting offices/ });
    expect(link.getAttribute('href')).toContain('/en/contact?topic=mutaba3a&utm_source=mutaba3a&utm_medium=portal&utm_campaign=malafat-upsell&utm_content=settings');
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Show Malafat suggestions' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(api.change).toHaveBeenCalledWith({ off: true });
  });

  it('shows nothing on a personal profile, on a firm, or to someone already on Malafat', () => {
    const personal = profile({ id: 'p', writerOfRecord: null, owned: true, isPersonalDefault: true, type: 'PERSONAL' });
    wrap(me([personal]), personal, <div role="menu"><MalafatMenuItems profile={personal} /></div>);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    document.body.innerHTML = '';
    wrap(me([business('a'), profile()]), business('a'), <div role="menu"><MalafatMenuItems profile={business('a')} /></div>);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  });
});

describe('MalafatClientsCard (C2/C3)', () => {
  const card = () => screen.queryByRole('group', { name: 'A suggestion for law firms and accounting offices' });

  it('suggests Malafat at ten active clients, tagged for the portal', () => {
    wrap(me([business('a')]), business('a'), <MalafatClientsCard customers={customers(10)} query={undefined} onGone={vi.fn()} />);
    expect(card()).toHaveTextContent('Lots of clients to keep track of?');
    expect(within(card()!).getByRole('link').getAttribute('href')).toContain('utm_medium=portal&utm_campaign=malafat-upsell&utm_content=client-threshold');
  });

  it('counts active clients only, and stays away while searching', () => {
    const mixed = new Map([...customers(9), ...[...customers(3, 'ARCHIVED')].map(([k, v]) => [`x${k}`, v] as const)]);
    wrap(me([business('a')]), business('a'), <MalafatClientsCard customers={mixed} query={undefined} onGone={vi.fn()} />);
    expect(card()).toBeNull();
    document.body.innerHTML = '';
    wrap(me([business('a')]), business('a'), <MalafatClientsCard customers={customers(10)} query="Nour" onGone={vi.fn()} />);
    expect(card()).toBeNull();
  });

  it('suggests it for a second business profile, but not while the created note is due', () => {
    wrap(me([business('a'), business('b')]), business('a'), <MalafatClientsCard customers={customers(2)} query={undefined} onGone={vi.fn()} />);
    expect(card()).toHaveTextContent('Running more than one office?');
    document.body.innerHTML = '';
    useMalafatPortalMoments.getState().markBusinessCreated('b');
    wrap(me([business('a'), business('b')]), business('a'), <MalafatClientsCard customers={customers(2)} query={undefined} onGone={vi.fn()} />);
    expect(card()).toBeNull();
  });

  it('never on a personal or Malafat-fed profile', () => {
    const personal = profile({ id: 'p', writerOfRecord: null, owned: true, isPersonalDefault: true, type: 'PERSONAL' });
    wrap(me([personal]), personal, <MalafatClientsCard customers={customers(20)} query={undefined} onGone={vi.fn()} />);
    expect(card()).toBeNull();
    document.body.innerHTML = '';
    wrap(me([profile()]), profile(), <MalafatClientsCard customers={customers(20)} query={undefined} onGone={vi.fn()} />);
    expect(card()).toBeNull();
  });

  it('retires the moment on the account and shows nothing more this visit', async () => {
    const onGone = vi.fn();
    const queryClient = wrap(me([business('a'), business('b')]), business('a'), <MalafatClientsCard customers={customers(10)} query={undefined} onGone={onGone} />);
    await userEvent.click(screen.getByRole('button', { name: "Don't show this again" }));
    expect(api.change).toHaveBeenCalledWith({ dismiss: ['client-threshold'] });
    expect(onGone).toHaveBeenCalled();
    expect(useMalafatPortalMoments.getState().clientsRetiredThisVisit).toBe(true);
    await vi.waitFor(() => expect((queryClient.getQueryData(ME_KEY) as Me).user.malafatSuggestions.dismissed).toEqual(['client-threshold']));
  });

  it('reads in Arabic', () => {
    wrap(me([business('a')]), business('a'), <MalafatClientsCard customers={customers(10)} query={undefined} onGone={vi.fn()} />, 'ar');
    expect(screen.getByRole('group', { name: 'اقتراح لمكاتب المحاماة والمحاسبة' })).toHaveTextContent('عملاء كثيرون تتابعهم؟');
  });
});

describe('MalafatCreatedNote (C1)', () => {
  it('shows on the business profile just created, tagged business-profile', () => {
    useMalafatPortalMoments.getState().markBusinessCreated('a');
    wrap(me([business('a')]), business('a'), <MalafatCreatedNote />);
    const note = screen.getByRole('group', { name: 'A suggestion for law firms and accounting offices' });
    expect(note).toHaveTextContent('Is this business a law firm or an accounting office?');
    expect(within(note).getByRole('link').getAttribute('href')).toContain('utm_content=business-profile');
  });

  it('not on another profile, and not once retired', () => {
    useMalafatPortalMoments.getState().markBusinessCreated('b');
    wrap(me([business('a'), business('b')]), business('a'), <MalafatCreatedNote />);
    expect(screen.queryByRole('group')).toBeNull();
    document.body.innerHTML = '';
    useMalafatPortalMoments.getState().markBusinessCreated('a');
    const retired = me([business('a')]);
    retired.user.malafatSuggestions = { off: false, dismissed: ['business-profile', 'second-business'] };
    wrap(retired, business('a'), <MalafatCreatedNote />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it("survives React's StrictMode double mount, consumes the mark, and is gone once the page is left", () => {
    useMalafatPortalMoments.getState().markBusinessCreated('a');
    const queryClient = new QueryClient();
    const account = me([business('a')]);
    queryClient.setQueryData(ME_KEY, account);
    const page = (note: boolean) => (
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <HostedLanguageProvider>
            <MeProvider me={account}>
              <ProfileProvider profile={business('a')}>{note ? <MalafatCreatedNote /> : null}</ProfileProvider>
            </MeProvider>
          </HostedLanguageProvider>
        </QueryClientProvider>
      </StrictMode>
    );
    const view = render(page(true));
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(useMalafatPortalMoments.getState().businessCreatedId).toBeNull();
    view.rerender(page(false));
    view.rerender(page(true));
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('the portal moment store', () => {
  it('forgets everything on reset (sign-out)', () => {
    const store = useMalafatPortalMoments.getState();
    store.markBusinessCreated('a');
    store.markClientsRetired();
    store.reset();
    expect(useMalafatPortalMoments.getState()).toMatchObject({ businessCreatedId: null, clientsRetiredThisVisit: false });
  });
});
