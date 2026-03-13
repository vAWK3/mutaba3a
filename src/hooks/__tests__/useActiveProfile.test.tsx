import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useActiveProfile, useProfileFilter } from '../useActiveProfile';
import * as profileStore from '../../lib/profileStore';
import * as useQueries from '../useQueries';
import type { BusinessProfile } from '../../types';

// Mock the profile store
vi.mock('../../lib/profileStore', () => ({
  useProfileStore: vi.fn(),
}));

// Mock useQueries hooks
vi.mock('../useQueries', () => ({
  useBusinessProfiles: vi.fn(),
  useDefaultBusinessProfile: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

const mockProfile1: BusinessProfile = {
  id: 'profile-1',
  name: 'Test Business 1',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockProfile2: BusinessProfile = {
  id: 'profile-2',
  name: 'Test Business 2',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('useActiveProfile', () => {
  const mockSetActiveProfile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeProfileId: '',
      setActiveProfile: mockSetActiveProfile,
    });
    (useQueries.useBusinessProfiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [mockProfile1],
      isLoading: false,
    });
    (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockProfile1,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('single profile scenarios', () => {
    it('should return single profile as active when only one exists', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeProfile).toEqual(mockProfile1);
      expect(result.current.activeProfileId).toBe('profile-1');
      expect(result.current.isAllProfiles).toBe(false);
      expect(result.current.showAllProfilesOption).toBe(false);
    });

    it('should return profiles list', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.profiles).toHaveLength(1);
      });

      expect(result.current.profiles[0]).toEqual(mockProfile1);
    });
  });

  describe('multiple profile scenarios', () => {
    beforeEach(() => {
      (useQueries.useBusinessProfiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: [mockProfile1, mockProfile2],
        isLoading: false,
      });
    });

    it('should show all profiles option when 2+ profiles exist', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.showAllProfilesOption).toBe(true);
      });
    });

    it('should support "all" mode when multiple profiles exist', async () => {
      (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        activeProfileId: 'all',
        setActiveProfile: mockSetActiveProfile,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isAllProfiles).toBe(true);
      });

      expect(result.current.activeProfileId).toBe('all');
      expect(result.current.activeProfile).toBeUndefined();
    });

    it('should return specific profile when selected', async () => {
      (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        activeProfileId: 'profile-2',
        setActiveProfile: mockSetActiveProfile,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.activeProfile).toEqual(mockProfile2);
      });
    });

    it('should allow setting active profile', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setActiveProfile('profile-2');
      });

      expect(mockSetActiveProfile).toHaveBeenCalledWith('profile-2');
    });

    it('should allow setting to all mode', async () => {
      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setActiveProfile('all');
      });

      expect(mockSetActiveProfile).toHaveBeenCalledWith('all');
    });

    it('should not set invalid profile ID via handleSetActiveProfile', async () => {
      // Clear any previous calls from auto-correction
      mockSetActiveProfile.mockClear();

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Clear calls after waiting for loading (auto-correction may have called it)
      mockSetActiveProfile.mockClear();

      act(() => {
        result.current.setActiveProfile('invalid-id');
      });

      // When an invalid ID is passed to handleSetActiveProfile, it should not call the store
      expect(mockSetActiveProfile).not.toHaveBeenCalledWith('invalid-id');
    });
  });

  describe('fallback scenarios', () => {
    it('should fallback to default profile when stored ID is invalid', async () => {
      (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        activeProfileId: 'non-existent-id',
        setActiveProfile: mockSetActiveProfile,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.activeProfileId).toBe('profile-1');
      });
    });

    it('should fallback to first profile when default is not set', async () => {
      (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.activeProfileId).toBe('profile-1');
      });
    });

    it('should return empty string when no profiles exist', async () => {
      (useQueries.useBusinessProfiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: [],
        isLoading: false,
      });
      (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: undefined,
        isLoading: false,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.activeProfileId).toBe('');
    });

    it('should fallback to single profile when all is set but only one profile', async () => {
      (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        activeProfileId: 'all',
        setActiveProfile: mockSetActiveProfile,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // With only 1 profile, 'all' should fallback to that profile
      expect(result.current.isAllProfiles).toBe(false);
      expect(result.current.activeProfileId).toBe('profile-1');
    });
  });

  describe('loading states', () => {
    it('should indicate loading when profiles are loading', () => {
      (useQueries.useBusinessProfiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: [],
        isLoading: true,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should indicate loading when default profile is loading', () => {
      (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      const { result } = renderHook(() => useActiveProfile(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });
  });
});

describe('useProfileFilter', () => {
  const mockSetActiveProfile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeProfileId: 'profile-1',
      setActiveProfile: mockSetActiveProfile,
    });
    (useQueries.useBusinessProfiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [mockProfile1, mockProfile2],
      isLoading: false,
    });
    (useQueries.useDefaultBusinessProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockProfile1,
      isLoading: false,
    });
  });

  it('should return profile ID when specific profile is active', async () => {
    const { result } = renderHook(() => useProfileFilter(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBe('profile-1');
    });
  });

  it('should return undefined when in all profiles mode', async () => {
    (profileStore.useProfileStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeProfileId: 'all',
      setActiveProfile: mockSetActiveProfile,
    });

    const { result } = renderHook(() => useProfileFilter(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toBeUndefined();
    });
  });
});
