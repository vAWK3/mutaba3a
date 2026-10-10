/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';

/**
 * MUT-14: the deleted expense pages' paths still exist as redirect-only
 * routes so old links land on the ledger (which then applies the switch).
 */
const LEGACY = [
  '/expenses/profiles',
  '/expenses/profile/$profileId',
  '/expenses/profile/$profileId/receipts',
  '/expenses/overview',
  '/expenses/forecast',
  '/expenses/vendors',
  '/expenses/close/profile/$profileId',
  '/suppliers',
];

type RouteLike = { options: { beforeLoad?: (ctx: unknown) => unknown; component?: unknown } };
let routesByPath: Record<string, RouteLike>;

beforeAll(async () => {
  vi.stubGlobal('__BUILD_MODE__', 'desktop');
  const { router } = await import('../../../router');
  routesByPath = router.routesByPath as unknown as Record<string, RouteLike>;
});

describe('legacy expense routes', () => {
  it.each(LEGACY)('%s redirects to /expenses and loads no page', async (path) => {
    const route = routesByPath[path];
    expect(route, `route ${path} exists`).toBeDefined();
    expect(route.options.component).toBeUndefined();
    let thrown: unknown;
    try {
      await route.options.beforeLoad!({});
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/expenses');
  });
});
