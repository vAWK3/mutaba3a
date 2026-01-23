/**
 * Demo Mode Zustand Store
 *
 * Manages demo mode state including activation, time freezing for screenshots,
 * and seeding status.
 */

import { create } from 'zustand';
import type { DemoModeState, SeedingStatus } from './types';
import { DEMO_STATE_KEY, DEFAULT_FROZEN_TIME } from './constants';

interface DemoStore {
  // State
  isActive: boolean;
  seededAt: string | null;
  frozenTime: string | null;
  showConfirmModal: boolean;
  seedingStatus: SeedingStatus;
  seedingError: string | null;

  // Actions
  setShowConfirmModal: (show: boolean) => void;
  activateDemo: (seededAt?: string) => void;
  deactivateDemo: () => void;
  freezeTime: (isoDate?: string) => void;
  unfreezeTime: () => void;
  setSeedingStatus: (status: SeedingStatus, error?: string) => void;

  // Time utilities
  getNow: () => Date;
  getToday: () => string;

  // Persistence
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

export const useDemoStore = create<DemoStore>((set, get) => ({
  // Initial state
  isActive: false,
  seededAt: null,
  frozenTime: null,
  showConfirmModal: false,
  seedingStatus: 'idle',
  seedingError: null,

  // Actions
  setShowConfirmModal: (show) => set({ showConfirmModal: show }),

  activateDemo: (seededAt) => {
    const timestamp = seededAt || new Date().toISOString();
    set({
      isActive: true,
      seededAt: timestamp,
      showConfirmModal: false,
      seedingStatus: 'success',
    });
    get().saveToStorage();
  },

  deactivateDemo: () => {
    set({
      isActive: false,
      seededAt: null,
      frozenTime: null,
      seedingStatus: 'idle',
      seedingError: null,
    });
    get().saveToStorage();
  },

  freezeTime: (isoDate) => {
    const time = isoDate || DEFAULT_FROZEN_TIME;
    set({ frozenTime: time });
    get().saveToStorage();
  },

  unfreezeTime: () => {
    set({ frozenTime: null });
    get().saveToStorage();
  },

  setSeedingStatus: (status, error) => {
    set({
      seedingStatus: status,
      seedingError: error || null,
    });
  },

  // Time utilities - use frozen time if set, otherwise real time
  getNow: () => {
    const { frozenTime } = get();
    return frozenTime ? new Date(frozenTime) : new Date();
  },

  getToday: () => {
    return get().getNow().toISOString().split('T')[0];
  },

  // Persistence
  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(DEMO_STATE_KEY);
      if (stored) {
        const state: DemoModeState = JSON.parse(stored);
        set({
          isActive: state.isActive,
          seededAt: state.seededAt || null,
          frozenTime: state.frozenTime || null,
        });
      }
    } catch (error) {
      console.error('Failed to load demo state from storage:', error);
    }
  },

  saveToStorage: () => {
    try {
      const { isActive, seededAt, frozenTime } = get();
      const state: DemoModeState = {
        isActive,
        seededAt: seededAt || undefined,
        frozenTime: frozenTime || undefined,
      };
      localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save demo state to storage:', error);
    }
  },
}));

// Initialize from storage when module loads
if (typeof window !== 'undefined') {
  useDemoStore.getState().loadFromStorage();
}
