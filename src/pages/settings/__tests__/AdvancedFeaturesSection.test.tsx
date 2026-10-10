import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import { LanguageProvider } from '../../../lib/i18n';
import { FEATURE_KEYS, DEFAULT_FEATURES } from '../../../lib/features/features';
import type { Settings } from '../../../types';
import { AdvancedFeaturesSection } from '../AdvancedFeaturesSection';
import en from '../../../lib/i18n/translations/en.json';

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  resetRepositories();
});

const labels = en.settings.features.items as Record<string, { label: string; description: string }>;

describe('AdvancedFeaturesSection', () => {
  it('renders one switch per feature, in order, all off by default', async () => {
    installFakeSettings();
    render(<AdvancedFeaturesSection />, { wrapper: Wrapper });

    expect(screen.getByText(en.settings.features.title)).toBeInTheDocument();
    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(FEATURE_KEYS.length);
    FEATURE_KEYS.forEach((key, index) => {
      expect(switches[index]).toHaveAccessibleName(labels[key].label);
      expect(switches[index]).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText(labels[key].description)).toBeInTheDocument();
    });
  });

  it('reflects stored flags', async () => {
    installFakeSettings({ features: { projects: true } });
    render(<AdvancedFeaturesSection />, { wrapper: Wrapper });

    const projects = await screen.findByRole('switch', { name: labels.projects.label });
    await waitFor(() => expect(projects).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('switch', { name: labels.expenses.label })).toHaveAttribute('aria-checked', 'false');
  });

  it('turns an area on and the switch reflects it without a reload', async () => {
    const fake = installFakeSettings();
    render(<AdvancedFeaturesSection />, { wrapper: Wrapper });

    const projects = await screen.findByRole('switch', { name: labels.projects.label });
    fireEvent.click(projects);

    await waitFor(() =>
      expect(fake.settings.update).toHaveBeenCalledWith({
        features: { ...DEFAULT_FEATURES, projects: true },
      }),
    );
    await waitFor(() => expect(projects).toHaveAttribute('aria-checked', 'true'));
    expect(fake.read().enabledCurrencies).toEqual(DEFAULT_SETTINGS.enabledCurrencies);
  });

  it('turns an area off again', async () => {
    const fake = installFakeSettings({ features: { ...DEFAULT_FEATURES, expenses: true, projects: true } });
    render(<AdvancedFeaturesSection />, { wrapper: Wrapper });

    const expenses = await screen.findByRole('switch', { name: labels.expenses.label });
    await waitFor(() => expect(expenses).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(expenses);

    await waitFor(() => expect(expenses).toHaveAttribute('aria-checked', 'false'));
    expect(fake.read().features).toEqual({ ...DEFAULT_FEATURES, projects: true });
  });
});
