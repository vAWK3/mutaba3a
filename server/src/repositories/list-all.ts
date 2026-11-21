import type { PageCursor } from './ports.js';

/** Walks every page of a keyset-paginated list, whatever its cursor's shape. */
export async function listAll<T, C = PageCursor>(fetchPage: (cursor: C | null) => Promise<{ items: T[]; nextCursor: C | null }>): Promise<T[]> {
  const all: T[] = [];
  let cursor: C | null = null;
  for (let i = 0; i < 1000; i += 1) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}
