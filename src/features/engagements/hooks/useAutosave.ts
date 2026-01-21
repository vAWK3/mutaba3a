import { useEffect, useRef, useCallback } from 'react';
import type { EngagementSnapshot } from '../types';

const AUTOSAVE_KEY = 'engagement_wizard_autosave';
const AUTOSAVE_DEBOUNCE_MS = 2000;

interface AutosaveData {
  engagementId?: string;
  snapshot: Partial<EngagementSnapshot>;
  savedAt: string;
}

/**
 * Hook for autosaving engagement wizard data to localStorage
 */
export function useAutosave(
  engagementId: string | undefined,
  snapshot: Partial<EngagementSnapshot>,
  isDirty: boolean,
  onSaved?: (timestamp: string) => void
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Debounced save to localStorage
  const saveToLocalStorage = useCallback(() => {
    const data: AutosaveData = {
      engagementId,
      snapshot: snapshotRef.current,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    onSaved?.(data.savedAt);
  }, [engagementId, onSaved]);

  // Trigger autosave when snapshot changes and is dirty
  useEffect(() => {
    if (!isDirty) return;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new debounced save
    timeoutRef.current = setTimeout(saveToLocalStorage, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [snapshot, isDirty, saveToLocalStorage]);

  // Cleanup on unmount - save any pending changes
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        // Save immediately on unmount if dirty
        if (isDirty) {
          saveToLocalStorage();
        }
      }
    };
  }, [isDirty, saveToLocalStorage]);

  return {
    saveNow: saveToLocalStorage,
  };
}

/**
 * Load autosaved data from localStorage
 */
export function loadAutosaveData(): AutosaveData | null {
  try {
    const stored = localStorage.getItem(AUTOSAVE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as AutosaveData;
  } catch {
    return null;
  }
}

/**
 * Clear autosaved data from localStorage
 */
export function clearAutosaveData(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}

/**
 * Check if autosaved data exists
 */
export function hasAutosaveData(): boolean {
  return localStorage.getItem(AUTOSAVE_KEY) !== null;
}

/**
 * Check if autosave is recent (within last hour)
 */
export function isAutosaveRecent(): boolean {
  const data = loadAutosaveData();
  if (!data) return false;

  const savedAt = new Date(data.savedAt);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return savedAt > hourAgo;
}
