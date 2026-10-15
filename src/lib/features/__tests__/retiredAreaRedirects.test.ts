/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';

/**
 * MUT-226: Planning and the local Retainers area are retired. Their old URLs,
 * with whatever search a bookmark carried, land on Home. The router has no
 * not-found component (ADR-067 §4), so a missing route would be a blank page.
 */
type RouteLike = { options: { beforeLoad?: (ctx: { search: Record<string, unknown> }) => unknown; component?: unknown } };
let routesByPath: Record<string, RouteLike>;

beforeAll(async () => {
  vi.stubGlobal('__BUILD_MODE__', 'desktop');
  const { router } = await import('../../../router');
  routesByPath = router.routesByPath as unknown as Record<string, RouteLike>;
});

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('retired area URLs redirect home', () => {
  it.each([
    ['/planning', { plan: 'p1', scenario: 's1' }],
    ['/retainers', { status: 'active', clientId: 'c1' }],
  ])('%s redirects to / without rendering anything', (path, search) => {
    const route = routesByPath[path];
    expect(route, `route ${path} exists`).toBeDefined();
    expect(route.options.component).toBeUndefined();
    const thrown = thrownBy(() => route.options.beforeLoad!({ search }));
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/');
  });
});
