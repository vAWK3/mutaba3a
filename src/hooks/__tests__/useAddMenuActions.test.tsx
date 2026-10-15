import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAddMenuActions } from '../useAddMenuActions';
import * as useActiveProfileModule from '../useActiveProfile';
import { useDrawerStore } from '../../lib/stores';
import { useProfileStore } from '../../lib/profileStore';
import type { BusinessProfile } from '../../types';

vi.mock('../useActiveProfile', () => ({
  useActiveProfile: vi.fn(),
}));

vi.mock('../../lib/features/useFeatures', () => ({
  useFeatureFlags: () => ({ expenses: true, projects: true, insights: false, conversions: false }),
}));

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

function mockActiveProfile(overrides: Partial<ReturnType<typeof useActiveProfileModule.useActiveProfile>>) {
  (useActiveProfileModule.useActiveProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    isAllProfiles: false,
    activeProfileId: 'profile-1',
    profiles: [mockProfile1],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useDrawerStore.setState({
    incomeDrawer: { isOpen: false, mode: 'create' },
    expenseDrawer: { isOpen: false, mode: 'create' },
    clientDrawer: { isOpen: false, mode: 'create' },
    projectDrawer: { isOpen: false, mode: 'create' },
  });
  useProfileStore.setState({ activeProfileId: '', allBusinesses: false });
});

const clickEvent = () => ({ currentTarget: document.createElement('button') }) as React.MouseEvent<HTMLElement>;

describe('useAddMenuActions', () => {
  describe('single profile', () => {
    beforeEach(() => mockActiveProfile({}));

    it('opens the income drawer in place with no navigation, and sets the working profile', () => {
      const { result } = renderHook(() => useAddMenuActions());

      act(() => result.current.run('income', clickEvent(), null));

      expect(useDrawerStore.getState().incomeDrawer).toMatchObject({
        isOpen: true,
        mode: 'create',
        defaultStatus: 'earned',
        defaultProfileId: 'profile-1',
      });
      expect(useProfileStore.getState().activeProfileId).toBe('profile-1');
    });

    it('opens the expense drawer in place with no navigation, and sets the working profile', () => {
      const { result } = renderHook(() => useAddMenuActions());

      act(() => result.current.run('expense', clickEvent(), null));

      expect(useDrawerStore.getState().expenseDrawer).toMatchObject({
        isOpen: true,
        mode: 'create',
        defaultProfileId: 'profile-1',
      });
      expect(useProfileStore.getState().activeProfileId).toBe('profile-1');
    });

    it('opens the client drawer in place with no navigation, profile-aware (MUT-57)', () => {
      const { result } = renderHook(() => useAddMenuActions());

      act(() => result.current.run('client', clickEvent(), null));

      expect(useDrawerStore.getState().clientDrawer).toMatchObject({
        isOpen: true,
        mode: 'create',
        defaultProfileId: 'profile-1',
      });
    });

    it('opens the project drawer in place with no navigation, profile-aware (MUT-57)', () => {
      const { result } = renderHook(() => useAddMenuActions());

      act(() => result.current.run('project', clickEvent(), null));

      expect(useDrawerStore.getState().projectDrawer).toMatchObject({
        isOpen: true,
        mode: 'create',
        defaultProfileId: 'profile-1',
      });
    });
  });

  describe('all profiles mode', () => {
    beforeEach(() => mockActiveProfile({ isAllProfiles: true, profiles: [mockProfile1, mockProfile2] }));

    it('shows a picker for each of the four actions instead of executing immediately', () => {
      const { result } = renderHook(() => useAddMenuActions());

      act(() => result.current.run('client', clickEvent(), null));
      expect(useDrawerStore.getState().clientDrawer.isOpen).not.toBe(true);
      expect(result.current.pickers.client.isPickerOpen).toBe(true);

      act(() => result.current.run('project', clickEvent(), null));
      expect(useDrawerStore.getState().projectDrawer.isOpen).not.toBe(true);
      expect(result.current.pickers.project.isPickerOpen).toBe(true);
    });

    it('opens the chosen drawer once a profile is picked, for every action', () => {
      const { result } = renderHook(() => useAddMenuActions());

      act(() => result.current.run('project', clickEvent(), null));
      act(() => result.current.pickers.project.pickerProps.onSelect(mockProfile2));

      expect(useDrawerStore.getState().projectDrawer).toMatchObject({
        isOpen: true,
        defaultProfileId: 'profile-2',
      });
    });
  });

  describe('visible actions', () => {
    it('reflects visibleAddMenuActions for the current feature flags', () => {
      mockActiveProfile({});
      const { result } = renderHook(() => useAddMenuActions());
      expect(result.current.actions).toEqual(['income', 'client', 'expense', 'project']);
    });
  });
});
