import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useProfileAwareAction } from '../useProfileAwareAction';
import * as useActiveProfileModule from '../useActiveProfile';
import type { BusinessProfile } from '../../types';

// Mock useActiveProfile hook
vi.mock('../useActiveProfile', () => ({
  useActiveProfile: vi.fn(),
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

describe('useProfileAwareAction', () => {
  const mockOnExecute = vi.fn();
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('single profile', () => {
    beforeEach(() => {
      (useActiveProfileModule.useActiveProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        isAllProfiles: false,
        activeProfileId: 'profile-1',
        profiles: [mockProfile1],
      });
    });

    it('should execute immediately with single profile', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const mockEvent = {
        currentTarget: document.createElement('button'),
      } as React.MouseEvent<HTMLElement>;

      act(() => {
        result.current.trigger(mockEvent);
      });

      expect(mockOnExecute).toHaveBeenCalledWith('profile-1');
      expect(result.current.isPickerOpen).toBe(false);
    });
  });

  describe('multiple profiles with specific one active', () => {
    beforeEach(() => {
      (useActiveProfileModule.useActiveProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        isAllProfiles: false,
        activeProfileId: 'profile-2',
        profiles: [mockProfile1, mockProfile2],
      });
    });

    it('should execute immediately with active profile', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const mockEvent = {
        currentTarget: document.createElement('button'),
      } as React.MouseEvent<HTMLElement>;

      act(() => {
        result.current.trigger(mockEvent);
      });

      expect(mockOnExecute).toHaveBeenCalledWith('profile-2');
      expect(result.current.isPickerOpen).toBe(false);
    });
  });

  describe('all profiles mode', () => {
    beforeEach(() => {
      (useActiveProfileModule.useActiveProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        isAllProfiles: true,
        activeProfileId: 'all',
        profiles: [mockProfile1, mockProfile2],
      });
    });

    it('should open picker instead of executing', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const mockButton = document.createElement('button');
      const mockEvent = {
        currentTarget: mockButton,
      } as React.MouseEvent<HTMLElement>;

      act(() => {
        result.current.trigger(mockEvent);
      });

      expect(mockOnExecute).not.toHaveBeenCalled();
      expect(result.current.isPickerOpen).toBe(true);
      expect(result.current.pickerProps.anchor).toBe(mockButton);
    });

    it('should provide profiles to picker', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      expect(result.current.pickerProps.profiles).toEqual([mockProfile1, mockProfile2]);
    });

    it('should execute with selected profile and close picker', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const mockEvent = {
        currentTarget: document.createElement('button'),
      } as React.MouseEvent<HTMLElement>;

      act(() => {
        result.current.trigger(mockEvent);
      });

      expect(result.current.isPickerOpen).toBe(true);

      act(() => {
        result.current.pickerProps.onSelect(mockProfile2);
      });

      expect(mockOnExecute).toHaveBeenCalledWith('profile-2');
      expect(result.current.isPickerOpen).toBe(false);
      expect(result.current.pickerProps.anchor).toBeNull();
    });

    it('should close picker without executing on close', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const mockEvent = {
        currentTarget: document.createElement('button'),
      } as React.MouseEvent<HTMLElement>;

      act(() => {
        result.current.trigger(mockEvent);
      });

      expect(result.current.isPickerOpen).toBe(true);

      act(() => {
        result.current.pickerProps.onClose();
      });

      expect(mockOnExecute).not.toHaveBeenCalled();
      expect(result.current.isPickerOpen).toBe(false);
    });
  });

  describe('no profiles', () => {
    beforeEach(() => {
      (useActiveProfileModule.useActiveProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        isAllProfiles: false,
        activeProfileId: '',
        profiles: [],
      });
    });

    it('should warn and not execute when no profiles', () => {
      const { result } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const mockEvent = {
        currentTarget: document.createElement('button'),
      } as React.MouseEvent<HTMLElement>;

      act(() => {
        result.current.trigger(mockEvent);
      });

      expect(consoleSpy).toHaveBeenCalledWith('useProfileAwareAction: No profiles available');
      expect(mockOnExecute).not.toHaveBeenCalled();
      expect(result.current.isPickerOpen).toBe(false);
    });
  });

  describe('picker props stability', () => {
    beforeEach(() => {
      (useActiveProfileModule.useActiveProfile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        isAllProfiles: true,
        activeProfileId: 'all',
        profiles: [mockProfile1, mockProfile2],
      });
    });

    it('should have stable onSelect callback', () => {
      const { result, rerender } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const firstOnSelect = result.current.pickerProps.onSelect;

      rerender();

      expect(result.current.pickerProps.onSelect).toBe(firstOnSelect);
    });

    it('should have stable onClose callback', () => {
      const { result, rerender } = renderHook(
        () => useProfileAwareAction({ onExecute: mockOnExecute }),
        { wrapper: createWrapper() }
      );

      const firstOnClose = result.current.pickerProps.onClose;

      rerender();

      expect(result.current.pickerProps.onClose).toBe(firstOnClose);
    });
  });
});
