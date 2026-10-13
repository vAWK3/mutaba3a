/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../../lib/theme';
import { SidebarNav } from '../SidebarNav';

/**
 * The sidebar's brand link (MUT-104, R6): what must survive the switch from
 * the PNG app icon to the theme-aware Brand v2 mark.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} className={rest.className as string} aria-label={rest['aria-label'] as string} title={rest.title as string}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('../../../hooks/useCheckForUpdates', () => ({ useCheckForUpdates: () => ({ hasUpdate: false }) }));
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

const brandLink = () => screen.getByRole('link', { name: 'متابعة' });
const mark = () => brandLink().querySelector('img.brand-mark');

afterEach(() => window.localStorage.clear());

describe('SidebarNav brand link (MUT-104)', () => {
  it('goes home and is announced by the product name', () => {
    renderNav();
    expect(brandLink()).toHaveAttribute('href', '/');
  });

  it('shows the decorative mark beside the name when expanded', () => {
    renderNav();
    expect(mark()).toHaveAttribute('alt', '');
    expect(brandLink()).toHaveTextContent('متابعة');
  });

  it('keeps only the mark when collapsed', () => {
    renderNav();
    fireEvent.click(screen.getByRole('button', { name: 'nav.collapse' }));
    expect(brandLink()).not.toHaveTextContent('متابعة');
    expect(mark()).not.toBeNull();
  });
});
