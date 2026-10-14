import { useState, useEffect } from 'react';

const GITHUB_API_URL = 'https://api.github.com/repos/vAWK3/mutaba3a/releases/latest';
const CACHE_KEY = 'latest-release-info';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
/** A stalled GitHub call gives up after this, so the shared in-flight request always settles. */
const FETCH_TIMEOUT_MS = 10_000;

interface CachedRelease {
  version: string;
  releaseNotesUrl: string;
  hasMacBuild: boolean;
  hasWindowsBuild: boolean;
  timestamp: number;
}

export interface ReleaseInfo {
  version: string;
  releaseNotesUrl: string;
  hasMacBuild: boolean;
  hasWindowsBuild: boolean;
}

interface UseLatestReleaseResult {
  release: ReleaseInfo | null;
  isLoading: boolean;
  error: string | null;
}

function getCachedRelease(): CachedRelease | null {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const parsed: CachedRelease = JSON.parse(cached);
    const isExpired = Date.now() - parsed.timestamp > CACHE_DURATION_MS;

    if (isExpired) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function setCachedRelease(release: ReleaseInfo): void {
  const cached: CachedRelease = {
    ...release,
    timestamp: Date.now(),
  };
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Storage full or blocked: the release is still good, only the cache is lost.
  }
}

/** The GitHub call already on its way, shared by every caller that asks before it settles. */
let inFlight: Promise<ReleaseInfo> | null = null;

/**
 * The latest release, one GitHub call per burst of callers: the landing hero,
 * its header button and Get it all ask on first paint, and GitHub allows 60
 * unauthenticated calls an hour per IP (MUT-77). Cleared once it settles, so a
 * failure can be retried and a later check asks again; a stalled call times
 * out, so it always settles.
 */
export function fetchLatestRelease(): Promise<ReleaseInfo> {
  inFlight ??= requestLatestRelease().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function requestLatestRelease(): Promise<ReleaseInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await readLatestRelease(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function readLatestRelease(signal: AbortSignal): Promise<ReleaseInfo> {
  const response = await fetch(GITHUB_API_URL, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }

  const data = await response.json();
  const tagName = data.tag_name as string;
  const htmlUrl = data.html_url as string;
  const assets = (data.assets || []) as Array<{ name: string }>;

  // Strip 'v' prefix if present
  const version = tagName.startsWith('v') ? tagName.slice(1) : tagName;

  // Check which platform builds exist based on asset names
  const hasMacBuild = assets.some(
    (a) => a.name.includes('macos') || a.name.endsWith('.dmg')
  );
  const hasWindowsBuild = assets.some(
    (a) => a.name.includes('windows') || a.name.endsWith('.msi') || a.name.endsWith('.exe')
  );

  return { version, releaseNotesUrl: htmlUrl, hasMacBuild, hasWindowsBuild };
}

export function useLatestRelease(): UseLatestReleaseResult {
  const [state, setState] = useState<UseLatestReleaseResult>({
    release: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    const loadRelease = async () => {
      // Check cache first
      const cached = getCachedRelease();
      if (cached) {
        setState({
          release: {
            version: cached.version,
            releaseNotesUrl: cached.releaseNotesUrl,
            hasMacBuild: cached.hasMacBuild,
            hasWindowsBuild: cached.hasWindowsBuild,
          },
          isLoading: false,
          error: null,
        });
        return;
      }

      try {
        const release = await fetchLatestRelease();

        // Cache the result
        setCachedRelease(release);

        setState({
          release,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        setState({
          release: null,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    };

    loadRelease();
  }, []);

  return state;
}
