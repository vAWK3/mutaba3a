/**
 * MUT-562 (D8, review fix 2): a share link's viewer token. The live token stays in this page's memory. What persists in
 * localStorage is only what keeps this device's place among the link's 3 viewers: the token with its
 * `viewerExpiresAt` and the link's own end, under the SHA-256 of the link token (never the link token itself). A token
 * past the link's end can keep no place, so it is dropped when read. Storage refused (a private window): memory only.
 *
 * Deviation (noted in the brief): the record is dropped at the link's end, not at `viewerExpiresAt`, because the
 * server keeps a device's place only when the ended viewer token comes back with the PIN (MUT-560 unlock).
 */

const PREFIX = 'mtb3a-share-viewer:';

export interface ViewerRecord {
  viewerToken: string;
  viewerExpiresAt: string;
  linkExpiresAt: string;
}

const memory = new Map<string, ViewerRecord>();

/** Hex SHA-256 of the link token (WebCrypto). */
export async function linkDigest(linkToken: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(linkToken));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parse(raw: string | null): ViewerRecord | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<ViewerRecord>;
    if (typeof record.viewerToken === 'string' && typeof record.viewerExpiresAt === 'string' && typeof record.linkExpiresAt === 'string') return record as ViewerRecord;
  } catch {
    // An older or malformed entry: nothing to keep
  }
  return null;
}

/** The token to send with the PIN so this device keeps its place; null (and the record dropped) once the link ended. */
export function readViewerToken(digest: string, now: Date = new Date()): string | null {
  let record = memory.get(digest) ?? null;
  try {
    record ??= parse(localStorage.getItem(PREFIX + digest));
  } catch {
    // Storage refused: memory only
  }
  if (!record) return null;
  if (new Date(record.linkExpiresAt).getTime() <= now.getTime()) {
    forgetViewerToken(digest);
    return null;
  }
  return record.viewerToken;
}

export function saveViewerToken(digest: string, record: ViewerRecord): void {
  memory.set(digest, record);
  try {
    localStorage.setItem(PREFIX + digest, JSON.stringify(record));
  } catch {
    // Private windows can refuse storage; the token then lasts for this page only
  }
}

/** The link answered "no longer available" (or ended): nothing of it is kept. */
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

/** The link ended for this tab (gone, locked, full): the tab forgets it too. */
export function forgetLinkForTab(): void {
  try {
    sessionStorage.removeItem(TAB_KEY);
  } catch {
    // Nothing stored
  }
}

export function linkForTab(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}
