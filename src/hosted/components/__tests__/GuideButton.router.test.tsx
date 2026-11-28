import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { AccountDrawers } from '../../shell/AccountDrawers';
import { GuideButton } from '../GuideButton';
import { loadGuide } from '../../../content/guides';
import type { Guide } from '../../../content/guides';
import { FIXTURE_GUIDE } from '../../../content/guides/__tests__/fixtures/fixtureGuide';

/**
 * MUT-679 (carried from MUT-674): the button does what the shell does, not what a mock says. Pressing it pushes
 * `?guide=<id>` on top of the page's own search, the drawer opens over the page, and closing it, or Back, leaves the
 * page and its filters as they were.
 */

vi.mock('../../../content/guides', () => ({ isGuideId: (id: string) => id === 'fixture-guide', loadGuide: vi.fn() }));
vi.mock('../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../analytics/portalAnalytics')>()), trackGuide: vi.fn() }));

function mount(path: string) {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  const root = createRootRoute({
    component: () => (
      <>
        <GuideButton guide="fixture-guide" label="How to" />
        <AccountDrawers />
      </>
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: '/', validateSearch: (search: Record<string, unknown>) => search });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree: root.addChildren([index]), history });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <RouterProvider router={router} />
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { router, history };
}

afterEach(() => localStorage.clear());
beforeEach(() => vi.mocked(loadGuide).mockReset().mockResolvedValue(FIXTURE_GUIDE as unknown as Guide));

describe('GuideButton through the real shell (MUT-679)', () => {
  it('pushes ?guide= on top of the page\'s search, opens the drawer, and closing keeps the page\'s search', async () => {
    const { router } = mount('/?status=POSTED');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'How to' }));
    const dialog = await screen.findByRole('dialog', { name: 'A test guide' });
    expect(router.state.location.href).toBe('/?status=POSTED&guide=fixture-guide');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.href).toBe('/?status=POSTED');
  });

  it('Back closes the guide and returns to the page as it was', async () => {
    const { router, history } = mount('/?status=POSTED');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'How to' }));
    await screen.findByRole('dialog', { name: 'A test guide' });
    history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.href).toBe('/?status=POSTED');
  });

  it('after the drawer closes, focus returns to the button that opened it', async () => {
    mount('/');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'How to' });
    await user.click(button);
    await screen.findByRole('dialog', { name: 'A test guide' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
  });
});
