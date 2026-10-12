import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useProfileStore } from '../profileStore';

/**
 * The profile store (MUT-89, ADR-051): a working business (always a concrete
 * id), the "All businesses" lens the user chose for Home and Clients, and
 * whether the screen is one of those two. Picking a business turns the lens
 * off; a background repair of the working business keeps it (D5).
 */

const state = () => useProfileStore.getState();
const options = () => useProfileStore.persist.getOptions();

describe('profileStore', () => {
  beforeEach(() => {
    act(() => {
      state().reset();
      state().setOnOwedScreen(false);
    });
  });

  it('starts with no working business, the lens off and no owed screen', () => {
    expect(state().activeProfileId).toBe('');
    expect(state().allBusinesses).toBe(false);
    expect(state().onOwedScreen).toBe(false);
  });

  describe('setActiveProfile: picking a business', () => {
    it('sets the working business', () => {
      act(() => state().setActiveProfile('profile-123'));
      expect(state().activeProfileId).toBe('profile-123');
    });

    it('turns All businesses off', () => {
      act(() => state().setAllBusinesses(true));
      act(() => state().setActiveProfile('profile-2'));
      expect(state().allBusinesses).toBe(false);
      expect(state().activeProfileId).toBe('profile-2');
    });
  });

  describe('setWorkingProfile: changing the working business without a pick', () => {
    it('keeps All businesses on (D5)', () => {
      act(() => state().setAllBusinesses(true));
      act(() => state().setWorkingProfile('profile-2'));
      expect(state().activeProfileId).toBe('profile-2');
      expect(state().allBusinesses).toBe(true);
    });
  });

  describe('setAllBusinesses (D6)', () => {
    it('turns the lens on and off without touching the working business', () => {
      act(() => state().setActiveProfile('profile-1'));
      act(() => state().setAllBusinesses(true));
      expect(state().allBusinesses).toBe(true);
      expect(state().activeProfileId).toBe('profile-1');

      act(() => state().setAllBusinesses(false));
      expect(state().allBusinesses).toBe(false);
      expect(state().activeProfileId).toBe('profile-1');
    });
  });

  it('reset clears the working business and the lens', () => {
    act(() => {
      state().setActiveProfile('profile-123');
      state().setAllBusinesses(true);
    });
    act(() => state().reset());
    expect(state().activeProfileId).toBe('');
    expect(state().allBusinesses).toBe(false);
  });

  describe('persistence', () => {
    it('is stored under the same key, at version 1', () => {
      expect(options().name).toBe('mutaba3a-active-profile');
      expect(options().version).toBe(1);
    });

    it('keeps the working business and the lens, never the screen flag', () => {
      act(() => {
        state().setActiveProfile('profile-1');
        state().setAllBusinesses(true);
        state().setOnOwedScreen(true);
      });
      const persisted = options().partialize!(state());
      expect(persisted).toEqual({ activeProfileId: 'profile-1', allBusinesses: true });
    });

    it('migrates a stored legacy "all" to the lens on, with the working business left to resolve', () => {
      const migrated = options().migrate!({ activeProfileId: 'all' }, 0);
      expect(migrated).toEqual({ activeProfileId: '', allBusinesses: true });
    });

    it('migrates a stored business id as that working business, lens off', () => {
      const migrated = options().migrate!({ activeProfileId: 'profile-7' }, 0);
      expect(migrated).toEqual({ activeProfileId: 'profile-7', allBusinesses: false });
    });
  });
});
