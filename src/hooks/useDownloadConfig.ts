import { useState, useEffect } from 'react';
import type { DownloadConfig } from '../content/download-config';
import { FALLBACK_DOWNLOAD_CONFIG } from '../content/download-config';

const CONFIG_URL = import.meta.env.VITE_DOWNLOAD_CONFIG_URL;
const CACHE_KEY = 'download-config';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

interface CachedConfig {
  config: DownloadConfig;
  timestamp: number;
}

export interface UseDownloadConfigResult {
  config: DownloadConfig;
  isLoading: boolean;
  error: string | null;
}

function getCachedConfig(): DownloadConfig | null {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const parsed: CachedConfig = JSON.parse(cached);
    const isExpired = Date.now() - parsed.timestamp > CACHE_DURATION_MS;

    if (isExpired) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }

    return parsed.config;
  } catch {
    return null;
  }
}

function setCachedConfig(config: DownloadConfig): void {
  const cached: CachedConfig = {
    config,
    timestamp: Date.now(),
  };
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(cached));
}

export async function fetchDownloadConfig(): Promise<DownloadConfig> {
  if (!CONFIG_URL) {
    throw new Error('VITE_DOWNLOAD_CONFIG_URL not configured');
  }

  const response = await fetch(CONFIG_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch config: ${response.status}`);
  }

  const data = await response.json();

  // Validate required fields
  if (!data.fallbackVersion || !data.mac || !data.windows) {
    throw new Error('Invalid config structure');
  }

  return data as DownloadConfig;
}

export function useDownloadConfig(): UseDownloadConfigResult {
  const [state, setState] = useState<UseDownloadConfigResult>({
    config: FALLBACK_DOWNLOAD_CONFIG,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const loadConfig = async () => {
      // Check cache first
      const cached = getCachedConfig();
      if (cached) {
        setState({
          config: cached,
          isLoading: false,
          error: null,
        });
        return;
      }

      try {
        const config = await fetchDownloadConfig();

        // Cache the result
        setCachedConfig(config);

        setState({
          config,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        // Fall back to local config on error
        setState({
          config: FALLBACK_DOWNLOAD_CONFIG,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    };

    loadConfig();
  }, []);

  return state;
}
