/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Structural proof that Home and the Clients layout are the owed screens
 * (MUT-89, ADR-051): they carry `staticData.owedLens`, which AppShell's
 * `useOwedScreenSync` reads to offer "All businesses". `/clients/$clientId`
 * sits under the Clients layout, so its matches include the tagged layout.
 * The sync's behaviour is proven in `allBusinessesLens.test.tsx`.
 */
const OWED = ['/', '/clients', '/clients/$clientId'];
const NOT_OWED = ['/income', '/settings', '/expenses', '/projects', '/insights', '/planning', '/retainers', '/documents'];

type RouteLike = { options: { staticData?: { owedLens?: boolean } }; parentRoute?: RouteLike };
let routesByPath: Record<string, RouteLike>;

/** What useOwedScreenSync sees: a route is owed when it, or a layout above it, is tagged */
function isOwed(route: RouteLike | undefined): boolean {
  for (let r = route; r; r = r.parentRoute) {
    if (r.options.staticData?.owedLens) return true;
  }
  return false;
}

beforeAll(async () => {
  // router.tsx reads the Vite-defined build mode at module load
  vi.stubGlobal('__BUILD_MODE__', 'desktop');
  const { router } = await import('../router');
  routesByPath = router.routesByPath as unknown as Record<string, RouteLike>;
});

describe('router owed-lens tags', () => {
  it.each(OWED)('%s is an owed screen', (path) => {
    expect(routesByPath[path], `route ${path} exists`).toBeDefined();
    expect(isOwed(routesByPath[path])).toBe(true);
  });

  it.each(NOT_OWED)('%s is not an owed screen', (path) => {
    expect(routesByPath[path], `route ${path} exists`).toBeDefined();
    expect(isOwed(routesByPath[path])).toBe(false);
  });
});
