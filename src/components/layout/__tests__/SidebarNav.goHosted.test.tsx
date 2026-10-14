/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../../lib/theme';
import { SidebarNav } from '../SidebarNav';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, title }: { children: ReactNode; to: string; className?: string; title?: string }) => (
    <a href={to} className={className} title={title}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../hooks/useCheckForUpdates', () => ({
  useCheckForUpdates: () => ({ hasUpdate: false }),
}));

vi.mock('../../../hooks/useProfileAwareAction', () => ({
  useProfileAwareAction: () => ({ trigger: vi.fn(), pickerProps: {} }),
}));

vi.mock('../ProfileSwitcher', () => ({ ProfileSwitcher: () => null }));
vi.mock('../../ui/ProfileQuickPicker', () => ({ ProfileQuickPicker: () => null }));

function renderNav() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SidebarNav />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const card = () => screen.queryByRole('group', { name: 'nav.goHosted.label' });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('SidebarNav: Go hosted card (MUT-187)', () => {
  it('shows the card in the web build, after the core four and before Settings', () => {
    vi.stubGlobal('__BUILD_MODE__', 'web');
    renderNav();

    const group = card();
    expect(group).toBeInTheDocument();
    const navLinks = screen.getAllByRole('link').filter((a) => a.classList.contains('nav-item'));
    expect(navLinks.slice(0, 3).map((a) => a.getAttribute('href'))).toEqual(['/', '/clients', '/income']);
    const settings = screen.getByRole('link', { name: 'nav.settings' });
    expect(group!.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const income = screen.getByRole('link', { name: 'nav.income' });
    expect(income.compareDocumentPosition(group!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no card in the desktop build', () => {
    vi.stubGlobal('__BUILD_MODE__', 'desktop');
    renderNav();
    expect(card()).not.toBeInTheDocument();
  });

  it('renders no card while the sidebar is collapsed', () => {
    vi.stubGlobal('__BUILD_MODE__', 'web');
    window.localStorage.setItem('sidebarCollapsed', '1');
    renderNav();
    expect(card()).not.toBeInTheDocument();
  });

  it('moves focus to Settings when the card is dismissed', async () => {
    vi.stubGlobal('__BUILD_MODE__', 'web');
    renderNav();

    fireEvent.click(screen.getByRole('button', { name: 'nav.goHosted.dismiss' }));

    expect(screen.getByRole('link', { name: 'nav.settings' })).toHaveFocus();
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });
});
