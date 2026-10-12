/**
 * @vitest-environment jsdom
 *
 * MUT-89 (ADR-051): the switcher offers "All businesses" on Home and Clients
 * only, with two or more businesses (AC1, O2). Picking it turns the lens on;
 * picking a business works in it and turns the lens off. Elsewhere the
 * switcher shows the working business, whatever was chosen for Home (O1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileSwitcher } from '../ProfileSwitcher';
import * as useQueries from '../../../hooks/useQueries';
import { useProfileStore } from '../../../lib/profileStore';
import type { BusinessProfile } from '../../../types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('../../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'profileSwitcher.allProfiles': 'All businesses',
    'profileSwitcher.manageProfiles': 'Manage businesses',
    'profileSwitcher.setUpBusiness': 'Set up business',
  };
  return { useT: () => (key: string) => translations[key] ?? key };
});

const STAMP = '2026-01-01T00:00:00Z';
const studio: BusinessProfile = { id: 'p1', name: 'Studio', isDefault: true, createdAt: STAMP, updatedAt: STAMP };
const teaching: BusinessProfile = { id: 'p2', name: 'Teaching', createdAt: STAMP, updatedAt: STAMP };

function mockBusinesses(profiles: BusinessProfile[]) {
  vi.spyOn(useQueries, 'useBusinessProfiles').mockReturnValue({ data: profiles, isLoading: false } as unknown as ReturnType<
    typeof useQueries.useBusinessProfiles
  >);
  vi.spyOn(useQueries, 'useDefaultBusinessProfile').mockReturnValue({ data: profiles[0], isLoading: false } as unknown as ReturnType<
    typeof useQueries.useDefaultBusinessProfile
  >);
}

function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileSwitcher />
    </QueryClientProvider>
  );
}

const switcherButton = () => screen.getByRole('button', { expanded: false });
const openSwitcher = () => {
  fireEvent.click(switcherButton());
  return screen.getByRole('listbox');
};
const optionNames = (listbox: HTMLElement) => within(listbox).getAllByRole('option').map((o) => o.textContent);

describe('ProfileSwitcher: All businesses (MUT-89)', () => {
  beforeEach(() => {
    mockBusinesses([studio, teaching]);
    useProfileStore.setState({ activeProfileId: 'p1', allBusinesses: false, onOwedScreen: true });
  });

  afterEach(() => {
    // Unmount before the store and the spies change under a mounted switcher
    cleanup();
    useProfileStore.setState({ activeProfileId: '', allBusinesses: false, onOwedScreen: false });
    vi.restoreAllMocks();
  });

  it('lists All businesses first on Home and Clients when two businesses exist (AC1)', () => {
    renderSwitcher();
    expect(optionNames(openSwitcher())).toEqual(['All businesses', 'SStudio', 'TTeaching']);
  });

  it('does not list it with one business (AC1)', () => {
    mockBusinesses([studio]);
    renderSwitcher();
    expect(optionNames(openSwitcher())).toEqual(['SStudio']);
  });

  it('does not list it away from Home and Clients (O2)', () => {
    useProfileStore.setState({ onOwedScreen: false });
    renderSwitcher();
    expect(optionNames(openSwitcher())).toEqual(['SStudio', 'TTeaching']);
  });

  it('turns All businesses on, and then says so on the switcher', () => {
    renderSwitcher();
    fireEvent.click(within(openSwitcher()).getByRole('option', { name: 'All businesses' }));

    expect(useProfileStore.getState().allBusinesses).toBe(true);
    expect(switcherButton()).toHaveTextContent('All businesses');
    const listbox = openSwitcher();
    expect(within(listbox).getByRole('option', { name: 'All businesses' })).toHaveAttribute('aria-selected', 'true');
    expect(within(listbox).getByRole('option', { name: /Studio/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('works in a business once it is picked, turning All businesses off', () => {
    useProfileStore.setState({ allBusinesses: true });
    renderSwitcher();
    fireEvent.click(within(openSwitcher()).getByRole('option', { name: /Teaching/ }));

    expect(useProfileStore.getState()).toMatchObject({ activeProfileId: 'p2', allBusinesses: false });
    expect(switcherButton()).toHaveTextContent('Teaching');
  });

  it('shows the working business away from Home and Clients, even with All chosen (O1)', () => {
    useProfileStore.setState({ allBusinesses: true, onOwedScreen: false });
    renderSwitcher();
    expect(switcherButton()).toHaveTextContent('Studio');
    expect(switcherButton()).not.toHaveTextContent('All businesses');
  });
});
