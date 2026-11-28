import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { PortalProviders } from '../../HostedApp';
import { createPortalQueryClient } from '../../queryClient';
import { createPortalRouter } from '../../router';
import { ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { SUPPORT_EMAIL } from '../../terms';
import { trackGuide } from '../../analytics/portalAnalytics';
import { loadGuide } from '../../../content/guides';
import type { Guide } from '../../../content/guides';
import { FIXTURE_GUIDE } from '../../../content/guides/__tests__/fixtures/fixtureGuide';

/**
 * MUT-674: the guide viewer through the real portal (shell, account drawers, query client), /v1 stubbed and the guide
 * registry replaced by one fixture guide. The drawer is a URL key (`?guide=<id>`), so closing it leaves the page.
 */

vi.mock('../../../content/guides', () => ({
  isGuideId: (id: string) => id === 'fixture-guide',
  loadGuide: vi.fn(),
}));
vi.mock('../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../analytics/portalAnalytics')>()), trackGuide: vi.fn() }));

const GUIDE = FIXTURE_GUIDE as unknown as Guide;
const PAGE = `/p/${ORG_B}/payments`;

function stub(locale: 'en' | 'ar' = 'en') {
  const personal = profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null });
  return stubApi({ 'GET /v1/me': () => ok(me([personal], locale)), ...emptyProfileRoutes() });
}

function portal(path: string, locale: 'en' | 'ar' = 'en') {
  stub(locale);
  return renderPortal(path);
}

beforeEach(() => {
  vi.mocked(loadGuide).mockReset().mockResolvedValue(GUIDE);
  vi.mocked(trackGuide).mockReset();
});

describe('the guide drawer (MUT-674)', () => {
  it('opens over the page from the URL key, named by its title, with the lead, the steps in order and the note', async () => {
    const { router } = portal(`${PAGE}?guide=fixture-guide`);
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    expect(locationOf(router)).toBe(`${PAGE}?guide=fixture-guide`);
    expect(within(dialog).getByText('A lead line')).toBeInTheDocument();
    const steps = within(dialog).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['First step', 'Second step']);
    expect(dialog.querySelector('ol')).not.toBeNull();
    expect(steps.map((s) => s.querySelector('[data-scene]')?.getAttribute('data-scene'))).toEqual(['guide-tax-1', 'guide-tax-2']);
    expect(dialog.querySelector('[data-scene="guide-tax-hero"]')).not.toBeNull();
    expect(within(dialog).getByRole('note')).toHaveTextContent('A note');
  });

  it('reads in Arabic, right to left, with the -rtl drawings', async () => {
    portal(`${PAGE}?guide=fixture-guide`, 'ar');
    const dialog = await screen.findByRole('dialog', { name: 'دليل تجريبي' });
    expect(within(dialog).getAllByRole('listitem').map((s) => s.textContent)).toEqual(['الخطوة الأولى', 'الخطوة الثانية']);
    expect(document.documentElement.dir).toBe('rtl');
    const arts = [...dialog.querySelectorAll('[data-scene]')].map((el) => el.getAttribute('data-scene-art'));
    expect(arts).toEqual(['guide-tax-hero-rtl', 'guide-tax-1-rtl', 'guide-tax-2-rtl']);
  });

  it('links to the official source in a new tab, without handing the page over', async () => {
    portal(`${PAGE}?guide=fixture-guide`);
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    const link = within(dialog).getByRole('link', { name: /The official page/ });
    expect(link).toHaveAttribute('href', 'https://example.com/official');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
  });

  it('offers help by mail to the support address', async () => {
    portal(`${PAGE}?guide=fixture-guide`);
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    expect(within(dialog).getByRole('link', { name: 'Need help?' })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });

  it('leaves out the note and the source when the guide has none', async () => {
    const bare: Record<string, unknown> = { ...FIXTURE_GUIDE };
    delete bare.note;
    delete bare.source;
    vi.mocked(loadGuide).mockResolvedValue(bare as unknown as Guide);
    portal(`${PAGE}?guide=fixture-guide`);
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    expect(within(dialog).queryByRole('note')).toBeNull();
    expect(within(dialog).queryByRole('link', { name: /official/i })).toBeNull();
  });

  it('the cross closes it, keeps the page, and counts only the opening', async () => {
    const { user, router } = portal(`${PAGE}?guide=fixture-guide`);
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    await waitFor(() => expect(trackGuide).toHaveBeenCalledWith('guide_opened', 'fixture-guide'));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'A test guide' })).not.toBeInTheDocument());
    expect(locationOf(router)).toBe(PAGE);
    expect(vi.mocked(trackGuide).mock.calls).toEqual([['guide_opened', 'fixture-guide']]);
  });

  it('Escape closes it and counts nothing more', async () => {
    const { user, router } = portal(`${PAGE}?guide=fixture-guide`);
    await screen.findByRole('dialog', { name: 'A test guide' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'A test guide' })).not.toBeInTheDocument());
    expect(locationOf(router)).toBe(PAGE);
    expect(vi.mocked(trackGuide).mock.calls.map((c) => c[0])).toEqual(['guide_opened']);
  });

  it('Done is the footer\'s one primary button: it closes and counts the guide finished', async () => {
    const { user, router } = portal(`${PAGE}?guide=fixture-guide`);
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    await waitFor(() => expect(trackGuide).toHaveBeenCalledWith('guide_opened', 'fixture-guide'));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'A test guide' })).not.toBeInTheDocument());
    expect(locationOf(router)).toBe(PAGE);
    expect(vi.mocked(trackGuide).mock.calls).toEqual([
      ['guide_opened', 'fixture-guide'],
      ['guide_finished', 'fixture-guide'],
    ]);
  });

  it('closes by itself on an id that is not a guide, and says nothing', async () => {
    const { router } = portal(`${PAGE}?guide=no-such-guide`);
    await waitFor(() => expect(locationOf(router)).toBe(PAGE));
    expect(screen.queryByRole('dialog', { name: /guide/i })).not.toBeInTheDocument();
    expect(trackGuide).not.toHaveBeenCalled();
  });

  it('stays open with Retry when the guide cannot be loaded, and loads it on Retry', async () => {
    vi.mocked(loadGuide).mockRejectedValueOnce(new Error('chunk failed'));
    const { user, router } = portal(`${PAGE}?guide=fixture-guide`);
    const alert = await screen.findByRole('alert');
    expect(locationOf(router)).toBe(`${PAGE}?guide=fixture-guide`);
    expect(trackGuide).not.toHaveBeenCalled();
    await user.click(within(alert).getByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByRole('dialog', { name: 'A test guide' })).toBeInTheDocument();
    await waitFor(() => expect(trackGuide).toHaveBeenCalledWith('guide_opened', 'fixture-guide'));
  });

  it('counts one opening under React StrictMode\'s double effect run', async () => {
    stub();
    const queryClient = createPortalQueryClient({ queries: { retry: false }, mutations: { retry: false } });
    const router = createPortalRouter(queryClient, createMemoryHistory({ initialEntries: [`${PAGE}?guide=fixture-guide`] }));
    render(
      <StrictMode>
        <PortalProviders queryClient={queryClient} router={router} />
      </StrictMode>,
    );
    await screen.findByRole('dialog', { name: 'A test guide' });
    await waitFor(() => expect(trackGuide).toHaveBeenCalled());
    expect(vi.mocked(trackGuide).mock.calls.filter((c) => c[0] === 'guide_opened')).toHaveLength(1);
  });
});
