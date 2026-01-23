/**
 * Hook for managing device pairing sessions
 *
 * Handles starting/stopping pairing sessions and polling for status updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSyncStore } from '../sync/stores/syncStore';
import { isTauri } from '../lib/platform';

// ============================================================================
// Types
// ============================================================================

export interface PairingSession {
  pairingId: string;
  code: string;
  expiresAt: string;
  hostCandidates: string[];
  port: number;
  qrPayload: string;
}

export type PairingStatus = 'pending' | 'verified' | 'expired' | 'failed';

export interface PairingStatusResponse {
  pairingId: string;
  status: PairingStatus;
  remainingSeconds: number;
  attemptsRemaining: number;
}

// ============================================================================
// Constants
// ============================================================================

const POLL_INTERVAL_MS = 2000;
// Cache the isTauri check at module load time
const IS_TAURI = isTauri();

// ============================================================================
// Hook
// ============================================================================

export function usePairingSession() {
  const [session, setSession] = useState<PairingSession | null>(null);
  const [status, setStatus] = useState<PairingStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<number | null>(null);
  const { refreshTrustedPeers } = useSyncStore();

  // Start a new pairing session
  const startSession = useCallback(async () => {
    if (!IS_TAURI) {
      setError('Pairing is only available in the desktop app');
      return;
    }

    setIsLoading(true);
    setError(null);
    setStatus(null);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<PairingSession>('start_pairing_session');
      setSession(result);
      startPolling(result.pairingId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Cancel the current session
  const cancelSession = useCallback(async () => {
    stopPolling();

    if (session && IS_TAURI) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('cancel_pairing_session', { pairingId: session.pairingId });
      } catch (err) {
        console.error('Failed to cancel pairing session:', err);
      }
    }

    setSession(null);
    setStatus(null);
    setError(null);
  }, [session]);

  // Regenerate (cancel + start new)
  const regenerateSession = useCallback(async () => {
    await cancelSession();
    await startSession();
  }, [cancelSession, startSession]);

  // Start polling for status updates
  const startPolling = useCallback((pairingId: string) => {
    stopPolling();

    const poll = async () => {
      if (!IS_TAURI) return;

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const statusResult = await invoke<PairingStatusResponse>('get_pairing_status', {
          pairingId,
        });

        setStatus(statusResult);

        // Stop polling if session is no longer pending
        if (statusResult.status !== 'pending') {
          stopPolling();

          if (statusResult.status === 'verified') {
            // Refresh trusted peers on successful pairing
            await refreshTrustedPeers();
          }
        }
      } catch (err) {
        // Session might have expired or been cancelled
        console.error('Status poll failed:', err);
        stopPolling();
        setStatus((prev) =>
          prev ? { ...prev, status: 'expired' as PairingStatus } : null
        );
      }
    };

    // Poll immediately, then at interval
    poll();
    pollIntervalRef.current = window.setInterval(poll, POLL_INTERVAL_MS);
  }, [refreshTrustedPeers]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Derived state
  const isExpired = status?.status === 'expired';
  const isVerified = status?.status === 'verified';
  const isFailed = status?.status === 'failed';
  const isPending = status?.status === 'pending' || (!status && session !== null);

  return {
    // State
    session,
    status,
    isLoading,
    error,

    // Derived state
    isExpired,
    isVerified,
    isFailed,
    isPending,

    // Actions
    startSession,
    cancelSession,
    regenerateSession,
  };
}

/**
 * Format a 6-digit code with a space in the middle: "123456" -> "123 456"
 */
export function formatPairingCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * Calculate remaining time from ISO timestamp
 */
export function useCountdown(expiresAt: string | undefined): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }

    const updateRemaining = () => {
      const expiry = new Date(expiresAt).getTime();
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiry - now) / 1000));
      setRemaining(diff);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

/**
 * Format seconds as MM:SS
 */
export function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
