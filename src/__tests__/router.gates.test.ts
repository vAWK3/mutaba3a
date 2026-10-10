/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Structural proof that the gated routes carry a `beforeLoad` guard and the
 * core routes do not (MUT-13; MUT-16 extends the list). The guard's behaviour
 * is proven in `src/lib/features/__tests__/routeGuard.test.ts`.
 */
const GATED = ['/documents', '/documents/new', '/documents/$documentId', '/documents/$documentId/edit', '/retainers'];
const UNGATED = ['/', '/income', '/clients', '/clients/$clientId', '/settings'];

type RouteLike = { options: { beforeLoad?: unknown } };
let routesByPath: Record<string, RouteLike>;

beforeAll(async () => {
  // router.tsx reads the Vite-defined build mode at module load
  vi.stubGlobal('__BUILD_MODE__', 'desktop');
  const { router } = await import('../router');
  routesByPath = router.routesByPath as unknown as Record<string, RouteLike>;
});

describe('router feature gates', () => {
  it.each(GATED)('%s has a beforeLoad guard', (path) => {
    expect(routesByPath[path], `route ${path} exists`).toBeDefined();
    expect(typeof routesByPath[path].options.beforeLoad).toBe('function');
  });

  it.each(UNGATED)('%s is not gated', (path) => {
    expect(routesByPath[path], `route ${path} exists`).toBeDefined();
    expect(routesByPath[path].options.beforeLoad).toBeUndefined();
  });
});
