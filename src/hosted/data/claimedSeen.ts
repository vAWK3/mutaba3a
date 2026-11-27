/**
 * MUT-768 (accountant channel, Claude Design brief): the "Claimed" spot is shown once per client, the first time the
 * accountant opens a customer who has claimed. This remembers which customers it was shown for, in localStorage: a
 * per-viewer convenience, so with storage blocked the spot simply shows again.
 */
const KEY = 'mtb3a.desk.claimedSeen';

function read(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export const hasSeenClaimed = (userId: string): boolean => read().includes(userId);

export function markClaimedSeen(userId: string): void {
  try {
    const seen = read();
    if (!seen.includes(userId)) localStorage.setItem(KEY, JSON.stringify([...seen, userId]));
  } catch {
    // Storage blocked or full: the spot shows again next time.
  }
}
