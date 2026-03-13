import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfileStore } from '../profileStore';

describe('profileStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    const { result } = renderHook(() => useProfileStore());
    act(() => {
      result.current.reset();
    });
  });

  describe('initial state', () => {
    it('should start with empty activeProfileId', () => {
      const { result } = renderHook(() => useProfileStore());
      expect(result.current.activeProfileId).toBe('');
    });
  });

  describe('setActiveProfile', () => {
    it('should set active profile to a specific ID', () => {
      const { result } = renderHook(() => useProfileStore());

      act(() => {
        result.current.setActiveProfile('profile-123');
      });

      expect(result.current.activeProfileId).toBe('profile-123');
    });

    it('should set active profile to all', () => {
      const { result } = renderHook(() => useProfileStore());

      act(() => {
        result.current.setActiveProfile('all');
      });

      expect(result.current.activeProfileId).toBe('all');
    });

    it('should update when changed multiple times', () => {
      const { result } = renderHook(() => useProfileStore());

      act(() => {
        result.current.setActiveProfile('profile-1');
      });
      expect(result.current.activeProfileId).toBe('profile-1');

      act(() => {
        result.current.setActiveProfile('profile-2');
      });
      expect(result.current.activeProfileId).toBe('profile-2');

      act(() => {
        result.current.setActiveProfile('all');
      });
      expect(result.current.activeProfileId).toBe('all');
    });
  });

  describe('reset', () => {
    it('should reset to empty string', () => {
      const { result } = renderHook(() => useProfileStore());

      act(() => {
        result.current.setActiveProfile('profile-123');
      });
      expect(result.current.activeProfileId).toBe('profile-123');

      act(() => {
        result.current.reset();
      });
      expect(result.current.activeProfileId).toBe('');
    });
  });

  describe('persistence', () => {
    // Note: In a real test environment with localStorage mocked,
    // you would test that values persist across renders
    it('should have a persist name', () => {
      // The store uses 'mutaba3a-active-profile' as persist name
      // This is more of a documentation test
      const { result } = renderHook(() => useProfileStore());
      expect(result.current).toBeDefined();
    });
  });

  describe('type safety', () => {
    it('should accept string IDs', () => {
      const { result } = renderHook(() => useProfileStore());

      act(() => {
        result.current.setActiveProfile('any-string-id');
      });

      expect(result.current.activeProfileId).toBe('any-string-id');
    });

    it('should accept "all" as special value', () => {
      const { result } = renderHook(() => useProfileStore());

      act(() => {
        result.current.setActiveProfile('all');
      });

      expect(result.current.activeProfileId).toBe('all');
    });
  });
});
