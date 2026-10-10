import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import { LanguageProvider } from '../../../lib/i18n';
import type { Settings } from '../../../types';
import { FeatureNoticeBanner } from '../FeatureNoticeBanner';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

function installFakeSettings(initial: Partial<Settings> = {}) {
  let row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = {
    get: vi.fn(async () => ({ ...row })),
    update: vi.fn(async (data: Partial<Settings>) => {
      row = { ...row, ...data, id: 'default' };
    }),
  };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return { settings, read: () => row };
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>{children}</LanguageProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

afterEach(() => {
  resetRepositories();
});

describe('FeatureNoticeBanner', () => {
  it('names the auto-enabled areas, links to Settings, and clears the notice only on dismiss', async () => {
    const fake = installFakeSettings({
      features: { invoices: true, projects: true },
      featureNotice: ['invoices', 'projects'],
    });

    render(<FeatureNoticeBanner />, { wrapper: Wrapper });

    const banner = await screen.findByTestId('feature-notice-banner');
    expect(banner).toHaveTextContent('Invoices and receipts');
    expect(banner).toHaveTextContent('Projects');
    expect(banner).not.toHaveTextContent('{features}');
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getAllByTestId('feature-notice-banner')).toHaveLength(1);

    // Nothing is written until the user dismisses
    expect(fake.settings.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(fake.settings.update).toHaveBeenCalledTimes(1));
    expect(fake.settings.update).toHaveBeenCalledWith({ featureNotice: undefined });
    expect(fake.read().features).toEqual({ invoices: true, projects: true });
    await waitFor(() => expect(screen.queryByTestId('feature-notice-banner')).toBeNull());
  });

  it('renders nothing when there is no notice', async () => {
    const fake = installFakeSettings({ features: { projects: true } });

    render(<FeatureNoticeBanner />, { wrapper: Wrapper });

    await waitFor(() => expect(fake.settings.get).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(screen.queryByTestId('feature-notice-banner')).toBeNull();
    expect(fake.settings.update).not.toHaveBeenCalled();
  });
});
