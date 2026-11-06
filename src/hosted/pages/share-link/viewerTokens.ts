/**
 * MUT-562 (D8): where a share link's viewer token lives, so a returning browser keeps its place among the link's 3
 * devices. Kept in localStorage under the SHA-256 of the link token, never the link token itself: what is stored
 * opens nothing without the link, and the link is never written anywhere. Storage refused (a private window) keeps it
 * for this page only; the slot is then spent again on the next visit, which is acceptable.
 */

const PREFIX = 'mtb3a-share-viewer:';
const memory = new Map<string, string>();

/** Hex SHA-256 of the link token (WebCrypto). */
export async function linkDigest(linkToken: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(linkToken));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function readViewerToken(digest: string): string | null {
  try {
    const stored = localStorage.getItem(PREFIX + digest);
    if (stored) return stored;
  } catch {
    // Storage refused: the page's own copy, if any
  }
  return memory.get(digest) ?? null;
}

export function saveViewerToken(digest: string, viewerToken: string): void {
  memory.set(digest, viewerToken);
  try {
    localStorage.setItem(PREFIX + digest, viewerToken);
  } catch {
    // Private windows can refuse storage; the token then lasts for this page only
  }
}

/** The link answered "no longer available": nothing of it is kept. */
export function forgetViewerToken(digest: string): void {
  memory.delete(digest);
  try {
    localStorage.removeItem(PREFIX + digest);
  } catch {
    // Nothing stored
  }
}

export function resetViewerTokensForTests(): void {
  memory.clear();
}

/**
 * The link token for this tab: taken from the fragment once (the page strips it at once), then kept in sessionStorage
 * so a reload of this tab still opens the link. Never localStorage: it dies with the tab.
 */
const TAB_KEY = 'mtb3a-share-link';

export function rememberLinkForTab(token: string): void {
  try {
    sessionStorage.setItem(TAB_KEY, token);
  } catch {
    // The page keeps it in state regardless
  }
}

export function linkForTab(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}
