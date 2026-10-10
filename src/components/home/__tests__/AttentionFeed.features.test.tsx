/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AttentionFeed } from '../AttentionFeed';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({ openIncomeDrawer: vi.fn() }),
}));

vi.mock('../../../lib/monthDetection', () => ({
  getCurrentMonthKey: () => '2026-10',
}));

vi.mock('../../../hooks/useActiveProfile', () => ({
  useProfileFilter: () => 'profile-1',
}));

const useGuidance = vi.fn(() => ({ data: [], isLoading: false }));
vi.mock('../../../hooks/useMoneyEventQueries', () => ({
  useGuidance: (filters: unknown) => useGuidance(filters),
}));

let retainersOn = false;
vi.mock('../../../lib/features/useFeatures', () => ({
  useFeatureEnabled: (key: string) => (key === 'retainers' ? retainersOn : false),
}));

function renderFeed() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttentionFeed />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useGuidance.mockClear();
});

describe('AttentionFeed and the Retainers area (MUT-13)', () => {
  it('asks guidance to leave projected retainer items out while retainers is off', () => {
    retainersOn = false;
    renderFeed();
    const calls = useGuidance.mock.calls as unknown as [{ includeProjectedRetainer: boolean; currency: string }][];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [filters] of calls) {
      expect(filters.includeProjectedRetainer).toBe(false);
    }
  });

  it('includes projected retainer items while retainers is on', () => {
    retainersOn = true;
    renderFeed();
    const calls = useGuidance.mock.calls as unknown as [{ includeProjectedRetainer: boolean }][];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [filters] of calls) {
      expect(filters.includeProjectedRetainer).toBe(true);
    }
  });
});
